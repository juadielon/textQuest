import { describe, expect, it } from 'vitest';
import { createAdventureSettings } from '../../adventure-settings';
import type { AdventureWorld } from '../../adventure-world';
import { generateAdventureWorld, versionOnePack } from '../../generate-world';
import type { ContentPack } from './format';
import { cosyMystery } from './cosy-mystery';
import { lightFantasy } from './light-fantasy';
import { scienceFiction } from './science-fiction';
import { aliasesFor, worldNamesFrom } from './world-names';

// A small world using the first few entries of a pack, so any genre can be checked.
function worldFrom(pack: ContentPack): AdventureWorld {
  const places = pack.places.slice(0, 2).map(({ id }) => ({ id }));
  return {
    version: 1,
    startPlaceId: places[0].id,
    places,
    exits: [],
    items: pack.items.slice(0, 2).map(({ id }) => ({ id })),
    clues: pack.clues.slice(0, 2).map(({ id }) => ({ id })),
    solution: { steps: [], goal: { placeId: places[0].id, conditions: {} } },
  };
}

describe('aliasesFor', () => {
  it.each([
    ['Mara the miller', ['mara', 'miller']],
    ['Spare power cell', ['power cell', 'cell']],
    ['Wren, the station mind', ['wren the station mind', 'wren', 'station mind', 'mind']],
    ['The river guest', ['river guest', 'guest']],
    ['Dr Ade Okafor', ['ade okafor', 'okafor']],
    ['Echo', []],
  ])('gives shorter names for %s', (name, aliases) => {
    expect(aliasesFor(name)).toEqual(aliases);
  });
});

describe('worldNamesFrom', () => {
  it.each([lightFantasy, cosyMystery, scienceFiction])('names everything in a $genre world from its pack', (pack) => {
    const world = worldFrom(pack);
    const names = worldNamesFrom(pack, world);
    expect(names.places.map(({ id, name }) => [id, name]))
      .toEqual(pack.places.slice(0, 2).map(({ id, name }) => [id, name]));
    expect(names.items.map(({ name }) => name)).toEqual(pack.items.slice(0, 2).map(({ name }) => name));
    expect(names.clues.map(({ name }) => name)).toEqual(pack.clues.slice(0, 2).map(({ name }) => name));
    const placeIds = world.places.map(({ id }) => id);
    expect(names.people.map(({ id }) => id))
      .toEqual(pack.characters.filter(({ placeId }) => placeIds.includes(placeId)).map(({ id }) => id));
    expect(names.people.every(({ placeId }) => placeIds.includes(placeId))).toBe(true);
  });

  it('names every place, item and clue in generated worlds', () => {
    const settings = createAdventureSettings(0, 'long');
    const world = generateAdventureWorld(settings);
    const names = worldNamesFrom(versionOnePack(settings.genre), world);
    expect(names.places.map(({ id }) => id)).toEqual(world.places.map(({ id }) => id));
    expect(names.items.map(({ id }) => id)).toEqual(world.items.map(({ id }) => id));
    expect(names.clues.map(({ id }) => id)).toEqual(world.clues.map(({ id }) => id));
  });

  it('rejects a world the pack did not make, without changing either', () => {
    const world = worldFrom(lightFantasy);
    const before = structuredClone(world);
    expect(() => worldNamesFrom(scienceFiction, world)).toThrow(RangeError);
    expect(world).toEqual(before);
  });
});

describe('versionOnePack', () => {
  it.each([
    ['light-fantasy', lightFantasy],
    ['cosy-mystery', cosyMystery],
    ['science-fiction', scienceFiction],
  ] as const)('gives the generator pack for %s', (genre, pack) => {
    expect(versionOnePack(genre)).toBe(pack);
  });
});
