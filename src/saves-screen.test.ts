// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdventureSettings, type RandomValueSource } from './adventure-settings';
import {
  createSave, createSaveStore, SAVE_KEY_PREFIX, type SaveStore, type StorageLike,
} from './saves';
import {
  buildSaveForm, formatLastPlayed, noLocksMessage, noSavesMessage, renderSavesScreen, SAVE_LOCK_NAME,
  saveNameMessage, type SaveLocks,
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

// Like Web Locks shared by every tab: tasks run one at a time, later, in order.
function fakeLocks() {
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((name: string, task: () => unknown) => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  });
  return { locks: { request } as unknown as SaveLocks, request, settled: () => queue };
}

const settings = createAdventureSettings(7, 'long');
const earlier = new Date('2026-10-01T09:00:00.000Z');
const later = new Date('2026-10-02T10:30:00.000Z');
let storage: MemoryStorage;
let store: SaveStore;
let app: HTMLElement;
let lock: ReturnType<typeof fakeLocks>;

beforeEach(() => {
  storage = new MemoryStorage();
  store = createSaveStore(storage, countingSource());
  lock = fakeLocks();
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
      now: () => times.shift() ?? later, locks: lock.locks, ...options,
    });
    app.append(form);
    return {
      form,
      name: form.querySelector<HTMLInputElement>('#save-name')!,
      status: form.querySelector('[role="status"]')!,
    };
  }

  it('adds a save, then updates the same one under the shared lock and keeps its created time', async () => {
    const commands = ['look'];
    const { form, name, status } = mountForm(commands);
    expect(name.value).toBe('silverlantern');
    expect(form.querySelector('label')?.htmlFor).toBe('save-name');

    form.requestSubmit();
    commands.push('hint');
    name.value = '  Tower trip ';
    form.requestSubmit();
    commands.push('inventory');
    await lock.settled();

    const [entry] = store.list();
    expect(store.list()).toHaveLength(1);
    expect(store.load(entry.id)).toEqual({
      ...createSave('Tower trip', settings, ['look', 'hint'], later),
      createdAt: earlier.toISOString(),
    });
    expect(status.textContent).toBe('Saved “Tower trip”.');
    expect(lock.request.mock.calls.map(([lockName]) => lockName)).toEqual([SAVE_LOCK_NAME, SAVE_LOCK_NAME]);
  });

  it.each([1, 2])('updates a resumed version %i save and keeps its adventure version', async (version) => {
    const resumedSettings = createAdventureSettings(7, 'short', version);
    const save = createSave('Old trip', resumedSettings, ['look'], earlier);
    const id = store.add(save);
    const { form, name } = mountForm(['look', 'hint'], {
      resumed: { id, save }, settings: resumedSettings, now: () => later,
    });
    expect(name.value).toBe('Old trip');

    form.requestSubmit();
    await lock.settled();

    expect(store.list()).toHaveLength(1);
    expect(store.load(id)).toMatchObject({
      settings: resumedSettings, commands: ['look', 'hint'], createdAt: earlier.toISOString(),
    });
  });

  it('still updates when the clock has gone backwards since the save was made', async () => {
    const save = createSave('Old trip', settings, ['look'], later);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save }, now: () => earlier });

    form.requestSubmit();
    await lock.settled();

    expect(status.textContent).toBe('Saved “Old trip”.');
    expect(store.load(id)).toMatchObject({
      commands: ['look', 'hint'], createdAt: later.toISOString(), updatedAt: later.toISOString(),
    });
  });

  it('keeps Last played when the clock moves between creation and the previous update', async () => {
    const save = { ...createSave('Trip', settings, ['look'], later), createdAt: earlier.toISOString() };
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], {
      resumed: { id, save }, now: () => new Date('2026-10-01T12:00:00.000Z'),
    });

    form.requestSubmit();
    await lock.settled();

    expect(status.textContent).toBe('Saved “Trip”.');
    expect(store.load(id)).toMatchObject({
      commands: ['look', 'hint'], createdAt: earlier.toISOString(), updatedAt: later.toISOString(),
    });
  });

  it.each(['rejects', 'throws'])('reports a lock request that %s without changing the save', async (failure) => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save } });
    lock.request.mockImplementationOnce(() => {
      const error = new DOMException('blocked', 'SecurityError');
      if (failure === 'throws') throw error;
      return Promise.reject(error);
    });

    form.requestSubmit();
    await Promise.resolve();

    expect(status.textContent).toBe('Your browser could not lock save storage. Nothing was changed. Please try again.');
    expect(store.load(id)).toEqual(save);
    expect(store.list()).toHaveLength(1);
    form.requestSubmit();
    await lock.settled();
    expect(store.load(id).commands).toEqual(['look', 'hint']);
  });

  it('keeps newer progress saved elsewhere, then saves this progress as a new save', async () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const elsewhere = { ...createSave('Trip', settings, ['look', 'north'], later), createdAt: save.createdAt };
    store.put(id, elsewhere);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save }, now: () => later });

    form.requestSubmit();
    await lock.settled();

    expect(status.textContent).toBe(
      'This save was changed in another tab or window, so it was not overwritten. '
      + 'Choose Save adventure again to keep this progress as a new save.',
    );
    expect(store.load(id)).toEqual(elsewhere);

    form.requestSubmit();
    await lock.settled();

    expect(status.textContent).toBe('Saved “Trip”.');
    expect(store.load(id)).toEqual(elsewhere);
    expect(store.list().map((entry) => entry.id)).toHaveLength(2);
  });

  it('does not bring back a save deleted elsewhere', async () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save } });
    store.remove(id);

    form.requestSubmit();
    await lock.settled();

    expect(status.textContent).toMatch(/^This save was deleted in another tab or window, so it was not overwritten\./);
    expect(storage.items.size).toBe(0);
  });

  it('lets only the first of two tabs saving the same moment update the save', async () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    // Same save, same clock: only the commands differ.
    const first = mountForm(['look', 'north'], { resumed: { id, save }, now: () => later });
    const second = mountForm(['look', 'south'], { resumed: { id, save }, now: () => later });

    first.form.requestSubmit();
    second.form.requestSubmit();
    await lock.settled();

    expect(first.status.textContent).toBe('Saved “Trip”.');
    expect(second.status.textContent).toMatch(/^This save was changed in another tab or window/);
    expect(store.load(id).commands).toEqual(['look', 'north']);
    expect(store.list()).toHaveLength(1);
  });

  it('saves a resumed adventure as a new save when the browser has no Web Locks', () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save }, locks: undefined });

    form.requestSubmit();

    expect(status.textContent).toBe(`Saved “Trip” as a new save. ${noLocksMessage}`);
    expect(store.load(id)).toEqual(save);
    expect(store.list()).toHaveLength(2);
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

  it.each([true, false])('reports full storage and keeps the save with Web Locks available: %s', async (hasLocks) => {
    const save = createSave('Old trip', settings, ['look'], earlier);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], {
      resumed: { id, save }, locks: hasLocks ? lock.locks : undefined,
    });
    storage.failWrites = true;

    form.requestSubmit();
    await lock.settled();

    expect(status.textContent).toMatch(/deleting an old save or freeing browser storage/);
    expect(store.list()).toHaveLength(1);
    expect(store.load(id)).toEqual(save);
  });
});

