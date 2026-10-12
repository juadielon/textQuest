import { describe, expect, it } from 'vitest';
import type { AdventureWorld, Conditions, Effect } from './adventure-world';
import { checkWinnability } from './winnability';

function sampleWorld(): AdventureWorld {
  return {
    version: 1,
    startPlaceId: 'entry',
    places: [{ id: 'entry' }, { id: 'study' }, { id: 'finish' }],
    exits: [
      { id: 'to-study', fromPlaceId: 'entry', toPlaceId: 'study', locked: false },
      { id: 'to-entry', fromPlaceId: 'study', toPlaceId: 'entry', locked: false },
      { id: 'door', fromPlaceId: 'entry', toPlaceId: 'finish', locked: true },
    ],
    items: [{ id: 'key' }, { id: 'token', placeId: 'study' }],
    clues: [{ id: 'note', placeId: 'study' }, { id: 'answer' }],
    solution: {
      steps: [
        {
          id: 'open-door', placeId: 'entry',
          conditions: { itemsHeld: ['key'], stepsDone: ['find-key'] },
          effects: [{ kind: 'unlock-exit', exitId: 'door' }],
        },
        {
          id: 'find-key', placeId: 'study',
          conditions: { itemsHeld: ['token'], cluesRevealed: ['answer'] },
          effects: [{ kind: 'give-item', itemId: 'key' }],
        },
        {
          id: 'read-note', placeId: 'study',
          conditions: { cluesRevealed: ['note'], placesVisited: ['entry'] },
          effects: [{ kind: 'reveal-clue', clueId: 'answer' }],
        },
      ],
      goal: { placeId: 'finish', conditions: { stepsDone: ['open-door'] } },
    },
  };
}

