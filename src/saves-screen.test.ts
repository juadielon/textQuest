// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdventureSettings, type RandomValueSource } from './adventure-settings';
import {
  createSave, createSaveStore, MAX_SAVE_FILE_LENGTH, SAVE_KEY_PREFIX, SaveError, type SaveStore, type StorageLike,
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
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it('reports a full storage and leaves the stored save as it was', async () => {
    const save = createSave('Old trip', settings, ['look'], earlier);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save } });
    storage.failWrites = true;

    form.requestSubmit();
    await lock.settled();

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
    [...app.querySelectorAll('button')].find((node) => node.textContent === 'Back to start')!.click();
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

  it('sets save names and import labels through textContent', () => {
    store.add(createSave('<b>Trip</b>', settings, [], earlier));
    const setText = vi.spyOn(Element.prototype, 'textContent', 'set');

    render();

    expect(setText).toHaveBeenCalledWith('<b>Trip</b>');
    expect(setText).toHaveBeenCalledWith('Save file');
    expect(app.querySelector('b')).toBeNull();
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
    expect(buttonNamed('Export: Unreadable save')).toBeNull();
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

  it.each([
    [1, '../Tower: <b>trip</b>?', 'textquest-Tower-b-trip-b.json'],
    [2, '../Tower: <b>trip</b>?', 'textquest-Tower-b-trip-b.json'],
    [1, '???', 'textquest-save.json'],
    [2, '???', 'textquest-save.json'],
  ] as const)('downloads version %i save %j as JSON with a safe file name and releases the URL', async (version, name, fileName) => {
    const id = store.add(createSave(name, createAdventureSettings(7, 'short', version), ['look', 'hint'], earlier));
    const before = new Map(storage.items);
    let blob: Blob | undefined;
    vi.useFakeTimers();
    const makeUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      if (value instanceof Blob) blob = value;
      return 'blob:save-file';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
      expect(this.download).toBe(fileName);
      expect(this.href).toBe('blob:save-file');
    });
    render();

    buttonNamed(`Export: ${name}`).click();

    expect(makeUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(blob?.type).toBe('application/json');
    expect(await blob?.text()).toBe(store.exportSave(id));
    expect(app.querySelector('[role="status"]')?.textContent).toContain('download started');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:save-file');
    expect(storage.items).toEqual(before);
  });

  it('reports export errors without changing saves', () => {
    store.add(createSave('Trip', settings, [], earlier));
    const before = new Map(storage.items);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('blocked'); });
    render();

    buttonNamed('Export: Trip').click();

    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/Something went wrong/);
    expect(storage.items).toEqual(before);
  });

  function chooseFile(text: string) {
    const input = app.querySelector<HTMLInputElement>('#import-save')!;
    const file = new File([text], 'trip.json', { type: 'application/json' });
    const read = vi.spyOn(file, 'arrayBuffer');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    const form = input.closest('form')!;
    return { input, file, read, form, submit: form.querySelector<HTMLButtonElement>('button')! };
  }

  it.each([1, 2])('imports a matching-name version %i adventure as a new save and can resume it', async (version) => {
    const save = createSave('<b>Trip</b>', createAdventureSettings(7, 'short', version), ['look', 'hint'], earlier);
    const id = store.add(save);
    const before = storage.items.get(`${SAVE_KEY_PREFIX}${id}`);
    render();
    const { input, form } = chooseFile(store.exportSave(id));
    expect(app.querySelector<HTMLLabelElement>('label[for="import-save"]')?.textContent).toBe('Save file');
    expect(input.accept).toBe('.json,application/json');
    expect(input.getAttribute('aria-describedby')).toBe('saves-status');

    form.requestSubmit();
    await vi.waitFor(() => expect(store.list()).toHaveLength(2));

    expect(storage.items.get(`${SAVE_KEY_PREFIX}${id}`)).toBe(before);
    expect(texts('.save-item h2')).toEqual(['<b>Trip</b>', '<b>Trip</b>']);
    expect(app.querySelector('b')).toBeNull();
    expect(app.querySelector('[role="status"]')?.textContent).toBe('Imported the save as a new save.');
    expect(document.activeElement).toBe(app.querySelector('[role="status"]'));
    expect(input.value).toBe('');
    buttonNamed('Resume: <b>Trip</b>').click();
    expect(onResume.mock.calls[0][0].save).toEqual(save);
  });

  it('asks for a file and focuses the labelled input', () => {
    render();
    app.querySelector<HTMLFormElement>('form')!.requestSubmit();

    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/Choose a textQuest save file/);
    expect(document.activeElement).toBe(app.querySelector('#import-save'));
    expect(store.list()).toEqual([]);
  });

  it.each([
    ['{broken', /not valid JSON/],
    ['{}', /damaged/],
    [JSON.stringify({ formatVersion: 2 }), /newer version/],
    [' '.repeat(MAX_SAVE_FILE_LENGTH + 1), /too large/],
  ])('rejects a bad file without changing any saves', async (text, message) => {
    store.add(createSave('Trip', settings, [], earlier));
    storage.items.set(`${SAVE_KEY_PREFIX}${'f'.repeat(32)}`, '{unreadable');
    const before = new Map(storage.items);
    render();
    const { form, submit } = chooseFile(text);

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(app.querySelector('[role="status"]')?.textContent).toMatch(message);
    expect(document.activeElement).toBe(app.querySelector('[role="status"]'));
    expect(storage.items).toEqual(before);
    expect(texts('.save-item h2')).toEqual(['Trip', 'Unreadable save']);
  });

  it('rejects invalid UTF-8 rather than changing the save text', async () => {
    const id = store.add(createSave('Trip', settings, ['look'], earlier));
    const before = new Map(storage.items);
    const text = store.exportSave(id);
    const bytes = new TextEncoder().encode(text);
    bytes[text.indexOf('"Trip"') + 1] = 0xff;
    render();
    const { input, form, submit } = chooseFile('');
    const file = new File([bytes], 'damaged.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/could not be read|damaged/);
    expect(storage.items).toEqual(before);
  });

  it('accepts a valid non-ASCII save whose byte size exceeds the character limit', async () => {
    const save = createSave('Trip', settings, Array(1700).fill('\u6f22'.repeat(200)), earlier);
    const id = store.add(save);
    render();
    const { file, form, submit } = chooseFile(store.exportSave(id));
    expect(file.size).toBeGreaterThan(MAX_SAVE_FILE_LENGTH);

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    const imported = store.list().find((entry) => entry.id !== id);
    expect(imported).toBeDefined();
    expect(store.load(imported!.id)).toEqual(save);
  });

  it('reports a successful import even if an extra read would fail', async () => {
    const id = store.add(createSave('Trip', settings, ['look'], earlier));
    render();
    const { form, submit } = chooseFile(store.exportSave(id));
    vi.spyOn(store, 'load').mockImplementation(() => { throw new Error('blocked'); });

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(store.list()).toHaveLength(2);
    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/Imported/);
  });

  it('reports an import succeeded when its list cannot be refreshed', async () => {
    const id = store.add(createSave('Trip', settings, ['look'], earlier));
    render();
    const { input, form, submit } = chooseFile(store.exportSave(id));
    vi.spyOn(store, 'list').mockImplementationOnce(() => {
      throw new SaveError('storage-unavailable', 'Storage is blocked.');
    });

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(store.list()).toHaveLength(2);
    expect(input.value).toBe('');
    expect(app.querySelector('[role="status"]')?.textContent)
      .toBe('The save was imported, but the list could not be refreshed. Storage is blocked.');
  });

  it('rejects an oversized file before reading it', async () => {
    render();
    const { file, read, form, submit } = chooseFile('');
    Object.defineProperty(file, 'size', { value: MAX_SAVE_FILE_LENGTH * 3 + 1 });

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(read).not.toHaveBeenCalled();
    expect(app.querySelector('[role="status"]')?.textContent).toMatch(/too large/);
    expect(store.list()).toEqual([]);
  });

  it.each(['read', 'storage'])('reports a %s failure and leaves existing saves untouched', async (failure) => {
    const id = store.add(createSave('Trip', settings, [], earlier));
    render();
    const { read, form, submit } = chooseFile(store.exportSave(id));
    const before = new Map(storage.items);
    if (failure === 'read') read.mockRejectedValue(new Error('unreadable'));
    else storage.failWrites = true;

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(app.querySelector('[role="status"]')?.textContent).toMatch(
      failure === 'read' ? /could not be read/ : /no room left for saves/,
    );
    expect(storage.items).toEqual(before);
  });

  it.each([false, true])('prevents duplicate imports and ignores a read after navigation: %s', async (leave) => {
    const id = store.add(createSave('Trip', settings, [], earlier));
    const text = store.exportSave(id);
    render();
    const { input, read, form, submit } = chooseFile(text);
    let finish!: (bytes: ArrayBuffer) => void;
    read.mockReturnValue(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));

    form.requestSubmit();
    form.requestSubmit();
    expect(input.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(app.querySelector('[role="status"]')?.textContent).toBe('Reading your save file…');
    if (leave) app.replaceChildren();
    finish(new TextEncoder().encode(text).buffer);
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(store.list()).toHaveLength(leave ? 1 : 2);
    if (leave) expect(app.childNodes).toHaveLength(0);
  });
});
