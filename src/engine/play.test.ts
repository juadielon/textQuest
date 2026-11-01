import { describe, expect, it } from 'vitest';
import { adventureLengths, createAdventureSettings } from '../adventure-settings';
import type { AdventureWorld, PuzzleStep } from '../adventure-world';
import { lightFantasy } from '../content/v1/light-fantasy';
import { worldNamesFrom } from '../content/v1/world-names';
import { generateAdventureWorld } from '../generate-world';
import { createSave, exportSaveFile, importSaveFile } from '../saves';
import { checkWinnability } from '../winnability';
import { commandHelp } from './commands';
import {
  discoveredTargets, playCommand, replayCommands, runAction, startPlay,
} from './play';
import type { PlayState, PlayWorld } from './play';

// The same world the winnability tests use, so play and checker agree on one example.
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
    items: [{ id: 'key' }, { id: 'token', placeId: 'study' }, { id: 'pebble', placeId: 'entry' }],
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

const winningCommands = [
  'go to study', 'take token', 'use token', 'go entry', 'use key on door', 'go finish',
];

it('can reach a place when its grammar-safe fallback name is occupied', () => {
  const world: AdventureWorld = {
    version: 1, startPlaceId: 'entry',
    places: [{ id: 'entry' }, { id: 'to-room' }, { id: 'place-2' }],
    exits: [{ id: 'path', fromPlaceId: 'entry', toPlaceId: 'to-room', locked: false }],
    items: [], clues: [],
    solution: { steps: [], goal: { placeId: 'to-room', conditions: {} } },
  };
  const start = startPlay(world);
  const target = discoveredTargets(world, start).find(({ id }) => id === 'to-room')!;
  expect(playCommand(world, start, `go ${target.name}`).state.goalReached).toBe(true);
});

it('keeps item use unambiguous after a visible place is renamed', () => {
  const itemId = 'badge-on-north-(place-2)';
  const world: AdventureWorld = {
    version: 1, startPlaceId: 'entry',
    places: [{ id: 'entry' }, { id: 'north' }],
    exits: [{ id: 'path', fromPlaceId: 'entry', toPlaceId: 'north', locked: false }],
    items: [{ id: 'badge', placeId: 'entry' }, { id: itemId, placeId: 'entry' }],
    clues: [],
    solution: {
      steps: [{ id: 'finish', placeId: 'entry', conditions: { itemsHeld: [itemId] }, effects: [] }],
      goal: { placeId: 'entry', conditions: { stepsDone: ['finish'] } },
    },
  };
  const start = startPlay(world);
  const target = discoveredTargets(world, start).find(({ id }) => id === itemId)!;
  const taken = playCommand(world, start, `take ${target.name}`).state;
  expect(playCommand(world, taken, `use ${target.name}`).state.goalReached).toBe(true);
});

it('suggests a winning place named too-large instead of search-limit advice', () => {
  const world: AdventureWorld = {
    version: 1, startPlaceId: 'entry',
    places: [{ id: 'entry' }, { id: 'too-large' }],
    exits: [{ id: 'path', fromPlaceId: 'entry', toPlaceId: 'too-large', locked: false }],
    items: [], clues: [],
    solution: { steps: [], goal: { placeId: 'too-large', conditions: {} } },
  };
  expect(playCommand(world, startPlay(world), 'hint').message).toBe('Try going to the too large.');
});

