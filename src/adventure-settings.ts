import { createSeededRandom } from './seeded-random';
import {
  versionTwoFirstWords, versionTwoSecondWords,
} from './share-words';

/*
 * The starting settings that a share word identifies. Player progress, saves
 * and display titles are deliberately not part of this contract.
 */

/**
 * Adventure lengths a player can choose, in share-word order.
 *
 * @remarks
 * Never add, remove, rename or reorder entries. Share words depend on this
 * exact list; a change needs a new version.
 */
export const adventureLengths = ['short', 'medium', 'long'] as const;

/** How long an adventure is: short, medium or long. */
export type AdventureLength = (typeof adventureLengths)[number];

/**
 * Every genre an adventure can have.
 *
 * @remarks
 * Each version's own rules set which genres it uses and the order its seed
 * picks from, so this list doesn't decide the genre for a seed.
 */
export const adventureGenres = ['light-fantasy', 'cosy-mystery', 'science-fiction'] as const;

/** The genre of an adventure, which is chosen from its seed. */
export type AdventureGenre = (typeof adventureGenres)[number];

/**
 * Checks whether a form value is a known adventure genre.
 *
 * @param value - The value from a genre control.
 * @returns True for a supported genre.
 */
export function isAdventureGenre(value: unknown): value is AdventureGenre {
  return adventureGenres.includes(value as AdventureGenre);
}

/**
 * The adventure version used for new adventures.
 *
 * @remarks
 * One number covers both the generator rules and their content. Any change
 * that could give a different adventure for the same seed needs a new
 * version, and every released version must keep working unchanged.
 */
export const currentVersion = 2;

const adventureVersionGenres: readonly AdventureGenre[] =
  ['light-fantasy', 'cosy-mystery', 'science-fiction'];

/** Adventure versions this copy of textQuest can create and open. */
export const supportedVersions: readonly number[] = [currentVersion];

/** Everything needed to recreate the same starting adventure. */
export interface AdventureSettings {
  /** The adventure version whose rules and content are used. */
  readonly version: number;
  /** A whole number below {@link seedCountFor} for this version. */
  readonly seed: number;
  /** The length the player chose. */
  readonly length: AdventureLength;
  /** The genre chosen from the seed. It must match the seed and version. */
  readonly genre: AdventureGenre;
}

/**
 * Why a share word could not be read.
 *
 * - `malformed`: the word is misspelt or isn't a textQuest share word.
 * - `unsupported-version`: the word is for a version this copy doesn't know.
 */
export type ShareWordProblem = 'malformed' | 'unsupported-version';

/** Thrown by {@link parseShareWord} with a message a player can read. */
export class ShareWordError extends Error {
  /** The kind of problem, so callers can respond without matching message text. */
  readonly problem: ShareWordProblem;

  /**
   * @param problem - The kind of problem.
   * @param message - A plain-English message to show the player.
   */
  constructor(problem: ShareWordProblem, message: string) {
    super(message);
    this.name = 'ShareWordError';
    this.problem = problem;
  }
}

/**
 * Counts the seeds version 2 supports.
 *
 * @remarks
 * Every word pair stands for one seed and length, so the number of seeds is
 * the number of pairs shared out between the lengths.
 *
 * @returns How many seeds the version has. Valid seeds go from 0 to this number minus 1.
 */
export function seedCountFor(version: number = currentVersion): number {
  if (version !== currentVersion) {
    throw new RangeError(`Adventure version ${version} is not supported.`);
  }
  return Math.floor((versionTwoFirstWords.length * versionTwoSecondWords.length) / adventureLengths.length);
}

/**
 * Builds the starting settings for a seed and length. The genre is worked out
 * from the seed, so the same input always gives the same settings.
 *
 * @param seed - A whole number below {@link seedCountFor} for the version.
 * @param length - The adventure length.
 * @param version - The adventure version. Defaults to {@link currentVersion}.
 * @returns The adventure's starting settings.
 * @throws RangeError if the version is unsupported, the seed is out of range
 * or the length is unknown.
 */
export function createAdventureSettings(
  seed: number,
  length: AdventureLength,
  version: number = currentVersion,
): AdventureSettings {
  if (version !== currentVersion) {
    throw new RangeError(`Adventure version ${version} is not supported.`);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed >= seedCountFor()) {
    throw new RangeError(`A seed must be a whole number below ${seedCountFor()}.`);
  }
  if (!adventureLengths.includes(length)) {
    throw new RangeError('Choose a short, medium or long adventure.');
  }

  const random = createSeededRandom(seed);
  const genre = adventureVersionGenres[random.pickIndex(adventureVersionGenres.length)];
  return { version: currentVersion, seed, length, genre };
}

/**
 * A source of unpredictable numbers, such as the browser's `crypto` object.
 * Tests can pass a fixed source instead.
 */
export interface RandomValueSource {
  /** Fills `array` with random 32-bit values. */
  getRandomValues(array: Uint32Array<ArrayBuffer>): unknown;
}

