import { describe, expect, it } from 'vitest';
import { createAdventureSettings } from '../adventure-settings';
import type { AdventureWorld } from '../adventure-world';
import { lightFantasy } from '../content/v1/light-fantasy';
import { worldNamesFrom } from '../content/v1/world-names';
import { generateAdventureWorld } from '../generate-world';
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
  // Regression: naming targets used to be redone for every command, so a long
  // world took about 75 ms per command and big saves were slow to resume.
  it('replays thousands of commands on a long generated world quickly', () => {
    let settings = createAdventureSettings(0, 'long');
    while (settings.genre !== 'light-fantasy') settings = createAdventureSettings(settings.seed + 1, 'long');
    const world = generateAdventureWorld(settings);
    const started = Date.now();
    expect(replayCommands(world, Array<string>(2000).fill('look'))).toEqual(startPlay(world));
    // The slow version took minutes, so a generous limit still catches it.
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
function playByHints(world: PlayWorld): PlayState {
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
    for (const input of inputs) state = playCommand(world, state, input).state;
    if (state === before) break;
  }
  return state;
}

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

  it('keeps an item named like an item-on-exit command usable', () => {
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
    const holding = playCommand(world, playCommand(world, start, `take ${badge.name}`).state,
      `take ${overlapping.name}`).state;

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
      .filter((seed) => createAdventureSettings(seed, 'short').genre === 'light-fantasy').slice(0, 3);
    expect(seeds).toHaveLength(3);
    for (const seed of seeds) {
      const base = generateAdventureWorld(createAdventureSettings(seed, 'short'));
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