function play(world: AdventureWorld, inputs: readonly string[]) {
  let state = startPlay(world);
  const messages: string[] = [];
  for (const input of inputs) {
    const turn = playCommand(world, state, input);
    state = turn.state;
    messages.push(turn.message);
  }
  return { state, messages };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('startPlay', () => {
  it('starts at the start place with its clues and no turns', () => {
    const state = startPlay(sampleWorld());
    expect(state).toEqual({
      placeId: 'entry', itemsHeld: [], placesVisited: ['entry'], cluesRevealed: [],
      stepsDone: [], unlockedExits: [], turns: 0, goalReached: false, previous: null,
    });
  });

  it('rejects invalid worlds like the checker does', () => {
    expect(() => startPlay({ ...sampleWorld(), startPlaceId: 'nowhere' })).toThrow(RangeError);
  });

  it('refuses failure endings until checkpoint recovery exists', () => {
    const world = choiceWorld();
    const unsafe: AdventureWorld = {
      ...world,
      solution: {
        ...world.solution,
        endings: [...world.solution.endings!, { id: 'lost', outcome: 'failure' }],
        steps: [...world.solution.steps, {
          id: 'jump', placeId: 'gate', conditions: {},
          effects: [{ kind: 'end-adventure', endingId: 'lost' }],
        }],
      },
    };
    expect(() => startPlay(unsafe)).toThrow(
      'Failure endings cannot be played until checkpoint recovery exists.',
    );
    expect(() => runAction(unsafe, startPlay(world), { kind: 'look' }))
      .toThrow('Failure endings cannot be played');
  });
});

// A world version 2 example: one choice opens one of two paths. The right
// path leads to a winning ending and the left path leads to the goal.
function choiceWorld(): PlayWorld {
  return {
    version: 2,
    startPlaceId: 'gate',
    places: [{ id: 'gate' }, { id: 'left-path' }, { id: 'right-path' }, { id: 'tower' }],
    exits: [
      { id: 'left-way', fromPlaceId: 'gate', toPlaceId: 'left-path', locked: true },
      { id: 'right-way', fromPlaceId: 'gate', toPlaceId: 'right-path', locked: true },
      { id: 'back', fromPlaceId: 'right-path', toPlaceId: 'gate', locked: false },
      { id: 'climb', fromPlaceId: 'left-path', toPlaceId: 'tower', locked: false },
    ],
    items: [{ id: 'crown', placeId: 'right-path' }],
    clues: [],
    choiceNames: [
      { id: 'head-left', name: 'head left', aliases: ['left turn'] },
      { id: 'head-right', name: 'head right' },
      { id: 'wear-crown', name: 'wear crown', aliases: ['coronation'] },
    ],
    solution: {
      steps: [
        {
          id: 'head-left', placeId: 'gate', conditions: {}, choiceId: 'route',
          effects: [{ kind: 'unlock-exit', exitId: 'left-way' }],
        },
        {
          id: 'head-right', placeId: 'gate', conditions: {}, choiceId: 'route',
          effects: [{ kind: 'unlock-exit', exitId: 'right-way' }],
        },
        {
          id: 'wear-crown', placeId: 'right-path', conditions: { itemsHeld: ['crown'] },
          effects: [{ kind: 'end-adventure', endingId: 'crowned' }],
        },
      ],
      goal: { placeId: 'tower', conditions: {} },
      endings: [{ id: 'crowned', outcome: 'win' }],
    },
  };
}

function itemLabelWorld(): PlayWorld {
  return {
    version: 2, startPlaceId: 'room', places: [{ id: 'room' }, { id: 'away' }],
    exits: [{ id: 'gate', fromPlaceId: 'room', toPlaceId: 'away', locked: true }],
    items: [
      { id: 'coin-on-gate', placeId: 'room' }, { id: 'coin', placeId: 'room' },
      { id: 'item-2', placeId: 'room' }, { id: 'secret-key', placeId: 'away' },
    ],
    clues: [],
    solution: {
      steps: [
        {
          id: 'open', placeId: 'room', conditions: { itemsHeld: ['coin'] },
          effects: [{ kind: 'unlock-exit', exitId: 'gate' }],
        },
        {
          id: 'finish', placeId: 'room', conditions: { itemsHeld: ['coin'], stepsDone: ['open'] },
          effects: [],
        },
      ],
      goal: { placeId: 'room', conditions: { stepsDone: ['finish'] } },
    },
  };
}

const choiceIds = (world: PlayWorld, state: PlayState) => discoveredTargets(world, state)
  .filter(({ kind }) => kind === 'choice').map(({ id }) => id);

describe('playing world version 2 choices', () => {
  it('agrees with the checker on the example world', () => {
    expect(checkWinnability(choiceWorld())).toMatchObject({
      winnable: true, unreachableStepIds: [], reachableEndingIds: ['crowned'],
    });
  });

  it('settles automatic steps without repeatedly scanning each choice group', () => {
    const size = 100;
    let choiceReads = 0;
    const choices = Array.from({ length: size }, (_, index): PuzzleStep => ({
      id: `option-${index}`, placeId: 'room', conditions: {}, effects: [],
      get choiceId() {
        choiceReads++;
        return 'route';
      },
    }));
    const automatic = Array.from({ length: size }, (_, index): PuzzleStep => ({
      id: `automatic-${index}`, placeId: 'room', conditions: {},
      effects: [{ kind: 'reveal-clue', clueId: `clue-${index}` }],
    }));
    const world: AdventureWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }, { id: 'goal' }],
      exits: [], items: [], clues: Array.from({ length: size }, (_, index) => ({ id: `clue-${index}` })),
      solution: { steps: [...choices, ...automatic], goal: { placeId: 'goal', conditions: {} } },
    };
    const start = startPlay(world);
    expect(start.stepsDone).toHaveLength(size);
    expect(start.cluesRevealed).toHaveLength(size);
    expect(choiceIds(world, start)).toHaveLength(size);
    expect(choiceReads).toBeLessThan(25 * size);
  });

  it('formats automatic arrival effects without rebuilding targets for each effect', () => {
    const size = 40;
    let choiceReads = 0;
    const choices = Array.from({ length: size }, (_, index): PuzzleStep => ({
      id: `option-${index}`, placeId: 'room', conditions: {}, effects: [],
      get choiceId() {
        choiceReads++;
        return 'route';
      },
    }));
    const automatic = Array.from({ length: size }, (_, index): PuzzleStep => ({
      id: `automatic-${index}`, placeId: 'room', conditions: {},
      effects: [
        { kind: 'reveal-clue', clueId: `clue-${index}` },
        { kind: 'give-item', itemId: `gift-${index}` },
      ],
    }));
    const world: AdventureWorld = {
      version: 2, startPlaceId: 'outside',
      places: [{ id: 'outside' }, { id: 'room' }, { id: 'goal' }],
      exits: [{ id: 'door', fromPlaceId: 'outside', toPlaceId: 'room', locked: false }],
      items: Array.from({ length: size }, (_, index) => ({ id: `gift-${index}` })),
      clues: Array.from({ length: size }, (_, index) => ({ id: `clue-${index}` })),
      solution: { steps: [...choices, ...automatic], goal: { placeId: 'goal', conditions: {} } },
    };
    const start = startPlay(world);
    choiceReads = 0;
    const arrived = runAction(world, start, { kind: 'move', targetKind: 'exit', targetId: 'door' });
    expect(arrived.state).toMatchObject({ placeId: 'room', turns: 1, previous: start });
    expect(arrived.state.stepsDone).toEqual(automatic.map(({ id }) => id));
    expect(arrived.state.cluesRevealed).toEqual(world.clues.map(({ id }) => id));
    expect(arrived.state.itemsHeld).toEqual(world.items.map(({ id }) => id));
    expect(arrived.message).toContain('You can choose choice 1');
    expect(arrived.message).toContain(`choice ${size}.`);
    for (let index = 0; index < size; index++) {
      expect(arrived.message).toContain(
        `Something changes here. You found the clue ${index} clue. You now have the gift ${index}.`,
      );
    }
    expect(choiceReads).toBeLessThan(25 * size);
    expect(playCommand(world, arrived.state, 'undo').state).toBe(start);
  });

  it('uses settled discovery names for automatic messages only in version 2', () => {
    for (const version of [1, 2] as const) {
      const world: PlayWorld = {
        version, startPlaceId: 'outside',
        places: [{ id: 'outside' }, { id: 'room' }, { id: 'garden' }, { id: 'secret-vault' }],
        exits: [
          { id: 'door', fromPlaceId: 'outside', toPlaceId: 'room', locked: false },
          { id: 'local', fromPlaceId: 'room', toPlaceId: 'garden', locked: true },
          { id: 'remote', fromPlaceId: 'garden', toPlaceId: 'secret-vault', locked: true },
        ],
        items: [], clues: [{ id: 'answer' }],
        names: {
          places: [], items: [], people: [], clues: [{ id: 'answer', name: 'way to the garden' }],
        },
        solution: {
          steps: [
            {
              id: 'open', placeId: 'room', conditions: {},
              effects: [{ kind: 'unlock-exit', exitId: 'local' }, { kind: 'unlock-exit', exitId: 'remote' }],
            },
            {
              id: 'reveal', placeId: 'room', conditions: { stepsDone: ['open'] },
              effects: [{ kind: 'reveal-clue', clueId: 'answer' }],
            },
          ],
          goal: { placeId: 'garden', conditions: {} },
        },
      };
      const arrived = runAction(world, startPlay(world), {
        kind: 'move', targetKind: 'exit', targetId: 'door',
      });
      const targets = discoveredTargets(world, arrived.state);
      const exit = targets.find(({ kind, id }) => kind === 'exit' && id === 'local')!;
      expect(arrived.state.stepsDone).toEqual(['open', 'reveal']);
      expect(arrived.message).not.toContain('secret vault');
      expect(exit.name).not.toBe('way to the garden');
      expect(arrived.message).toContain(version === 2
        ? `The ${exit.name} is now open. A way is now open.`
        : 'The way to the garden is now open. A way is now open.');
      expect(arrived.message).toContain('Something changes here. You found the way to the garden clue.');
    }
  });

  it('offers open choices here without doing them by themselves', () => {
    const world = choiceWorld();
    const start = startPlay(world);
    expect(start.stepsDone).toEqual([]);
    expect(choiceIds(world, start)).toEqual(['choice-1', 'choice-2']);
    expect(playCommand(world, start, 'look').message).toContain('You can choose head left and head right.');
    expect(playCommand(world, start, 'examine head left').message).toBe('You could choose head left here.');
    expect(playCommand(world, start, 'choose left turn').state.stepsDone).toEqual(['head-left']);
  });

  it('uses neutral IDs and labels rather than exposing solution IDs', () => {
    const original = choiceWorld();
    const world: PlayWorld = {
      ...original,
      choiceNames: undefined,
      solution: {
        ...original.solution,
        steps: original.solution.steps.map((step, index) => index === 0
          ? { ...step, id: 'secret-blue_key' }
          : index === 1 ? { ...step, id: 'secret-blue-key' } : step),
      },
    };
    const start = startPlay(world);
    const targets = discoveredTargets(world, start);
    expect(targets.filter(({ kind }) => kind === 'choice')).toEqual([
      { id: 'choice-1', kind: 'choice', name: 'choice 1' },
      { id: 'choice-2', kind: 'choice', name: 'choice 2' },
    ]);
    expect(JSON.stringify(targets)).not.toContain('secret');
    expect(playCommand(world, start, 'look').message).not.toContain('secret');
    expect(playCommand(world, start, 'choose choice 1').state.stepsDone).toEqual(['secret-blue_key']);
    expect(playCommand(world, start, 'choose choice 2').state.stepsDone).toEqual(['secret-blue-key']);
    expect(runAction(world, start, { kind: 'choose', targetId: 'secret-blue_key', targetKind: 'choice' }).state)
      .toBe(start);
  });

  it('makes colliding choice labels selectable without hiding other targets', () => {
    const original = choiceWorld();
    const world: PlayWorld = {
      ...original,
      items: [...original.items, { id: 'fork', placeId: 'gate' }],
      choiceNames: [
        { id: 'head-left', name: 'a fork', aliases: ['left track'] },
        { id: 'head-right', name: 'the fork', aliases: ['right track'] },
      ],
    };
    const start = startPlay(world);
    const targets = discoveredTargets(world, start);
    const choices = targets.filter(({ kind }) => kind === 'choice');
    const item = targets.find(({ kind, id }) => kind === 'item' && id === 'fork')!;
    expect(choices).toHaveLength(2);
    expect(playCommand(world, start, 'look').message).toContain(item.name);
    expect(playCommand(world, start, `take ${item.name}`).state.itemsHeld).toContain('fork');
    for (const [index, choice] of choices.entries()) {
      expect(playCommand(world, start, `examine ${choice.name}`).message).toContain('You could choose');
      expect(playCommand(world, start, `choose ${choice.name}`).state.stepsDone)
        .toEqual([original.solution.steps[index].id]);
    }
    expect(playCommand(world, start, 'choose left track').state.stepsDone).toEqual(['head-left']);
    expect(playCommand(world, start, 'choose right track').state.stepsDone).toEqual(['head-right']);
  });

  it('uses the displayed destination name when examining an exit', () => {
    const original = choiceWorld();
    const world: PlayWorld = {
      ...original,
      places: [...original.places, { id: 'fork' }],
      exits: [...original.exits, { id: 'fork-path', fromPlaceId: 'gate', toPlaceId: 'fork', locked: false }],
      choiceNames: [
        { id: 'head-left', name: 'fork' },
        { id: 'head-right', name: 'head right' },
      ],
    };
    const start = startPlay(world);
    const place = discoveredTargets(world, start).find(({ kind, id }) => kind === 'place' && id === 'fork')!;
    expect(place.name).not.toBe('fork');
    expect(playCommand(world, start, 'examine fork path').message).toContain(place.name);
    expect(playCommand(world, start, `go ${place.name}`).state.placeId).toBe('fork');
  });

  it('does not name an undiscovered remote exit opened by a choice', () => {
    const original = choiceWorld();
    const world: PlayWorld = {
      ...original,
      exits: [...original.exits, {
        id: 'way-to-secret-vault', fromPlaceId: 'left-path', toPlaceId: 'tower', locked: true,
      }],
      solution: {
        ...original.solution,
        steps: original.solution.steps.map((step) => step.id === 'head-left'
          ? { ...step, effects: [{ kind: 'unlock-exit' as const, exitId: 'way-to-secret-vault' }] }
          : step),
      },
    };
    const opened = playCommand(world, startPlay(world), 'choose head left');
    expect(opened.state.unlockedExits).toContain('way-to-secret-vault');
    expect(opened.message).toContain('A way is now open.');
    expect(opened.message).not.toContain('secret vault');
    expect(JSON.stringify(discoveredTargets(world, opened.state))).not.toContain('secret');
  });

  it('shuts out the other steps of a choice once one is made, until undo', () => {
    const world = choiceWorld();
    const start = startPlay(world);
    const turn = playCommand(world, start, 'choose head left');
    expect(turn.message).toBe('You choose head left. The left way is now open.');
    expect(turn.state).toMatchObject({ stepsDone: ['head-left'], unlockedExits: ['left-way'], turns: 1 });
    expect(choiceIds(world, turn.state)).toEqual([]);
    expect(playCommand(world, turn.state, 'choose head right').state).toBe(turn.state);
    expect(runAction(world, turn.state, { kind: 'choose', targetId: 'choice-2', targetKind: 'choice' }))
      .toEqual({ state: turn.state, message: 'There is no choice to make here.' });
    expect(playCommand(world, turn.state, 'go right way').message).toBe('The right way is locked.');
    const undone = playCommand(world, turn.state, 'undo').state;
    expect(undone).toBe(start);
    expect(choiceIds(world, undone)).toEqual(['choice-1', 'choice-2']);
  });

  it('reaches the goal along the chosen route', () => {
    const world = choiceWorld();
    const state = replayCommands(world, ['choose head left', 'go left path', 'go tower']);
    expect(state.goalReached).toBe(true);
    expect(playCommand(world, replayCommands(world, ['choose head left', 'go left path']), 'go tower')
      .message).toContain('You have reached your goal. Well done!');
  });

  it('keeps an ending hidden until its conditions hold, then wins when chosen', () => {
    const world = choiceWorld();
    const there = replayCommands(world, ['choose head right', 'go right path']);
    expect(choiceIds(world, there)).toEqual([]);
    expect(JSON.stringify(discoveredTargets(world, there))).not.toContain('wear crown');
    expect(JSON.stringify(discoveredTargets(world, there))).not.toContain('coronation');
    expect(playCommand(world, there, 'choose wear crown').state).toBe(there);
    const holding = playCommand(world, there, 'take crown').state;
    expect(playCommand(world, holding, 'use crown')).toEqual({ state: holding, message: 'Nothing happens.' });
    expect(choiceIds(world, holding)).toEqual(['choice-3']);
    const won = playCommand(world, holding, 'choose wear crown');
    expect(won.message).toBe('You choose wear crown. Your adventure ends here, and you have won. Well done!');
    expect(won.state).toMatchObject({ goalReached: true, stepsDone: ['head-right', 'wear-crown'], turns: 4 });
    expect(playCommand(world, holding, 'choose coronation').state.goalReached).toBe(true);
    expect(playCommand(world, won.state, 'go gate').message)
      .toBe('You have already finished this adventure. Type undo to go back a turn.');
    expect(playCommand(world, won.state, 'undo').state).toBe(holding);
    expect(replayCommands(world, ['choose head right', 'go right path', 'take crown', 'choose wear crown']))
      .toEqual(won.state);
  });

  it('hides choices unlocked by a winning ending and restores them on undo', () => {
    const world: PlayWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }, { id: 'goal' }], exits: [],
      items: [], clues: [],
      choiceNames: [{ id: 'win', name: 'finish' }, { id: 'secret', name: 'hidden finale' }],
      solution: {
        steps: [
          { id: 'win', placeId: 'room', conditions: {}, effects: [{ kind: 'end-adventure', endingId: 'done' }] },
          {
            id: 'secret', placeId: 'room', conditions: { stepsDone: ['win'] },
            effects: [{ kind: 'end-adventure', endingId: 'done' }],
          },
          { id: 'after-win', placeId: 'room', conditions: { stepsDone: ['win'] }, effects: [] },
        ],
        goal: { placeId: 'goal', conditions: {} },
        endings: [{ id: 'done', outcome: 'win' }],
      },
    };
    const start = startPlay(world);
    const won = playCommand(world, start, 'choose finish').state;
    expect(won.goalReached).toBe(true);
    expect(won.stepsDone).toEqual(['win']);
    expect(choiceIds(world, won)).toEqual([]);
    expect(playCommand(world, won, 'look').message).not.toContain('hidden finale');
    expect(playCommand(world, won, 'choose hidden finale').state).toBe(won);
    const undone = playCommand(world, won, 'undo').state;
    expect(undone).toBe(start);
    expect(choiceIds(world, undone)).toEqual(['choice-1']);
  });

  it('does not show choices on arrival when automatic steps finish the adventure', () => {
    const world: PlayWorld = {
      version: 2, startPlaceId: 'outside', places: [{ id: 'outside' }, { id: 'inside' }],
      exits: [{ id: 'door', fromPlaceId: 'outside', toPlaceId: 'inside', locked: false }],
      items: [], clues: [],
      choiceNames: [{ id: 'secret-one', name: 'hidden route' }, { id: 'secret-two', name: 'hidden ending' }],
      solution: {
        steps: [
          { id: 'arrive', placeId: 'inside', conditions: {}, effects: [] },
          { id: 'secret-one', placeId: 'inside', conditions: {}, choiceId: 'route', effects: [] },
          { id: 'secret-two', placeId: 'inside', conditions: {}, choiceId: 'route', effects: [] },
        ],
        goal: { placeId: 'inside', conditions: { stepsDone: ['arrive'] } },
      },
    };
    const turn = playCommand(world, startPlay(world), 'go inside');
    expect(turn.state.goalReached).toBe(true);
    expect(turn.message).toContain('You have reached your goal.');
    expect(turn.message).not.toMatch(/hidden|choose/);
    expect(choiceIds(world, turn.state)).toEqual([]);
    expect(playCommand(world, turn.state, 'look').message).not.toMatch(/hidden|choose/);
  });

  it('shows choices made available by automatic steps after arriving', () => {
    const world: PlayWorld = {
      version: 2, startPlaceId: 'outside', places: [{ id: 'outside' }, { id: 'inside' }],
      exits: [{ id: 'door', fromPlaceId: 'outside', toPlaceId: 'inside', locked: false }],
      items: [], clues: [],
      choiceNames: [{ id: 'stay', name: 'stay' }, { id: 'leave', name: 'leave' }],
      solution: {
        steps: [
          { id: 'arrive', placeId: 'inside', conditions: {}, effects: [] },
          {
            id: 'stay', placeId: 'inside', conditions: { stepsDone: ['arrive'] },
            choiceId: 'route', effects: [],
          },
          {
            id: 'leave', placeId: 'inside', conditions: { stepsDone: ['arrive'] },
            choiceId: 'route', effects: [{ kind: 'end-adventure', endingId: 'done' }],
          },
        ],
        goal: { placeId: 'inside', conditions: { stepsDone: ['stay'] } },
        endings: [{ id: 'done', outcome: 'win' }],
      },
    };
    const turn = playCommand(world, startPlay(world), 'go inside');
    expect(turn.message).toContain('You can choose stay and leave.');
    expect(choiceIds(world, turn.state)).toEqual(['choice-1', 'choice-2']);
    expect(playCommand(world, turn.state, 'choose stay').state.goalReached).toBe(true);
  });

  it('checks shared-item steps using the same local-exit preference as play', () => {
    const world: PlayWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }, { id: 'away' }],
      exits: [{ id: 'gate', fromPlaceId: 'away', toPlaceId: 'room', locked: true }],
      items: [{ id: 'coin', placeId: 'room' }, { id: 'badge' }, { id: 'key' }], clues: [],
      solution: {
        steps: [
          {
            id: 'finish', placeId: 'room', conditions: { itemsHeld: ['coin'] },
            effects: [{ kind: 'give-item', itemId: 'badge' }],
          },
          {
            id: 'prepare', placeId: 'room', conditions: { itemsHeld: ['coin'] },
            effects: [{ kind: 'unlock-exit', exitId: 'gate' }, { kind: 'give-item', itemId: 'key' }],
          },
          {
            id: 'alternate', placeId: 'room', conditions: { itemsHeld: ['key'] },
            effects: [{ kind: 'end-adventure', endingId: 'early-win' }],
          },
        ],
        goal: { placeId: 'room', conditions: { itemsHeld: ['badge'] } },
        endings: [{ id: 'early-win', outcome: 'win' }],
      },
    };
    expect(checkWinnability(world)).toMatchObject({
      winnable: true, unreachableStepIds: ['prepare', 'alternate'], reachableEndingIds: [],
    });
    const holding = playCommand(world, startPlay(world), 'take coin').state;
    expect(runAction(world, holding, {
      kind: 'use', itemId: 'coin', targetId: 'gate', targetKind: 'exit',
    })).toEqual({ state: holding, message: 'That is not here.' });
    const finished = playCommand(world, holding, 'use coin').state;
    expect(finished.goalReached).toBe(true);
    expect(finished.stepsDone).toEqual(['finish']);

    const local: PlayWorld = {
      ...world,
      exits: [{ id: 'gate', fromPlaceId: 'room', toPlaceId: 'away', locked: true }],
    };
    expect(checkWinnability(local)).toMatchObject({
      winnable: true, unreachableStepIds: [], reachableEndingIds: ['early-win'],
    });
    const localHolding = playCommand(local, startPlay(local), 'take coin').state;
    expect(playCommand(local, localHolding, 'use coin').state.stepsDone).toEqual(['finish']);
    const prepared = playCommand(local, localHolding, 'use coin on gate').state;
    expect(prepared.stepsDone).toEqual(['prepare']);
    expect(prepared.goalReached).toBe(false);
    expect(playCommand(local, prepared, 'choose choice 1').state.goalReached).toBe(true);

    const awkward: PlayWorld = {
      ...local, items: [...local.items, { id: 'coin-on-gate', placeId: 'room' }],
    };
    const awkwardHolding = playCommand(awkward, startPlay(awkward), 'take coin').state;
    const targets = discoveredTargets(awkward, awkwardHolding);
    const coin = targets.find(({ kind, id }) => kind === 'item' && id === 'coin')!;
    const gate = targets.find(({ kind, id }) => kind === 'exit' && id === 'gate')!;
    const awkwardPrepared = playCommand(awkward, awkwardHolding, `use ${coin.name} on ${gate.name}`).state;
    expect(awkwardPrepared.stepsDone).toEqual(['prepare']);
    expect(playCommand(awkward, awkwardPrepared, 'choose choice 1').state.goalReached).toBe(true);
    expect(checkWinnability(awkward)).toMatchObject({ reachableEndingIds: ['early-win'] });

    const sameExit: PlayWorld = {
      ...local,
      solution: {
        ...local.solution,
        steps: local.solution.steps.map((step) => step.id === 'finish'
          ? { ...step, effects: [{ kind: 'unlock-exit' as const, exitId: 'gate' }, ...step.effects] }
          : step),
      },
    };
    const sameExitHolding = playCommand(sameExit, startPlay(sameExit), 'take coin').state;
    expect(playCommand(sameExit, sameExitHolding, 'use coin on gate').state.stepsDone).toEqual(['finish']);
    expect(checkWinnability(sameExit)).toMatchObject({
      winnable: true, unreachableStepIds: ['prepare', 'alternate'], reachableEndingIds: [],
    });

    const legacy: AdventureWorld = {
      ...local, version: 1,
      solution: { steps: local.solution.steps.slice(0, 2), goal: local.solution.goal },
    };
    const legacyHolding = playCommand(legacy, startPlay(legacy), 'take coin').state;
    expect(playCommand(legacy, legacyHolding, 'use coin').state.stepsDone).toEqual(['finish']);
    expect(playCommand(legacy, legacyHolding, 'use coin on gate').state.stepsDone).toEqual(['prepare']);
    expect(checkWinnability(legacy)).toEqual({ winnable: true, unreachableStepIds: [] });
  });

  it('keeps the displayed fallback usable after taking an item and opening an exit', () => {
    const world = itemLabelWorld();
    const start = startPlay(world);
    const targets = discoveredTargets(world, start);
    const coin = targets.find(({ kind, id }) => kind === 'item' && id === 'coin')!;
    expect(coin.name).not.toBe('coin');
    expect(coin.name).not.toBe('item 2');
    expect(JSON.stringify(targets)).not.toContain('secret');
    expect(playCommand(world, start, 'look').message).toContain(coin.name);
    const taken = playCommand(world, start, `take ${coin.name}`);
    expect(taken.state.itemsHeld).toEqual(['coin']);
    expect(taken.message).toContain(coin.name);
    expect(playCommand(world, taken.state, 'inventory').message).toContain(coin.name);
    const opened = playCommand(world, taken.state, `use ${coin.name}`).state;
    expect(opened.stepsDone).toEqual(['open']);
    expect(discoveredTargets(world, opened).find(({ kind, id }) => kind === 'item' && id === 'coin')?.name)
      .toBe(coin.name);
    const won = playCommand(world, opened, `use ${coin.name}`).state;
    expect(won.goalReached).toBe(true);
    expect(replayCommands(world, [`take ${coin.name}`, `use ${coin.name}`, `use ${coin.name}`])).toEqual(won);
  });

  it('keeps item labels usable when taking them reveals a choice with the same name', () => {
    const base = itemLabelWorld();
    const examples = [
      base,
      { ...base, items: base.items.filter(({ id }) => id === 'coin' || id === 'secret-key') },
    ];
    for (const original of examples) {
      const label = discoveredTargets(original, startPlay(original))
        .find(({ kind, id }) => kind === 'item' && id === 'coin')!.name;
      const world: PlayWorld = {
        ...original,
        choiceNames: [{ id: 'secret-ending', name: label, aliases: ['hidden celebration'] }],
        solution: {
          ...original.solution,
          steps: [...original.solution.steps, {
            id: 'secret-ending', placeId: 'room', conditions: { itemsHeld: ['coin'] },
            effects: [{ kind: 'end-adventure', endingId: 'done' }],
          }],
          endings: [{ id: 'done', outcome: 'win' }],
        },
      };
      const start = startPlay(world);
      const before = discoveredTargets(world, start);
      expect(before.find(({ kind, id }) => kind === 'item' && id === 'coin')?.name).toBe(label);
      expect(JSON.stringify(before)).not.toMatch(/secret|hidden celebration/);
      const taken = playCommand(world, start, `take ${label}`);
      const after = discoveredTargets(world, taken.state);
      expect(taken.state.itemsHeld).toEqual(['coin']);
      expect(taken.message).toContain(label);
      expect(after.find(({ kind, id }) => kind === 'item' && id === 'coin')?.name).toBe(label);
      expect(after.find(({ kind }) => kind === 'choice')?.name).not.toBe(label);
      expect(playCommand(world, taken.state, 'choose hidden celebration').state.goalReached).toBe(true);
      const opened = playCommand(world, taken.state, `use ${label}`).state;
      expect(opened.stepsDone).toEqual(['open']);
      const won = playCommand(world, opened, `use ${label}`).state;
      expect(won.goalReached).toBe(true);
      expect(replayCommands(world, [`take ${label}`, `use ${label}`, `use ${label}`])).toEqual(won);
    }
  });

  it('keeps an item label usable after moving, including when a hidden name appears', () => {
    const base = itemLabelWorld();
    for (const hasAnotherExit of [false, true]) {
      const world: PlayWorld = {
        ...base,
        exits: hasAnotherExit
          ? [...base.exits, { id: 'door', fromPlaceId: 'away', toPlaceId: 'room', locked: true }]
          : base.exits,
        items: hasAnotherExit
          ? base.items.map((item) => item.id === 'secret-key' ? { ...item, id: 'coin-on-door' } : item)
          : base.items,
        solution: {
          ...base.solution,
          steps: base.solution.steps.map((step) => step.id === 'finish' ? {
            ...step, placeId: 'away',
            effects: hasAnotherExit ? [{ kind: 'unlock-exit' as const, exitId: 'door' }] : [],
          } : step),
          goal: { placeId: 'away', conditions: { stepsDone: ['finish'] } },
        },
      };
      const start = startPlay(world);
      const before = discoveredTargets(world, start);
      const label = before.find(({ kind, id }) => kind === 'item' && id === 'coin')!.name;
      expect(JSON.stringify(before)).not.toMatch(/secret|coin.on.door/);
      expect(playCommand(world, start, 'look').message).not.toContain('coin on door');
      const taken = playCommand(world, start, `take ${label}`).state;
      expect(taken.itemsHeld).toEqual(['coin']);
      const opened = playCommand(world, taken, `use ${label}`).state;
      const away = playCommand(world, opened, 'go away').state;
      expect(away.placeId).toBe('away');
      const after = discoveredTargets(world, away);
      expect(after.find(({ kind, id }) => kind === 'item' && id === 'coin')?.name).toBe(label);
      const door = after.find(({ kind, id }) => kind === 'exit' && id === 'door');
      const use = door ? `use ${label} on ${door.name}` : `use ${label}`;
      const won = playCommand(world, away, use).state;
      expect(won.stepsDone).toEqual(['open', 'finish']);
      expect(won.goalReached).toBe(true);
      expect(replayCommands(world, [`take ${label}`, `use ${label}`, 'go away', use])).toEqual(won);
    }
  });

  it('keeps version 1 item names and commands unchanged', () => {
    const world: AdventureWorld = { ...itemLabelWorld(), version: 1 };
    const start = startPlay(world);
    expect(discoveredTargets(world, start).find(({ kind, id }) => kind === 'item' && id === 'coin')?.name)
      .toBe('coin');
    const taken = playCommand(world, start, 'take coin').state;
    expect(discoveredTargets(world, taken).find(({ kind, id }) => kind === 'item' && id === 'coin')?.name)
      .toBe('coin');
    const opened = playCommand(world, taken, 'use coin').state;
    expect(opened.stepsDone).toEqual(['open']);
    const won = playCommand(world, opened, 'use coin').state;
    expect(won.goalReached).toBe(true);
    expect(replayCommands(world, ['take coin', 'use coin', 'use coin'])).toEqual(won);
  });

  it('checks and plays local-exit preference with a punctuated item label', () => {
    const world: PlayWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }, { id: 'away' }],
      exits: [{ id: 'gate', fromPlaceId: 'room', toPlaceId: 'away', locked: true }],
      items: [{ id: 'coin', placeId: 'room' }, { id: 'badge' }, { id: 'key' }], clues: [],
      names: {
        places: [], items: [{ id: 'coin', name: 'coin!' }], clues: [], people: [],
      },
      solution: {
        steps: [
          {
            id: 'finish', placeId: 'room', conditions: { itemsHeld: ['coin'] },
            effects: [{ kind: 'give-item', itemId: 'badge' }],
          },
          {
            id: 'prepare', placeId: 'room', conditions: { itemsHeld: ['coin'] },
            effects: [{ kind: 'unlock-exit', exitId: 'gate' }, { kind: 'give-item', itemId: 'key' }],
          },
          {
            id: 'alternate', placeId: 'room', conditions: { itemsHeld: ['key'] },
            effects: [{ kind: 'end-adventure', endingId: 'early-win' }],
          },
        ],
        goal: { placeId: 'room', conditions: { itemsHeld: ['badge'] } },
        endings: [{ id: 'early-win', outcome: 'win' }],
      },
    };
    expect(checkWinnability(world)).toMatchObject({
      winnable: true, unreachableStepIds: [], reachableEndingIds: ['early-win'],
    });
    const start = startPlay(world);
    const targets = discoveredTargets(world, start);
    const coin = targets.find(({ kind, id }) => kind === 'item' && id === 'coin')!;
    const gate = targets.find(({ kind, id }) => kind === 'exit' && id === 'gate')!;
    expect(coin.name).not.toBe('coin!');
    const holding = playCommand(world, start, `take ${coin.name}`).state;
    expect(playCommand(world, holding, `use ${coin.name}`).state.stepsDone).toEqual(['finish']);
    const prepared = playCommand(world, holding, `use ${coin.name} on ${gate.name}`).state;
    expect(prepared.stepsDone).toEqual(['prepare']);
    expect(prepared.goalReached).toBe(false);
    expect(playCommand(world, prepared, 'choose choice 1').state.goalReached).toBe(true);
  });

  it('uses displayed item and exit labels when another item ends in on', () => {
    const world: PlayWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }, { id: 'gate' }],
      exits: [{ id: 'on-gate', fromPlaceId: 'room', toPlaceId: 'gate', locked: false }],
      items: [{ id: 'coin', placeId: 'room' }, { id: 'coin-on', placeId: 'room' }, { id: 'badge' }],
      clues: [],
      solution: {
        steps: [
          {
            id: 'finish', placeId: 'room', conditions: { itemsHeld: ['coin'] },
            effects: [{ kind: 'give-item', itemId: 'badge' }],
          },
          {
            id: 'prepare', placeId: 'room', conditions: { itemsHeld: ['coin'] },
            effects: [{ kind: 'unlock-exit', exitId: 'on-gate' }],
          },
        ],
        goal: { placeId: 'room', conditions: { itemsHeld: ['badge'] } },
      },
    };
    expect(checkWinnability(world)).toMatchObject({ winnable: true, unreachableStepIds: [] });
    const start = startPlay(world);
    const before = discoveredTargets(world, start);
    const coin = before.find(({ kind, id }) => kind === 'item' && id === 'coin')!;
    const gate = before.find(({ kind, id }) => kind === 'exit' && id === 'on-gate')!;
    expect(playCommand(world, start, 'look').message).toContain(coin.name);
    const holding = playCommand(world, start, `take ${coin.name}`).state;
    expect(holding.itemsHeld).toEqual(['coin']);
    const prepared = playCommand(world, holding, `use ${coin.name} on ${gate.name}`).state;
    expect(prepared.stepsDone).toEqual(['prepare']);
    expect(prepared.goalReached).toBe(false);
    const won = playCommand(world, prepared, `use ${coin.name}`).state;
    expect(won.goalReached).toBe(true);
    expect(replayCommands(world, [`take ${coin.name}`, `use ${coin.name} on ${gate.name}`, `use ${coin.name}`]))
      .toEqual(won);
    const legacy: AdventureWorld = { ...world, version: 1 };
    expect(discoveredTargets(legacy, startPlay(legacy))
      .find(({ kind, id }) => kind === 'item' && id === 'coin')?.name).toBe('coin');
  });

  it('checks a shared step that can be selected with a different held item', () => {
    const world: PlayWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }], exits: [],
      items: [
        { id: 'coin', placeId: 'room' }, { id: 'token', placeId: 'room' }, { id: 'badge' }, { id: 'key' },
      ],
      clues: [],
      solution: {
        steps: [
          {
            id: 'finish', placeId: 'room', conditions: { itemsHeld: ['coin'] },
            effects: [{ kind: 'give-item', itemId: 'badge' }],
          },
          {
            id: 'prepare', placeId: 'room', conditions: { itemsHeld: ['coin', 'token'] },
            effects: [{ kind: 'give-item', itemId: 'key' }],
          },
          {
            id: 'alternate', placeId: 'room', conditions: { itemsHeld: ['key'] },
            effects: [{ kind: 'end-adventure', endingId: 'early-win' }],
          },
        ],
        goal: { placeId: 'room', conditions: { itemsHeld: ['badge'] } },
        endings: [{ id: 'early-win', outcome: 'win' }],
      },
    };
    expect(checkWinnability(world)).toMatchObject({
      winnable: true, unreachableStepIds: [], reachableEndingIds: ['early-win'],
    });
    const holding = replayCommands(world, ['take coin', 'take token']);
    const prepared = playCommand(world, holding, 'use token').state;
    expect(prepared.stepsDone).toEqual(['prepare']);
    expect(playCommand(world, prepared, 'choose choice 1').state.goalReached).toBe(true);
  });

  it('gives general hints that never name a choice or a closed route', () => {
    const world = choiceWorld();
    const start = startPlay(world);
    const atStart = playCommand(world, start, 'hint').message;
    expect(atStart).toBe('There is a choice to make here. Think before you choose.');
    const chosen = playCommand(world, start, 'choose head left').state;
    expect(playCommand(world, chosen, 'hint').message)
      .toBe('Look around and think about what you could do next. You can also try undo.');
    const room: AdventureWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }], exits: [],
      items: [{ id: 'lamp', placeId: 'room' }], clues: [],
      solution: {
        steps: [
          { id: 'light-lamp', placeId: 'room', conditions: { itemsHeld: ['lamp'] }, choiceId: 'mood', effects: [] },
          { id: 'sit-dark', placeId: 'room', conditions: {}, choiceId: 'mood', effects: [] },
        ],
        goal: { placeId: 'room', conditions: { stepsDone: ['light-lamp'] } },
      },
    };
    const roomStart = startPlay(room);
    expect(playCommand(room, roomStart, 'hint').message)
      .toBe('There is a choice to make here. Think before you choose.');
    const dark = playCommand(room, roomStart, 'choose choice 2').state;
    expect(playCommand(room, dark, 'hint').message)
      .toBe('Look around and think about what you could do next. You can also try undo.');

    const indirect: AdventureWorld = {
      version: 2, startPlaceId: 'room', places: [{ id: 'room' }, { id: 'goal' }],
      exits: [{ id: 'way', fromPlaceId: 'room', toPlaceId: 'goal', locked: false }],
      items: [{ id: 'lamp', placeId: 'room' }], clues: [],
      solution: {
        steps: [
          { id: 'left', placeId: 'room', conditions: {}, choiceId: 'route', effects: [] },
          { id: 'right', placeId: 'room', conditions: {}, choiceId: 'route', effects: [] },
          {
            id: 'right-step', placeId: 'room',
            conditions: { itemsHeld: ['lamp'], stepsDone: ['right'] }, effects: [],
          },
        ],
        goal: { placeId: 'goal', conditions: {} },
      },
    };
    const left = playCommand(indirect, startPlay(indirect), 'choose choice 1').state;
    expect(playCommand(indirect, left, 'hint').message)
      .toBe('Look around and think about what you could do next. You can also try undo.');
  });
});

