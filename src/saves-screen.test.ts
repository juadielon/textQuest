// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdventureSettings, type RandomValueSource } from './adventure-settings';
import {
  createSave, createSaveStore, SAVE_KEY_PREFIX, type SaveStore, type StorageLike,
} from './saves';
import {
  buildSaveForm, formatLastPlayed, noSavesMessage, renderSavesScreen, saveNameMessage,
} from './saves-screen';
import { genreLabels, lengthLabels } from './start-screen-model';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failWrites = false;
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    this.items.set(key, value);
  }
  removeItem(key: string) { this.items.delete(key); }
}

// Counts up, so new save IDs are predictable.
function countingSource(): RandomValueSource {
  let next = 0;
  return { getRandomValues(array) { next += 1; array.fill(next); return array; } };
}

const settings = createAdventureSettings(7, 'long');
const earlier = new Date('2026-10-01T09:00:00.000Z');
const later = new Date('2026-10-02T10:30:00.000Z');
let storage: MemoryStorage;
let store: SaveStore;
let app: HTMLElement;

beforeEach(() => {
  storage = new MemoryStorage();
  store = createSaveStore(storage, countingSource());
  app = document.createElement('main');
  document.body.append(app);
});

afterEach(() => {
  document.body.replaceChildren();
});

const texts = (selector: string) => [...app.querySelectorAll(selector)].map((node) => node.textContent);
const buttonNamed = (name: string) =>
  app.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

describe('formatLastPlayed', () => {
  it('shows a readable Australian date and time', () => {
    expect(formatLastPlayed(later.toISOString())).toBe(
      new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(later),
    );
  });
});

describe('buildSaveForm', () => {
  function mountForm(commands: string[], options: Partial<Parameters<typeof buildSaveForm>[0]> = {}) {
    const times = [earlier, later];
    const form = buildSaveForm({
      store, settings, suggestedName: 'silverlantern', commands: () => commands,
      now: () => times.shift() ?? later, ...options,
    });
    app.append(form);
    return {
      form,
      name: form.querySelector<HTMLInputElement>('#save-name')!,
      status: form.querySelector('[role="status"]')!,
    };
  }

  it('adds a save, then updates the same one and keeps its created time', () => {
    const commands = ['look'];
    const { form, name, status } = mountForm(commands);
    expect(name.value).toBe('silverlantern');
    expect(form.querySelector('label')?.htmlFor).toBe('save-name');

    form.requestSubmit();
    commands.push('hint');
    name.value = '  Tower trip ';
    form.requestSubmit();

    const [entry] = store.list();
    expect(store.list()).toHaveLength(1);
    expect(store.load(entry.id)).toEqual({
      ...createSave('Tower trip', settings, ['look', 'hint'], later),
      createdAt: earlier.toISOString(),
    });
    expect(status.textContent).toBe('Saved “Tower trip”.');
  });

  it('updates the save an adventure was resumed from', () => {
    const save = createSave('Old trip', settings, ['look'], earlier);
    const id = store.add(save);
    const { form, name } = mountForm(['look', 'hint'], { resumed: { id, save }, now: () => later });
    expect(name.value).toBe('Old trip');

    form.requestSubmit();

    expect(store.list()).toHaveLength(1);
    expect(store.load(id).commands).toEqual(['look', 'hint']);
    expect(store.load(id).createdAt).toBe(earlier.toISOString());
  });

  it('still updates when the clock has gone backwards since the save was made', () => {
    const save = createSave('Old trip', settings, ['look'], later);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save }, now: () => earlier });

    form.requestSubmit();

    expect(status.textContent).toBe('Saved “Old trip”.');
    expect(store.load(id)).toMatchObject({
      commands: ['look', 'hint'], createdAt: later.toISOString(), updatedAt: later.toISOString(),
    });
  });

  it.each(['   ', 'tab\there'])('asks for a usable name instead of saving %j', (value) => {
    const { form, name, status } = mountForm([]);
    name.value = value;

    form.requestSubmit();

    expect(status.textContent).toBe(saveNameMessage);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(storage.items.size).toBe(0);
  });

  it('reports a full storage and leaves the stored save as it was', () => {
    const save = createSave('Old trip', settings, ['look'], earlier);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save } });
    storage.failWrites = true;

    form.requestSubmit();

    expect(status.textContent).toMatch(/no room left for saves/);
    expect(store.load(id)).toEqual(save);
  });
});

