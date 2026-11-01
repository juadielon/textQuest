import { describe, expect, it, vi } from 'vitest';
import {
  adventureGenres, adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord, seedCountFor,
  type AdventureGenre, type AdventureLength, type AdventureSettings,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import type { ContentPack } from './content/v1/format';
import { cosyMystery } from './content/v1/cosy-mystery';
import { lightFantasy } from './content/v1/light-fantasy';
import { scienceFiction } from './content/v1/science-fiction';
import { generateAdventureWorld } from './generate-world';
import { checkWinnability } from './winnability';

const packs: readonly ContentPack[] = [lightFantasy, cosyMystery, scienceFiction];
const seedCount = 600;

function firstSeedFor(pack: ContentPack): number {
  let seed = 0;
  while (createAdventureSettings(seed, 'short').genre !== pack.genre) seed += 1;
  return seed;
}

describe('version 1 world generation', () => {
  it('generates a world for every version 1 genre', () => {
    expect(packs.map(({ genre }) => genre).sort()).toEqual([...adventureGenres].sort());
    for (const pack of packs) {
      expect(generateAdventureWorld(createAdventureSettings(firstSeedFor(pack), 'short')).startPlaceId)
        .toBe(pack.startPlaceId);
    }
  });

  for (const pack of packs) for (const length of adventureLengths) {
    it(`${pack.genre}, ${length}: recreates the same world from settings and share words without real randomness`, () => {
      const settings = createAdventureSettings(firstSeedFor(pack), length);
      const random = vi.spyOn(Math, 'random').mockImplementation(() => {
        throw new Error('Generation must use only the seed.');
      });
      try {
        const before = structuredClone(settings);
        const world = generateAdventureWorld(settings);
        expect(generateAdventureWorld(settings)).toEqual(world);
        expect(generateAdventureWorld(parseShareWord(encodeShareWord(settings)))).toEqual(world);
        expect(settings).toEqual(before);
      } finally {
        random.mockRestore();
      }
    });
  }

  it.each(packs)('$genre: selects every authored graph across seeds, without correlating plot with genre', (pack) => {
    const worlds = new Set<string>();
    for (let seed = 0; seed < seedCount; seed += 1) {
      const settings = createAdventureSettings(seed, 'short');
      if (settings.genre === pack.genre) {
        worlds.add(JSON.stringify(generateAdventureWorld(settings)));
      }
    }
    expect(worlds.size).toBe(pack.plots.length);
  });

  for (const pack of packs) for (const length of adventureLengths) {
    it(`${pack.genre}, ${length}: preserves the exact plan, local rules and optional routes for every graph`, () => {
      const seenPlots = new Set<string>();
      for (let seed = 0; seed < seedCount; seed += 1) {
        const settings = createAdventureSettings(seed, length);
        if (settings.genre !== pack.genre) continue;
        const world = generateAdventureWorld(settings);
        const plot = pack.plots.find((entry) => world.solution.steps.every((step) =>
          JSON.stringify(step.conditions.stepsDone) === JSON.stringify([
            ...pack.solution.steps.find(({ id }) => id === step.id)!.conditions.stepsDone ?? [],
            ...entry.dependencies[step.id] ?? [],
          ])))!;
        expect(plot).toBeDefined();
        seenPlots.add(plot.id);
        const plan = plot.lengths[length];
        expect(world.version).toBe(1);
        expect(world.startPlaceId).toBe(pack.startPlaceId);
        expect(world.places.map(({ id }) => id)).toEqual(plan.placeIds);
        expect(world.places).toHaveLength({ short: 8, medium: 16, long: 24 }[length]);
        expect(world.solution.goal.conditions.stepsDone).toEqual(plan.requiredStepIds);
        expect(plan.requiredStepIds).toHaveLength({ short: 4, medium: 8, long: 12 }[length]);
        expect(world.solution.goal).toEqual({
          ...pack.solution.goal,
          conditions: { ...pack.solution.goal.conditions, stepsDone: plan.requiredStepIds },
        });
        expect(world.exits).toEqual(pack.exits.filter(({ fromPlaceId, toPlaceId }) =>
          plan.placeIds.includes(fromPlaceId) && plan.placeIds.includes(toPlaceId)));
        for (const kind of ['items', 'clues'] as const) {
          expect(world[kind]).toEqual(pack[kind]
            .filter(({ placeId }) => placeId === undefined || plan.placeIds.includes(placeId))
            .map(({ id, placeId }) => placeId === undefined ? { id } : { id, placeId }));
        }
        expect(world.solution.steps.map(({ id }) => id)).toEqual([
          ...plan.requiredStepIds, ...pack.optionalDiscoveries.map(({ id }) => id),
        ]);
        for (const step of world.solution.steps) {
          const authored = pack.solution.steps.find(({ id }) => id === step.id)!;
          expect(step).toEqual({
            ...authored,
            conditions: {
              ...authored.conditions,
              stepsDone: [...authored.conditions.stepsDone ?? [], ...plot.dependencies[step.id] ?? []],
            },
          });
        }
        expect(checkWinnability(world)).toEqual({ winnable: true, unreachableStepIds: [] });
        expect(checkWinnability({
          ...world,
          solution: {
            ...world.solution,
            steps: world.solution.steps.filter(({ id }) => plan.requiredStepIds.includes(id)),
          },
        })).toEqual({ winnable: true, unreachableStepIds: [] });
      }
      expect(seenPlots.size).toBe(pack.plots.length);
    });
  }

  it.each(packs)('$genre: does not mutate or share nested data with the pack or other generated worlds', (pack) => {
    const before = structuredClone(pack);
    const settings = createAdventureSettings(firstSeedFor(pack), 'long');
    const first = generateAdventureWorld(settings);
    const second = generateAdventureWorld(settings);
    function checkDetached(left: unknown, right: unknown) {
      if (left !== null && typeof left === 'object' && right !== null && typeof right === 'object') {
        expect(left).not.toBe(right);
        for (const key of Object.keys(left)) {
          checkDetached(Reflect.get(left, key), Reflect.get(right, key));
        }
      }
    }
    checkDetached(first, second);
    for (const kind of ['places', 'exits', 'items', 'clues'] as const) {
      for (const entity of first[kind]) {
        checkDetached(entity, pack[kind].find(({ id }) => id === entity.id));
      }
    }
    for (const step of first.solution.steps) {
      checkDetached(step, pack.solution.steps.find(({ id }) => id === step.id));
    }
    checkDetached(first.solution.goal, pack.solution.goal);
    expect(pack).toEqual(before);
  });

  it.each([
    [{ version: 2 }, 'Adventure version 2 is not supported.'],
    [{ seed: -1 }, 'seed must be a whole number'],
    [{ seed: 0.5 }, 'seed must be a whole number'],
    [{ seed: Number.NaN }, 'seed must be a whole number'],
    [{ seed: seedCountFor(1) }, 'seed must be a whole number'],
    [{ length: 'endless' }, 'Choose a short, medium or long adventure.'],
    [{ genre: 'cosy-mystery' }, 'The genre does not match this seed and version.'],
  ])('rejects invalid settings %j', (changes, message) => {
    const settings = { ...createAdventureSettings(0, 'short'), ...changes } as AdventureSettings;
    expect(() => generateAdventureWorld(settings)).toThrow(message);
  });

  it.each([
    [0, 'short', 'light-fantasy', '28963b7eceb5d70a22d76b087f6cdff0ca67155cefacfb34c1e5b0ed849937c6'],
    [1234, 'medium', 'light-fantasy', '917290c0b0fb358e5aeee74f462c80b78a22ad42f47ee0e81719e4577fbf1db0'],
    [9999, 'long', 'light-fantasy', '2376a8828b5e705c4c430bde79ae91bb70af5176beac50eaf1c5a6ccf8baf51d'],
    [1, 'short', 'cosy-mystery', 'a7671f5ed95e1e904b6f4e6114f346f48ece7d014983ef5db0bb6a1545dfc3de'],
    [42, 'medium', 'cosy-mystery', '94e24f29769cfcc48dded9642b89dce263b279878d7c04bde15a3952a00e7066'],
    [13, 'long', 'cosy-mystery', 'c5bb081f302488f4ebcca3dc6bf932fb830db84434a7427f4e45e0c66c63315c'],
    [17000, 'short', 'science-fiction', '26b79005727cc71480acca452f31dfa6a65dfc3b12d9901cdf6239493f873f69'],
    [2024, 'medium', 'science-fiction', 'df434d4055dd65b66638b40e563b2c650f0b7817d562b7ed60647988da72eed4'],
    [777, 'long', 'science-fiction', '1d3fdf21a29ee337bc1cb0b0b9568aac44a2188b81f4d2152cf9a73dcc6848a7'],
  ] satisfies [number, AdventureLength, AdventureGenre, string][])(
    'pins the complete version 1 world for seed %i, %s, %s',
    async (seed, length, genre, expected) => {
      const settings = createAdventureSettings(seed, length);
      expect(settings.genre).toBe(genre);
      const world: AdventureWorld = generateAdventureWorld(settings);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(world)));
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(hex).toBe(expected);
    },
  );
});
