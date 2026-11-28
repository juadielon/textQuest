import { describe, expect, it } from 'vitest';
import type { AdventureWorld } from './adventure-world';
import { checkWinnability } from './winnability';

function world(overrides: Partial<AdventureWorld> = {}): AdventureWorld {
  return {

    startPlaceId: 'gate',
    places: [{ id: 'gate' }, { id: 'goal' }],
    exits: [{ id: 'path', fromPlaceId: 'gate', toPlaceId: 'goal', locked: false }],
    items: [],
    clues: [],
    solution: {
      steps: [],
      goal: { placeId: 'goal', conditions: {} },
    },
    ...overrides,
  };
}

describe('checkWinnability', () => {
  it('finds a winnable world', () => {
    expect(checkWinnability(world())).toMatchObject({ winnable: true });
  });

  it('reports an unwinnable world', () => {
    const blocked = world({
      exits: [{ id: 'path', fromPlaceId: 'gate', toPlaceId: 'goal', locked: true }],
    });
    expect(checkWinnability(blocked)).toMatchObject({ winnable: false });
  });

  it('checks items and puzzle steps', () => {
    const checked = world({
      items: [{ id: 'key', placeId: 'gate' }],
      solution: {
        steps: [{
          id: 'open-door',
          placeId: 'gate',
          conditions: { itemsHeld: ['key'] },
          effects: [{ kind: 'unlock-exit', exitId: 'path' }],
        }],
        goal: { placeId: 'goal', conditions: { stepsDone: ['open-door'] } },
      },
    });
    expect(checkWinnability(checked)).toMatchObject({ winnable: true });
  });

  it('returns the choice and ending data for a world', () => {
    const checked = world({
      solution: {
        endings: [{ id: 'win', outcome: 'win' }],
        steps: [{
          id: 'finish',
          placeId: 'gate',
          choiceId: 'ending-choice',
          conditions: {},
          effects: [{ kind: 'end-adventure', endingId: 'win' }],
        }, {
          id: 'leave',
          placeId: 'gate',
          choiceId: 'ending-choice',
          conditions: {},
          effects: [],
        }],
        goal: { placeId: 'goal', conditions: { stepsDone: ['finish'] } },
      },
    });
    expect(checkWinnability(checked)).toMatchObject({
      winnable: true,
      reachableEndingIds: ['win'],
    });
  });

  it('reports stuck and unreachable states', () => {
    const checked = world({
      exits: [{ id: 'path', fromPlaceId: 'gate', toPlaceId: 'goal', locked: true }],
    });
    expect(checkWinnability(checked)).toMatchObject({
      winnable: false,
      canGetStuck: true,
    });
  });
});
