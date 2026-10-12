import { describe, expect, it } from 'vitest';
import {
  adventureGenres, adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord,
  type AdventureGenre, type AdventureLength, type AdventureSettings, type RandomValueSource,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import { discoveredTargets, playCommand, replayCommands, startPlay, type PlayState } from './engine/play';
import { generateAdventureWorld } from './generate-world';
import {
  createSave, createSaveStore, exportSaveFile, importSaveFile, type AdventureSave, type StorageLike,
} from './saves';

const savedTime = new Date('2026-10-12T04:00:00.000Z');

class MemoryStorage implements StorageLike {
  private readonly items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

// Fixed IDs keep the store repeatable without browser randomness.
function countingSource(): RandomValueSource {
  let next = 1;
  return {
    getRandomValues(array: Uint32Array<ArrayBuffer>) {
      array.fill(next++);
      return array;
    },
  };
}

function seedsFor(genre: AdventureGenre, length: AdventureLength, count: number): AdventureSettings[] {
  const found: AdventureSettings[] = [];
  for (let seed = 0; found.length < count && seed < 10_000; seed += 1) {
    const settings = createAdventureSettings(seed, length);
    if (settings.genre === genre) found.push(settings);
  }
  return found;
}

function generates(genre: AdventureGenre): boolean {
  try {
    generateAdventureWorld(seedsFor(genre, 'short', 1)[0]);
    return true;
  } catch (error) {
    if (error instanceof RangeError && /not supported yet/.test(error.message)) return false;
    throw error;
  }
}

function nameOf(world: AdventureWorld, state: PlayState, kind: string, id: string): string {
  const target = discoveredTargets(world, state).find((t) => t.kind === kind && t.id === id);
  if (!target) throw new Error(`No ${kind} named ${id} is in sight.`);
  return target.name;
}

// Follows the hints, with a few free commands mixed in, and keeps every typed
// command so it can be saved and replayed. Most hints are read, not typed,
// because each one searches for a route and would slow every replay.
function commandsToWin(world: AdventureWorld): string[] {
  const typed: string[] = ['look', 'inventory', 'hint'];
  let state = replayCommands(world, typed);
  const type = (input: string) => {
    typed.push(input);
    state = playCommand(world, state, input).state;
  };
  for (let guard = 0; guard < 200 && !state.goalReached; guard += 1) {
    const before = state;
    const message = playCommand(world, state, 'hint').message;
    const place = /^Try going to the (.+)\.$/.exec(message);
    if (place) {
      type(`go ${place[1]}`);
    } else if (message.includes('worth taking')) {
      for (const { id, kind } of discoveredTargets(world, state)) {
        if (kind === 'item' && !state.itemsHeld.includes(id)) type(`take ${nameOf(world, state, kind, id)}`);
      }
    } else if (message.includes('could be useful here')) {
      for (const id of state.itemsHeld) type(`use ${nameOf(world, state, 'item', id)}`);
    }
    if (state === before) throw new Error(`Hints got stuck: ${message}`);
  }
  if (!state.goalReached) throw new Error('Following hints did not win.');
  return typed;
}

// Rebuilds a game the way a player resuming a save would.
function resume(save: AdventureSave): PlayState {
  const world = generateAdventureWorld(parseShareWord(encodeShareWord(save.settings)));
  return replayCommands(world, save.commands);
}

function roundTrips(settings: AdventureSettings, commands: readonly string[]): PlayState {
  const world = generateAdventureWorld(parseShareWord(encodeShareWord(settings)));
  let original = startPlay(world);
  for (const input of commands) original = playCommand(world, original, input).state;

  const save = createSave('Round trip', settings, commands, savedTime);
  const imported = importSaveFile(exportSaveFile(save));
  expect(imported).toStrictEqual(save);
  expect(resume(imported)).toStrictEqual(original);

  const storage = new MemoryStorage();
  const id = createSaveStore(storage, countingSource()).add(save);
  // A fresh store on the same storage stands in for reopening the page.
  const reloaded = createSaveStore(storage, countingSource()).load(id);
  expect(reloaded).toStrictEqual(save);
  expect(resume(reloaded)).toStrictEqual(original);
  return original;
}

describe.each(adventureGenres)('saved %s games', (genre) => {
  describe.skipIf(!generates(genre)).each(adventureLengths)('of %s length', (length) => {
    it.each(seedsFor(genre, length, 3).map((settings) => [settings.seed, settings] as const))(
      'resume to the same state for seed %i',
      (_, settings) => {
        const world = generateAdventureWorld(settings);
        const winning = commandsToWin(world);
        const halfway = [...winning.slice(0, Math.ceil(winning.length / 2)), 'dance', 'take nothing', 'undo'];

        expect(roundTrips(settings, []).turns).toBe(0);
        const partial = roundTrips(settings, halfway);
        expect(partial.goalReached).toBe(false);
        expect(partial.turns).toBeGreaterThan(0);
        expect(roundTrips(settings, winning).goalReached).toBe(true);
      },
      // Long worlds search for a route at every hint, so allow extra time.
      20_000,
    );
  });
});

describe('saved games', () => {
  it('resume a won game where further commands change nothing', () => {
    const [settings] = seedsFor('light-fantasy', 'short', 1);
    const winning = commandsToWin(generateAdventureWorld(settings));
    const won = roundTrips(settings, winning);
    expect(roundTrips(settings, [...winning, 'look', 'hint', 'go nowhere'])).toStrictEqual(won);
  });
});
