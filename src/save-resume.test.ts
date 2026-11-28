import { describe, expect, it } from 'vitest';
import { createAdventureSettings, encodeShareWord, parseShareWord } from './adventure-settings';
import { worldNamesFrom } from './content/world-names';
import { replayCommands } from './engine/play';
import { adventurePack, generateAdventureWorld } from './generate-world';
import {
  createSave, createSaveStore, exportSaveFile, importSaveFile, type StorageLike,
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

function randomSource() {
  let next = 1;
  return {
    getRandomValues(array: Uint32Array<ArrayBuffer>) {
      array.fill(next++);
      return array;
    },
  };
}

function replay(settings: ReturnType<typeof createAdventureSettings>, commands: readonly string[], packNames = false) {
  const world = generateAdventureWorld(settings);
  const named = packNames
    ? { ...world, names: worldNamesFrom(adventurePack(settings.genre), world) }
    : world;
  return replayCommands(named, [...commands]);
}

describe('save and resume', () => {
  it.each([
    [0, 'short'],
    [1, 'medium'],
    [17000, 'long'],
  ] as const)('round-trips seed %i at %s length', (seed, length) => {
    const settings = createAdventureSettings(seed, length);
    const commands = ['look', 'inventory', 'hint'];
    const save = createSave('Round trip', settings, commands, savedTime);
    const imported = importSaveFile(exportSaveFile(save));
    expect(imported).toStrictEqual(save);
    expect(replay(parseShareWord(encodeShareWord(settings)), imported.commands))
      .toStrictEqual(replay(settings, commands));
  });

  it('stores and reloads a save in browser storage', () => {
    const storage = new MemoryStorage();
    const store = createSaveStore(storage, randomSource());
    const settings = createAdventureSettings(7, 'short');
    const save = createSave('Stored trip', settings, ['look'], savedTime);
    const id = store.add(save);
    expect(createSaveStore(storage, randomSource()).load(id)).toStrictEqual(save);
  });

  it('replays named commands with the same state', () => {
    const settings = createAdventureSettings(0, 'medium');
    const commands = ['look', 'inventory'];
    const save = createSave('Named trip', settings, commands, savedTime, ['content', 'content']);
    const imported = importSaveFile(exportSaveFile(save));
    expect(replay(settings, imported.commands, true)).toStrictEqual(replay(settings, commands, true));
  });
});
