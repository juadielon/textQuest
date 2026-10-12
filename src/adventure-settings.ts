import { createSeededRandom } from './seeded-random';
import { versionOneFirstWords, versionOneSecondWords } from './share-words';

// The starting settings that a share word identifies. Player progress, saves
// and display titles are deliberately not part of this contract.

export const adventureLengths = ['short', 'medium', 'long'] as const;
export type AdventureLength = (typeof adventureLengths)[number];

export const adventureGenres = ['light-fantasy', 'cosy-mystery', 'science-fiction'] as const;
export type AdventureGenre = (typeof adventureGenres)[number];

// One number covers both the generator rules and their content. Any change
// that could give a different adventure for the same seed needs a new
// version, and every released version must keep working unchanged.
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

export const supportedVersions: readonly number[] = [...versionRules.keys()];

export interface AdventureSettings {
  readonly version: number;
  readonly seed: number;
  readonly length: AdventureLength;
  readonly genre: AdventureGenre;
}

export type ShareWordProblem = 'malformed' | 'unsupported-version';

export class ShareWordError extends Error {
  readonly problem: ShareWordProblem;

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

// Every word pair stands for one seed and length, so the number of seeds is
// the number of pairs shared out between the lengths.
export function seedCountFor(version: number): number {
  const rules = rulesFor(version);
  return Math.floor((rules.firstWords.length * rules.secondWords.length) / adventureLengths.length);
}

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

export interface RandomValueSource {
  getRandomValues(array: Uint32Array<ArrayBuffer>): unknown;
}

// Only new adventures use real randomness. Everything after the seed is
// worked out from it.
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

export function createNewAdventureSettings(
  length: AdventureLength,
  source: RandomValueSource = globalThis.crypto,
): AdventureSettings {
  return createAdventureSettings(createSeed(currentVersion, source), length);
}

// A share word joins one word from each list, such as "silverlantern".
// Version 1 words have no number. Later versions will end with their number,
// such as "silverlantern2", so older copies can say they do not support them.
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
