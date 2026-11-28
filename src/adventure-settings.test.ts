import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adventureLengths,
  adventureGenres,
  createAdventureSettings,
  createNewAdventureSettings,
  createSeed,
  encodeShareWord,
  parseShareWord,
  seedCountFor,
  ShareWordError,
  supportedVersions,
  type RandomValueSource,
} from './adventure-settings';

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
    if (error instanceof ShareWordError) return error.problem;
    throw error;
  }
  return undefined;
}

describe('adventure settings', () => {
  it('supports only version 2', () => {
    expect(supportedVersions).toEqual([2]);
  });

  it('works out the same genre from the same seed', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('The clock must not be used');
    });
    expect(createAdventureSettings(1, 'short').genre).toBe('cosy-mystery');
  });

  it('round-trips every version 2 seed and length to one canonical word', () => {
    const words = new Set<string>();
    for (let seed = 0; seed < seedCountFor(); seed += 1) {
      for (const length of adventureLengths) {
        const settings = createAdventureSettings(seed, length);
        const word = encodeShareWord(settings);
        expect(parseShareWord(word)).toEqual(settings);
        words.add(word);
      }
    }
    expect(words.size).toBe(seedCountFor() * adventureLengths.length);
  }, 30_000);

  it('rejects malformed and unsupported share words', () => {
    for (const input of ['', 'silverlantern', 'ableacorn', 'silverlantern1']) {
      expect(problemOf(input)).toBe('malformed');
    }
    expect(problemOf('silverlantern3')).toBe('unsupported-version');
  });

  it('starts a new adventure with the chosen length and genre', () => {
    const settings = createNewAdventureSettings('long', fixedSource([0, 1234]));
    expect(settings.version).toBe(2);
    expect(settings.length).toBe('long');
    expect(adventureGenres).toContain(settings.genre);
  });

  it('uses a given random source and stays in seed range', () => {
    expect(createSeed(fixedSource([21761]))).toBe(1);
    expect(createSeed(fixedSource([0xffffffff, 3]))).toBe(3);
  });

  it('rejects seeds outside the supported range and unknown lengths', () => {
    expect(() => createAdventureSettings(-1, 'short')).toThrow(RangeError);
    expect(() => createAdventureSettings(seedCountFor(), 'short')).toThrow(RangeError);
    expect(() => createAdventureSettings(1, 'huge' as never)).toThrow(RangeError);
  });
});
