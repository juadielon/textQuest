import type { AdventureWorld } from '../../adventure-world';
import type { NamedThing, WorldNames } from '../../engine/play';
import type { ContentPack } from './format';

/**
 * Shorter names a player might type for a pack name. "Mara the miller" gives
 * "mara" and "miller"; "Spare power cell" gives "power cell" and "cell".
 * Commas are dropped, so "Wren, the station mind" also gives
 * "wren the station mind". The result never includes the name itself.
 */
export function aliasesFor(name: string): string[] {
  const full = name.toLowerCase().replace(/,/g, ' ').trim().replace(/\s+/g, ' ');
  const aliases = new Set<string>([full]);
  for (const part of full.split(/\bthe\b/)) {
    const words = part.trim().split(' ').filter(Boolean);
    for (let index = 0; index < words.length; index++) aliases.add(words.slice(index).join(' '));
  }
  aliases.delete(name.toLowerCase().trim().replace(/\s+/g, ' '));
  return [...aliases];
}

/**
 * Looks up the pack names for everything in a world made from that pack, so
 * play can show and accept them. People are included when their place is in
 * the world. Neither argument is changed.
 *
 * @throws RangeError when the world has a place, item or clue the pack lacks.
 */
export function worldNamesFrom(pack: ContentPack, world: AdventureWorld): WorldNames {
  const named = (kind: 'place' | 'item' | 'clue', entries: readonly { readonly id: string; readonly name: string }[]) =>
    world[`${kind}s`].map(({ id }): NamedThing => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) throw new RangeError(`The ${pack.genre} pack has no ${kind} "${id}".`);
      return { id, name: entry.name, aliases: aliasesFor(entry.name) };
    });
  const placeIds = new Set(world.places.map(({ id }) => id));
  return {
    places: named('place', pack.places),
    items: named('item', pack.items),
    clues: named('clue', pack.clues),
    people: pack.characters.filter(({ placeId }) => placeIds.has(placeId))
      .map(({ id, name, placeId }) => ({ id, name, placeId, aliases: aliasesFor(name) })),
  };
}