describe('playing with typed commands', () => {
  it('keeps leading articles in ID-derived names', () => {
    const world: AdventureWorld = {
      version: 1,
      startPlaceId: 'the-garden',
      places: [{ id: 'the-garden' }],
      exits: [],
      items: [],
      clues: [],
      solution: { steps: [], goal: { placeId: 'the-garden', conditions: {} } },
    };

    expect(playCommand(world, startPlay(world), 'look').message)
      .toBe('You are at the the garden. There is no way out.');
  });

  it('wins a hand-built world from start to goal using typed commands only', () => {
    const world = deepFreeze(sampleWorld());
    const commands = ['go study', 'take token', 'use token', 'go to entry', 'use key on door', 'go finish'];
    const { state, messages } = play(world, commands);
    expect(state.goalReached).toBe(true);
    expect(state.placeId).toBe('finish');
    expect(state.turns).toBe(6);
    expect(state.stepsDone).toEqual(['open-door', 'find-key', 'read-note']);
    expect(state.unlockedExits).toEqual(['door']);
    expect(messages[0]).toBe('You are at the study. You can see the token. Clues here: the note. '
      + 'Ways out: the exit 5 to the entry. You found the note clue. '
      + 'Something changes here. You found the answer clue.');
    expect(messages[2]).toBe('You use the token. You now have the key.');
    expect(messages[4]).toBe('You use the key on the door. The door is now open.');
    expect(messages[5]).toMatch(/You have reached your goal\. Well done!$/);
    expect(checkWinnability(world).winnable).toBe(true);
  });

  it('gives the same state when the same commands are replayed', () => {
    const world = sampleWorld();
    const first = replayCommands(world, winningCommands);
    expect(replayCommands(world, winningCommands)).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it('never changes the input state or world', () => {
    const world = deepFreeze(sampleWorld());
    const states: PlayState[] = [deepFreeze(startPlay(world))];
    for (const input of [...winningCommands, 'look', 'i', 'hint', 'undo', 'help']) {
      const before = JSON.stringify(states.at(-1));
      states.push(deepFreeze(playCommand(world, states.at(-1)!, input).state));
      expect(JSON.stringify(states.at(-2))).toBe(before);
    }
  });

  it('returns parser problems without changing the state', () => {
    const world = sampleWorld();
    const state = startPlay(world);
    const turn = playCommand(world, state, 'take token');
    expect(turn.state).toBe(state);
    expect(turn.message).toBe('That name is not one you have discovered.');
  });
});

describe('discoveredTargets', () => {
  it('lists only things the player has found, as world IDs with a separate kind', () => {
    const world = sampleWorld();
    expect(discoveredTargets(world, startPlay(world))).toEqual([
      { id: 'entry', name: 'entry', kind: 'place' },
      { id: 'study', name: 'study', kind: 'place' },
      { id: 'to-study', name: 'exit 4', kind: 'exit', aliases: ['to study'] },
      { id: 'door', name: 'door', kind: 'exit' },
      { id: 'pebble', name: 'pebble', kind: 'item' },
    ]);
  });

  it('never lists hidden places, items elsewhere, unfound clues or solution data', () => {
    const world = sampleWorld();
    const keyOf = ({ kind, id }: { kind: string; id: string }) => `${kind}:${id}`;
    const ids = discoveredTargets(world, startPlay(world)).map(keyOf);
    for (const hidden of ['place:finish', 'item:token', 'item:key', 'clue:note', 'clue:answer',
      'open-door', 'find-key', 'read-note']) {
      expect(ids).not.toContain(hidden);
    }
    const later = replayCommands(world, ['go study', 'take token']);
    expect(discoveredTargets(world, later).map(keyOf)).toEqual([
      'place:entry', 'place:study', 'exit:to-entry', 'item:token', 'clue:note', 'clue:answer',
    ]);
  });

  it('keeps places and items with the same ID apart', () => {
    const world: AdventureWorld = {
      ...sampleWorld(),
      items: [{ id: 'study', placeId: 'entry' }],
      solution: { steps: [], goal: { placeId: 'study', conditions: { itemsHeld: ['study'] } } },
    };
    const { state, messages } = play(world, ['take study', 'go to study']);
    expect(messages[0]).toMatch(/^You take the study \(item \d+\)\.$/);
    expect(state.goalReached).toBe(true);
  });

  it.each([
    ['red-key', 'red_key'],
    ['Red Key', 'red key'],
    ['the key', 'key'],
    ['the', 'a'],
    ['red-key', 'red_key', 'red key (item 4)'],
  ])('wins using displayed names despite colliding IDs: %j', (...ids: string[]) => {
    const world: AdventureWorld = {
      version: 1,
      startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id: 'finish' }],
      exits: [{ id: 'door', fromPlaceId: 'entry', toPlaceId: 'finish', locked: true }],
      items: ids.map((id) => ({ id, placeId: 'entry' })),
      clues: [{ id: 'hidden-clue' }],
      solution: {
        steps: [{
          id: 'hidden-solution', placeId: 'entry',
          conditions: { itemsHeld: ids },
          effects: [{ kind: 'unlock-exit', exitId: 'door' }],
        }],
        goal: { placeId: 'finish', conditions: { stepsDone: ['hidden-solution'] } },
      },
    };
    expect(checkWinnability(world).winnable).toBe(true);
    const start = startPlay(world);
    const items = discoveredTargets(world, start).filter(({ kind }) => kind === 'item');
    const look = playCommand(world, start, 'look').message;
    const commands = items.map(({ name }) => {
      expect(look).toContain(name);
      return `take ${name}`;
    });
    commands.push(`use ${items[0].name} on door`, 'go finish');
    const won = replayCommands(world, commands);
    expect(won.itemsHeld).toEqual(ids);
    expect(won.goalReached).toBe(true);
    expect(replayCommands(world, commands)).toEqual(won);
    expect(discoveredTargets(world, start)).not.toContainEqual(
      expect.objectContaining({ id: 'hidden-clue' }),
    );
    expect(discoveredTargets(world, start)).not.toContainEqual(
      expect.objectContaining({ id: 'hidden-solution' }),
    );
  });

  it.each(['north', 'up', 'the'])('can walk to a place and exit both called %j', (id) => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id }],
      exits: [{ id, fromPlaceId: 'entry', toPlaceId: id, locked: false }],
      items: [], clues: [],
      solution: { steps: [], goal: { placeId: id, conditions: {} } },
    };
    expect(checkWinnability(world).winnable).toBe(true);
    const start = startPlay(world);
    const names = discoveredTargets(world, start).filter(({ id: found }) => found === id)
      .map(({ name }) => name);
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(playCommand(world, start, `go ${name}`).state.goalReached).toBe(true);
    }
  });

  it('uses distinct names in movement hints when place IDs collide', () => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id: 'red-room' }, { id: 'red_room' }],
      exits: [
        { id: 'wrong-way', fromPlaceId: 'entry', toPlaceId: 'red-room', locked: false },
        { id: 'right-way', fromPlaceId: 'entry', toPlaceId: 'red_room', locked: false },
      ],
      items: [], clues: [],
      solution: { steps: [], goal: { placeId: 'red_room', conditions: {} } },
    };
    const start = startPlay(world);
    const target = discoveredTargets(world, start).find(({ id }) => id === 'red_room')!;
    expect(playCommand(world, start, 'look').message).toContain(target.name);
    expect(playCommand(world, start, 'hint').message).toBe(`Try going to the ${target.name}.`);
    expect(playCommand(world, start, `go ${target.name}`).state.goalReached).toBe(true);
  });

  it('round-trips displayed movement names beginning with to to the exact target', () => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id: 'to-red-room' }, { id: 'red-room' }],
      exits: [
        { id: 'to-path', fromPlaceId: 'entry', toPlaceId: 'to-red-room', locked: false },
        { id: 'path', fromPlaceId: 'entry', toPlaceId: 'red-room', locked: false },
      ],
      items: [], clues: [],
      solution: { steps: [], goal: { placeId: 'to-red-room', conditions: {} } },
    };
    const start = startPlay(world);
    for (const target of discoveredTargets(world, start)) {
      const turn = playCommand(world, start, `go ${target.name}`);
      const expected = target.kind === 'exit'
        ? world.exits.find(({ id }) => id === target.id)!.toPlaceId : target.id;
      expect(turn.state.placeId).toBe(expected);
    }
    const target = discoveredTargets(world, start).find(({ id }) => id === 'to-red-room')!;
    expect(playCommand(world, start, 'hint').message).toBe(`Try going to the ${target.name}.`);
    expect(playCommand(world, start, `go ${target.name}`).state.goalReached).toBe(true);
  });

  it('wins using the displayed name of an item that overlaps an item-on-target command', () => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id: 'ribbon' }],
      exits: [{ id: 'door', fromPlaceId: 'entry', toPlaceId: 'ribbon', locked: true }],
      items: [{ id: 'badge-on-ribbon', placeId: 'entry' }, { id: 'badge', placeId: 'entry' }],
      clues: [],
      solution: {
        steps: [{
          id: 'open', placeId: 'entry', conditions: { itemsHeld: ['badge-on-ribbon'] },
          effects: [{ kind: 'unlock-exit', exitId: 'door' }],
        }],
        goal: { placeId: 'ribbon', conditions: {} },
      },
    };
    expect(checkWinnability(world).winnable).toBe(true);
    const start = deepFreeze(startPlay(world));
    const target = discoveredTargets(world, start).find(({ id }) => id === 'badge-on-ribbon')!;
    expect(playCommand(world, start, 'look').message).toContain(target.name);
    const taken = playCommand(world, start, `take ${target.name}`).state;
    expect(playCommand(world, taken, 'inventory').message).toContain(target.name);
    const used = playCommand(world, taken, `use ${target.name}`).state;
    expect(used.stepsDone).toEqual(['open']);
    expect(playCommand(world, used, 'go ribbon').state.goalReached).toBe(true);
    expect(playByHints(world).goalReached).toBe(true);
  });
});

