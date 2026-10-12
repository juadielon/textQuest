import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adventureLengths,
  createAdventureSettings,
  createNewAdventureSettings,
  createSeed,
  encodeShareWord,
  parseShareWord,
  seedCountFor,
  ShareWordError,
  supportedVersions,
  type AdventureSettings,
  type RandomValueSource,
} from './adventure-settings';
import { versionOneFirstWords, versionOneSecondWords } from './share-words';

afterEach(() => {
  vi.restoreAllMocks();
});

function fixedSource(values: number[]): RandomValueSource {
  return {
    getRandomValues(array) {
      array[0] = values.shift() ?? 0;
      return array;
    },
  };
}

function problemOf(input: unknown): string | undefined {
  try {
    parseShareWord(input as string);
  } catch (error) {
    if (error instanceof ShareWordError) {
      return error.problem;
    }
    throw error;
  }
  return undefined;
}

// Version 1 must keep giving these results after any later update.
const versionOneExamples: [string, AdventureSettings][] = [
  ['ableacorn', { version: 1, seed: 0, length: 'short', genre: 'light-fantasy' }],
  ['ableapple', { version: 1, seed: 0, length: 'long', genre: 'light-fantasy' }],
  ['ablebadger', { version: 1, seed: 1, length: 'medium', genre: 'cosy-mystery' }],
  ['busyraven', { version: 1, seed: 1234, length: 'long', genre: 'light-fantasy' }],
  ['luckythistle', { version: 1, seed: 9999, length: 'short', genre: 'light-fantasy' }],
  ['tallanchor', { version: 1, seed: 17000, length: 'medium', genre: 'science-fiction' }],
  ['sunlitsaucer', { version: 1, seed: 21759, length: 'long', genre: 'science-fiction' }],
];

describe('version 1 share words', () => {
  it('uses fixed lists of simple, unique lowercase words', () => {
    expect(versionOneFirstWords).toHaveLength(256);
    expect(versionOneSecondWords).toHaveLength(255);
    expect(supportedVersions).toEqual([1]);

    for (const words of [versionOneFirstWords, versionOneSecondWords]) {
      expect(new Set(words).size).toBe(words.length);
      expect(words.every((word) => /^[a-z]{2,10}$/.test(word))).toBe(true);
    }
  });

  it('shares the word pairs evenly between the lengths', () => {
    const pairCount = versionOneFirstWords.length * versionOneSecondWords.length;

    expect(pairCount % adventureLengths.length).toBe(0);
    expect(seedCountFor(1)).toBe(21760);
  });

  it('gives every word pair one spelling that splits only one way', () => {
    const joined = new Set(
      versionOneFirstWords.flatMap((first) => versionOneSecondWords.map((second) => first + second)),
    );

    expect(joined.size).toBe(versionOneFirstWords.length * versionOneSecondWords.length);
  });

  it.each(versionOneExamples)('keeps %s pinned to the same settings', (word, settings) => {
    expect(parseShareWord(word)).toEqual(settings);
    expect(encodeShareWord(settings)).toBe(word);
  });

  it('round-trips every version 1 seed and length to one canonical word', () => {
    const words = new Set<string>();

    for (let seed = 0; seed < seedCountFor(1); seed += 1) {
      for (const length of adventureLengths) {
        const settings = createAdventureSettings(seed, length);
        const word = encodeShareWord(settings);

        expect(parseShareWord(word)).toEqual(settings);
        words.add(word);
      }
    }

    expect(words.size).toBe(versionOneFirstWords.length * versionOneSecondWords.length);
  });

  it('accepts capitals, spaces and hyphens but encodes them one way', () => {
    const settings = parseShareWord('silverlantern');

    for (const typed of ['SilverLantern', '  silver lantern ', 'silver-lantern', 'SILVER  LANTERN']) {
      expect(parseShareWord(typed)).toEqual(settings);
    }
    expect(encodeShareWord(settings)).toBe('silverlantern');
  });
});

describe('parseShareWord', () => {
  it.each([
    '',
    '   ',
    'silver',
    'lantern',
    'lanternsilver',
    'silverlanterns',
    'silverlanter',
    'silver lantern!',
    'sílverlantern',
    'silverlantern1',
    'silverlantern02',
    'silverlantern0',
    '1silverlantern',
    '2',
  ])('rejects %j as malformed', (input) => {
    expect(problemOf(input)).toBe('malformed');
  });

  it('rejects values that are not text as malformed', () => {
    expect(problemOf(undefined)).toBe('malformed');
    expect(problemOf(42)).toBe('malformed');
  });

  it.each(['silverlantern2', 'silverlantern10', 'unknownword7', 'silverlantern99999999999999999999'])(
    'rejects %j as an unsupported version without reading it as version 1',
    (input) => {
      expect(problemOf(input)).toBe('unsupported-version');
    },
  );

  it('explains the problem in plain words', () => {
    expect(() => parseShareWord('nonsense')).toThrow(/not one textQuest knows/);
    expect(() => parseShareWord('silverlantern2')).toThrow(/version 2.*does not support/);
  });
});

describe('createAdventureSettings', () => {
  it('works out the same genre from the same seed and version', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('The clock must not be used');
    });

    expect(createAdventureSettings(1234, 'medium')).toEqual(createAdventureSettings(1234, 'medium'));
    expect(createAdventureSettings(1, 'short').genre).toBe('cosy-mystery');
  });

  it('keeps only starting settings, not progress or titles', () => {
    expect(Object.keys(createAdventureSettings(5, 'long')).sort()).toEqual([
      'genre',
      'length',
      'seed',
      'version',
    ]);
  });

  it('rejects seeds outside the version range, unknown lengths and versions', () => {
    for (const seed of [-1, 0.5, 21760]) {
      expect(() => createAdventureSettings(seed, 'short')).toThrow(RangeError);
    }
    expect(() => createAdventureSettings(1, 'huge' as never)).toThrow(RangeError);
    expect(() => createAdventureSettings(1, 'short', 2)).toThrow(RangeError);
  });
});

describe('encodeShareWord', () => {
  it('refuses settings whose genre does not match the seed', () => {
    const settings = createAdventureSettings(1, 'short');

    expect(() => encodeShareWord({ ...settings, genre: 'light-fantasy' })).toThrow(RangeError);
  });
});

describe('createSeed', () => {
  it('uses the given random source and stays in range', () => {
    expect(createSeed(1, fixedSource([21761]))).toBe(1);
  });

  it('skips the top values that would make some seeds more likely', () => {
    expect(createSeed(1, fixedSource([0xffffffff, 3]))).toBe(3);
  });

  it('gets a seed from browser cryptographic randomness by default', () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues');

    const seed = createSeed();

    expect(getRandomValues).toHaveBeenCalled();
    expect(Number.isInteger(seed) && seed >= 0 && seed < seedCountFor(1)).toBe(true);
  });

  it('starts a new adventure with the chosen length and a fresh seed', () => {
    expect(createNewAdventureSettings('long', fixedSource([1234]))).toEqual({
      version: 1,
      seed: 1234,
      length: 'long',
      genre: 'light-fantasy',
    });
  });
});
