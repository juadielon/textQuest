import { describe, expect, it } from 'vitest';
import type { AdventureWorld, Conditions, Effect } from './adventure-world';
import { checkWinnability, MAX_SEARCH_STATES, validateWorld } from './winnability';

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

const twoWay = (from: string, to: string) => [
  { id: `${from}-${to}`, fromPlaceId: from, toPlaceId: to, locked: false },
  { id: `${to}-${from}`, fromPlaceId: to, toPlaceId: from, locked: false },
];

// A long adventure: 27 rooms off one hall, with 14 chained steps needing items
// from different rooms. Tracking each order of visits separately runs out of memory.
function longHubWorld(): AdventureWorld {
  const rooms = Array.from({ length: 27 }, (_, index) => `room-${index}`);
  const steps = Array.from({ length: 14 }, (_, index) => ({
    id: `step-${index}`, placeId: 'hall',
    conditions: {
      itemsHeld: [`item-${index}`],
      stepsDone: index ? [`step-${index - 1}`] : [],
    },
    effects: [],
  }));
  return {
    version: 1, startPlaceId: 'hall',
    places: [{ id: 'hall' }, ...rooms.map((id) => ({ id }))],
    exits: rooms.flatMap((room) => twoWay('hall', room)),
    items: steps.map((_, index) => ({ id: `item-${index}`, placeId: `room-${index * 2}` })),
    clues: [],
    solution: { steps, goal: { placeId: 'hall', conditions: { stepsDone: ['step-13'] } } },
  };
}

// A long adventure in 14 sections. Each section's step needs an item from its
// side room and unlocks a one-way gate. Side rooms have one-way drops back.
function longGatedWorld(): AdventureWorld {
  const sections = Array.from({ length: 14 }, (_, index) => index);
  return {
    version: 1, startPlaceId: 'hall-0',
    places: sections.flatMap((index) => [{ id: `hall-${index}` }, { id: `side-${index}` }]),
    exits: sections.flatMap((index) => [
      ...twoWay(`hall-${index}`, `side-${index}`),
      ...(index < 13 ? [
        { id: `gate-${index}`, fromPlaceId: `hall-${index}`, toPlaceId: `hall-${index + 1}`, locked: true },
      ] : []),
      ...(index > 0 ? [
        { id: `drop-${index}`, fromPlaceId: `side-${index}`, toPlaceId: `hall-${index - 1}`, locked: false },
      ] : []),
    ]),
    items: sections.map((index) => ({ id: `key-${index}`, placeId: `side-${index}` })),
    clues: [],
    solution: {
      steps: sections.map((index) => ({
        id: `open-${index}`, placeId: `hall-${index}`,
        conditions: { itemsHeld: [`key-${index}`] },
        effects: index < 13 ? [{ kind: 'unlock-exit' as const, exitId: `gate-${index}` }] : [],
      })),
      goal: { placeId: 'hall-13', conditions: { stepsDone: ['open-13'] } },
    },
  };
}