describe('runAction responses', () => {
  const world = sampleWorld();
  const start = startPlay(world);

  it('looks, examines and lists the inventory without spending a turn', () => {
    expect(runAction(world, start, { kind: 'look' })).toEqual({
      state: start,
      message: 'You are at the entry. You can see the pebble. Ways out: '
        + 'the exit 4 to the study, the door (locked).',
    });
    expect(runAction(world, start, { kind: 'examine', targetId: 'door', targetKind: 'exit' }).message)
      .toBe('The door is locked.');
    expect(runAction(world, start, { kind: 'examine', targetId: 'to-study', targetKind: 'exit' }).message)
      .toBe('The exit 4 leads to the study.');
    expect(runAction(world, start, { kind: 'examine', targetId: 'pebble', targetKind: 'item' }).message)
      .toBe('The pebble is here. You could take it.');
    expect(runAction(world, start, { kind: 'examine', targetId: 'study', targetKind: 'place' }).message)
      .toBe('The study is nearby. Go there to look around.');
    expect(runAction(world, start, { kind: 'inventory' }).message).toBe('You are not carrying anything.');
    const later = replayCommands(world, ['take pebble', 'go study', 'take token']);
    expect(runAction(world, later, { kind: 'inventory' }).message)
      .toBe('You are carrying the token and the pebble.');
    expect(runAction(world, later, { kind: 'examine', targetId: 'note', targetKind: 'clue' }).message)
      .toBe('You have found the note clue.');
  });

  it('explains moves that cannot happen', () => {
    expect(runAction(world, start, { kind: 'move', targetId: 'door', targetKind: 'exit' }).message).toBe('The door is locked.');
    expect(runAction(world, start, { kind: 'move', targetId: 'entry', targetKind: 'place' }).message).toBe('You are already here.');
    expect(runAction(world, start, { kind: 'move', targetId: 'finish', targetKind: 'place' }).message).toBe('The door is locked.');
    expect(runAction(world, replayCommands(world, ['go study']), { kind: 'move', targetId: 'finish', targetKind: 'place' }).message)
      .toBe('You cannot get to the finish directly from here.');
    expect(runAction(world, start, { kind: 'move', direction: 'north' }).message)
      .toBe('This adventure does not mark compass directions yet. Try go <place>.');
    expect(runAction(world, start, { kind: 'move', direction: 'north' }).state).toBe(start);
  });

  it('takes items once and only where they are', () => {
    const taken = runAction(world, start, { kind: 'take', targetId: 'pebble', targetKind: 'item' });
    expect(taken.message).toBe('You take the pebble.');
    expect(taken.state.itemsHeld).toEqual(['pebble']);
    expect(taken.state.turns).toBe(1);
    expect(runAction(world, taken.state, { kind: 'take', targetId: 'pebble', targetKind: 'item' }).message)
      .toBe('You already have the pebble.');
    expect(runAction(world, start, { kind: 'take', targetId: 'token', targetKind: 'item' }).message).toBe('That is not here.');
  });

  it('uses items only when a step here needs them', () => {
    const atStudy = replayCommands(world, ['go study']);
    expect(runAction(world, atStudy, { kind: 'use', itemId: 'token' }).message).toBe('Take the token first.');
    const holding = replayCommands(world, ['take pebble', 'go study', 'take token']);
    const nothing = runAction(world, holding, { kind: 'use', itemId: 'pebble' });
    expect(nothing).toEqual({ state: holding, message: 'Nothing happens.' });
    expect(runAction(world, holding, { kind: 'use', itemId: 'token', targetId: 'door', targetKind: 'exit' }).message)
      .toBe('That is not here.');
    expect(runAction(world, start, { kind: 'use', itemId: 'key' }).message).toBe('You are not carrying that.');
  });

  it('has no one to talk to or choices to make in version 1 worlds', () => {
    expect(runAction(world, start, { kind: 'talk', targetId: 'guard', targetKind: 'person' }))
      .toEqual({ state: start, message: 'There is no one here to talk to.' });
    expect(runAction(world, start, { kind: 'choose', targetId: 'left', targetKind: 'choice' }))
      .toEqual({ state: start, message: 'There is no choice to make here.' });
  });

  it('shows command help', () => {
    expect(runAction(world, start, { kind: 'help' })).toEqual({ state: start, message: commandHelp });
  });

  it('stops progress after the goal until the player undoes', () => {
    const won = replayCommands(world, winningCommands);
    expect(won.goalReached).toBe(true);
    expect(playCommand(world, won, 'go entry').message)
      .toBe('You have already finished this adventure. Type undo to go back a turn.');
    expect(playCommand(world, won, 'hint').message).toBe('You have already finished this adventure.');
  });
});