describe('renderSavesScreen', () => {
  const onResume = vi.fn();
  const onBack = vi.fn();

  function render(): void {
    onResume.mockClear();
    onBack.mockClear();
    renderSavesScreen(app, { store, onResume, onBack });
  }

  it('says when there are no saves and focuses the heading', () => {
    render();

    expect(app.querySelector('h1')?.textContent).toBe('Your saves');
    expect(document.activeElement).toBe(app.querySelector('h1'));
    expect(texts('.saves-list li')).toEqual([noSavesMessage]);
    app.querySelector<HTMLButtonElement>('button')!.click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('lists name, genre, length and last played time, newest first', () => {
    store.add(createSave('First', settings, [], earlier));
    store.add(createSave('<b>Second</b>', createAdventureSettings(3, 'short'), [], later));

    render();

    expect(texts('.save-item h2')).toEqual(['<b>Second</b>', 'First']);
    expect(app.querySelector('b')).toBeNull();
    const first = app.querySelectorAll('.save-item')[1];
    expect([...first.querySelectorAll('dt, dd')].map((node) => node.textContent)).toEqual([
      'Genre', genreLabels[settings.genre],
      'Length', lengthLabels.long,
      'Last played', formatLastPlayed(earlier.toISOString()),
    ]);
    expect(first.getAttribute('aria-labelledby')).toBe(first.querySelector('h2')?.id);
  });

  it('resumes a loaded save', () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    render();

    buttonNamed('Resume: Trip').click();

    expect(onResume).toHaveBeenCalledExactlyOnceWith({ id, save });
  });

  it('only deletes after confirmation, and Keep cancels', () => {
    const id = store.add(createSave('Trip', settings, [], earlier));
    render();

    buttonNamed('Delete: Trip').click();
    expect(app.textContent).toContain('Delete “Trip”? This can’t be undone.');
    expect(document.activeElement).toBe(buttonNamed('Keep: Trip'));
    const question = app.querySelector(`#${buttonNamed('Keep: Trip').getAttribute('aria-describedby')}`);
    expect(question?.textContent).toBe('Delete “Trip”? This can’t be undone.');
    expect(buttonNamed('Yes, delete: Trip').getAttribute('aria-describedby')).toBe(question?.id);
    buttonNamed('Keep: Trip').click();
    expect(document.activeElement).toBe(buttonNamed('Delete: Trip'));
    expect(store.load(id).name).toBe('Trip');

    buttonNamed('Delete: Trip').click();
    buttonNamed('Yes, delete: Trip').click();

    expect(store.list()).toEqual([]);
    expect(app.querySelector('[role="status"]')?.textContent).toBe('Deleted “Trip”.');
    expect(document.activeElement).toBe(app.querySelector('[role="status"]'));
    expect(texts('.saves-list li')).toEqual([noSavesMessage]);
  });

  it('shows unreadable saves with the reason and keeps them', () => {
    store.add(createSave('Trip', settings, [], earlier));
    const key = `${SAVE_KEY_PREFIX}${'f'.repeat(32)}`;
    storage.items.set(key, '{not json');

    render();

    expect(texts('.save-item h2')).toEqual(['Trip', 'Unreadable save']);
    expect(app.querySelector('.save-item .error')?.textContent).toMatch(/not valid JSON/);
    expect(buttonNamed('Resume: Unreadable save')).toBeNull();
    expect(storage.items.get(key)).toBe('{not json');
    buttonNamed('Delete: Unreadable save').click();
    buttonNamed('Yes, delete: Unreadable save').click();
    expect(storage.items.has(key)).toBe(false);
  });

  it('reports a save that became unreadable before resuming', () => {
    const id = store.add(createSave('Trip', settings, [], earlier));
    render();
    storage.items.set(`${SAVE_KEY_PREFIX}${id}`, '[]');

    buttonNamed('Resume: Trip').click();

    expect(onResume).not.toHaveBeenCalled();
    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/damaged/);
  });

  it('explains blocked storage instead of listing saves', () => {
    store.add(createSave('Trip', settings, [], earlier));
    vi.spyOn(storage, 'key').mockImplementation(() => { throw new Error('blocked'); });

    render();

    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/would not let textQuest/);
    expect(app.querySelectorAll('.saves-list li')).toHaveLength(0);
  });
});