describe('renderSavesScreen', () => {
  const onResume = vi.fn();
  const onBack = vi.fn();

  function render(): void {
    onResume.mockClear();
    onBack.mockClear();
    renderSavesScreen(app, { store, onResume, onBack, locks: lock.locks });
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

  it('lets an unexpected problem starting play surface instead of calling it a save problem', () => {
    store.add(createSave('Trip', settings, ['look'], earlier));
    render();
    const failure = new TypeError('play broke');
    onResume.mockImplementationOnce(() => { throw failure; });
    const reported: unknown[] = [];
    const onError = (event: ErrorEvent) => { reported.push(event.error); event.preventDefault(); };
    window.addEventListener('error', onError);

    try {
      buttonNamed('Resume: Trip').click();
    } catch (error) {
      reported.push(error);
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(reported).toEqual([failure]);
    expect(app.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('waits for the shared lock before deleting, so a queued save cannot bring it back', async () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    renderSavesScreen(app, { store, onResume, onBack, locks: lock.locks });
    const tab = buildSaveForm({
      store, settings, suggestedName: 'Trip', commands: () => ['look', 'hint'],
      resumed: { id, save }, now: () => later, locks: lock.locks,
    });
    document.body.append(tab);

    buttonNamed('Delete: Trip').click();
    buttonNamed('Yes, delete: Trip').click();
    expect(store.list()).toHaveLength(1);
    tab.requestSubmit();
    await lock.settled();

    expect(storage.items.size).toBe(0);
    expect(app.querySelector('[role="status"]')?.textContent).toBe('Deleted “Trip”.');
    expect(tab.querySelector('[role="status"]')?.textContent).toMatch(/^This save was deleted in another tab/);
  });

  it('only deletes after confirmation, and Keep cancels', async () => {
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
    await lock.settled();

    expect(store.list()).toEqual([]);
    expect(app.querySelector('[role="status"]')?.textContent).toBe('Deleted “Trip”.');
    expect(document.activeElement).toBe(app.querySelector('[role="status"]'));
    expect(texts('.saves-list li')).toEqual([noSavesMessage]);
  });

  it('shows unreadable saves with the reason and keeps them', async () => {
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
    await lock.settled();
    expect(storage.items.has(key)).toBe(false);
  });

  it.each(['rename', 'progress'])('keeps a save with a same-timestamp %s before delete gets the lock', async (change) => {
    const save = createSave('Old name', settings, ['look'], earlier);
    const id = store.add(save);
    render();
    buttonNamed('Delete: Old name').click();
    const updated = change === 'rename' ? { ...save, name: 'New name' } : { ...save, commands: ['look', 'hint'] };
    void lock.request(SAVE_LOCK_NAME, () => store.put(id, updated));

    buttonNamed('Yes, delete: Old name').click();
    await lock.settled();

    expect(store.load(id)).toEqual(updated);
    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/not deleted.*refreshed list.*confirm Delete again/);
    expect(document.activeElement).toBe(app.querySelector('[role="status"]'));
    expect(buttonNamed('Yes, delete: Old name')).toBeNull();
    buttonNamed(`Delete: ${updated.name}`).click();
    buttonNamed(`Yes, delete: ${updated.name}`).click();
    await lock.settled();
    expect(store.list()).toEqual([]);
  });

  it.each(['recovered', 'still unreadable'])('keeps an unreadable save changed elsewhere to %s', async (change) => {
    const save = createSave('Recovered', settings, [], earlier);
    const id = store.add(save);
    const key = SAVE_KEY_PREFIX + id;
    storage.items.set(key, 'broken');
    render();
    buttonNamed('Delete: Unreadable save').click();
    if (change === 'recovered') store.put(id, save);
    else storage.items.set(key, 'different broken text');
    const before = storage.items.get(key);

    buttonNamed('Yes, delete: Unreadable save').click();
    await lock.settled();

    expect(storage.items.get(key)).toBe(before);
    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/not deleted/);
    expect(texts('.save-item h2')).toEqual([change === 'recovered' ? 'Recovered' : 'Unreadable save']);
  });

  it.each(['rejects', 'throws'])('reports a delete lock request that %s and leaves storage alone', async (failure) => {
    const save = createSave('Trip', settings, [], earlier);
    const id = store.add(save);
    render();
    const before = new Map(storage.items);
    lock.request.mockImplementationOnce(() => {
      const error = new DOMException('blocked', 'SecurityError');
      if (failure === 'throws') throw error;
      return Promise.reject(error);
    });
    buttonNamed('Delete: Trip').click();

    buttonNamed('Yes, delete: Trip').click();
    await Promise.resolve();

    expect(app.querySelector('[role="status"]')?.textContent).toBe(
      'Your browser could not lock save storage. Nothing was changed. Please try again.',
    );
    expect(document.activeElement).toBe(app.querySelector('[role="status"]'));
    expect(storage.items).toEqual(before);
    expect(store.load(id)).toEqual(save);
  });

  it('refuses deletion when the browser has no Web Locks', () => {
    const save = createSave('Trip', settings, [], earlier);
    const id = store.add(save);
    renderSavesScreen(app, { store, onResume, onBack, locks: undefined });
    buttonNamed('Delete: Trip').click();

    buttonNamed('Yes, delete: Trip').click();

    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/can’t safely delete.*kept/);
    expect(store.load(id)).toEqual(save);
  });

  it('reports a save that became unreadable before resuming', () => {
    const id = store.add(createSave('Trip', settings, [], earlier));
    render();
    storage.items.set(`${SAVE_KEY_PREFIX}${id}`, '[]');

    buttonNamed('Resume: Trip').click();

    expect(onResume).not.toHaveBeenCalled();
    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/damaged/);
  });

  it('reports blocked storage in a live region already attached to the screen', () => {
    store.add(createSave('Trip', settings, [], earlier));
    let statusBeforeRead: { attached: boolean; text: string | null } | undefined;
    vi.spyOn(storage, 'key').mockImplementation(() => {
      const status = app.querySelector('[role="status"]');
      statusBeforeRead = { attached: status?.isConnected === true, text: status?.textContent ?? null };
      throw new Error('blocked');
    });

    render();

    expect(statusBeforeRead).toEqual({ attached: true, text: '' });
    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/would not let textQuest/);
    expect(app.querySelectorAll('.saves-list li')).toHaveLength(0);
    expect(document.activeElement).toBe(app.querySelector('h1'));
  });
});