// Every level offers two one-way rooms with different items, so the number of
// separate routes doubles each level.
function branchingWorld(levels: number): AdventureWorld {
  const indexes = Array.from({ length: levels }, (_, index) => index);
  return {
    version: 1, startPlaceId: 'junction-0',
    places: [
      ...indexes.flatMap((index) => [
        { id: `junction-${index}` }, { id: `left-${index}` }, { id: `right-${index}` },
      ]),
      { id: `junction-${levels}` },
    ],
    exits: indexes.flatMap((index) => ['left', 'right'].flatMap((side) => [
      { id: `to-${side}-${index}`, fromPlaceId: `junction-${index}`, toPlaceId: `${side}-${index}`, locked: false },
      { id: `from-${side}-${index}`, fromPlaceId: `${side}-${index}`, toPlaceId: `junction-${index + 1}`, locked: false },
    ])),
    items: indexes.flatMap((index) => ['left', 'right'].map((side) => ({
      id: `${side}-item-${index}`, placeId: `${side}-${index}`,
    }))),
    clues: [],
    solution: { steps: [], goal: { placeId: `junction-${levels}`, conditions: {} } },
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
    expect(() => checkWinnability(JSON.parse(data.replace('"version":1', '"version":3'))))
      .toThrow('not supported');
    expect(() => checkWinnability(JSON.parse(data.replace('unlock-exit', 'remove-item'))))
      .toThrow('Unknown puzzle effect');
  });

  it('only joins places once a one-way route has an unlocked way back', () => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id: 'cellar' }],
      exits: [
        { id: 'drop', fromPlaceId: 'entry', toPlaceId: 'cellar', locked: false },
        { id: 'ladder', fromPlaceId: 'cellar', toPlaceId: 'entry', locked: true },
      ],
      items: [{ id: 'lamp', placeId: 'cellar' }], clues: [],
      solution: {
        steps: [{
          id: 'lower-ladder', placeId: 'cellar', conditions: {},
          effects: [{ kind: 'unlock-exit', exitId: 'ladder' }],
        }],
        goal: { placeId: 'entry', conditions: { itemsHeld: ['lamp'] } },
      },
    };
    expect(checkWinnability(world)).toEqual({ winnable: true, unreachableStepIds: [] });
    expect(checkWinnability({
      ...world,
      solution: { ...world.solution, steps: [{ ...world.solution.steps[0], effects: [] }] },
    })).toEqual({ winnable: false, unreachableStepIds: [] });
  });

  it('checks long worlds with 28 places and 14 required steps within the limit', () => {
    for (const world of [longHubWorld(), longGatedWorld()]) {
      expect(world.places).toHaveLength(28);
      expect(world.solution.steps).toHaveLength(14);
      expect(checkWinnability(world)).toEqual({ winnable: true, unreachableStepIds: [] });
    }
  });

  it('still reports unwinnable long worlds', () => {
    const world = longGatedWorld();
    expect(checkWinnability({
      ...world, items: world.items.map((item) => item.id === 'key-6' ? { id: item.id } : item),
    })).toEqual({
      winnable: false,
      unreachableStepIds: Array.from({ length: 8 }, (_, index) => `open-${index + 6}`),
    });
  });

  // Searching up to the limit takes a few seconds, so a busy machine can push it
  // past Vitest's 5-second default. Give it more room.
  it('reports a world over the search limit as too large, never winnable', () => {
    expect(MAX_SEARCH_STATES).toBe(10_000);
    expect(checkWinnability(branchingWorld(10))).toEqual({
      winnable: true, unreachableStepIds: [],
    });
    const result = checkWinnability(branchingWorld(16));
    expect(result).toEqual({ winnable: false, tooLarge: true });
    expect(checkWinnability(branchingWorld(16))).toEqual(result);
  }, 30_000);
});

describe('validateWorld', () => {
  it('accepts a valid world and rejects the same problems as the checker', () => {
    expect(() => validateWorld(sampleWorld())).not.toThrow();
    expect(() => validateWorld({ ...sampleWorld(), startPlaceId: 'nowhere' }))
      .toThrow('Unknown place ID "nowhere".');
  });
});

// A world version 2 square with two mutually exclusive ways out. The bridge
// has a failure ending and the tunnel a winning one; both lead to the castle.
function choiceWorld(): AdventureWorld {
  return {
    version: 2, startPlaceId: 'square',
    places: [{ id: 'square' }, { id: 'bridge' }, { id: 'tunnel' }, { id: 'castle' }],
    exits: [
      { id: 'bridge-gate', fromPlaceId: 'square', toPlaceId: 'bridge', locked: true },
      { id: 'tunnel-gate', fromPlaceId: 'square', toPlaceId: 'tunnel', locked: true },
      { id: 'bridge-end', fromPlaceId: 'bridge', toPlaceId: 'castle', locked: false },
      { id: 'tunnel-end', fromPlaceId: 'tunnel', toPlaceId: 'castle', locked: false },
    ],
    items: [], clues: [],
    solution: {
      steps: [
        {
          id: 'cross-bridge', placeId: 'square', choiceId: 'route', conditions: {},
          effects: [{ kind: 'unlock-exit', exitId: 'bridge-gate' }],
        },
        {
          id: 'dig-tunnel', placeId: 'square', choiceId: 'route', conditions: {},
          effects: [{ kind: 'unlock-exit', exitId: 'tunnel-gate' }],
        },
        {
          id: 'jump', placeId: 'bridge', conditions: {},
          effects: [{ kind: 'end-adventure', endingId: 'fall' }],
        },
        {
          id: 'slip-away', placeId: 'tunnel', conditions: {},
          effects: [{ kind: 'end-adventure', endingId: 'escape' }],
        },
      ],
      goal: { placeId: 'castle', conditions: {} },
      endings: [{ id: 'fall', outcome: 'failure' }, { id: 'escape', outcome: 'win' }],
    },
  };
}