describe('checkWinnability', () => {
  it('wins a hand-built world with items, clues, steps, a return trip and an unlocked exit', () => {
    const world = sampleWorld();
    const before = JSON.stringify(world);

    expect(checkWinnability(world)).toEqual({ winnable: true, unreachableStepIds: [] });
    expect(JSON.stringify(world)).toBe(before);
    expect(checkWinnability(JSON.parse(before))).toEqual(checkWinnability(world));
  });

  it('reports an unreachable goal even when every step can be completed', () => {
    const world = sampleWorld();
    const blocked: AdventureWorld = {
      ...world,
      solution: {
        ...world.solution,
        steps: world.solution.steps.map((step) =>
          step.id === 'open-door' ? { ...step, effects: [] } : step),
      },
    };
    expect(checkWinnability(blocked)).toEqual({ winnable: false, unreachableStepIds: [] });
  });

  it('reports a key behind its own locked door', () => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id: 'finish' }],
      exits: [{ id: 'door', fromPlaceId: 'entry', toPlaceId: 'finish', locked: true }],
      items: [{ id: 'key', placeId: 'finish' }], clues: [],
      solution: {
        steps: [{
          id: 'open-door', placeId: 'entry', conditions: { itemsHeld: ['key'] },
          effects: [{ kind: 'unlock-exit', exitId: 'door' }],
        }],
        goal: { placeId: 'finish', conditions: {} },
      },
    };
    expect(checkWinnability(world)).toEqual({
      winnable: false, unreachableStepIds: ['open-door'],
    });
  });

  it('does not combine items or visits from mutually unreachable one-way routes', () => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id: 'left' }, { id: 'right' }],
      exits: ['left', 'right'].map((id) => ({
        id, fromPlaceId: 'entry', toPlaceId: id, locked: false,
      })),
      items: [{ id: 'key', placeId: 'left' }], clues: [],
      solution: {
        steps: [{
          id: 'use-key', placeId: 'right',
          conditions: { itemsHeld: ['key'] }, effects: [],
        }],
        goal: { placeId: 'right', conditions: { placesVisited: ['left'] } },
      },
    };
    expect(checkWinnability(world)).toEqual({
      winnable: false, unreachableStepIds: ['use-key'],
    });
    expect(checkWinnability({
      ...world, solution: {
        ...world.solution, goal: { placeId: 'right', conditions: {} },
      },
    })).toEqual({ winnable: true, unreachableStepIds: ['use-key'] });
  });

  it('finishes ordinary exit cycles and reports optional unreachable steps after a win', () => {
    const world = sampleWorld();
    const optional = {
      id: 'loop', placeId: 'entry', conditions: { stepsDone: ['loop'] }, effects: [],
    };
    expect(checkWinnability({
      ...world, solution: { ...world.solution, steps: [...world.solution.steps, optional] },
    })).toEqual({ winnable: true, unreachableStepIds: ['loop'] });
  });

  it('can win at the start without any puzzle steps', () => {
    expect(checkWinnability({
      version: 1, startPlaceId: 'entry', places: [{ id: 'entry' }],
      exits: [], items: [], clues: [],
      solution: { steps: [], goal: { placeId: 'entry', conditions: {} } },
    })).toEqual({ winnable: true, unreachableStepIds: [] });
  });

  it.each<Conditions>([
    { itemsHeld: ['key'] }, { placesVisited: ['study'] },
    { stepsDone: ['open-door'] }, { cluesRevealed: ['answer'] },
  ])('requires each kind of goal condition: %j', (conditions) => {
    const world = sampleWorld();
    const solution = { ...world.solution, goal: { placeId: 'entry', conditions } };
    expect(checkWinnability({ ...world, solution }).winnable).toBe(true);
    expect(checkWinnability({
      ...world,
      exits: world.exits.filter((exit) => exit.id !== 'to-study'),
      solution,
    }).winnable).toBe(false);
  });

  it.each<Conditions>([
    { itemsHeld: ['missing'] }, { placesVisited: ['missing'] },
    { stepsDone: ['missing'] }, { cluesRevealed: ['missing'] },
  ])('rejects missing references in step and goal conditions: %j', (conditions) => {
    const world = sampleWorld();
    expect(() => checkWinnability({
      ...world,
      solution: { ...world.solution, goal: { ...world.solution.goal, conditions } },
    })).toThrow('Unknown');
    expect(() => checkWinnability({
      ...world,
      solution: {
        ...world.solution,
        steps: [{ ...world.solution.steps[0], conditions }],
      },
    })).toThrow('Unknown');
  });

  it.each<Effect>([
    { kind: 'unlock-exit', exitId: 'missing' },
    { kind: 'give-item', itemId: 'missing' },
    { kind: 'reveal-clue', clueId: 'missing' },
  ])('rejects missing effect references: %j', (effect) => {
    const world = sampleWorld();
    expect(() => checkWinnability({
      ...world,
      solution: {
        ...world.solution,
        steps: [{ ...world.solution.steps[0], conditions: {}, effects: [effect] }],
        goal: { placeId: 'entry', conditions: {} },
      },
    })).toThrow('Unknown');
  });

  it.each<(world: AdventureWorld) => AdventureWorld>([
    (world) => ({ ...world, startPlaceId: 'missing' }),
    (world) => ({ ...world, exits: [{ ...world.exits[0], fromPlaceId: 'missing' }] }),
    (world) => ({ ...world, exits: [{ ...world.exits[0], toPlaceId: 'missing' }] }),
    (world) => ({ ...world, items: [{ id: 'key', placeId: 'missing' }] }),
    (world) => ({ ...world, clues: [{ id: 'note', placeId: 'missing' }] }),
    (world) => ({
      ...world, solution: {
        ...world.solution, goal: { placeId: 'missing', conditions: {} },
      },
    }),
    (world) => ({
      ...world, solution: {
        ...world.solution, steps: [{ ...world.solution.steps[0], placeId: 'missing' }],
      },
    }),
  ])('rejects missing place references %#', (change) => {
    expect(() => checkWinnability(change(sampleWorld()))).toThrow('Unknown');
  });

  it.each(['places', 'exits', 'items', 'clues'] as const)('rejects repeated %s IDs', (kind) => {
    const world = sampleWorld();
    expect(() => checkWinnability({
      ...world, [kind]: [...world[kind], world[kind][0]],
    })).toThrow('repeated');
  });

  it('rejects repeated step IDs and empty IDs', () => {
    const world = sampleWorld();
    expect(() => checkWinnability({
      ...world,
      solution: {
        ...world.solution, steps: [...world.solution.steps, world.solution.steps[0]],
      },
    })).toThrow('repeated');
    expect(() => checkWinnability({
      ...world, places: [{ id: ' ' }],
    })).toThrow('empty');
  });

  it('rejects unsupported versions and unknown effects in serialised data', () => {
    const data = JSON.stringify(sampleWorld());
    expect(() => checkWinnability(JSON.parse(data.replace('"version":1', '"version":2'))))
      .toThrow('not supported');
    expect(() => checkWinnability(JSON.parse(data.replace('unlock-exit', 'remove-item'))))
      .toThrow('Unknown puzzle effect');
  });
});
