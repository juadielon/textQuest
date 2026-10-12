import {
  adventureGenres,
  adventureLengths,
  encodeShareWord,
  supportedVersions,
  type AdventureSettings,
  type RandomValueSource,
} from './adventure-settings';

/*
 * A save holds the starting settings and the commands the player typed.
 * Progress is rebuilt later by replaying those commands, so saves never depend
 * on engine internals and never hold puzzle solutions.
 */

/**
 * The save format version written by this copy of textQuest.
 *
 * @remarks
 * Bump this only for a change older copies cannot read. Every released
 * version must still load, so players never lose a save.
 */
export const saveFormatVersion = 1;

/** The longest save file, in characters, that will be stored or imported. */
export const MAX_SAVE_FILE_LENGTH = 1_000_000;

/** The most typed commands one save can hold. */
export const MAX_SAVE_COMMANDS = 10_000;

/** The longest typed command, in characters, that a save can hold. */
export const MAX_COMMAND_LENGTH = 200;

/** The longest adventure name, in characters, after trimming spaces. */
export const MAX_SAVE_NAME_LENGTH = 60;

/** One saved adventure, as stored in the browser and in exported files. */
export interface AdventureSave {
  /** The save format version. See {@link saveFormatVersion}. */
  readonly formatVersion: number;
  /** The name the player gave this adventure. */
  readonly name: string;
  /** The settings the adventure started with. */
  readonly settings: AdventureSettings;
  /** Every command the player typed, oldest first, exactly as entered. */
  readonly commands: readonly string[];
  /** When the save was first made, as an ISO 8601 UTC time. */
  readonly createdAt: string;
  /** When the save last changed, as an ISO 8601 UTC time. */
  readonly updatedAt: string;
}

/**
 * Why a save could not be read, stored or found.
 *
 * - `malformed`: the file is damaged or isn't a textQuest save.
 * - `too-large`: the file or save is over the size limits.
 * - `future-version`: a newer copy of textQuest made the file.
 * - `unsupported-adventure`: the adventure version isn't supported here.
 * - `not-found`: no save has that ID.
 * - `storage-full`: the browser has no room left for saves.
 * - `storage-unavailable`: the browser refused to read or write saves.
 */
export type SaveProblem =
  | 'malformed'
  | 'too-large'
  | 'future-version'
  | 'unsupported-adventure'
  | 'not-found'
  | 'storage-full'
  | 'storage-unavailable';

/** Thrown by save functions with a message a player can read. */
export class SaveError extends Error {
  /** The kind of problem, so callers can respond without matching message text. */
  readonly problem: SaveProblem;

  /**
   * @param problem - The kind of problem.
   * @param message - A plain-English message to show the player.
   */
  constructor(problem: SaveProblem, message: string) {
    super(message);
    this.name = 'SaveError';
    this.problem = problem;
  }
}

const isoTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Typed commands and names are single lines, so control characters only
// appear in damaged or crafted files.
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function damaged(detail: string): SaveError {
  return new SaveError('malformed', `This save file is damaged or isn't a textQuest save: ${detail}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readName(value: unknown): string {
  if (typeof value !== 'string') {
    throw damaged('the adventure name is missing.');
  }
  if (controlCharacterPattern.test(value)) {
    throw damaged(`the adventure name must be 1 to ${MAX_SAVE_NAME_LENGTH} characters on one line.`);
  }
  const name = value.trim();
  if (name === '' || name.length > MAX_SAVE_NAME_LENGTH) {
    throw damaged(`the adventure name must be 1 to ${MAX_SAVE_NAME_LENGTH} characters on one line.`);
  }
  return name;
}

function readSettings(value: unknown): AdventureSettings {
  if (!isPlainObject(value)) {
    throw damaged('the adventure settings are missing.');
  }
  const { version, seed, length, genre } = value;
  if (!Number.isInteger(version) || typeof seed !== 'number') {
    throw damaged('the adventure settings are not valid.');
  }
  if (!supportedVersions.includes(version as number)) {
    throw new SaveError(
      'unsupported-adventure',
      `This save is for adventure version ${version}, which this copy of textQuest does not support.`,
    );
  }
  if (
    !adventureLengths.includes(length as AdventureSettings['length']) ||
    !adventureGenres.includes(genre as AdventureSettings['genre'])
  ) {
    throw damaged('the adventure settings are not valid.');
  }

  const settings = { version, seed, length, genre } as AdventureSettings;
  try {
    // Checks the seed range and that the genre matches the seed.
    encodeShareWord(settings);
  } catch {
    throw damaged('the adventure settings are not valid.');
  }
  return settings;
}

function readCommands(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw damaged('the command list is missing.');
  }
  if (value.length > MAX_SAVE_COMMANDS) {
    throw new SaveError(
      'too-large',
      `This save has more than ${MAX_SAVE_COMMANDS.toLocaleString('en-AU')} commands, which is more than textQuest can keep.`,
    );
  }
  return Array.from(value, (command) => {
    if (typeof command !== 'string' || controlCharacterPattern.test(command)) {
      throw damaged('a command is not plain text.');
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      throw damaged(`a command is longer than ${MAX_COMMAND_LENGTH} characters.`);
    }
    return command;
  });
}

function readTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isoTimePattern.test(value)) {
    throw damaged(`the ${label} time is not valid.`);
  }
  const time = new Date(value);
  // Rejects impossible dates such as 31 February, which Date would roll over.
  if (Number.isNaN(time.getTime()) || time.toISOString() !== value) {
    throw damaged(`the ${label} time is not valid.`);
  }
  return value;
}

/**
 * Checks untrusted data, such as a parsed import file, and builds a clean save.
 *
 * @remarks
 * Only known fields are copied, so extra fields in the input are dropped.
 *
 * @param value - The data to check.
 * @returns A new save holding only checked values.
 * @throws {@link SaveError} if the data is not a valid save.
 */
export function validateSave(value: unknown): AdventureSave {
  if (!isPlainObject(value)) {
    throw damaged('it does not hold a save.');
  }
  const { formatVersion } = value;
  if (!Number.isInteger(formatVersion) || (formatVersion as number) < 1) {
    throw damaged('the save format version is missing.');
  }
  if ((formatVersion as number) > saveFormatVersion) {
    throw new SaveError(
      'future-version',
      'This save file was made by a newer version of textQuest. Update textQuest, then try again.',
    );
  }

  const createdAt = readTime(value.createdAt, 'created');
  const updatedAt = readTime(value.updatedAt, 'updated');
  if (updatedAt < createdAt) {
    throw damaged('the updated time is earlier than the created time.');
  }

  return {
    formatVersion: saveFormatVersion,
    name: readName(value.name),
    settings: readSettings(value.settings),
    commands: readCommands(value.commands),
    createdAt,
    updatedAt,
  };
}

/**
 * Starts a new save for an adventure.
 *
 * @param name - The name the player chose. Spaces at either end are removed.
 * @param settings - The adventure's starting settings.
 * @param commands - Commands typed so far. Defaults to none.
 * @param now - The current time. Used for both timestamps.
 * @returns A checked save.
 * @throws {@link SaveError} if the name, settings or commands are not valid.
 */
export function createSave(
  name: string,
  settings: AdventureSettings,
  commands: readonly string[] = [],
  now: Date = new Date(),
): AdventureSave {
  const time = now.toISOString();
  return validateSave({
    formatVersion: saveFormatVersion,
    name,
    settings,
    commands,
    createdAt: time,
    updatedAt: time,
  });
}

/**
 * Turns a save into export file text.
 *
 * @param save - The save to export.
 * @returns Readable JSON text.
 * @throws {@link SaveError} if the save is not valid or is too large.
 */
export function exportSaveFile(save: AdventureSave): string {
  const text = JSON.stringify(validateSave(save), null, 2);
  if (text.length > MAX_SAVE_FILE_LENGTH) {
    throw new SaveError('too-large', 'This save is too large to keep or export.');
  }
  return text;
}

/**
 * Reads export file text from an untrusted source, such as a player's file.
 *
 * @param text - The file contents.
 * @returns The checked save.
 * @throws {@link SaveError} if the file is too large, damaged or from a newer version.
 */
export function importSaveFile(text: string): AdventureSave {
  if (typeof text !== 'string') {
    throw damaged('it is not text.');
  }
  // Check the size before parsing, so a huge file can't freeze the page.
  if (text.length > MAX_SAVE_FILE_LENGTH) {
    throw new SaveError(
      'too-large',
      'This save file is too large to be a textQuest save. Check you chose the right file.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw damaged('it is not valid JSON.');
  }
  return validateSave(parsed);
}

/**
 * The parts of the browser's `Storage` that saves use, such as `localStorage`.
 * Tests can pass a simple in-memory version instead.
 */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** A short description of one stored save, for a list of saves. */
export type SaveListEntry =
  | {
      readonly id: string;
      readonly status: 'ready';
      readonly name: string;
      readonly settings: AdventureSettings;
      readonly commandCount: number;
      readonly createdAt: string;
      readonly updatedAt: string;
    }
  | {
      /** A stored save that can't be read. It is left in place, never deleted. */
      readonly id: string;
      readonly status: 'unreadable';
      readonly message: string;
    };

type ReadySave = Extract<SaveListEntry, { status: 'ready' }>;

/**
 * Lists, saves, loads, deletes, imports and exports saves in a `Storage`.
 * Methods throw {@link SaveError} with a message a player can read.
 */
export interface SaveStore {
  /**
   * Lists every stored save, most recently updated first. Saves that can't be
   * read come last and are kept, so they are never lost.
   */
  list(): SaveListEntry[];
  /** Stores a new save and returns its new ID. */
  add(save: AdventureSave): string;
  /** Stores a save under this ID, replacing any earlier version. On failure the old version is kept. */
  put(id: string, save: AdventureSave): void;
  /** Loads the save with this ID. */
  load(id: string): AdventureSave;
  /** Deletes the save with this ID. Deleting a save that is already gone does nothing. */
  remove(id: string): void;
  /** Returns export file text for the save with this ID. */
  exportSave(id: string): string;
  /** Checks an import file and stores it as a new save. Existing saves are never changed. */
  importSave(text: string): string;
}

/** The storage key prefix for saves. Never change it, or stored saves are lost. */
export const SAVE_KEY_PREFIX = 'textquest:save:';

const idPattern = /^[0-9a-f]{32}$/;

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  // Browsers name a full storage differently; Firefox used its own name and code.
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

function storageError(error: unknown): SaveError {
  if (isQuotaError(error)) {
    return new SaveError(
      'storage-full',
      'Your browser has no room left for saves. Delete or export an old save, then try again. Your other saves are safe.',
    );
  }
  return new SaveError(
    'storage-unavailable',
    'Your browser would not let textQuest use its save storage. Check your privacy settings, then try again.',
  );
}

function notFound(): SaveError {
  return new SaveError('not-found', 'That save could not be found. It may have been deleted.');
}

/**
 * Makes a save store on top of a `Storage`-like object.
 *
 * @remarks
 * Each save is kept under its own key, so writing one save can never damage
 * another. Browsers leave the old value in place when a write fails.
 *
 * @param storage - Where to keep saves, such as `localStorage`.
 * @param source - Where to get random numbers for new IDs. Defaults to browser cryptographic randomness.
 * @returns The save store.
 */
export function createSaveStore(
  storage: StorageLike,
  source: RandomValueSource = globalThis.crypto,
): SaveStore {
  function read(key: string): string | null {
    try {
      return storage.getItem(key);
    } catch (error) {
      throw storageError(error);
    }
  }

  function write(key: string, value: string): void {
    try {
      storage.setItem(key, value);
    } catch (error) {
      throw storageError(error);
    }
  }

  function keyFor(id: string): string {
    if (typeof id !== 'string' || !idPattern.test(id)) {
      throw notFound();
    }
    return `${SAVE_KEY_PREFIX}${id}`;
  }

  function newId(): string {
    const values = new Uint32Array(4);
    for (;;) {
      source.getRandomValues(values);
      const id = [...values].map((value) => value.toString(16).padStart(8, '0')).join('');
      if (read(keyFor(id)) === null) {
        return id;
      }
    }
  }

  function load(id: string): AdventureSave {
    const text = read(keyFor(id));
    if (text === null) {
      throw notFound();
    }
    return importSaveFile(text);
  }

  function put(id: string, save: AdventureSave): void {
    write(keyFor(id), exportSaveFile(save));
  }

  function add(save: AdventureSave): string {
    // Check the save before picking an ID, so a bad save writes nothing.
    const text = exportSaveFile(save);
    const id = newId();
    write(keyFor(id), text);
    return id;
  }

  function storedIds(): string[] {
    const ids: string[] = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(SAVE_KEY_PREFIX) && idPattern.test(key.slice(SAVE_KEY_PREFIX.length))) {
          ids.push(key.slice(SAVE_KEY_PREFIX.length));
        }
      }
    } catch (error) {
      throw storageError(error);
    }
    return ids;
  }

  return {
    list() {
      const ready: ReadySave[] = [];
      const unreadable: SaveListEntry[] = [];
      for (const id of storedIds()) {
        try {
          const save = load(id);
          ready.push({
            id,
            status: 'ready',
            name: save.name,
            settings: save.settings,
            commandCount: save.commands.length,
            createdAt: save.createdAt,
            updatedAt: save.updatedAt,
          });
        } catch (error) {
          if (error instanceof SaveError && error.problem === 'storage-unavailable') {
            throw error;
          }
          const message = error instanceof SaveError ? error.message : 'This save could not be read.';
          unreadable.push({ id, status: 'unreadable', message });
        }
      }
      // Plain comparisons, not localeCompare, keep the order the same everywhere.
      const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      ready.sort((a, b) => compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id));
      unreadable.sort((a, b) => compare(a.id, b.id));
      return [...ready, ...unreadable];
    },
    add,
    put,
    load,
    remove(id) {
      const key = keyFor(id);
      try {
        storage.removeItem(key);
      } catch (error) {
        throw storageError(error);
      }
    },
    exportSave(id) {
      return exportSaveFile(load(id));
    },
    importSave(text) {
      return add(importSaveFile(text));
    },
  };
}