function randomIndex(count: number, source: RandomValueSource): number {
  if (!Number.isInteger(count) || count < 1 || count > 0xffffffff) {
    throw new RangeError('Choose a valid number of options.');
  }
  const limit = Math.floor(2 ** 32 / count) * count;
  const values = new Uint32Array(1);
  do {
    source.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % count;
}

/**
 * Picks an unpredictable seed for a new adventure. Every seed is equally likely.
 *
 * @remarks
 * Only new adventures use real randomness. Everything after the seed is
 * worked out from it.
 *
 * @param version - The adventure version. Defaults to {@link currentVersion}.
 * @param source - Where to get random numbers. Defaults to browser cryptographic randomness.
 * @returns A seed below {@link seedCountFor} for the version.
 * @throws RangeError if the version is not supported.
 */
export function createSeed(
  versionOrSource: number | RandomValueSource = globalThis.crypto,
  source: RandomValueSource = globalThis.crypto,
): number {
  if (typeof versionOrSource === 'number') {
    throw new RangeError(`Adventure version ${versionOrSource} is not supported.`);
  }
  source = versionOrSource;
  const count = seedCountFor();
  return randomIndex(count, source);
}

/**
 * Starts a new adventure of the chosen length with a fresh random seed.
 *
 * @param length - The adventure length the player chose.
 * @param source - Where to get random numbers. Defaults to browser cryptographic randomness.
 * @returns Settings for the current version.
 * @throws RangeError if the length is unknown.
 */
export function createNewAdventureSettings(
  length: AdventureLength,
  source: RandomValueSource = globalThis.crypto,
  genre?: AdventureGenre,
): AdventureSettings {
  if (genre) {
    if (!isAdventureGenre(genre)) {
      throw new RangeError('Choose a supported adventure genre.');
    }
    const matchingSeeds: number[] = [];
    for (let seed = 0; seed < seedCountFor(); seed += 1) {
      if (createAdventureSettings(seed, length).genre === genre) {
        matchingSeeds.push(seed);
      }
    }
    if (!matchingSeeds.length) {
      throw new RangeError('Choose a supported adventure genre.');
    }
    return createAdventureSettings(matchingSeeds[randomIndex(matchingSeeds.length, source)], length);
  }
  const selectedGenre = adventureGenres[randomIndex(adventureGenres.length, source)];
  return createNewAdventureSettings(length, source, selectedGenre);
}

/**
 * Turns adventure settings into their one canonical share word.
 *
 * @remarks
 * A share word joins one word from each list and ends with the adventure
 * version, such as "sunlitsaucer2".
 *
 * @param settings - The settings to share.
 * @returns A lowercase share word.
 * @throws RangeError if the settings are invalid or the genre doesn't match the seed.
 */
export function encodeShareWord(settings: AdventureSettings): string {
  if (settings.version !== currentVersion) {
    throw new RangeError(`Adventure version ${settings.version} is not supported.`);
  }
  const expected = createAdventureSettings(settings.seed, settings.length);
  if (settings.genre !== expected.genre) {
    throw new RangeError('The genre does not match this seed.');
  }
  const pairNumber = settings.seed * adventureLengths.length + adventureLengths.indexOf(settings.length);
  const first = versionTwoFirstWords[Math.floor(pairNumber / versionTwoSecondWords.length)];
  const second = versionTwoSecondWords[pairNumber % versionTwoSecondWords.length];
  return `${first}${second}${currentVersion}`;
}

function malformed(): ShareWordError {
  return new ShareWordError(
    'malformed',
    'That share word is not one textQuest knows. Check the spelling and try again.',
  );
}

/**
 * Reads a share word that a player typed. Capitals, spaces and hyphens are
 * ignored, so "Silver Lantern" works too.
 *
 * @param input - The text the player entered.
 * @returns The adventure settings the word stands for.
 * @throws {@link ShareWordError} if the word is malformed or for an unsupported version.
 */
export function parseShareWord(input: string): AdventureSettings {
  if (typeof input !== 'string') {
    throw malformed();
  }

  // People may type "Silver Lantern". toLowerCase is locale-independent,
  // unlike toLocaleLowerCase.
  const match = /^([a-z]+)(\d*)$/.exec(input.toLowerCase().replace(/[\s-]+/g, ''));
  if (!match) {
    throw malformed();
  }

  const [, letters, suffix] = match;
  if (suffix === '') {
    throw malformed();
  }
  if (!/^[2-9]$|^[1-9]\d+$/.test(suffix)) {
    throw malformed();
  }
  const version = Number(suffix);
  if (version !== currentVersion) {
    throw new ShareWordError(
      'unsupported-version',
      `That share word is for adventure version ${suffix}, which this copy of textQuest does not support.`,
    );
  }
  for (const [firstIndex, first] of versionTwoFirstWords.entries()) {
    if (!letters.startsWith(first)) {
      continue;
    }
    const secondIndex = versionTwoSecondWords.indexOf(letters.slice(first.length));
    if (secondIndex === -1) {
      continue;
    }

    const pairNumber = firstIndex * versionTwoSecondWords.length + secondIndex;
    const seed = Math.floor(pairNumber / adventureLengths.length);
    const length = adventureLengths[pairNumber % adventureLengths.length];
    return createAdventureSettings(seed, length);
  }

  throw malformed();
}
