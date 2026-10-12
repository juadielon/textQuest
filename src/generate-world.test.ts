import { describe, expect, it, vi } from 'vitest';
import {
  adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord, seedCountFor,
  type AdventureLength, type AdventureSettings,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import type { ContentPack } from './content/v1/format';
import { lightFantasy } from './content/v1/light-fantasy';
import { generateAdventureWorld } from './generate-world';
import { checkWinnability } from './winnability';

const pack: ContentPack = lightFantasy;

describe('version 1 world generation', () => {
  it('recreates the same world from settings and share words without real randomness', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Generation must use only the seed.');
    });
    try {
      const settings = createAdventureSettings(1234, 'medium');
      const before = structuredClone(settings);
      const world = generateAdventureWorld(settings);
      expect(generateAdventureWorld(settings)).toEqual(world);
      expect(generateAdventureWorld(parseShareWord(encodeShareWord(settings)))).toEqual(world);
      expect(settings).toEqual(before);
    } finally {
      random.mockRestore();
    }
  });

  it('selects all three authored graphs across seeds, without correlating plot with genre', () => {
    const worlds = new Set<string>();
    for (let seed = 0; seed < 256; seed += 1) {
      const settings = createAdventureSettings(seed, 'short');
      if (settings.genre === 'light-fantasy') {
        worlds.add(JSON.stringify(generateAdventureWorld(settings)));
      }
    }
    expect(worlds.size).toBe(pack.plots.length);
  });

  for (const length of adventureLengths) {
    it(`${length}: preserves the exact plan, local rules and optional routes for every graph`, () => {
      const seenPlots = new Set<string>();
      for (let seed = 0; seed < 256; seed += 1) {
        const settings = createAdventureSettings(seed, length);
        if (settings.genre !== 'light-fantasy') continue;
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

  it('does not mutate or share nested data with the pack or other generated worlds', () => {
    const before = structuredClone(lightFantasy);
    const settings = createAdventureSettings(0, 'long');
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
    expect(lightFantasy).toEqual(before);
  });

  it.each([
    ['cosy-mystery', 1],
    ['science-fiction', 17000],
  ] as const)('rejects %s rather than substituting a fantasy world', (genre, seed) => {
    const settings = createAdventureSettings(seed, 'short');
    expect(settings.genre).toBe(genre);
    expect(() => generateAdventureWorld(settings)).toThrow(
      `World generation for ${genre} is not supported yet.`,
    );
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
    [0, 'short', '28963b7eceb5d70a22d76b087f6cdff0ca67155cefacfb34c1e5b0ed849937c6'],
    [1234, 'medium', '917290c0b0fb358e5aeee74f462c80b78a22ad42f47ee0e81719e4577fbf1db0'],
    [9999, 'long', '2376a8828b5e705c4c430bde79ae91bb70af5176beac50eaf1c5a6ccf8baf51d'],
  ] satisfies [number, AdventureLength, string][])(
    'pins the complete version 1 world for seed %i, %s',
    async (seed, length, expected) => {
      const world: AdventureWorld = generateAdventureWorld(createAdventureSettings(seed, length));
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(world)));
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(hex).toBe(expected);
    },
  );
});
