import { describe, expect, it } from 'vitest';
import { cosyMystery } from '../v1/cosy-mystery';
import type { ContentPack, Prose } from '../v1/format';
import { lightFantasy } from '../v1/light-fantasy';
import { scienceFiction } from '../v1/science-fiction';
import { cosyMysteryV2, lightFantasyV2, scienceFictionV2 } from './place-wording';

const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];

// Joining words and "old" say nothing about which thing a name means.
const fillerWords = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'old', 'on', 'the', 'to', 'with']);

// Any other name word, or its simple plural, counts as a mention, so "Carved
// tide marks" describes the "Tide verse" clue and "the map" a "River map".
const mentions = (text: string, name: string) => words(name).filter((nameWord) => !fillerWords.has(nameWord))
  .some((nameWord) => words(text).some((word) => [nameWord, `${nameWord}s`, `${nameWord}es`].includes(word)));

// Lists each place description that mentions a starting item or clue, which
// the generator may move to another place.
function movableMentions(pack: Pick<ContentPack, 'places' | 'items' | 'clues'>): string[] {
  const movable = [
    ...pack.items.map((thing) => ({ ...thing, kind: 'item' })),
    ...pack.clues.map((thing) => ({ ...thing, kind: 'clue' })),
  ].filter(({ placeId }) => placeId !== undefined);
  return pack.places.flatMap(({ id, description }: { id: string; description: Prose }) =>
    movable.filter((thing) => description.some((part) =>
      typeof part === 'string' ? mentions(part, thing.name) : part.kind === thing.kind && part.id === thing.id))
      .map((thing) => `${id} mentions ${thing.name}`));
}

const pairs = [[lightFantasy, lightFantasyV2], [cosyMystery, cosyMysteryV2], [scienceFiction, scienceFictionV2]] as const;

describe('version 2 place descriptions', () => {
  it.each(pairs)('keep $genre places free of items and clues that can move', (_v1, pack) => {
    expect(movableMentions(pack)).toEqual([]);
  });

  it.each(pairs)('change only place descriptions and prompts for $genre', (v1, v2) => {
    const { places: oldPlaces, puzzles: oldPuzzles, version: oldVersion, ...rest } = v1;
    const { places, puzzles, version, ...newRest } = v2;
    expect([oldVersion, version]).toEqual([1, 2]);
    expect(newRest).toEqual(rest);
    expect(places.map(({ id, name }) => [id, name])).toEqual(oldPlaces.map(({ id, name }) => [id, name]));
    expect(puzzles.map(({ id, placeId, family, completion }) => [id, placeId, family, completion]))
      .toEqual(oldPuzzles.map(({ id, placeId, family, completion }) => [id, placeId, family, completion]));
  });

  it('moves the align-mirrors prompt off the garden while version 1 keeps it', () => {
    const prompt = (pack: typeof lightFantasy) => pack.puzzles.find(({ id }) => id === 'align-mirrors')?.prompt;
    expect(prompt(lightFantasy)).toEqual(['Arrange the mirrors to follow the garden labels.']);
    expect(prompt(lightFantasyV2 as unknown as typeof lightFantasy)).toEqual(['Arrange the mirrors to follow the sun labels.']);
  });

  it('leaves released version 1 wording alone', () => {
    expect(movableMentions(lightFantasy)).toContain('bridge mentions Tide verse');
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

  it('catches an exact name made only of short words', () => {
    const shed = { id: 'shed', name: 'Shed', description: ['An ash peg rests here.'] };
    const peg = { id: 'peg', placeId: 'well', name: 'Ash peg', description: [] };
    expect(movableMentions({ ...lightFantasy, places: [shed], items: [peg], clues: [] }))
      .toEqual(['shed mentions Ash peg']);
  });

  it('compares the kind of a typed reference as well as its id', () => {
    const refs: Prose = [{ kind: 'character', id: 'peg' }, { kind: 'item', id: 'peg' }];
    const hut = { id: 'hut', name: 'Hut', description: refs };
    const peg = { id: 'peg', placeId: 'well', name: 'Qux', description: [] };
    expect(movableMentions({ ...lightFantasy, places: [hut], items: [peg], clues: [] })).toEqual(['hut mentions Qux']);
    expect(movableMentions({ ...lightFantasy, places: [{ ...hut, description: [refs[0]] }], items: [peg], clues: [] }))
      .toEqual([]);
  });
});