const withGoal = (world: AdventureWorld, goal: AdventureWorld['solution']['goal']): AdventureWorld =>
  ({ ...world, solution: { ...world.solution, goal } });

describe('world version 2 choices and endings', () => {
  function goalWorld(): AdventureWorld {
    return {
      version: 2, startPlaceId: 'start',
      places: [{ id: 'start' }, { id: 'goal' }, { id: 'beyond' }],
      exits: [
        ...twoWay('start', 'goal'), ...twoWay('goal', 'beyond'),
      ],
      items: [], clues: [],
      solution: {
        steps: [{
          id: 'leave', placeId: 'beyond', conditions: {},
          effects: [{ kind: 'end-adventure', endingId: 'escape' }],
        }],
        goal: { placeId: 'start', conditions: {} },
        endings: [{ id: 'escape', outcome: 'win' }],
      },
    };
  }

  it('does not follow a one-way exit after winning at the start', () => {
    const world = goalWorld();
    expect(checkWinnability({
      ...world, exits: [{ id: 'out', fromPlaceId: 'start', toPlaceId: 'beyond', locked: false }],
      solution: { ...world.solution, steps: [] },
    })).toEqual({
      winnable: true, unreachableStepIds: [], reachableEndingIds: [], canGetStuck: false,
    });
  });

  it('does not visit returnable places or take an ending after winning at the start', () => {
    expect(checkWinnability(goalWorld())).toEqual({
      winnable: true, unreachableStepIds: ['leave'], reachableEndingIds: [], canGetStuck: false,
    });
  });

  it('stops at a goal midway along a returnable route', () => {
    expect(checkWinnability(withGoal(goalWorld(), { placeId: 'goal', conditions: {} }))).toEqual({
      winnable: true, unreachableStepIds: ['leave'], reachableEndingIds: [], canGetStuck: false,
    });
  });

  it('still explores routes that avoid the goal', () => {
    const world = withGoal(goalWorld(), { placeId: 'goal', conditions: {} });
    expect(checkWinnability({
      ...world, exits: [...world.exits, ...twoWay('start', 'beyond')],
    })).toEqual({
      winnable: true, unreachableStepIds: [], reachableEndingIds: ['escape'], canGetStuck: false,
    });
  });

  it.each<Conditions>([
    { itemsHeld: ['token'] }, { cluesRevealed: ['note'] },
    { stepsDone: ['prepare'] }, { placesVisited: ['goal'] },
  ])('can leave an unmet goal and return when its conditions hold: %j', (conditions) => {
    const world = withGoal(goalWorld(), { placeId: 'start', conditions });
    expect(checkWinnability({
      ...world,
      items: [{ id: 'token', placeId: 'goal' }],
      clues: [{ id: 'note', placeId: 'goal' }],
      solution: {
        ...world.solution,
        steps: [...world.solution.steps, {
          id: 'prepare', placeId: 'goal', conditions: {}, effects: [],
        }],
      },
    })).toEqual({
      winnable: true, unreachableStepIds: [], reachableEndingIds: ['escape'], canGetStuck: false,
    });
  });

  it('stops when a decision at the goal meets its conditions', () => {
    const world = withGoal(goalWorld(), { placeId: 'start', conditions: { stepsDone: ['finish'] } });
    expect(checkWinnability({
      ...world,
      solution: {
        ...world.solution,
        steps: [...world.solution.steps,
          { id: 'finish', placeId: 'start', choiceId: 'plan', conditions: {}, effects: [] },
          { id: 'wait', placeId: 'start', choiceId: 'plan', conditions: {}, effects: [] },
          {
            id: 'too-late', placeId: 'start', conditions: { stepsDone: ['finish'] },
            effects: [{ kind: 'end-adventure', endingId: 'escape' }],
          },
        ],
      },
    })).toEqual({
      winnable: true, unreachableStepIds: ['too-late'],
      reachableEndingIds: ['escape'], canGetStuck: false,
    });
  });

  it('preserves version 1 exploration beyond a reached goal and its result shape', () => {
    const world = goalWorld();
    expect(checkWinnability({
      ...world, version: 1,
      solution: {
        goal: world.solution.goal,
        steps: [{ id: 'after-goal', placeId: 'beyond', conditions: {}, effects: [] }],
      },
    })).toEqual({ winnable: true, unreachableStepIds: [] });
  });

  it.each(['take', 'use'] as const)('preserves an early ending before %s wins at the goal', (action) => {
    const world: AdventureWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }], exits: [],
      items: [{ id: 'key', placeId: 'room' }], clues: [],
      solution: {
        goal: {
          placeId: 'room',
          conditions: action === 'take' ? { itemsHeld: ['key'] } : { stepsDone: ['finish'] },
        },
        steps: [
          {
            id: 'leave-early', placeId: 'room', conditions: {},
            effects: [{ kind: 'end-adventure', endingId: 'early' }],
          },
          {
            id: 'leave-late', placeId: 'room',
            conditions: action === 'take' ? { itemsHeld: ['key'] } : { stepsDone: ['finish'] },
            effects: [{ kind: 'end-adventure', endingId: 'late' }],
          },
          {
            id: 'leave-holding-key', placeId: 'room', conditions: { itemsHeld: ['key'] },
            effects: [{ kind: 'end-adventure', endingId: 'holding-key' }],
          },
          {
            id: 'finish', placeId: 'room', conditions: { itemsHeld: ['key'] }, effects: [],
          },
        ],
        endings: [
          { id: 'early', outcome: 'failure' }, { id: 'late', outcome: 'failure' },
          { id: 'holding-key', outcome: 'failure' },
        ],
      },
    };
    expect(checkWinnability(world)).toEqual({
      winnable: true,
      unreachableStepIds: action === 'take'
        ? ['leave-late', 'leave-holding-key', 'finish'] : ['leave-late'],
      reachableEndingIds: action === 'take' ? ['early'] : ['early', 'holding-key'],
      canGetStuck: false,
    });
  });

  it('settles automatic steps and clues at the current place before checking the goal', () => {
    const world = withGoal(goalWorld(), { placeId: 'start', conditions: { stepsDone: ['finish'] } });
    expect(checkWinnability({
      ...world,
      clues: [{ id: 'note', placeId: 'start' }],
      solution: {
        ...world.solution,
        steps: [...world.solution.steps, {
          id: 'finish', placeId: 'start', conditions: { cluesRevealed: ['note'] }, effects: [],
        }],
      },
    })).toEqual({
      winnable: true, unreachableStepIds: ['leave'], reachableEndingIds: [], canGetStuck: false,
    });
  });

  it('searches every choice and reports each reachable ending without changing the world', () => {
    const world = choiceWorld();
    const before = JSON.stringify(world);
    expect(checkWinnability(world)).toEqual({
      winnable: true, unreachableStepIds: [],
      reachableEndingIds: ['fall', 'escape'], canGetStuck: false,
    });
    expect(JSON.stringify(world)).toBe(before);
    expect(checkWinnability(JSON.parse(before))).toEqual(checkWinnability(world));
  });

  it('never lets one route take both options of a choice', () => {
    const world = withGoal(choiceWorld(), {
      placeId: 'castle', conditions: { stepsDone: ['cross-bridge', 'dig-tunnel'] },
    });
    const result = checkWinnability({
      ...world,
      solution: {
        ...world.solution,
        endings: [{ id: 'fall', outcome: 'failure' }, { id: 'escape', outcome: 'failure' }],
      },
    });
    expect(result).toEqual({
      winnable: false, unreachableStepIds: [],
      reachableEndingIds: ['fall', 'escape'], canGetStuck: true,
    });
  });

  it('reports a choice that leaves the player unable to win', () => {
    const world = withGoal(choiceWorld(), { placeId: 'castle', conditions: { placesVisited: ['tunnel'] } });
    expect(checkWinnability(world)).toMatchObject({ winnable: true, canGetStuck: true });
  });

  it('counts a winning ending as a win when the goal cannot be reached', () => {
    const world = withGoal(choiceWorld(), { placeId: 'castle', conditions: { stepsDone: ['jump'] } });
    expect(checkWinnability(world)).toEqual({
      winnable: true, unreachableStepIds: [],
      reachableEndingIds: ['fall', 'escape'], canGetStuck: true,
    });
  });

  it('allows a failure only when the player could still have won instead', () => {
    const world = choiceWorld();
    const onlyFailure: AdventureWorld = {
      ...world,
      exits: world.exits.filter(({ id }) => id !== 'bridge-end'),
      solution: {
        ...world.solution,
        steps: world.solution.steps.filter(({ id }) => id !== 'slip-away'),
      },
    };
    // The bridge leads nowhere but the fall, so recovering to just before it can't help.
    expect(checkWinnability(onlyFailure)).toEqual({
      winnable: true, unreachableStepIds: [],
      reachableEndingIds: ['fall'], canGetStuck: true,
    });
    expect(checkWinnability({ ...onlyFailure, exits: [...onlyFailure.exits, world.exits[2]] }))
      .toMatchObject({ winnable: true, canGetStuck: false });
  });

  it('reports a world whose only outcome is failure as unwinnable', () => {
    expect(checkWinnability({
      version: 2, startPlaceId: 'cliff', places: [{ id: 'cliff' }, { id: 'sea' }],
      exits: [], items: [], clues: [],
      solution: {
        steps: [{
          id: 'leap', placeId: 'cliff', conditions: {},
          effects: [{ kind: 'end-adventure', endingId: 'fall' }],
        }],
        goal: { placeId: 'sea', conditions: {} },
        endings: [{ id: 'fall', outcome: 'failure' }],
      },
    })).toEqual({
      winnable: false, unreachableStepIds: [], reachableEndingIds: ['fall'], canGetStuck: true,
    });
  });

  it('adds only the extra fields when a version 2 world has no choices', () => {
    expect(checkWinnability({ ...sampleWorld(), version: 2 })).toEqual({
      winnable: true, unreachableStepIds: [], reachableEndingIds: [], canGetStuck: false,
    });
  });

  it.each<(world: AdventureWorld) => AdventureWorld>([
    (world) => ({ ...world, solution: { ...world.solution, endings: [] } }),
    (world) => ({
      ...world, solution: {
        ...world.solution,
        steps: world.solution.steps.map((step) => ({ ...step, choiceId: 'pick' })),
      },
    }),
    (world) => ({
      ...world, solution: {
        ...world.solution,
        steps: world.solution.steps.map((step, index) => index ? step
          : { ...step, effects: [{ kind: 'end-adventure' as const, endingId: 'x' }] }),
      },
    }),
  ])('keeps choices and endings out of world version 1 %#', (change) => {
    expect(() => checkWinnability(change(sampleWorld()))).toThrow('need world version 2');
  });

  it.each<[string, (world: AdventureWorld) => AdventureWorld, string]>([
    ['a one-option choice', (world) => ({
      ...world, solution: {
        ...world.solution,
        steps: world.solution.steps.map((step) =>
          step.id === 'dig-tunnel' ? { ...step, choiceId: 'other' } : step),
      },
    }), 'needs at least two steps'],
    ['an empty choice ID', (world) => ({
      ...world, solution: {
        ...world.solution,
        steps: world.solution.steps.map((step) => ({ ...step, choiceId: ' ' })),
      },
    }), 'empty choice ID'],
    ['an unknown ending', (world) => ({
      ...world, solution: {
        ...world.solution,
        steps: world.solution.steps.map((step) => step.id === 'jump'
          ? { ...step, effects: [{ kind: 'end-adventure' as const, endingId: 'missing' }] } : step),
      },
    }), 'Unknown ending ID "missing"'],
    ['two endings from one step', (world) => ({
      ...world, solution: {
        ...world.solution,
        steps: world.solution.steps.map((step) => step.id === 'jump' ? {
          ...step, effects: [...step.effects, { kind: 'end-adventure' as const, endingId: 'escape' }],
        } : step),
      },
    }), 'more than once'],
    ['a repeated ending ID', (world) => ({
      ...world, solution: {
        ...world.solution, endings: [...world.solution.endings!, world.solution.endings![0]],
      },
    }), 'ending ID "fall" is empty or repeated'],
    ['an unknown outcome', (world) => JSON.parse(JSON.stringify(world).replace('"failure"', '"draw"')),
      'unknown outcome'],
  ])('rejects %s', (_, change, message) => {
    expect(() => validateWorld(change(choiceWorld()))).toThrow(message);
  });
});
