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

  it.each(packs)('$genre: varies the world within each plot, without correlating plot with genre', (pack) => {
    const worlds = new Set<string>();
    const spots = new Map<string, Set<string>>();
    for (let seed = 0; seed < seedCount; seed += 1) {
      const settings = createAdventureSettings(seed, 'short');
      if (settings.genre !== pack.genre) continue;
      const world = generateAdventureWorld(settings);
      worlds.add(JSON.stringify(world));
      for (const { id, placeId } of [...world.items, ...world.clues]) {
        if (placeId !== undefined) spots.set(id, (spots.get(id) ?? new Set()).add(placeId));
      }
    }
    expect(worlds.size).toBeGreaterThan(pack.plots.length * 10);
    // Every starting item and clue turns up in more than one place.
    for (const [id, places] of spots) expect(places.size, id).toBeGreaterThan(1);
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
          const authored = pack[kind]
            .filter(({ placeId }) => placeId === undefined || plan.placeIds.includes(placeId));
          expect(world[kind].map(({ id }) => id)).toEqual(authored.map(({ id }) => id));
          for (const [index, { id, placeId }] of world[kind].entries()) {
            const authoredPlaceId = authored[index].placeId;
            const neededAt = world.solution.steps
              .filter(({ conditions }) => (kind === 'items' ? conditions.itemsHeld : conditions.cluesRevealed)?.includes(id))
              .map((step) => plan.placeIds.indexOf(step.placeId));
            if (authoredPlaceId === undefined || neededAt.length === 0) {
              expect(placeId, id).toBe(authoredPlaceId);
            } else {
              // Plans list places in walking order from the start, so this
              // means the thing is found on the way to where it's first used.
              expect(plan.placeIds.indexOf(placeId!), id).toBeGreaterThanOrEqual(0);
              expect(plan.placeIds.indexOf(placeId!), id).toBeLessThanOrEqual(Math.min(...neededAt));
            }
          }
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
    [0, 'short', 'light-fantasy', 'e9af7673d2dee3d86f601d159e2038d7891d932a64b8ba2e6d83cfc1f39a8f04'],
    [1234, 'medium', 'light-fantasy', 'b2f9ed8d8ccb1cd58e15447fe5f23e0a3cd75c65eb9171375b6fab273a083db6'],
    [9999, 'long', 'light-fantasy', 'fcdbac2b6aad75922cefa15a2e7b6c1b054ee2d4494b20603a7f2ff021ba4497'],
    [1, 'short', 'cosy-mystery', '40bb4833f1f2c763f5dec54bc1caa276cf9f97dd71c8a4d217adf735124e8958'],
    [42, 'medium', 'cosy-mystery', '99a59ddac090dd607902d595a0fd45d86a6ab71667d27f08440bb703fb51e8f8'],
    [13, 'long', 'cosy-mystery', 'fa7a08310af44887476d55dcafcf554b00c2962cbdf6c0aecf3e7f1da7496bdb'],
    [17000, 'short', 'science-fiction', '8f8d5f6c14c69f26ce9e0eec3141d1a6a77de3c99d342365910f01cbe0698f3b'],
    [2024, 'medium', 'science-fiction', '6fd7031df8796f7159ab4bb73cd826e4c59f77b775bee377be7f672a5316b014'],
    [777, 'long', 'science-fiction', '9a6636b701c88dc96d05a8a377502f91195f42c6a29efa067ee99cf662b23556'],
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
