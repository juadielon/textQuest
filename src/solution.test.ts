// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdventureWorld } from './adventure-world';
import type { PlayWorld } from './engine/play';
import { createAdventureSettings } from './adventure-settings';
import { generateAdventureWorld } from './generate-world';
import { replayCommands } from './engine/play';
import {
  findWinningCommands, SOLUTION_SEARCH_LIMIT, solutionModeEnabled,
} from './solution';

const tinyWorld: PlayWorld = {
  version: 1,
  startPlaceId: 'gate',
  places: [{ id: 'gate' }, { id: 'old-tower' }],
  exits: [
    { id: 'path', fromPlaceId: 'gate', toPlaceId: 'old-tower', locked: true },
    { id: 'steps', fromPlaceId: 'old-tower', toPlaceId: 'gate', locked: false },
  ],
  items: [{ id: 'brass-key', placeId: 'gate' }],
  clues: [],
  solution: {
    steps: [{
      id: 'open-path', placeId: 'gate', conditions: { itemsHeld: ['brass-key'] },
      effects: [{ kind: 'unlock-exit', exitId: 'path' }],
    }],
    goal: { placeId: 'old-tower', conditions: { stepsDone: ['open-path'] } },
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('solution mode', () => {
  it('is enabled only by the explicit environment flag', () => {
    vi.stubEnv('VITE_SOLUTION_MODE', '');
    expect(solutionModeEnabled()).toBe(false);
    vi.stubEnv('VITE_SOLUTION_MODE', '0');
    expect(solutionModeEnabled()).toBe(false);
    vi.stubEnv('VITE_SOLUTION_MODE', '1');
    expect(solutionModeEnabled()).toBe(true);
  });

  it('finds a deterministic winning route through the real parser and play state', () => {
    expect(findWinningCommands(tinyWorld)).toEqual([
      'take brass key',
      'use brass key',
      'go to old tower',
    ]);
  });

  it('finds a deterministic route in a version 2 world', () => {
    const world: PlayWorld = {
      ...tinyWorld,
      version: 2,
      solution: {
        steps: [
          {
            id: 'open-path',
            placeId: 'gate',
            conditions: { itemsHeld: ['brass-key'] },
            choiceId: 'gate-choice',
            effects: [{ kind: 'unlock-exit', exitId: 'path' }],
          },
          {
            id: 'keep-path',
            placeId: 'gate',
            conditions: { itemsHeld: ['brass-key'] },
            choiceId: 'gate-choice',
            effects: [],
          },
        ],
        goal: { placeId: 'old-tower', conditions: { stepsDone: ['open-path'] } },
        endings: [{ id: 'win', outcome: 'win' }],
      },
    };
    expect(findWinningCommands(world).length).toBeGreaterThan(0);
  });

  it('returns no route for a world with no solution', () => {
    const world: AdventureWorld = {
      ...tinyWorld,
      solution: {
        steps: [],
        goal: { placeId: 'nowhere', conditions: {} },
      },
      places: [...tinyWorld.places, { id: 'nowhere' }],
    };
    expect(findWinningCommands(world)).toEqual([]);
  });

  it('does not search beyond the documented state limit', () => {
    expect(SOLUTION_SEARCH_LIMIT).toBe(10_000);
  });

  it.each([1, 2] as const)('finds a short generated route: version %i', (version) => {
    const settings = createAdventureSettings(7, 'short', version);
    const world = generateAdventureWorld(settings);
    const route = findWinningCommands(world);
    expect(route.length).toBeGreaterThan(0);
    expect(replayCommands(world, route).goalReached).toBe(true);
  });
});
