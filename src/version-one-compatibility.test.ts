import { describe, expect, it } from 'vitest';
import {
  createAdventureSettings, currentVersion, encodeShareWord, parseShareWord, supportedVersions,
} from './adventure-settings';
import { generateAdventureWorld } from './generate-world';
import { replayCommands } from './engine/play';
import { createSave, exportSaveFile, importSaveFile } from './saves';
import { prepareSeededPlacement } from './seeded-placement';
import { createSeededRandom } from './seeded-random';

describe('released version 1 compatibility', () => {
  it('keeps version 1 placement when new adventures default to version 2', () => {
    expect(currentVersion).toBe(2);
    expect(supportedVersions).toEqual([1, 2]);
    expect(createAdventureSettings(0, 'short').version).toBe(2);
    const settings = parseShareWord('ableacorn');
    expect(settings).toEqual({ version: 1, seed: 0, length: 'short', genre: 'light-fantasy' });
    expect(encodeShareWord(settings)).toBe('ableacorn');
    const world = generateAdventureWorld(settings);
    const random = createSeededRandom(settings.seed);
    random.nextUint32();
    random.pickIndex(3);
    expect(prepareSeededPlacement(world, random)).not.toEqual(world);
    expect(generateAdventureWorld(parseShareWord('ableacorn'))).toEqual(world);
    expect(world.items[0]).toEqual({ id: 'peg', placeId: 'well' });
    expect(world.clues[0]).toEqual({ id: 'wheel-note', placeId: 'mill' });
  });

  it.each([
    ['ableacorn', ['take ash peg', 'go well', 'take peg', 'talk mara', 'use peg'], 'well', 'peg'],
    ['ablebadger', ['take volunteer apron', 'go tea room', 'take apron', 'talk nell', 'use apron'], 'tea-room', 'apron'],
    ['tallanchor', ['take sealant tube', 'go cargo bay', 'take sealant', 'talk eri', 'use sealant'], 'cargo-bay', 'sealant'],
  ] as const)('%s: imports old saved commands and replays their original pickups', (word, commands, placeId, itemId) => {
    const settings = parseShareWord(word);
    const save = createSave('Original adventure', settings, commands, new Date('2026-10-12T04:00:00Z'));
    const file = exportSaveFile(save);
    const restored = importSaveFile(file);
    expect(restored).toEqual(save);
    expect(encodeShareWord(restored.settings)).toBe(word);
    const world = generateAdventureWorld(restored.settings);
    const replay = replayCommands(world, restored.commands);
    expect(replay).toMatchObject({
      placeId, placesVisited: [world.startPlaceId, placeId],
      turns: 2, goalReached: false,
    });
    expect(replay.itemsHeld).toContain(itemId);
    expect(replay.previous).toMatchObject({ placeId, turns: 1 });
    expect(replay.previous?.itemsHeld).not.toContain(itemId);
    expect(replayCommands(world, commands)).toEqual(replayCommands(world, commands.slice(1, 3)));
    expect(replayCommands(generateAdventureWorld(parseShareWord(word)), commands)).toEqual(replay);
    expect(exportSaveFile(restored)).toBe(file);
  });
});
