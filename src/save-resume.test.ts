import { describe, expect, it } from 'vitest';
import {
  adventureGenres, adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord,
  type AdventureGenre, type AdventureLength, type AdventureSettings, type RandomValueSource,
} from './adventure-settings';
import { worldNamesFrom } from './content/v1/world-names';
import { discoveredTargets, playCommand, replayCommands, startPlay, type PlayState, type PlayWorld } from './engine/play';
import { generateAdventureWorld, versionOnePack } from './generate-world';
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
  expect(found).toHaveLength(count);
  return found;
}

function worldFrom(settings: AdventureSettings, packNames: boolean): PlayWorld {
  const parsed = parseShareWord(encodeShareWord(settings));
  const world = generateAdventureWorld(parsed);
  return packNames ? { ...world, names: worldNamesFrom(versionOnePack(parsed.genre), world) } : world;
}

function nameOf(world: PlayWorld, state: PlayState, kind: string, id: string): string {
  const target = discoveredTargets(world, state).find((t) => t.kind === kind && t.id === id);
  if (!target) throw new Error(`No ${kind} named ${id} is in sight.`);
  return target.name;
}

// Big worlds can be too large for the hint's route search, so the hint asks the
// player to explore. This finds the next place on the way to the nearest new place.
function firstStepToNewPlace(world: PlayWorld, state: PlayState): string | undefined {
  const firstStep = new Map<string, string | undefined>([[state.placeId, undefined]]);
  const queue = [state.placeId];
  for (const placeId of queue) {
    if (!state.placesVisited.includes(placeId)) return firstStep.get(placeId);
    for (const exit of world.exits) {
      if (exit.fromPlaceId !== placeId || firstStep.has(exit.toPlaceId)) continue;
      if (exit.locked && !state.unlockedExits.includes(exit.id)) continue;
      firstStep.set(exit.toPlaceId, firstStep.get(placeId) ?? exit.toPlaceId);
      queue.push(exit.toPlaceId);
    }
  }
  return undefined;
}

// Follows the hints, with a few free commands mixed in, and keeps every typed
// command so it can be saved and replayed. Most hints are read, not typed,
// because each one searches for a route and would slow every replay.
function commandsToWin(world: PlayWorld): string[] {
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
    } else if (message.includes('somewhere you have not been')) {
      const next = firstStepToNewPlace(world, state);
      if (next) type(`go ${nameOf(world, state, 'place', next)}`);
    }
    if (state === before) throw new Error(`Hints got stuck: ${message}`);
  }
  if (!state.goalReached) throw new Error('Following hints did not win.');
  return typed;
}

// Rebuilds a game the way a player resuming a save would.
function resume(save: AdventureSave, packNames: boolean): PlayState {
  const world = worldFrom(save.settings, packNames);
  return replayCommands(world, save.commands);
}

function roundTrips(settings: AdventureSettings, commands: readonly string[], packNames: boolean): PlayState {
  const world = worldFrom(settings, packNames);
  let original = startPlay(world);
  for (const input of commands) original = playCommand(world, original, input).state;

  const save = createSave('Round trip', settings, commands, savedTime);
  const imported = importSaveFile(exportSaveFile(save));
  expect(imported).toStrictEqual(save);
  expect(resume(imported, packNames)).toStrictEqual(original);

  const storage = new MemoryStorage();
  const id = createSaveStore(storage, countingSource()).add(save);
  // A fresh store on the same storage stands in for reopening the page.
  const reloaded = createSaveStore(storage, countingSource()).load(id);
  expect(reloaded).toStrictEqual(save);
  expect(resume(reloaded, packNames)).toStrictEqual(original);
  return original;
}

describe.each([false, true])('saved games with pack names: %s', (packNames) => {
  describe.each(adventureGenres)('saved %s games', (genre) => {
    describe.each(adventureLengths)('of %s length', (length) => {
      it.each(seedsFor(genre, length, 3).map((settings) => [settings.seed, settings] as const))(
        'resume to the same state for seed %i',
        (_, settings) => {
          const world = worldFrom(settings, packNames);
          const winning = commandsToWin(world);
          const halfway = [...winning.slice(0, Math.ceil(winning.length / 2)), 'dance', 'take nothing', 'undo'];

          expect(roundTrips(settings, [], packNames).turns).toBe(0);
          const partial = roundTrips(settings, halfway, packNames);
          expect(partial.goalReached).toBe(false);
          expect(partial.turns).toBeGreaterThan(0);
          expect(roundTrips(settings, winning, packNames).goalReached).toBe(true);
        },
        // Long worlds search for a route at every hint, so allow extra time.
        60_000,
      );
    });
  });

  it('resume a won game where further commands change nothing', () => {
    const [settings] = seedsFor('light-fantasy', 'short', 1);
    const winning = commandsToWin(worldFrom(settings, packNames));
    const won = roundTrips(settings, winning, packNames);
    expect(roundTrips(settings, [...winning, 'look', 'hint', 'go nowhere'], packNames)).toStrictEqual(won);
  });
});
