import { describe, expect, it, vi } from 'vitest';
import {
  adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord, type AdventureLength,
} from './adventure-settings';
import { cosyMysteryV2, lightFantasyV2, scienceFictionV2 } from './content/v2/place-wording';
import { adventurePack, generateAdventureWorld, versionOnePack } from './generate-world';
import { prepareSeededPlacement } from './seeded-placement';
import { createSeededRandom } from './seeded-random';

describe('released version 2 generation', () => {
  it.each([lightFantasyV2, cosyMysteryV2, scienceFictionV2])('selects the final $genre content', (pack) => {
    expect(adventurePack(2, pack.genre)).toBe(pack);
    expect(adventurePack(1, pack.genre)).toBe(versionOnePack(pack.genre));
    expect(() => adventurePack(3, pack.genre)).toThrow('version 3 is not supported');
  });

  it.each([0, 1, 17000])('seed %i: uses only the prepared draws and detaches the world', (seed) => {
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Generation must use the seed.');
    });
    const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Generation must not use the clock.');
    });
    try {
      for (const length of adventureLengths) {
        const settings = createAdventureSettings(seed, length, 2);
        const pack = adventurePack(2, settings.genre);
        const before = structuredClone(pack);
        const original = generateAdventureWorld(createAdventureSettings(seed, length, 1));
        const random = createSeededRandom(seed);
        random.nextUint32();
        random.pickIndex(pack.plots.length);
        const expected = prepareSeededPlacement(original, random);
        const world = generateAdventureWorld(settings);
        expect(world).toEqual(expected);
        expect(world).not.toEqual(original);
        expect(world.version).toBe(1); // The engine data format has not changed.
        expect(world).not.toHaveProperty('names');
        expect(world.items[0]).not.toBe(pack.items[0]);
        expect(world.solution.steps[0].conditions).not.toBe(pack.solution.steps[0].conditions);
        expect(pack).toEqual(before);
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
  ] satisfies [number, AdventureLength, string][])('keeps seed %i, %s canonical as %s', (seed, length, word) => {
    const settings = createAdventureSettings(seed, length, 2);
    expect(encodeShareWord(settings)).toBe(word);
    expect(parseShareWord(` ${word.toUpperCase()}- `)).toEqual(settings);
    expect(parseShareWord(word.slice(0, -1)).version).toBe(1);
    expect(encodeShareWord(parseShareWord(word.slice(0, -1)))).toBe(word.slice(0, -1));
  });

  it.each([
    [0, 'short', 'e9af7673d2dee3d86f601d159e2038d7891d932a64b8ba2e6d83cfc1f39a8f04'],
    [1234, 'medium', 'b2f9ed8d8ccb1cd58e15447fe5f23e0a3cd75c65eb9171375b6fab273a083db6'],
    [9999, 'long', 'fcdbac2b6aad75922cefa15a2e7b6c1b054ee2d4494b20603a7f2ff021ba4497'],
    [1, 'short', '40bb4833f1f2c763f5dec54bc1caa276cf9f97dd71c8a4d217adf735124e8958'],
    [42, 'medium', '99a59ddac090dd607902d595a0fd45d86a6ab71667d27f08440bb703fb51e8f8'],
    [13, 'long', 'fa7a08310af44887476d55dcafcf554b00c2962cbdf6c0aecf3e7f1da7496bdb'],
    [17000, 'short', '8f8d5f6c14c69f26ce9e0eec3141d1a6a77de3c99d342365910f01cbe0698f3b'],
    [2024, 'medium', '6fd7031df8796f7159ab4bb73cd826e4c59f77b775bee377be7f672a5316b014'],
    [777, 'long', '9a6636b701c88dc96d05a8a377502f91195f42c6a29efa067ee99cf662b23556'],
  ] satisfies [number, AdventureLength, string][])('pins the complete world for seed %i, %s', async (seed, length, pin) => {
    const world = generateAdventureWorld(createAdventureSettings(seed, length, 2));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(world)));
    expect([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')).toBe(pin);
  });
});
