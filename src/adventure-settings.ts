import { createSeededRandom } from './seeded-random';
import { versionOneFirstWords, versionOneSecondWords } from './share-words';

/**
 * @packageDocumentation
 * The starting settings that a share word identifies. Player progress, saves
 * and display titles are deliberately not part of this contract.
 */

/** Adventure lengths a player can choose, in share-word order. Never reorder. */
export const adventureLengths = ['short', 'medium', 'long'] as const;

/** How long an adventure is: short, medium or long. */
export type AdventureLength = (typeof adventureLengths)[number];

/** Every genre an adventure can have. */
export const adventureGenres = ['light-fantasy', 'cosy-mystery', 'science-fiction'] as const;

/** The genre of an adventure, which is chosen from its seed. */
export type AdventureGenre = (typeof adventureGenres)[number];

/**
 * The adventure version used for new adventures.
 *
 * @remarks
 * One number covers both the generator rules and their content. Any change
 * that could give a different adventure for the same seed needs a new
 * version, and every released version must keep working unchanged.
 */
export const currentVersion = 1;

interface VersionRules {
  readonly genres: readonly AdventureGenre[];
  readonly firstWords: readonly string[];
  readonly secondWords: readonly string[];
}

const versionRules: ReadonlyMap<number, VersionRules> = new Map([
  [
    1,
    {
      genres: ['light-fantasy', 'cosy-mystery', 'science-fiction'],
      firstWords: versionOneFirstWords,
      secondWords: versionOneSecondWords,
    },
  ],
]);

/** Adventure versions this copy of textQuest can create and open. */
export const supportedVersions: readonly number[] = [...versionRules.keys()];

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

function rulesFor(version: number): VersionRules {
  const rules = versionRules.get(version);
  if (!rules) {
    throw new RangeError(`Adventure version ${version} is not supported.`);
  }
  return rules;
}

/**
 * Counts the seeds a version supports.
 *
 * @remarks
 * Every word pair stands for one seed and length, so the number of seeds is
 * the number of pairs shared out between the lengths.
 *
 * @param version - The adventure version.
 * @returns How many seeds the version has. Valid seeds go from 0 to this number minus 1.
 * @throws RangeError if the version is not supported.
 */
export function seedCountFor(version: number): number {
  const rules = rulesFor(version);
  return Math.floor((rules.firstWords.length * rules.secondWords.length) / adventureLengths.length);
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
  const rules = rulesFor(version);
  if (!Number.isInteger(seed) || seed < 0 || seed >= seedCountFor(version)) {
    throw new RangeError(`A version ${version} seed must be a whole number below ${seedCountFor(version)}.`);
  }
  if (!adventureLengths.includes(length)) {
    throw new RangeError('Choose a short, medium or long adventure.');
  }

  const random = createSeededRandom(seed);
  const genre = rules.genres[random.pickIndex(rules.genres.length)];
  return { version, seed, length, genre };
}

/**
 * A source of unpredictable numbers, such as the browser's `crypto` object.
 * Tests can pass a fixed source instead.
 */
export interface RandomValueSource {
  /** Fills `array` with random 32-bit values. */
  getRandomValues(array: Uint32Array<ArrayBuffer>): unknown;
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
  version: number = currentVersion,
  source: RandomValueSource = globalThis.crypto,
): number {
  const count = seedCountFor(version);
  // Throw away the few top values that would make some seeds more likely.
  const limit = Math.floor(2 ** 32 / count) * count;
  const values = new Uint32Array(1);
  do {
    source.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % count;
}

/**
 * Starts a new adventure of the chosen length with a fresh random seed.
 *
 * @param length - The adventure length the player chose.
 * @param source - Where to get random numbers. Defaults to browser cryptographic randomness.
 * @returns Settings for the current version.
 */
export function createNewAdventureSettings(
  length: AdventureLength,
  source: RandomValueSource = globalThis.crypto,
): AdventureSettings {
  return createAdventureSettings(createSeed(currentVersion, source), length);
}

/**
 * Turns adventure settings into their one canonical share word.
 *
 * @remarks
 * A share word joins one word from each list, such as "silverlantern".
 * Version 1 words have no number. Later versions will end with their number,
 * such as "silverlantern2", so older copies can say they do not support them.
 *
 * @param settings - The settings to share.
 * @returns A lowercase share word.
 * @throws RangeError if the settings are invalid or the genre doesn't match the seed.
 */
export function encodeShareWord(settings: AdventureSettings): string {
  const expected = createAdventureSettings(settings.seed, settings.length, settings.version);
  if (settings.genre !== expected.genre) {
    throw new RangeError('The genre does not match this seed and version.');
  }

  const rules = rulesFor(settings.version);
  const pairNumber = settings.seed * adventureLengths.length + adventureLengths.indexOf(settings.length);
  const first = rules.firstWords[Math.floor(pairNumber / rules.secondWords.length)];
  const second = rules.secondWords[pairNumber % rules.secondWords.length];
  const suffix = settings.version === 1 ? '' : String(settings.version);
  return `${first}${second}${suffix}`;
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
  if (suffix !== '' && !/^[2-9]$|^[1-9]\d+$/.test(suffix)) {
    throw malformed();
  }

  const version = suffix === '' ? 1 : Number(suffix);
  if (!versionRules.has(version)) {
    throw new ShareWordError(
      'unsupported-version',
      `That share word is for adventure version ${suffix}, which this copy of textQuest does not support.`,
    );
  }

  const rules = rulesFor(version);
  for (const [firstIndex, first] of rules.firstWords.entries()) {
    if (!letters.startsWith(first)) {
      continue;
    }
    const secondIndex = rules.secondWords.indexOf(letters.slice(first.length));
    if (secondIndex === -1) {
      continue;
    }

    const pairNumber = firstIndex * rules.secondWords.length + secondIndex;
    const seed = Math.floor(pairNumber / adventureLengths.length);
    const length = adventureLengths[pairNumber % adventureLengths.length];
    return createAdventureSettings(seed, length, version);
  }

  throw malformed();
}
