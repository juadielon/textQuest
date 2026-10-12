import { describe, expect, it } from 'vitest';
import { cosyMystery } from './cosy-mystery';
import type { ContentPack, Prose } from './format';
import { lightFantasy } from './light-fantasy';
import { scienceFiction } from './science-fiction';

const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];

// Joining words and "old" say nothing about which thing a name means.
const fillerWords = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'old', 'on', 'the', 'to', 'with']);

// Any other name word, or its simple plural, counts as a mention, so "Carved
// tide marks" describes the "Tide verse" clue and "the map" a "River map".
const mentions = (text: string, name: string) => words(name).filter((nameWord) => !fillerWords.has(nameWord))
  .some((nameWord) => words(text).some((word) => [nameWord, `${nameWord}s`, `${nameWord}es`].includes(word)));

// Lists each place description that mentions a starting item or clue, which
// the generator may move to another place.
function movableMentions(pack: ContentPack): string[] {
  const movable = [...pack.items, ...pack.clues].filter(({ placeId }) => placeId !== undefined);
  return pack.places.flatMap(({ id, description }: { id: string; description: Prose }) =>
    movable.filter((thing) => description.some((part) =>
      typeof part === 'string' ? mentions(part, thing.name) : part.id === thing.id))
      .map((thing) => `${id} mentions ${thing.name}`));
}

describe('version 1 place descriptions', () => {
  it.each([lightFantasy, cosyMystery, scienceFiction])('keep $genre places free of items and clues that can move', (pack) => {
    expect(movableMentions(pack)).toEqual([]);
  });

  it('catches a place that names or describes a movable clue', () => {
    const bridge = { id: 'bridge', name: 'Bridge', description: ['Carved tide marks line the parapet.'] };
    const tideVerse = { id: 'tide-note', placeId: 'mill', name: 'Tide verse', text: [] };
    expect(movableMentions({ ...lightFantasy, places: [bridge], items: [], clues: [tideVerse] }))
      .toEqual(['bridge mentions Tide verse']);
    expect(movableMentions({ ...lightFantasy, places: [bridge], items: [], clues: [{ ...tideVerse, placeId: undefined }] }))
      .toEqual([]);
  });

  it('catches short name words such as map and log', () => {
    const cabin = { id: 'cabin', name: 'Cabin', description: ['An old map hangs by the log book.'] };
    const map = { id: 'river-map', placeId: 'mill', name: 'Dated river map', text: [] };
    const log = { id: 'crew-log', placeId: 'mill', name: 'Crew log', text: [] };
    expect(movableMentions({ ...lightFantasy, places: [cabin], items: [], clues: [map, log] }))
      .toEqual(['cabin mentions Dated river map', 'cabin mentions Crew log']);
  });
});