describe('undo', () => {
  const world = sampleWorld();

  it('restores the previous state, one turn at a time', () => {
    const one = replayCommands(world, ['go study']);
    const two = playCommand(world, one, 'take token').state;
    const undone = playCommand(world, two, 'undo');
    expect(undone).toEqual({ state: one, message: 'You undo your last turn.' });
    expect(playCommand(world, undone.state, 'u').state).toEqual(startPlay(world));
  });

  it('ignores free actions and says when there is nothing to undo', () => {
    const start = startPlay(world);
    const looked = replayCommands(world, ['look', 'i', 'hint']);
    expect(looked).toEqual(start);
    expect(playCommand(world, start, 'undo')).toEqual({ state: start, message: 'There is nothing to undo.' });
  });
});

describe('replaying a long save', () => {
  // Regression: repeated target resolution made large saves slow to resume.
  it('replays thousands of commands on a long named world quickly', () => {
    let settings = createAdventureSettings(0, 'long', 1);
    while (settings.genre !== 'light-fantasy') settings = createAdventureSettings(settings.seed + 1, 'long', 1);
    const generated = generateAdventureWorld(settings);
    const world: PlayWorld = { ...generated, names: worldNamesFrom(lightFantasy, generated) };
    const started = Date.now();
    expect(replayCommands(world, Array<string>(2000).fill('look'))).toEqual(startPlay(world));
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);
});

describe('hints', () => {
  it('does not recommend undo in an unwinnable initial state', () => {
    const world: AdventureWorld = {
      ...sampleWorld(), exits: [],
      solution: { steps: [], goal: { placeId: 'finish', conditions: {} } },
    };
    const start = startPlay(world);
    expect(checkWinnability(world).winnable).toBe(false);
    expect(playCommand(world, start, 'hint')).toEqual({
      state: start, message: 'There seems to be no way forward from here.',
    });
  });

  it('point at the next useful step without naming puzzle answers', () => {
    const world = sampleWorld();
    const hints = (inputs: string[]) => playCommand(world, replayCommands(world, inputs), 'hint').message;
    expect(hints([])).toBe('Try going to the study.');
    expect(hints(['go study'])).toBe('Look around. Something here is worth taking.');
    expect(hints(['go study', 'take token'])).toBe('Something you are carrying could be useful here.');
    expect(hints(['go study', 'take token', 'use token'])).toBe('Try going to the entry.');
    expect(hints(['go study', 'take token', 'use token', 'go entry']))
      .toBe('Something you are carrying could be useful here.');
    for (const message of [hints([]), hints(['go study', 'take token'])]) {
      expect(message).not.toMatch(/open door|find key|read note|token|key/);
    }
  });

  it('skip items no step needs', () => {
    const world = sampleWorld();
    expect(playCommand(world, startPlay(world), 'hint').message).not.toMatch(/taking/);
  });

  it('avoid one-way dead ends and admit when there is no way forward', () => {
    const world: AdventureWorld = {
      version: 1, startPlaceId: 'fork',
      places: [{ id: 'fork' }, { id: 'pit' }, { id: 'home' }],
      exits: [
        { id: 'slide', fromPlaceId: 'fork', toPlaceId: 'pit', locked: false },
        { id: 'path', fromPlaceId: 'fork', toPlaceId: 'home', locked: false },
      ],
      items: [], clues: [],
      solution: { steps: [], goal: { placeId: 'home', conditions: {} } },
    };
    expect(playCommand(world, startPlay(world), 'hint').message).toBe('Try going to the home.');
    const stuck = replayCommands(world, ['go pit']);
    expect(playCommand(world, stuck, 'hint').message).toBe('There seems to be no way forward from here. Try undo.');
  });
});

// A simple player that only types what the hints suggest. If the checker calls
// a world winnable, following the hints must win it with typed commands.
function playByHints(world: PlayWorld, commands: string[] = []): PlayState {
  let state = startPlay(world);
  for (let guard = 0; guard < 200 && !state.goalReached; guard++) {
    const message = playCommand(world, state, 'hint').message;
    const place = /^Try going to the (.+)\.$/.exec(message);
    let inputs: string[];
    if (place) {
      inputs = [`go ${place[1]}`];
    } else if (message.includes('worth taking')) {
      inputs = discoveredTargets(world, state)
        .filter((target) => target.kind === 'item' && !state.itemsHeld.includes(target.id))
        .map((target) => `take ${target.name}`);
    } else if (message.includes('could be useful here')) {
      inputs = discoveredTargets(world, state)
        .filter((target) => target.kind === 'item' && state.itemsHeld.includes(target.id))
        .map((target) => `use ${target.name}`);
    } else {
      break;
    }
    const before = state;
    for (const input of inputs) {
      commands.push(input);
      state = playCommand(world, state, input).state;
    }
    if (state === before) break;
  }
  return state;
}

describe.each([1, 2])('version %i generated play and saved replay', (version) => {
  it.each([0, 1, 17000])('seed %i: wins every length and resumes the exact command history', (seed) => {
    for (const length of adventureLengths) {
      const settings = createAdventureSettings(seed, length, version);
      const world = generateAdventureWorld(settings);
      for (const optional of [true, false]) {
        const required = world.solution.goal.conditions.stepsDone ?? [];
        const played = optional ? world : {
          ...world, solution: {
            ...world.solution, steps: world.solution.steps.filter(({ id }) => required.includes(id)),
          },
        };
        const commands: string[] = ['look', 'take unknown item', 'talk unknown person'];
        const won = playByHints(played, commands);
        expect(won.goalReached, `${settings.genre}/${length}/${optional}`).toBe(true);
        expect(replayCommands(played, commands)).toEqual(won);
        if (optional) {
          commands.push('undo', 'look');
          const savedState = replayCommands(world, commands);
          expect(savedState.goalReached).toBe(false);
          const save = createSave('Shared trip', settings, commands);
          const restored = importSaveFile(exportSaveFile(save));
          expect(restored).toEqual(save);
          expect(replayCommands(generateAdventureWorld(restored.settings), restored.commands)).toEqual(savedState);
        }
      }
    }
  }, 30_000);
});

describe('agreement with the winnability checker', () => {
  const chain = (length: number): AdventureWorld => {
    const places = Array.from({ length }, (_, index) => ({ id: `room-${index}` }));
    return {
      version: 1, startPlaceId: 'room-0', places,
      exits: places.slice(1).flatMap(({ id }, index) => [
        { id: `gate-${index}`, fromPlaceId: `room-${index}`, toPlaceId: id, locked: index % 2 === 0 },
        { id: `back-${index}`, fromPlaceId: id, toPlaceId: `room-${index}`, locked: false },
      ]),
      items: places.map(({ id }, index) => ({ id: `charm-${index}`, placeId: id })),
      clues: [],
      solution: {
        steps: places.slice(0, -1).flatMap((_, index) => index % 2 === 0 ? [{
          id: `open-${index}`, placeId: `room-${index}`,
          conditions: { itemsHeld: [`charm-${index}`] },
          effects: [{ kind: 'unlock-exit' as const, exitId: `gate-${index}` }],
        }] : []),
        goal: { placeId: `room-${length - 1}`, conditions: {} },
      },
    };
  };

  it.each([
    ['the sample world', sampleWorld()],
    ['a long gated chain', chain(9)],
  ])('wins %s by following hints', (_, world) => {
    expect(checkWinnability(world).winnable).toBe(true);
    expect(playByHints(world).goalReached).toBe(true);
  });

  it('cannot win a world the checker calls unwinnable', () => {
    const world: AdventureWorld = {
      ...sampleWorld(),
      exits: sampleWorld().exits.filter(({ id }) => id !== 'to-study'),
    };
    expect(checkWinnability(world).winnable).toBe(false);
    expect(playByHints(world).goalReached).toBe(false);
  });
});

// The sample world with pack-style names, a person and some aliases that must be ignored.
function namedWorld(): PlayWorld {
  return {
    ...sampleWorld(),
    names: {
      places: [
        { id: 'entry', name: 'Front hall' },
        { id: 'study', name: 'Quiet study', aliases: ['study', 'north'] },
        { id: 'finish', name: 'The garden' },
      ],
      items: [
        { id: 'key', name: 'Brass key', aliases: ['key', 'quiet study'] },
        { id: 'token', name: 'Silver token', aliases: ['token'] },
        { id: 'pebble', name: 'Round pebble' },
      ],
      clues: [{ id: 'note', name: 'Torn note' }, { id: 'answer', name: 'Hidden answer' }],
      people: [
        { id: 'guard', name: 'The old guard', placeId: 'entry', aliases: ['guard'] },
        { id: 'ghost', name: 'Ghost', placeId: 'elsewhere' },
      ],
    },
  };
}

describe('play with content-pack names', () => {
  it('describes places with pack names and people, without naming unknown places', () => {
    const world = namedWorld();
    const look = playCommand(world, startPlay(world), 'look').message;
    expect(look).toBe('You are at the front hall. The old guard is here. You can see the round pebble. '
      + 'Ways out: the way to the quiet study, the locked way.');
    expect(JSON.stringify(discoveredTargets(world, startPlay(world)))).not.toMatch(/garden|finish/);
  });

  it('wins with pack names and aliases, naming the way once it opens', () => {
    const { state, messages } = play(namedWorld(), [
      'go study', 'take token', 'use silver token', 'go front hall', 'use key on locked way', 'go garden',
    ]);
    expect(state.goalReached).toBe(true);
    expect(messages[0]).toBe('You are at the quiet study. You can see the silver token. Clues here: the torn note. '
      + 'Ways out: the way to the front hall. You found the torn note clue. '
      + 'Something changes here. You found the hidden answer clue.');
    expect(messages[2]).toBe('You use the silver token. You now have the brass key.');
    expect(messages[4]).toBe('You use the brass key on the locked way. The way to the garden is now open.');
  });

  it('drops aliases that clash with a name or read as a direction', () => {
    const targets = discoveredTargets(namedWorld(), startPlay(namedWorld()));
    expect(targets.find(({ id }) => id === 'study')).toEqual(
      { id: 'study', kind: 'place', name: 'Quiet study', aliases: ['study'] });
    expect(targets.find(({ id }) => id === 'guard')).toEqual(
      { id: 'guard', kind: 'person', name: 'The old guard', aliases: ['guard'] });
    expect(targets.some(({ id }) => id === 'ghost')).toBe(false);
  });

  it('disambiguates generated exits against discovered names and aliases', () => {
    const base = namedWorld();
    const world: PlayWorld = {
      ...base,
      names: {
        ...base.names!,
        items: base.names!.items.map((item) =>
          item.id === 'pebble' ? { ...item, name: 'Locked way' } : item),
      },
    };
    const state = startPlay(world);
    const targets = discoveredTargets(world, state);
    const item = targets.find(({ id, kind }) => id === 'pebble' && kind === 'item')!;
    const exit = targets.find(({ id, kind }) => id === 'door' && kind === 'exit')!;

    expect(exit.name).not.toBe(item.name);
    expect(playCommand(world, state, `examine ${item.name}`).message).toContain('is here.');
    expect(playCommand(world, state, `examine ${exit.name}`).message).toContain('is locked.');
    expect(playCommand(world, state, 'look').message).toContain(`the ${exit.name}`);
  });

  it('disambiguates generated exits using the parser punctuation rules', () => {
    const base = namedWorld();
    const world: PlayWorld = {
      ...base,
      names: {
        ...base.names!,
        items: base.names!.items.map((item) =>
          item.id === 'pebble' ? { ...item, name: 'Locked way.' } : item),
      },
    };
    const state = startPlay(world);
    const targets = discoveredTargets(world, state);
    const item = targets.find(({ id, kind }) => id === 'pebble' && kind === 'item')!;
    const exit = targets.find(({ id, kind }) => id === 'door' && kind === 'exit')!;

    expect(exit.name).not.toBe(item.name);
    expect(playCommand(world, state, 'examine Locked way.').message).toContain('is here.');
    expect(playCommand(world, state, `examine ${exit.name}`).message).toContain('is locked.');
  });

  it.each([['key', 'pebble'], ['pebble', 'key']])(
    'keeps state-resolved item names stable when taking %j then %j', (...order: string[]) => {
      const base = namedWorld();
      const world: PlayWorld = {
        ...base,
        items: base.items.map((item) => item.id === 'key' ? { ...item, placeId: 'entry' } : item),
        names: {
          ...base.names!,
          items: base.names!.items.map((item) => item.id === 'key' ? { ...item, name: 'Badge' }
            : item.id === 'pebble' ? { ...item, name: 'Badge on locked way' } : item),
        },
        solution: {
          steps: [{
            id: 'finish', placeId: 'entry', conditions: { itemsHeld: ['pebble'] }, effects: [],
          }],
          goal: { placeId: 'entry', conditions: { stepsDone: ['finish'] } },
        },
      };
      const start = startPlay(world);
      const targets = discoveredTargets(world, start);
      const badge = targets.find(({ id, kind }) => id === 'key' && kind === 'item')!;
      const overlapping = targets.find(({ id, kind }) => id === 'pebble' && kind === 'item')!;
      let holding = start;
      for (const id of order) {
        const item = id === 'key' ? badge : overlapping;
        const taken = playCommand(world, holding, `take ${item.name}`);
        expect(taken.message.toLowerCase()).toContain(item.name.toLowerCase());
        holding = taken.state;
      }

      expect(overlapping.name).not.toBe('Badge on locked way');
      expect(playCommand(world, start, 'look').message.toLowerCase()).toContain(overlapping.name.toLowerCase());
      expect(playCommand(world, holding, 'inventory').message.toLowerCase())
        .toContain(overlapping.name.toLowerCase());
      expect(playCommand(world, holding, `use ${overlapping.name}`).state.goalReached).toBe(true);
    });

  it('does not name an undiscovered destination when a remote exit opens', () => {
    const base = namedWorld();
    const world: PlayWorld = {
      ...base,
      items: base.items.map((item) => item.id === 'key' ? { ...item, placeId: 'entry' } : item),
      exits: [
        { id: 'to-study', fromPlaceId: 'entry', toPlaceId: 'study', locked: false },
        { id: 'to-entry', fromPlaceId: 'study', toPlaceId: 'entry', locked: false },
        { id: 'secret-door', fromPlaceId: 'study', toPlaceId: 'finish', locked: true },
      ],
      solution: {
        steps: [{
          id: 'open-remote', placeId: 'entry', conditions: { itemsHeld: ['key'] },
          effects: [{ kind: 'unlock-exit', exitId: 'secret-door' }],
        }],
        goal: { placeId: 'finish', conditions: { stepsDone: ['open-remote'] } },
      },
      names: {
        ...base.names!,
        places: base.names!.places.map((place) =>
          place.id === 'finish' ? { ...place, name: 'Secret vault' } : place),
      },
    };
    const start = startPlay(world);
    const holding = playCommand(world, start, 'take brass key').state;
    const opened = playCommand(world, holding, 'use brass key');

    expect(opened.message).not.toContain('secret vault');
    expect(opened.message).toContain('A way is now open.');
    expect(discoveredTargets(world, opened.state).some(({ id }) => id === 'finish')).toBe(false);
    expect(playCommand(world, opened.state, 'go quiet study').message).toContain('secret vault');
  });

  it('keeps ID-only remote unlock wording unchanged', () => {
    const world: AdventureWorld = {
      version: 1,
      startPlaceId: 'entry',
      places: [{ id: 'entry' }, { id: 'vault' }],
      exits: [{ id: 'secret-door', fromPlaceId: 'vault', toPlaceId: 'entry', locked: true }],
      items: [{ id: 'key', placeId: 'entry' }],
      clues: [],
      solution: {
        steps: [{
          id: 'open-remote', placeId: 'entry', conditions: { itemsHeld: ['key'] },
          effects: [{ kind: 'unlock-exit', exitId: 'secret-door' }],
        }],
        goal: { placeId: 'entry', conditions: { stepsDone: ['open-remote'] } },
      },
    };

    const holding = playCommand(world, startPlay(world), 'take key').state;
    expect(playCommand(world, holding, 'use key').message)
      .toContain('You use the key. The secret door is now open.');
  });

  it('lets the player talk to and examine people only where they are', () => {
    const world = namedWorld();
    const start = startPlay(world);
    expect(playCommand(world, start, 'talk to guard')).toEqual({ state: start, message: 'The old guard greets you.' });
    expect(playCommand(world, start, 'examine old guard').message).toBe('The old guard is here.');
    expect(runAction(world, start, { kind: 'talk', targetId: 'pebble', targetKind: 'item' }).message)
      .toBe('You can only talk to people.');
    const study = playCommand(world, start, 'go study').state;
    expect(discoveredTargets(world, study).some(({ kind }) => kind === 'person')).toBe(false);
    expect(runAction(world, study, { kind: 'talk', targetId: 'guard', targetKind: 'person' }).message)
      .toBe('There is no one here to talk to.');
    const finished = { ...start, goalReached: true };
    expect(playCommand(world, finished, 'talk to guard').message).toBe('The old guard greets you.');
  });

  it('keeps the same state as ID names for the same moves', () => {
    const named = replayCommands(namedWorld(), ['go study', 'take token', 'use token']);
    expect(named).toEqual(replayCommands(sampleWorld(), ['go study', 'take token', 'use token']));
  });

  it('wins generated light fantasy worlds by hints using only pack names', () => {
    const seeds = Array.from({ length: 64 }, (_, seed) => seed)
      .filter((seed) => createAdventureSettings(seed, 'short', 1).genre === 'light-fantasy').slice(0, 3);
    expect(seeds).toHaveLength(3);
    for (const seed of seeds) {
      const base = generateAdventureWorld(createAdventureSettings(seed, 'short', 1));
      const world: PlayWorld = { ...base, names: worldNamesFrom(lightFantasy, base) };
      expect(playByHints(world).goalReached).toBe(true);
      const packNames = new Set([...lightFantasy.places, ...lightFantasy.items, ...lightFantasy.clues,
        ...lightFantasy.characters].map(({ name }) => name));
      for (const target of discoveredTargets(world, startPlay(world)).filter(({ kind }) => kind !== 'exit')) {
        expect(packNames).toContain(target.name);
      }
    }
  }, 20_000);
});
