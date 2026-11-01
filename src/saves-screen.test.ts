// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdventureSettings, type RandomValueSource } from './adventure-settings';
import {
  createSave, createSaveStore, MAX_SAVE_FILE_LENGTH, PLAYED_KEY_PREFIX,
  SAVE_KEY_PREFIX, SaveError, type AdventureSave, type SaveStore, type StorageLike,
} from './saves';
import {
  buildSaveForm, formatSaveTime, noLocksMessage, noSavesMessage, recordPlayed, renderSavesScreen,
  SAVE_LOCK_NAME, saveNameMessage, type SaveLocks,
} from './saves-screen';
import { genreLabels, lengthLabels } from './start-screen-model';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failWrites = false;
  failRemoveKey: string | null = null;
  failListAfterRemove = false;
  failList = false;
  failReadKey: string | null = null;
  get length() {
    if (this.failList) throw new DOMException('blocked', 'SecurityError');
    return this.items.size;
  }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) {
    if (key === this.failReadKey) throw new DOMException('blocked', 'SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    this.items.set(key, value);
  }
  removeItem(key: string) {
    if (key === this.failRemoveKey) {
      if (this.failListAfterRemove) this.failList = true;
      throw new DOMException('blocked', 'SecurityError');
    }
    this.items.delete(key);
  }
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

function withCommands(save: AdventureSave, commands: string[]): AdventureSave {
  return { ...save, commands, commandModes: commands.map(() => 'id' as const) };
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

describe('formatSaveTime', () => {
  it('shows a readable Australian date and time', () => {
    expect(formatSaveTime(later.toISOString())).toBe(
      new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(later),
    );
  });
});

describe('recordPlayed', () => {
  const firstPlay = new Date('2026-10-05T01:00:00.000Z');
  const secondPlay = new Date('2026-10-05T02:00:00.000Z');
  const addSave = () => store.add(createSave('Trip', settings, [], earlier));
  const playedTime = (id: string) => storage.items.get(PLAYED_KEY_PREFIX + id);
  function holdLock() {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    void lock.request(SAVE_LOCK_NAME, () => held);
    return release;
  }

  it('writes the time it was called under the lock every tab shares', async () => {
    const id = addSave();
    const result = vi.fn();
    recordPlayed(store, id, { now: firstPlay, locks: lock.locks, onResult: result });
    expect(lock.request).toHaveBeenCalledWith(SAVE_LOCK_NAME, expect.any(Function));
    expect(playedTime(id)).toBeUndefined();
    await lock.settled();
    expect(playedTime(id)).toBe(firstPlay.toISOString());
    expect(result).toHaveBeenCalledWith('recorded');
  });

  it('cannot move the time back when another tab records a later play at the same moment', async () => {
    // Regression: two tabs could both read the old time, then the earlier write could land last.
    const id = addSave();
    const release = holdLock();
    const markPlayed = vi.spyOn(store, 'markPlayed');
    recordPlayed(store, id, { now: secondPlay, locks: lock.locks });
    recordPlayed(store, id, { now: firstPlay, locks: lock.locks });
    await Promise.resolve();
    expect(markPlayed).not.toHaveBeenCalled();
    release();
    await lock.settled();
    expect(markPlayed).toHaveBeenCalledTimes(2);
    expect(playedTime(id)).toBe(secondPlay.toISOString());
  });

  it('leaves no time behind for a save deleted in another tab while it waited', async () => {
    const id = addSave();
    const [listed] = store.list();
    const release = holdLock();
    void lock.locks.request(SAVE_LOCK_NAME, () => createSaveStore(storage).remove(id, listed.snapshot));
    recordPlayed(store, id, { now: firstPlay, locks: lock.locks });
    release();
    await lock.settled();
    expect(storage.items.size).toBe(0);
  });

  it('reports a save deleted before its queued play-time write runs', async () => {
    const id = addSave();
    const result = vi.fn();
    let run!: () => void;
    const delayed = {
      request: vi.fn((_name: string, task: () => void) => new Promise<void>((resolve) => {
        run = () => { task(); resolve(); };
      })),
    } as unknown as SaveLocks;
    recordPlayed(store, id, { now: firstPlay, locks: delayed, onResult: result });
    store.remove(id);

    run();

    expect(result).toHaveBeenCalledWith('missing');
    expect(storage.items.has(PLAYED_KEY_PREFIX + id)).toBe(false);
  });

  it('keeps progress changed in another tab while the play time waits for the lock', async () => {
    const id = addSave();
    const updated = createSave('Changed elsewhere', settings, ['look'], later);
    const release = holdLock();
    void lock.locks.request(SAVE_LOCK_NAME, () => store.put(id, updated));
    recordPlayed(store, id, { now: firstPlay, locks: lock.locks });
    release();
    await lock.settled();
    expect(store.load(id)).toEqual(updated);
    expect(playedTime(id)).toBe(firstPlay.toISOString());
  });

  it('reports unavailable tracking without Web Locks and leaves Last played unknown', () => {
    const id = addSave();
    const markPlayed = vi.spyOn(store, 'markPlayed');
    const result = vi.fn();
    recordPlayed(store, id, { now: firstPlay, locks: undefined, onResult: result });
    expect(markPlayed).not.toHaveBeenCalled();
    expect(store.list()[0]).not.toHaveProperty('lastPlayedAt');
    expect(result).toHaveBeenCalledWith('failed');
  });

  it('never throws when storage or the lock fails', async () => {
    const id = addSave();
    const result = vi.fn();
    storage.failWrites = true;
    expect(() => recordPlayed(store, id, { now: firstPlay, locks: lock.locks, onResult: result })).not.toThrow();
    await lock.settled();
    expect(result).toHaveBeenLastCalledWith('failed');
    storage.failWrites = false;
    const rejecting = { request: vi.fn(() => Promise.reject(new Error('no lock'))) } as unknown as SaveLocks;
    const throwing = { request: vi.fn(() => { throw new Error('no lock'); }) } as unknown as SaveLocks;
    expect(() => recordPlayed(store, id, { now: firstPlay, locks: rejecting, onResult: result })).not.toThrow();
    expect(() => recordPlayed(store, id, { now: firstPlay, locks: throwing, onResult: result })).not.toThrow();
    await Promise.resolve();
    expect(result).toHaveBeenLastCalledWith('failed');
    expect(playedTime(id)).toBeUndefined();
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

  it('keeps Last saved when the clock moves between creation and the previous update', async () => {
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
      + 'Saves queued before this warning will not be written. Choose Save adventure again to keep this progress as a new save.',
    );
    expect(store.load(id)).toEqual(elsewhere);

    form.requestSubmit();
    await lock.settled();

    expect(status.textContent).toBe('Saved “Trip”.');
    expect(store.load(id)).toEqual(elsewhere);
    expect(store.list().map((entry) => entry.id)).toHaveLength(2);
  });

  it('reports which stored save play belongs to after each save and conflict', async () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const onStoredChange = vi.fn();
    const { form } = mountForm(['look', 'hint'], { resumed: { id, save }, now: () => later, onStoredChange });

    form.requestSubmit();
    await lock.settled();
    expect(onStoredChange).toHaveBeenLastCalledWith({ id, save: store.load(id) });

    store.put(id, { ...save, name: 'Other tab' });
    form.requestSubmit();
    await lock.settled();
    expect(onStoredChange).toHaveBeenLastCalledWith(undefined);

    form.requestSubmit();
    await lock.settled();
    const copy = store.list().find((entry) => entry.id !== id)!;
    expect(onStoredChange).toHaveBeenLastCalledWith({ id: copy.id, save: store.load(copy.id) });
    expect(onStoredChange).toHaveBeenCalledTimes(3);
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

  it.each(['changed', 'deleted'])('keeps the %s warning when two saves were queued before it', async (change) => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const commands = ['look', 'hint'];
    const { form, status } = mountForm(commands, { resumed: { id, save } });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    void lock.request(SAVE_LOCK_NAME, () => held);

    form.requestSubmit();
    commands.push('inventory');
    form.requestSubmit();
    if (change === 'changed') store.put(id, withCommands(save, ['look', 'north']));
    else store.remove(id);
    const before = new Map(storage.items);
    release();
    await lock.settled();

    expect(status.textContent).toBe(
      `This save was ${change} in another tab or window, so it was not overwritten. `
      + 'Saves queued before this warning will not be written. Choose Save adventure again to keep this progress as a new save.',
    );
    expect(storage.items).toEqual(before);

    commands.push('help');
    form.requestSubmit();
    await lock.settled();

    expect(status.textContent).toBe('Saved “Trip”.');
    const copy = store.list().find((entry) => !before.has(SAVE_KEY_PREFIX + entry.id))!;
    expect(store.load(copy.id).commands).toEqual(commands);
    expect(storage.items.size).toBe(before.size + 1);
    for (const [key, text] of before) expect(storage.items.get(key)).toBe(text);
  });

  it('keeps the conflict warning when an earlier queued lock request later rejects', async () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const { form, status } = mountForm(['look', 'hint'], { resumed: { id, save } });
    let reject!: (reason: Error) => void;
    const rejected = new Promise<void>((_resolve, fail) => { reject = fail; });
    form.requestSubmit();
    lock.request.mockImplementationOnce(() => rejected);
    form.requestSubmit();
    store.put(id, withCommands(save, ['look', 'north']));
    const before = new Map(storage.items);
    await lock.settled();
    const warning = status.textContent;
    expect(warning).toMatch(/^This save was changed/);

    reject(new DOMException('blocked', 'SecurityError'));
    await Promise.resolve();

    expect(status.textContent).toBe(warning);
    expect(storage.items).toEqual(before);
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
    [...app.querySelectorAll('button')].find((node) => node.textContent === 'Back to start')!.click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('lists name, genre, length, last played and last saved time, most recently played first', () => {
    const firstId = store.add(createSave('First', settings, [], earlier));
    store.add(createSave('<b>Second</b>', createAdventureSettings(3, 'short'), [], later));

    render();

    expect(texts('.save-item h2')).toEqual(['First', '<b>Second</b>']);
    expect(app.querySelector('b')).toBeNull();
    const first = app.querySelectorAll('.save-item')[0];
    expect([...first.querySelectorAll('dt, dd')].map((node) => node.textContent)).toEqual([
      'Genre', genreLabels[settings.genre],
      'Length', lengthLabels.long,
      'Last played', 'Not recorded',
      'Last saved', formatSaveTime(earlier.toISOString()),
    ]);
    expect(first.getAttribute('aria-labelledby')).toBe(first.querySelector('h2')?.id);

    const played = new Date('2026-10-03T08:15:00.000Z');
    store.markPlayed(firstId, played);
    render();

    expect(texts('.save-item h2')).toEqual(['First', '<b>Second</b>']);
    expect([...app.querySelectorAll('.save-item')[0].querySelectorAll('dd')].map((node) => node.textContent))
      .toEqual([
        genreLabels[settings.genre], lengthLabels.long,
        formatSaveTime(played.toISOString()), formatSaveTime(earlier.toISOString()),
      ]);
  });

  it('keeps Resume and Export available when play-time metadata cannot be read', async () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    storage.failReadKey = PLAYED_KEY_PREFIX + id;
    vi.useFakeTimers();
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      if (value instanceof Blob) blob = value;
      return 'blob:save-file';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render();

    const row = app.querySelector('.save-item')!;
    const playedLabel = [...row.querySelectorAll('dt')].find((label) => label.textContent === 'Last played');
    expect(playedLabel?.nextElementSibling?.textContent).toBe('Unavailable (could not read)');
    buttonNamed('Resume: Trip').click();
    expect(onResume).toHaveBeenCalledWith({ id, save });
    buttonNamed('Export: Trip').click();

    expect(await blob?.text()).toBe(store.exportSave(id));
    expect(app.querySelector('#export-status')?.textContent).toContain('download started');
    vi.runAllTimers();
  });

  it('refreshes after a played time is recorded without moving keyboard focus', async () => {
    const first = store.add(createSave('First', settings, [], earlier));
    store.add(createSave('Second', settings, [], later));
    const refresh = renderSavesScreen(app, { store, onResume, onBack, locks: lock.locks });
    const focused = buttonNamed('Resume: Second');
    focused.focus();
    recordPlayed(store, first, {
      now: new Date('2026-10-04T08:00:00.000Z'),
      locks: lock.locks,
      onResult: (result) => { if (result === 'recorded') refresh(); },
    });

    await lock.settled();

    expect(texts('.save-item h2')).toEqual(['First', 'Second']);
    expect(app.querySelectorAll('.save-item')[1].querySelectorAll('dd')[2].textContent).toBe('Not recorded');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Resume: Second');
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

  it.each(['ready', 'unreadable'])('Keep cancels a queued deletion of a %s save', async (kind) => {
    const id = store.add(createSave('Trip', settings, [], earlier));
    if (kind === 'unreadable') storage.items.set(SAVE_KEY_PREFIX + id, 'broken');
    const before = new Map(storage.items);
    render();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    void lock.request(SAVE_LOCK_NAME, () => held);
    const name = kind === 'ready' ? 'Trip' : 'Unreadable save';

    buttonNamed(`Delete: ${name}`).click();
    buttonNamed(`Yes, delete: ${name}`).click();
    buttonNamed(`Keep: ${name}`).click();
    release();
    await lock.settled();

    expect(storage.items).toEqual(before);
    expect(document.activeElement).toBe(buttonNamed(`Delete: ${name}`));
    expect(app.querySelector('[role="status"]')?.textContent).toBe('');

    buttonNamed(`Delete: ${name}`).click();
    buttonNamed(`Yes, delete: ${name}`).click();
    await lock.settled();
    expect(storage.items.size).toBe(0);
  });

  it('ignores a delayed lock rejection after Keep and allows a fresh confirmation', async () => {
    const save = createSave('Trip', settings, [], earlier);
    const id = store.add(save);
    render();
    let reject!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    lock.request.mockImplementationOnce(() => pending);
    buttonNamed('Delete: Trip').click();
    buttonNamed('Yes, delete: Trip').click();
    buttonNamed('Keep: Trip').click();

    reject(new DOMException('blocked', 'SecurityError'));
    await Promise.resolve();

    expect(store.load(id)).toEqual(save);
    expect(document.activeElement).toBe(buttonNamed('Delete: Trip'));
    expect(app.querySelector('[role="status"]')?.textContent).toBe('');
    buttonNamed('Delete: Trip').click();
    buttonNamed('Yes, delete: Trip').click();
    await lock.settled();
    expect(store.list()).toEqual([]);
  });

  it.each(['success', 'rejection', 'list-failure'])('preserves other queued confirmations and focus during a %s refresh', async (result) => {
    const first = store.add(createSave('A', settings, [], earlier));
    const second = store.add(createSave('B', settings, [], earlier));
    const waiting: { run: () => void; reject: (error: Error) => void }[] = [];
    lock.request.mockImplementation((_name: string, task: () => unknown) => new Promise<void>((resolve, reject) => {
      waiting.push({ run: () => { task(); resolve(); }, reject });
    }));
    render();
    buttonNamed('Delete: A').click();
    buttonNamed('Yes, delete: A').click();
    buttonNamed('Delete: B').click();
    buttonNamed('Yes, delete: B').click();
    const oldKeep = buttonNamed('Keep: B');
    if (result === 'list-failure') vi.spyOn(store, 'list').mockImplementationOnce(() => { throw new Error('storage blocked'); });
    if (result !== 'rejection') waiting.shift()!.run();
    else {
      waiting.shift()!.reject(new DOMException('blocked', 'SecurityError'));
      await Promise.resolve();
    }
    expect(oldKeep.isConnected).toBe(true);
    expect(document.activeElement).toBe(oldKeep);
    expect(buttonNamed('Keep: B')).toBe(oldKeep);
    oldKeep.click();
    const status = app.querySelector('[role="status"]')!.textContent;
    waiting.shift()!.run();
    expect(store.load(second).name).toBe('B');
    expect(app.querySelector('[role="status"]')!.textContent).toBe(status);
    expect(document.activeElement).toBe(buttonNamed('Delete: B'));
    expect(store.list()).toHaveLength(result === 'rejection' ? 2 : 1);
    if (result === 'rejection') expect(store.load(first).name).toBe('A');
    buttonNamed('Delete: B').click();
    buttonNamed('Yes, delete: B').click();
    waiting.shift()!.run();
    expect(store.list().some((entry) => entry.id === second)).toBe(false);
  });

  it.each(['unchanged', 'changed', 'deleted'])('checks the original %s snapshot after an unrelated deletion refresh', (result) => {
    store.add(createSave('A', settings, [], earlier));
    const saved = createSave('B', settings, [], earlier);
    const id = store.add(saved);
    const waiting: (() => void)[] = [];
    lock.request.mockImplementation((_name: string, task: () => unknown) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }));
    render();
    buttonNamed('Delete: A').click();
    buttonNamed('Yes, delete: A').click();
    buttonNamed('Delete: B').click();
    buttonNamed('Yes, delete: B').click();
    const keep = buttonNamed('Keep: B');
    if (result === 'changed') store.put(id, withCommands(saved, ['look']));
    if (result === 'deleted') store.remove(id);
    waiting.shift()!();
    expect(keep.isConnected).toBe(true);
    expect(document.activeElement).toBe(keep);
    waiting.shift()!();
    if (result === 'unchanged') {
      expect(store.list()).toHaveLength(0);
      expect(app.querySelector('[role="status"]')!.textContent).toContain('Deleted “B”.');
    } else {
      expect(app.querySelector('[role="status"]')!.textContent).not.toBe('Deleted “B”.');
      expect(store.list()).toHaveLength(result === 'changed' ? 1 : 0);
      if (result === 'changed') expect(store.load(id).commands).toEqual(['look']);
    }
  });

  it.each(['conflict', 'rejection'])('keeps a concurrent delete %s visible after another delete succeeds', async (failure) => {
    const saved = createSave('A', settings, [], earlier);
    const id = store.add(saved);
    store.add(createSave('B', settings, [], earlier));
    const waiting: { run: () => void; reject: (error: Error) => void }[] = [];
    lock.request.mockImplementation((_name: string, task: () => unknown) => new Promise<void>((resolve, reject) => {
      waiting.push({ run: () => { task(); resolve(); }, reject });
    }));
    render();
    for (const name of ['A', 'B']) {
      buttonNamed(`Delete: ${name}`).click();
      buttonNamed(`Yes, delete: ${name}`).click();
    }
    if (failure === 'conflict') {
      store.put(id, { ...saved, name: 'Updated A' });
      waiting.shift()!.run();
    } else {
      waiting.shift()!.reject(new DOMException('blocked', 'SecurityError'));
      await Promise.resolve();
    }
    const warning = app.querySelector('[role="status"]')!.textContent!;
    expect(warning).toContain(failure === 'conflict' ? 'not deleted' : 'could not lock');
    waiting.shift()!.run();
    expect(app.querySelector('[role="status"]')!.textContent).toContain(warning);
    expect(app.querySelector('[role="status"]')!.textContent).toContain('Deleted “B”.');
    expect(store.list()).toHaveLength(1);
    expect(store.load(id).name).toBe(failure === 'conflict' ? 'Updated A' : 'A');
  });

  it.each(['success', 'conflict', 'rejection'])('preserves newer keyboard focus after a delete %s refresh', async (result) => {
    const saved = createSave('A', settings, [], earlier);
    const id = store.add(saved);
    store.add(createSave('B', settings, [], earlier));
    for (const focusTarget of ['row', 'heading']) {
      let run!: () => void;
      let reject!: (error: Error) => void;
      lock.request.mockImplementationOnce((_name: string, task: () => unknown) => new Promise<void>((resolve, fail) => {
        run = () => { task(); resolve(); };
        reject = fail;
      }));
      render();
      buttonNamed('Delete: A').click();
      buttonNamed('Yes, delete: A').click();
      const focused = focusTarget === 'row' ? buttonNamed('Delete: B') : app.querySelector<HTMLElement>('h1')!;
      focused.focus();
      if (result === 'conflict') store.put(id, withCommands(saved, ['look']));
      if (result === 'rejection') {
        reject(new DOMException('blocked', 'SecurityError'));
        await Promise.resolve();
      } else run();
      expect(document.activeElement).toBe(focusTarget === 'row' ? buttonNamed('Delete: B') : focused);
      store.put(id, saved);
    }
  });

  it.each(['changed', 'deleted', 'list-failure'])('reconciles a kept %s row without reviving its queued deletion', (change) => {
    store.add(createSave('A', settings, [], earlier));
    const saved = createSave('B', settings, [], earlier);
    const id = store.add(saved);
    store.add(createSave('C', settings, [], earlier));
    const waiting: (() => void)[] = [];
    lock.request.mockImplementation((_name: string, task: () => unknown) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }));
    render();
    for (const name of ['A', 'B']) {
      buttonNamed(`Delete: ${name}`).click();
      buttonNamed(`Yes, delete: ${name}`).click();
    }
    buttonNamed('Delete: C').click();
    const otherKeep = buttonNamed('Keep: C');
    if (change === 'deleted') store.remove(id);
    else store.put(id, { ...saved, name: 'Updated B' });
    waiting.shift()!();
    expect(buttonNamed('Keep: B').isConnected).toBe(true);
    if (change === 'list-failure') vi.spyOn(store, 'list').mockImplementationOnce(() => { throw new Error('storage blocked'); });
    buttonNamed('Keep: B').click();
    expect(otherKeep.isConnected).toBe(true);
    if (change === 'changed') {
      expect(texts('.save-item h2')).toContain('Updated B');
      expect(document.activeElement).toBe(buttonNamed('Delete: Updated B'));
    } else if (change === 'deleted') {
      expect(texts('.save-item h2')).not.toContain('B');
      expect(document.activeElement).toBe(app.querySelector('[role="status"]'));
    } else {
      expect(app.querySelector('[role="status"]')!.textContent).toContain('Something went wrong');
      expect(document.activeElement).toBe(buttonNamed('Delete: B'));
      // A later successful refresh can reconcile the retained row.
      buttonNamed('Keep: C').click();
      expect(texts('.save-item h2')).toContain('Updated B');
    }
    const status = app.querySelector('[role="status"]')!.textContent;
    waiting.shift()!();
    expect(app.querySelector('[role="status"]')!.textContent).toBe(status);
    if (change !== 'deleted') expect(store.load(id).name).toBe('Updated B');
    else expect(store.list().some((entry) => entry.id === id)).toBe(false);
  });

  it('restores usable actions after a delete conflict and failed list refresh', () => {
    const saved = createSave('A', settings, [], earlier);
    const id = store.add(saved);
    store.add(createSave('B', settings, [], earlier));
    const waiting: (() => void)[] = [];
    lock.request.mockImplementation((_name: string, task: () => unknown) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }));
    render();
    buttonNamed('Delete: A').click();
    buttonNamed('Yes, delete: A').click();
    buttonNamed('Delete: B').click();
    const keep = buttonNamed('Keep: B');
    store.put(id, { ...saved, name: 'Updated A' });
    vi.spyOn(store, 'list').mockImplementationOnce(() => { throw new Error('storage blocked'); });
    waiting.shift()!();
    expect(buttonNamed('Yes, delete: A')).toBeNull();
    expect(buttonNamed('Delete: A')).not.toBeNull();
    expect(keep.isConnected).toBe(true);
    expect(document.activeElement).toBe(keep);
    expect(app.querySelector('[role="status"]')!.textContent).toContain('not deleted');
    expect(app.querySelector('[role="status"]')!.textContent).toContain('Something went wrong');
    buttonNamed('Delete: A').click();
    buttonNamed('Keep: A').click();
    expect(buttonNamed('Delete: Updated A')).not.toBeNull();
    expect(store.load(id).name).toBe('Updated A');
  });

  it.each(['first', 'last'])('updates a failed %s deletion row\'s Resume when its list refresh fails', (order) => {
    const saved = createSave('A', settings, [], earlier);
    const id = store.add(saved);
    store.add(createSave('B', settings, [], earlier));
    const waiting = new Map<string, () => void>();
    let next = '';
    lock.request.mockImplementation((_name: string, task: () => unknown) => new Promise<void>((resolve) => {
      waiting.set(next, () => { task(); resolve(); });
    }));
    render();
    // A waits first, so B is still pending when A fails; or B waits first, so A fails last.
    for (const name of order === 'first' ? ['A', 'B'] : ['B', 'A']) {
      next = name;
      buttonNamed(`Delete: ${name}`).click();
      buttonNamed(`Yes, delete: ${name}`).click();
    }
    const back = [...app.querySelectorAll('button')].find((node) => node.textContent === 'Back to start')!;
    store.put(id, withCommands(saved, ['look']));
    if (order === 'last') waiting.get('B')!();
    vi.spyOn(store, 'list').mockImplementationOnce(() => { throw new Error('storage blocked'); });
    waiting.get('A')!();
    expect(app.querySelector('[role="status"]')!.textContent).toContain('Something went wrong');
    if (order === 'first') {
      expect(buttonNamed('Resume: A').disabled).toBe(true);
      expect(back.disabled).toBe(true);
      waiting.get('B')!();
    }
    expect(buttonNamed('Resume: A').disabled).toBe(false);
    expect(back.disabled).toBe(false);
    expect(store.load(id).commands).toEqual(['look']);
  });

  it('shows unreadable saves with the reason and keeps them', async () => {
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
    await lock.settled();
    expect(storage.items.has(key)).toBe(false);
  });

  it.each(['rename', 'progress'])('keeps a save with a same-timestamp %s before delete gets the lock', async (change) => {
    const save = createSave('Old name', settings, ['look'], earlier);
    const id = store.add(save);
    render();
    buttonNamed('Delete: Old name').click();
    const updated = change === 'rename' ? { ...save, name: 'New name' } : withCommands(save, ['look', 'hint']);
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

  it('says the save was deleted when its play-time metadata could not be removed', async () => {
    const save = createSave('Trip', settings, [], earlier);
    const id = store.add(save);
    store.markPlayed(id, later);
    storage.failRemoveKey = PLAYED_KEY_PREFIX + id;
    render();
    buttonNamed('Delete: Trip').click();
    buttonNamed('Yes, delete: Trip').click();
    await lock.settled();

    expect(store.list()).toEqual([]);
    expect(storage.items.has(PLAYED_KEY_PREFIX + id)).toBe(true);
    expect(app.querySelector('[role="status"]')?.textContent)
      .toContain('Deleted “Trip”, but its Last played time could not be removed');
    expect(app.querySelector('[role="status"]')?.textContent).toContain('leftover time is ignored');
  });

  it('removes a deleted row when metadata cleanup and list refresh both fail', async () => {
    const deletedId = store.add(createSave('Deleted', settings, [], earlier));
    const keptId = store.add(createSave('Kept', settings, [], later));
    store.markPlayed(deletedId, later);
    storage.failRemoveKey = PLAYED_KEY_PREFIX + deletedId;
    storage.failListAfterRemove = true;
    render();
    buttonNamed('Delete: Kept').click();
    buttonNamed('Delete: Deleted').click();
    buttonNamed('Yes, delete: Deleted').click();
    await lock.settled();

    expect(storage.items.has(SAVE_KEY_PREFIX + deletedId)).toBe(false);
    expect(storage.items.has(PLAYED_KEY_PREFIX + deletedId)).toBe(true);
    expect(app.querySelector(`#save-${deletedId}`)).toBeNull();
    const keptTitle = app.querySelector(`#save-${keptId}`);
    expect(keptTitle?.closest('.save-item')?.querySelector('button[aria-label="Keep: Kept"]')).not.toBeNull();
    expect(app.querySelector('#saves-status')?.textContent)
      .toContain('Deleted “Deleted”, but its Last played time could not be removed');
    expect(app.querySelector('#saves-status')?.textContent)
      .toContain('would not let textQuest use its save storage');
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
    expect(app.querySelector('#export-status')?.textContent).toContain('download started');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:save-file');
    expect(storage.items).toEqual(before);
  });

  it('exports a renamed save with content, file name and message from the same snapshot', async () => {
    const save = createSave('Old trip', settings, ['look'], earlier);
    const id = store.add(save);
    render();
    store.put(id, { ...withCommands(save, ['look', 'hint']), name: 'New trip' });
    const before = new Map(storage.items);
    let blob: Blob | undefined;
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      if (value instanceof Blob) blob = value;
      return 'blob:save-file';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('textquest-New-trip.json');
    });

    buttonNamed('Export: Old trip').click();

    expect(await blob?.text()).toBe(store.exportSave(id));
    expect(app.querySelector('#export-status')?.textContent).toBe('Save file download started for “New trip”.');
    expect(storage.items).toEqual(before);
    vi.runAllTimers();
  });

  it('reports export errors without changing saves', () => {
    store.add(createSave('Trip', settings, [], earlier));
    const before = new Map(storage.items);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('blocked'); });
    render();

    buttonNamed('Export: Trip').click();

    expect(app.querySelector('#export-status')?.textContent).toMatch(/Something went wrong/);
    expect(storage.items).toEqual(before);
  });

  it.each(['success', 'failure'])('keeps a delete failure after export %s and cancellation of another deletion', async (result) => {
    for (const name of ['A', 'B', 'C']) store.add(createSave(name, settings, [], earlier));
    const before = new Map(storage.items);
    const waiting: { run: () => void; reject: (error: Error) => void }[] = [];
    lock.request.mockImplementation((_name: string, task: () => unknown) => new Promise<void>((resolve, reject) => {
      waiting.push({ run: () => { task(); resolve(); }, reject });
    }));
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      if (result === 'failure') throw new Error('blocked');
      return 'blob:save-file';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render();
    for (const name of ['A', 'B']) {
      buttonNamed(`Delete: ${name}`).click();
      buttonNamed(`Yes, delete: ${name}`).click();
    }
    waiting.shift()!.reject(new DOMException('blocked', 'SecurityError'));
    await Promise.resolve();
    const warning = app.querySelector('#saves-status')!.textContent!;
    expect(warning).toContain('could not lock');

    buttonNamed('Export: C').click();
    buttonNamed('Keep: B').click();
    waiting.shift()!.run();

    expect(app.querySelector('#saves-status')?.textContent).toBe(warning);
    expect(app.querySelector('#export-status')?.textContent).toMatch(
      result === 'success' ? /download started for “C”/ : /Something went wrong/,
    );
    expect(app.querySelector('#export-status')?.getAttribute('role')).toBe('status');
    expect([...app.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Back to start')?.disabled).toBe(false);
    expect(storage.items).toEqual(before);
    vi.runAllTimers();
  });

  function chooseFile(text: string) {
    const input = app.querySelector<HTMLInputElement>('#import-save')!;
    const file = new File([text], 'trip.json', { type: 'application/json' });
    const read = vi.spyOn(file, 'arrayBuffer');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    const form = input.closest('form')!;
    return { input, file, read, form, submit: form.querySelector<HTMLButtonElement>('button')! };
  }

  it('keeps a save when import refreshes a queued deletion and the player chooses Keep', async () => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const original = storage.items.get(SAVE_KEY_PREFIX + id);
    const text = JSON.stringify({ ...save, name: 'Imported trip' });
    render();
    const { read, form, submit } = chooseFile(text);
    let finish!: (bytes: ArrayBuffer) => void;
    read.mockReturnValue(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    void lock.request(SAVE_LOCK_NAME, () => held);

    form.requestSubmit();
    expect(read).toHaveBeenCalledOnce();
    buttonNamed('Delete: Trip').click();
    buttonNamed('Yes, delete: Trip').click();
    expect(storage.items.get(SAVE_KEY_PREFIX + id)).toBe(original);

    finish(new TextEncoder().encode(text).buffer);
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    expect(store.list()).toHaveLength(2);
    expect(app.querySelector('#import-status')?.textContent).toBe('Imported the save as a new save.');
    const afterImport = new Map(storage.items);

    if (buttonNamed('Keep: Trip')) expect(document.activeElement).toBe(buttonNamed('Keep: Trip'));
    else buttonNamed('Delete: Trip').click();
    buttonNamed('Keep: Trip').click();
    release();
    await lock.settled();

    expect(storage.items).toEqual(afterImport);
    expect(storage.items.get(SAVE_KEY_PREFIX + id)).toBe(original);
    expect(document.activeElement).toBe(buttonNamed('Delete: Trip'));
    expect(app.querySelector('[role="status"]')?.textContent).not.toContain('Deleted');
  });

  it.each(['success', 'read failure'])('announces import %s without taking focus from a newer interaction', async (result) => {
    const id = store.add(createSave('Trip', settings, ['look'], earlier));
    const text = store.exportSave(id);
    const before = new Map(storage.items);
    render();
    const { read, form, submit } = chooseFile(text);
    let finish!: (bytes: ArrayBuffer) => void;
    let fail!: (error: Error) => void;
    read.mockReturnValue(new Promise<ArrayBuffer>((resolve, reject) => { finish = resolve; fail = reject; }));

    form.requestSubmit();
    let newerControl: HTMLButtonElement;
    if (result === 'success') {
      newerControl = [...app.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'Back to start')!;
      newerControl.focus();
      finish(new TextEncoder().encode(text).buffer);
    } else {
      buttonNamed('Delete: Trip').click();
      newerControl = buttonNamed('Keep: Trip');
      expect(document.activeElement).toBe(newerControl);
      fail(new Error('unreadable'));
    }
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(document.activeElement).toBe(newerControl);
    expect(app.querySelector('#import-status')?.textContent).toMatch(
      result === 'success' ? /Imported the save as a new save/ : /could not be read/,
    );
    if (result === 'success') {
      expect(store.list()).toHaveLength(2);
      expect(storage.items.get(SAVE_KEY_PREFIX + id)).toBe(before.get(SAVE_KEY_PREFIX + id));
    } else {
      expect(storage.items).toEqual(before);
    }
  });

  it.each([
    ['lock failure', 'success', 'delete first'],
    ['lock failure', 'success', 'import first'],
    ['lock failure', 'read failure', 'delete first'],
    ['lock failure', 'read failure', 'import first'],
    ['conflict', 'success', 'delete first'],
    ['conflict', 'success', 'import first'],
    ['conflict', 'read failure', 'delete first'],
    ['conflict', 'read failure', 'import first'],
    ['success', 'read failure', 'import first'],
    ['success', 'success', 'delete first'],
    ['success', 'success', 'import first'],
  ])('keeps both results for delete %s, import %s, %s', async (failure, result, order) => {
    const save = createSave('Trip', settings, ['look'], earlier);
    const id = store.add(save);
    const text = store.exportSave(id);
    render();
    const { read, form, submit } = chooseFile(text);
    let finish!: (bytes: ArrayBuffer) => void;
    let fail!: (error: Error) => void;
    read.mockReturnValue(new Promise<ArrayBuffer>((resolve, reject) => { finish = resolve; fail = reject; }));
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    void lock.request(SAVE_LOCK_NAME, () => held);
    if (failure === 'lock failure') {
      lock.request.mockImplementationOnce(() => held.then(() => {
        throw new DOMException('blocked', 'SecurityError');
      }));
    }

    form.requestSubmit();
    buttonNamed('Delete: Trip').click();
    buttonNamed('Yes, delete: Trip').click();
    if (failure === 'conflict') store.put(id, withCommands(save, ['look', 'hint']));
    const beforeImport = new Map(storage.items);
    const deleteMessage = failure === 'lock failure' ? /could not lock save storage/
      : failure === 'conflict' ? /not deleted/ : /Deleted/;
    if (order === 'delete first') {
      release();
      await vi.waitFor(() => expect(app.querySelector('#saves-status')?.textContent).toMatch(deleteMessage));
    }

    if (result === 'success') finish(new TextEncoder().encode(text).buffer);
    else fail(new Error('unreadable'));
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    if (order === 'import first') {
      release();
      await vi.waitFor(() => expect(app.querySelector('#saves-status')?.textContent).toMatch(deleteMessage));
    }

    expect(app.querySelector('#saves-status')?.textContent).toMatch(deleteMessage);
    expect(app.querySelector('#import-status')?.textContent).toMatch(
      result === 'success' ? /Imported the save as a new save/ : /could not be read/,
    );
    expect(app.querySelector('#import-status')?.getAttribute('role')).toBe('status');
    if (failure === 'success') {
      expect(storage.items.has(SAVE_KEY_PREFIX + id)).toBe(false);
      if (result === 'success') {
        const entries = store.list();
        expect(entries).toHaveLength(1);
        expect(entries[0].id).not.toBe(id);
        expect(store.load(entries[0].id)).toEqual(save);
      } else expect(store.list()).toEqual([]);
    }
    else if (result === 'success') {
      expect(store.list()).toHaveLength(2);
      expect(storage.items.get(SAVE_KEY_PREFIX + id)).toBe(beforeImport.get(SAVE_KEY_PREFIX + id));
    } else expect(storage.items).toEqual(beforeImport);
  });

  it.each([1, 2])('imports a matching-name version %i adventure as a new save and can resume it', async (version) => {
    const save = createSave('<b>Trip</b>', createAdventureSettings(7, 'short', version), ['look', 'hint'], earlier);
    const id = store.add(save);
    const before = storage.items.get(`${SAVE_KEY_PREFIX}${id}`);
    render();
    const { input, form } = chooseFile(store.exportSave(id));
    expect(app.querySelector<HTMLLabelElement>('label[for="import-save"]')?.textContent).toBe('Save file');
    expect(input.accept).toBe('.json,application/json');
    expect(input.getAttribute('aria-describedby')).toBe('import-status');

    form.requestSubmit();
    await vi.waitFor(() => expect(store.list()).toHaveLength(2));

    expect(storage.items.get(`${SAVE_KEY_PREFIX}${id}`)).toBe(before);
    expect(texts('.save-item h2')).toEqual(['<b>Trip</b>', '<b>Trip</b>']);
    expect(app.querySelector('b')).toBeNull();
    expect(app.querySelector('#import-status')?.textContent).toBe('Imported the save as a new save.');
    expect(document.activeElement).toBe(app.querySelector('#import-status'));
    expect(input.value).toBe('');
    buttonNamed('Resume: <b>Trip</b>').click();
    expect(onResume.mock.calls[0][0].save).toEqual(save);
  });

  it('asks for a file and focuses the labelled input', () => {
    render();
    app.querySelector<HTMLFormElement>('form')!.requestSubmit();

    expect(app.querySelector('#import-status')?.textContent).toMatch(/Choose a textQuest save file/);
    expect(document.activeElement).toBe(app.querySelector('#import-save'));
    expect(store.list()).toEqual([]);
  });

  it.each([
    ['{broken', /not valid JSON/],
    ['{}', /damaged/],
    [JSON.stringify({ ...createSave('Future', settings, [], earlier), formatVersion: 3 }), /newer version/],
    [' '.repeat(MAX_SAVE_FILE_LENGTH + 1), /too large/],
  ])('rejects a bad file without changing any saves', async (text, message) => {
    store.add(createSave('Trip', settings, [], earlier));
    storage.items.set(`${SAVE_KEY_PREFIX}${'f'.repeat(32)}`, '{unreadable');
    const before = new Map(storage.items);
    render();
    const { form, submit } = chooseFile(text);

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(app.querySelector('#import-status')?.textContent).toMatch(message);
    expect(document.activeElement).toBe(app.querySelector('#import-status'));
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

    expect(app.querySelector('#import-status')?.textContent).toMatch(/could not be read|damaged/);
    expect(storage.items).toEqual(before);
  });

  it('accepts a valid non-ASCII save whose byte size exceeds the character limit', async () => {
    const save = createSave('Trip', settings, Array(2000).fill('\u6f22'.repeat(200)), earlier);
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
    expect(app.querySelector('#import-status')?.textContent).toMatch(/Imported/);
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
    expect(app.querySelector('#import-status')?.textContent)
      .toBe('The save was imported, but the list could not be refreshed. Storage is blocked.');
  });

  it('rejects an oversized file before reading it', async () => {
    render();
    const { file, read, form, submit } = chooseFile('');
    Object.defineProperty(file, 'size', { value: MAX_SAVE_FILE_LENGTH * 3 + 1 });

    form.requestSubmit();
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(read).not.toHaveBeenCalled();
    expect(app.querySelector('#import-status')?.textContent).toMatch(/too large/);
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

    expect(app.querySelector('#import-status')?.textContent).toMatch(
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
    expect(app.querySelector('#import-status')?.textContent).toBe('Reading your save file…');
    if (leave) app.replaceChildren();
    finish(new TextEncoder().encode(text).buffer);
    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    expect(store.list()).toHaveLength(leave ? 1 : 2);
    if (leave) expect(app.childNodes).toHaveLength(0);
  });
});
