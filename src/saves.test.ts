import { describe, expect, it } from 'vitest';
import { createAdventureSettings, type RandomValueSource } from './adventure-settings';
import {
  MAX_COMMAND_LENGTH,
  MAX_SAVE_COMMANDS,
  MAX_SAVE_FILE_LENGTH,
  MAX_SAVE_NAME_LENGTH,
  SAVE_KEY_PREFIX,
  SaveError,
  createSave,
  createSaveStore,
  exportSaveFile,
  importSaveFile,
  saveFormatVersion,
  validateSave,
  type SaveProblem,
  type StorageLike,
} from './saves';

const settings = createAdventureSettings(1234, 'medium');
const createdTime = new Date('2026-10-12T04:00:00.000Z');

function sampleSave(name = 'Lighthouse trip', commands: string[] = ['look', 'go north']) {
  return createSave(name, settings, commands, createdTime);
}

/** An in-memory `Storage` that can be told to fail. */
class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failWrites: unknown = null;
  failReads: unknown = null;

  get length() {
    return this.items.size;
  }

  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string) {
    if (this.failReads) throw this.failReads;
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw this.failWrites;
    this.items.set(key, value);
  }

  removeItem(key: string) {
    if (this.failWrites) throw this.failWrites;
    this.items.delete(key);
  }
}

/** Gives each new ID a counting number, so tests are repeatable. */
function countingSource(): RandomValueSource {
  let next = 1;
  return {
    getRandomValues(array: Uint32Array<ArrayBuffer>) {
      array.fill(0);
      array[3] = next;
      next += 1;
      return array;
    },
  };
}

function idFor(number: number) {
  return number.toString(16).padStart(32, '0');
}

function quotaError() {
  return Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
}

function problemOf(action: () => unknown): SaveProblem | undefined {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SaveError);
    return (error as SaveError).problem;
  }
  return undefined;
}

function messageOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('Expected an error.');
}

