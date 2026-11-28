import { describe, expect, it, vi } from 'vitest';
import {
  adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord,
  type AdventureLength,
} from './adventure-settings';
import { cosyMysteryV2, lightFantasyV2, scienceFictionV2 } from './content/v2/place-wording';
import { adventurePack, generateAdventureWorld } from './generate-world';

describe('released version 2 generation', () => {
  it.each([lightFantasyV2, cosyMysteryV2, scienceFictionV2])(
    'selects the final $genre content',
    (pack) => expect(adventurePack(pack.genre)).toBe(pack),
  );

  it.each([0, 1, 17000])('seed %i uses the seeded placement without real randomness', (seed) => {
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Generation must use the seed.');
    });
    const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Generation must not use the clock.');
    });
    try {
      for (const length of adventureLengths) {
        const settings = createAdventureSettings(seed, length);
        const world = generateAdventureWorld(settings);
        expect(world.version).toBe(2);
        expect(world).not.toHaveProperty('names');
        expect(generateAdventureWorld(settings)).toEqual(world);
      }
    } finally {
      randomSpy.mockRestore();
      clockSpy.mockRestore();
    }
  });

  it.each([
    [0, 'short', 'sunlitsaucer2'],
    [0, 'long', 'sunlitjellyfish2'],
    [21759, 'long', 'ableacorn2'],
  ] satisfies [number, AdventureLength, string][])(
    'keeps seed %i, %s canonical as %s',
    (seed, length, word) => {
      const settings = createAdventureSettings(seed, length);
      expect(encodeShareWord(settings)).toBe(word);
      expect(parseShareWord(` ${word.toUpperCase()}- `)).toEqual(settings);
    },
  );
});
