import { describe, expect, it, vi } from 'vitest';
import { adventureLengths, createAdventureSettings } from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import { generateAdventureWorld, versionOnePack } from './generate-world';
import { createSeededRandom } from './seeded-random';
import { prepareSeededPlacement } from './seeded-placement';
import { checkWinnability } from './winnability';

function prepare(seed: number, world: AdventureWorld): AdventureWorld {
  const random = createSeededRandom(seed);
  random.nextUint32();
  random.pickIndex(3);
  return prepareSeededPlacement(world, random);
}

describe('seeded placement rules', () => {
  for (const length of adventureLengths) {
    it(`${length}: varies every genre and plot without blocking a win`, () => {
      const groups = new Map<string, { seeds: number; worlds: Set<string> }>();
      for (let seed = 0; seed < 1_000; seed += 1) {
        const settings = createAdventureSettings(seed, length, 1);
        const original = generateAdventureWorld(settings);
        const random = createSeededRandom(seed);
        random.nextUint32();
        const plot = random.pickIndex(versionOnePack(settings.genre).plots.length);
        const world = prepareSeededPlacement(original, random);
        expect(prepare(seed, original)).toEqual(world);
        expect(generateAdventureWorld(settings)).toEqual(original);
        expect(world.places).toEqual(original.places);
        expect(world.exits).toEqual(original.exits);
        expect(world.solution).toEqual(original.solution);
        for (const kind of ['items', 'clues'] as const) {
          expect(world[kind].map(({ id }) => id)).toEqual(original[kind].map(({ id }) => id));
          for (const [index, entry] of world[kind].entries()) {
            if (original[kind][index].placeId === undefined) {
              expect(entry.placeId).toBeUndefined();
              continue;
            }
            const neededAt = world.solution.steps.filter(({ conditions }) =>
              (kind === 'items' ? conditions.itemsHeld : conditions.cluesRevealed)?.includes(entry.id))
              .map(({ placeId }) => world.places.findIndex(({ id }) => id === placeId));
            const spot = world.places.findIndex(({ id }) => id === entry.placeId);
            expect(spot, entry.id).toBeGreaterThanOrEqual(0);
            expect(spot, entry.id).toBeLessThanOrEqual(Math.min(...neededAt));
          }
        }
        const required = world.solution.goal.conditions.stepsDone ?? [];
        const withoutOptional = {
          ...world, solution: {
            ...world.solution, steps: world.solution.steps.filter(({ id }) => required.includes(id)),
          },
        };
        // Exact results reject unknown/too-large worlds as well as unwinnable ones.
        expect(checkWinnability(world)).toEqual({ winnable: true, unreachableStepIds: [] });
        expect(checkWinnability(withoutOptional)).toEqual({ winnable: true, unreachableStepIds: [] });
        const key = `${settings.genre}/${plot}`;
        const group = groups.get(key) ?? { seeds: 0, worlds: new Set<string>() };
        group.seeds += 1;
        group.worlds.add(JSON.stringify(world));
        groups.set(key, group);
      }
      expect(groups.size).toBe(9);
      for (const [key, { seeds, worlds }] of groups) {
        expect(seeds, key).toBeGreaterThan(50);
        expect(worlds.size, key).toBeGreaterThanOrEqual(Math.ceil(seeds * 0.8));
      }
    }, 30_000);
  }

  it('uses only the supplied stream and detaches the result', () => {
    const world = generateAdventureWorld(createAdventureSettings(0, 'short', 1));
    const before = structuredClone(world);
    const realRandom = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Placement must use the seed.');
    });
    try {
      const first = prepare(0, world);
      const second = prepare(0, world);
      expect(first).toEqual(second);
      expect(first.items).not.toBe(second.items);
      expect(first.items[0]).not.toBe(world.items[0]);
      expect(first.solution.steps[0].conditions).not.toBe(world.solution.steps[0].conditions);
      expect(world).toEqual(before);
    } finally {
      realRandom.mockRestore();
    }
  });

  it('leaves awarded and unused pickups alone and avoids locked and one-way paths', () => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'start',
      places: ['start', 'workshop', 'trap', 'gate'].map((id) => ({ id })),
      exits: [
        { id: 'out', fromPlaceId: 'start', toPlaceId: 'workshop', locked: false },
        { id: 'back', fromPlaceId: 'workshop', toPlaceId: 'start', locked: false },
        { id: 'trap', fromPlaceId: 'start', toPlaceId: 'trap', locked: false },
        { id: 'gate', fromPlaceId: 'start', toPlaceId: 'gate', locked: true },
        { id: 'gate-back', fromPlaceId: 'gate', toPlaceId: 'start', locked: false },
      ],
      items: [{ id: 'tool', placeId: 'workshop' }, { id: 'unused', placeId: 'workshop' }, { id: 'award' }],
      clues: [{ id: 'goal-note', placeId: 'workshop' }, { id: 'gated-note', placeId: 'gate' }],
      solution: {
        steps: [{
          id: 'work', placeId: 'workshop', conditions: { itemsHeld: ['tool'] },
          effects: [{ kind: 'give-item', itemId: 'award' }],
        }, {
          id: 'gated', placeId: 'gate', conditions: { cluesRevealed: ['gated-note'] }, effects: [],
        }],
        goal: { placeId: 'workshop', conditions: { cluesRevealed: ['goal-note'] } },
      },
    };
    const pickIndex = vi.fn((count: number) => count - 1);
    const result = prepareSeededPlacement(world, { pickIndex, nextUint32: () => 0 });
    expect(pickIndex.mock.calls).toEqual([[2], [2]]);
    expect(result.items).toEqual(world.items);
    expect(result.clues).toEqual(world.clues);
    const atStart = prepareSeededPlacement(world, { pickIndex: () => 0, nextUint32: () => 0 });
    expect(atStart.items[0].placeId).toBe('start');
    expect(atStart.clues[0].placeId).toBe('start');
    expect(atStart.items.slice(1)).toEqual(world.items.slice(1));
    expect(atStart.clues[1]).toEqual(world.clues[1]);
  });
});