describe('save format', () => {
  it('holds a version, name, settings, commands and timestamps', () => {
    expect(sampleSave()).toEqual({
      formatVersion: 1,
      name: 'Lighthouse trip',
      settings,
      commands: ['look', 'go north'],
      createdAt: '2026-10-12T04:00:00.000Z',
      updatedAt: '2026-10-12T04:00:00.000Z',
    });
    expect(saveFormatVersion).toBe(1);
  });

  it('trims the name and rejects blank or overlong names', () => {
    expect(sampleSave('  Night walk  ').name).toBe('Night walk');
    expect(problemOf(() => sampleSave('   '))).toBe('malformed');
    expect(problemOf(() => sampleSave('a'.repeat(MAX_SAVE_NAME_LENGTH + 1)))).toBe('malformed');
    expect(problemOf(() => sampleSave('two\nlines'))).toBe('malformed');
  });

  it('round-trips through export and import', () => {
    const save = sampleSave();
    expect(importSaveFile(exportSaveFile(save))).toEqual(save);
  });

  it.each(['\u0080', '\u0085', '\u009f', '\u2028', '\u2029'])(
    'rejects names and commands containing %j',
    (character) => {
      expect(problemOf(() => sampleSave(`First${character}second`))).toBe('malformed');
      expect(problemOf(() => sampleSave('Trip', [`look${character}north`]))).toBe('malformed');
      const save = sampleSave();
      expect(problemOf(() => importSaveFile(JSON.stringify({
        ...save,
        name: `First${character}second`,
      })))).toBe('malformed');
      expect(problemOf(() => importSaveFile(JSON.stringify({
        ...save,
        commands: [`look${character}north`],
      })))).toBe('malformed');
    },
  );

  it('rejects sparse command arrays rather than exporting null commands', () => {
    const commands: string[] = ['look', 'go north'];
    delete commands[0];
    expect(problemOf(() => sampleSave('Trip', commands))).toBe('malformed');
    expect(problemOf(() => validateSave({ ...sampleSave(), commands }))).toBe('malformed');
    expect(problemOf(() => exportSaveFile({ ...sampleSave(), commands }))).toBe('malformed');
  });

  it('keeps only known fields, so a file cannot slip in extra data', () => {
    const file = exportSaveFile(sampleSave());
    const extra = `{"__proto__":{"polluted":true},"solution":{"secret":true},${file.slice(1)}`;
    const imported = importSaveFile(extra);
    expect(Object.keys(imported).sort()).toEqual(
      ['commands', 'createdAt', 'formatVersion', 'name', 'settings', 'updatedAt'],
    );
    expect(Object.keys(imported.settings).sort()).toEqual(['genre', 'length', 'seed', 'version']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('importing untrusted save files', () => {
  const good = () => JSON.parse(exportSaveFile(sampleSave()));

  it.each([
    ['not JSON', 'not a save'],
    ['a number', '42'],
    ['an array', '[]'],
    ['no format version', JSON.stringify({ ...good(), formatVersion: undefined })],
    ['a zero format version', JSON.stringify({ ...good(), formatVersion: 0 })],
    ['a text format version', JSON.stringify({ ...good(), formatVersion: '1' })],
    ['no settings', JSON.stringify({ ...good(), settings: null })],
    ['a seed out of range', JSON.stringify({ ...good(), settings: { ...settings, seed: 999_999 } })],
    ['a seed that is text', JSON.stringify({ ...good(), settings: { ...settings, seed: '1234' } })],
    ['an unknown length', JSON.stringify({ ...good(), settings: { ...settings, length: 'epic' } })],
    ['a genre that does not match the seed', JSON.stringify({
      ...good(),
      settings: { ...settings, genre: settings.genre === 'cosy-mystery' ? 'light-fantasy' : 'cosy-mystery' },
    })],
    ['commands that are not a list', JSON.stringify({ ...good(), commands: 'look' })],
    ['a command that is not text', JSON.stringify({ ...good(), commands: ['look', 7] })],
    ['a command with a line break', JSON.stringify({ ...good(), commands: ['look\nnorth'] })],
    ['an overlong command', JSON.stringify({ ...good(), commands: ['x'.repeat(MAX_COMMAND_LENGTH + 1)] })],
    ['a missing time', JSON.stringify({ ...good(), createdAt: undefined })],
    ['a time with no zone', JSON.stringify({ ...good(), updatedAt: '2026-10-12T04:00:00.000' })],
    ['an impossible date', JSON.stringify({ ...good(), createdAt: '2026-02-31T04:00:00.000Z' })],
  ])('rejects a file with %s', (_label, text) => {
    expect(problemOf(() => importSaveFile(text))).toBe('malformed');
    expect(messageOf(() => importSaveFile(text))).toMatch(/^This save file is damaged or isn't a textQuest save: /);
  });

  it('rejects a file that is too large before reading it', () => {
    const text = ' '.repeat(MAX_SAVE_FILE_LENGTH + 1);
    expect(problemOf(() => importSaveFile(text))).toBe('too-large');
    expect(messageOf(() => importSaveFile(text))).toBe(
      'This save file is too large to be a textQuest save. Check you chose the right file.',
    );
  });

  it('rejects too many commands', () => {
    const text = JSON.stringify({ ...good(), commands: Array(MAX_SAVE_COMMANDS + 1).fill('z') });
    expect(problemOf(() => importSaveFile(text))).toBe('too-large');
    expect(messageOf(() => importSaveFile(text))).toBe(
      'This save has more than 10,000 commands, which is more than textQuest can keep.',
    );
  });

  it('rejects a file from a newer version of textQuest', () => {
    const text = JSON.stringify({ ...good(), formatVersion: saveFormatVersion + 1 });
    expect(problemOf(() => importSaveFile(text))).toBe('future-version');
    expect(messageOf(() => importSaveFile(text))).toBe(
      'This save file was made by a newer version of textQuest. Update textQuest, then try again.',
    );
  });

  it('rejects an adventure version this copy does not support', () => {
    const text = JSON.stringify({ ...good(), settings: { ...settings, version: 2 } });
    expect(problemOf(() => importSaveFile(text))).toBe('unsupported-adventure');
    expect(messageOf(() => importSaveFile(text))).toBe(
      'This save is for adventure version 2, which this copy of textQuest does not support.',
    );
  });

  it('rejects input that is not text', () => {
    expect(problemOf(() => importSaveFile(undefined as unknown as string))).toBe('malformed');
    expect(problemOf(() => validateSave(null))).toBe('malformed');
  });

  it('refuses to export a save that would be too large to import again', () => {
    const save = sampleSave('Big', Array(MAX_SAVE_COMMANDS).fill('x'.repeat(MAX_COMMAND_LENGTH)));
    expect(problemOf(() => exportSaveFile(save))).toBe('too-large');
  });
});

describe('save store', () => {
  function setUp() {
    const storage = new MemoryStorage();
    return { storage, store: createSaveStore(storage, countingSource()) };
  }

  it('saves, lists, loads and deletes several adventures', () => {
    const { storage, store } = setUp();
    const first = store.add(sampleSave('First'));
    const second = store.add(createSave('Second', settings, [], new Date('2026-10-13T00:00:00.000Z')));

    expect([first, second]).toEqual([idFor(1), idFor(2)]);
    expect([...storage.items.keys()]).toEqual([SAVE_KEY_PREFIX + first, SAVE_KEY_PREFIX + second]);
    expect(store.load(first)).toEqual(sampleSave('First'));
    expect(store.list()).toEqual([
      {
        id: second,
        status: 'ready',
        name: 'Second',
        settings,
        commandCount: 0,
        createdAt: '2026-10-13T00:00:00.000Z',
        updatedAt: '2026-10-13T00:00:00.000Z',
      },
      {
        id: first,
        status: 'ready',
        name: 'First',
        settings,
        commandCount: 2,
        createdAt: '2026-10-12T04:00:00.000Z',
        updatedAt: '2026-10-12T04:00:00.000Z',
      },
    ]);

    store.remove(first);
    store.remove(first);
    expect(store.list().map((entry) => entry.id)).toEqual([second]);
    expect(problemOf(() => store.load(first))).toBe('not-found');
  });

  it('updates a save in place', () => {
    const { store } = setUp();
    const id = store.add(sampleSave());
    const updated = { ...store.load(id), commands: ['look', 'go north', 'take lamp'], updatedAt: '2026-10-12T05:00:00.000Z' };
    store.put(id, updated);
    expect(store.load(id)).toEqual(updated);
    expect(store.list()).toHaveLength(1);
  });

  it('skips IDs that are already taken', () => {
    const { storage, store } = setUp();
    storage.setItem(SAVE_KEY_PREFIX + idFor(1), exportSaveFile(sampleSave('Old')));
    expect(store.add(sampleSave('New'))).toBe(idFor(2));
    expect(store.load(idFor(1)).name).toBe('Old');
  });

  it('treats unknown or odd IDs as not found', () => {
    const { store } = setUp();
    expect(problemOf(() => store.load(idFor(9)))).toBe('not-found');
    expect(problemOf(() => store.load('../other-key'))).toBe('not-found');
    expect(messageOf(() => store.load(idFor(9)))).toBe('That save could not be found. It may have been deleted.');
  });

  it('ignores other keys and keeps unreadable saves listed rather than deleting them', () => {
    const { storage, store } = setUp();
    storage.setItem('theme', 'dark');
    storage.setItem(SAVE_KEY_PREFIX + 'not-an-id', '{}');
    storage.setItem(SAVE_KEY_PREFIX + idFor(7), 'broken');
    storage.setItem(SAVE_KEY_PREFIX + idFor(8), JSON.stringify({ ...sampleSave(), formatVersion: 2 }));
    const good = store.add(sampleSave());

    expect(store.list()).toEqual([
      expect.objectContaining({ id: good, status: 'ready' }),
      { id: idFor(7), status: 'unreadable', message: expect.stringMatching(/damaged/) },
      { id: idFor(8), status: 'unreadable', message: expect.stringMatching(/newer version/) },
    ]);
    expect(storage.items.size).toBe(5);
  });

  it('exports JSON and imports it as a new save without changing existing saves', () => {
    const { storage, store } = setUp();
    const id = store.add(sampleSave());
    const text = store.exportSave(id);
    expect(JSON.parse(text)).toEqual(sampleSave());

    const before = new Map(storage.items);
    const copy = store.importSave(text);
    expect(copy).not.toBe(id);
    expect(store.load(copy)).toEqual(store.load(id));
    expect(storage.items.get(SAVE_KEY_PREFIX + id)).toBe(before.get(SAVE_KEY_PREFIX + id));
  });

  it('leaves storage untouched when an import is rejected', () => {
    const { storage, store } = setUp();
    store.add(sampleSave());
    const before = new Map(storage.items);
    for (const text of ['nope', JSON.stringify({ ...sampleSave(), formatVersion: 99 }), ' '.repeat(MAX_SAVE_FILE_LENGTH + 1)]) {
      expect(() => store.importSave(text)).toThrow(SaveError);
    }
    expect(storage.items).toEqual(before);
  });

  it('reports a full storage clearly and keeps the old save', () => {
    const { storage, store } = setUp();
    const id = store.add(sampleSave());
    const before = new Map(storage.items);
    storage.failWrites = quotaError();

    expect(problemOf(() => store.put(id, { ...sampleSave(), commands: ['look'] }))).toBe('storage-full');
    expect(problemOf(() => store.add(sampleSave()))).toBe('storage-full');
    expect(problemOf(() => store.importSave(store.exportSave(id)))).toBe('storage-full');
    expect(messageOf(() => store.add(sampleSave()))).toBe(
      'Your browser has no room left for saves. Delete or export an old save, then try again. Your other saves are safe.',
    );
    expect(storage.items).toEqual(before);
    expect(store.load(id)).toEqual(sampleSave());
  });

  it.each([
    ['Firefox name', Object.assign(new Error('full'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' })],
    ['legacy code 22', { name: 'Error', code: 22 }],
    ['Firefox code 1014', { name: 'Error', code: 1014 }],
  ])('recognises a full storage by its %s', (_label, error) => {
    const { storage, store } = setUp();
    storage.failWrites = error;
    expect(problemOf(() => store.add(sampleSave()))).toBe('storage-full');
  });

  it('reports blocked storage clearly', () => {
    const { storage, store } = setUp();
    const id = store.add(sampleSave());
    storage.failReads = Object.assign(new Error('denied'), { name: 'SecurityError' });
    expect(problemOf(() => store.list())).toBe('storage-unavailable');
    expect(problemOf(() => store.load(id))).toBe('storage-unavailable');
    expect(messageOf(() => store.list())).toBe(
      'Your browser would not let textQuest use its save storage. Check your privacy settings, then try again.',
    );

    storage.failReads = null;
    storage.failWrites = new Error('denied');
    expect(problemOf(() => store.remove(id))).toBe('storage-unavailable');
    expect(store.load(id)).toEqual(sampleSave());
  });

  it('writes nothing for an invalid save', () => {
    const { storage, store } = setUp();
    expect(problemOf(() => store.add({ ...sampleSave(), name: '' }))).toBe('malformed');
    expect(storage.items.size).toBe(0);
  });
});
