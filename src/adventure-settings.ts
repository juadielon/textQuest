import { createSeededRandom } from './seeded-random';
import { firstWords, secondWords } from './share-words';

/*
 * The starting settings that a share word identifies. Player progress, saves
 * and display titles are deliberately not part of this contract.
 */

/**
 * Adventure lengths a player can choose, in share-word order.
 *
 * @remarks
 * Never add, remove, rename or reorder entries. Share words depend on this
 * exact list.
 */
export const adventureLengths = ['short', 'medium', 'long'] as const;

/** How long an adventure is: short, medium or long. */
export type AdventureLength = (typeof adventureLengths)[number];

/**
 * Every genre an adventure can have.
 *
 * @remarks
 * The supported rules set which genres it uses and the order its seed picks
 * from, so this list doesn't decide the genre for a seed.
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

const genresInSeedOrder: readonly AdventureGenre[] =
  ['light-fantasy', 'cosy-mystery', 'science-fiction'];

/** Everything needed to recreate the same starting adventure. */
export interface AdventureSettings {
  /** A whole number below {@link seedCountFor}. */
  readonly seed: number;
  /** The length the player chose. */
  readonly length: AdventureLength;
  /** The genre chosen from the seed. It must match the seed. */
  readonly genre: AdventureGenre;
}

/**
 * Why a share word could not be read.
 *
 * - `malformed`: the word is misspelt or isn't a textQuest share word.
 */
export type ShareWordProblem = 'malformed';

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
 * Counts the supported seeds.
 *
 * @returns How many seeds there are. Valid seeds go from 0 to this number minus 1.
 */
export function seedCountFor(): number {
  return Math.floor((firstWords.length * secondWords.length) / adventureLengths.length);
}

/**
 * Builds the starting settings for a seed and length. The genre is worked out
 * from the seed, so the same input always gives the same settings.
 *
 * @param seed - A whole number below {@link seedCountFor}.
 * @param length - The adventure length.
 * @returns The adventure's starting settings.
 * @throws RangeError if the seed is out of range or the length is unknown.
 */
export function createAdventureSettings(
  seed: number,
  length: AdventureLength,
): AdventureSettings {
  if (!Number.isInteger(seed) || seed < 0 || seed >= seedCountFor()) {
    throw new RangeError(`A seed must be a whole number below ${seedCountFor()}.`);
  }
  if (!adventureLengths.includes(length)) {
    throw new RangeError('Choose a short, medium or long adventure.');
  }

  const random = createSeededRandom(seed);
  const genre = genresInSeedOrder[random.pickIndex(genresInSeedOrder.length)];
  return { seed, length, genre };
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
 * @param source - Where to get random numbers. Defaults to browser cryptographic randomness.
 * @returns A seed below {@link seedCountFor}.
 */
export function createSeed(
  source: RandomValueSource = globalThis.crypto,
): number {
  const count = seedCountFor();
  return randomIndex(count, source);
}

/**
 * Starts a new adventure of the chosen length with a fresh random seed.
 *
 * @param length - The adventure length the player chose.
 * @param source - Where to get random numbers. Defaults to browser cryptographic randomness.
 * @returns Settings for the adventure.
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
 * A share word joins one word from each list.
 *
 * @param settings - The settings to share.
 * @returns A lowercase share word.
 * @throws RangeError if the settings are invalid or the genre doesn't match the seed.
 */
export function encodeShareWord(settings: AdventureSettings): string {
  const expected = createAdventureSettings(settings.seed, settings.length);
  if (settings.genre !== expected.genre) {
    throw new RangeError('The genre does not match this seed.');
  }
  const pairNumber = settings.seed * adventureLengths.length + adventureLengths.indexOf(settings.length);
  const first = firstWords[Math.floor(pairNumber / secondWords.length)];
  const second = secondWords[pairNumber % secondWords.length];
  return `${first}${second}`;
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
 * @throws {@link ShareWordError} if the word is malformed.
 */
export function parseShareWord(input: string): AdventureSettings {
  if (typeof input !== 'string') {
    throw malformed();
  }

  // People may type "Silver Lantern". toLowerCase is locale-independent,
  // unlike toLocaleLowerCase.
  const match = /^([a-z]+)$/.exec(input.toLowerCase().replace(/[\s-]+/g, ''));
  if (!match) {
    throw malformed();
  }

  const [, letters] = match;
  for (const [firstIndex, first] of firstWords.entries()) {
    if (!letters.startsWith(first)) {
      continue;
    }
    const secondIndex = secondWords.indexOf(letters.slice(first.length));
    if (secondIndex === -1) {
      continue;
    }

    const pairNumber = firstIndex * secondWords.length + secondIndex;
    const seed = Math.floor(pairNumber / adventureLengths.length);
    const length = adventureLengths[pairNumber % adventureLengths.length];
    return createAdventureSettings(seed, length);
  }

  throw malformed();
}
