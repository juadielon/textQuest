import type { ContentPack } from '../v1/format';
import { cosyMystery } from '../v1/cosy-mystery';
import { lightFantasy } from '../v1/light-fantasy';
import { scienceFiction } from '../v1/science-fiction';

/** Released version 2 content; its complete data and order are pinned separately. */
export type VersionTwoContentPack = Omit<ContentPack, 'version'> & { readonly version: 2 };

// Reuses the released data and rewrites only the place descriptions (and any
// prompt) that named a starting item or clue the generator can now move.
function reword(
  pack: ContentPack,
  descriptions: Readonly<Record<string, string>>,
  prompts: Readonly<Record<string, string>> = {},
): VersionTwoContentPack {
  return {
    ...pack,
    version: 2,
    places: pack.places.map((place) => place.id in descriptions
      ? { ...place, description: [descriptions[place.id]] } : place),
    puzzles: pack.puzzles.map((puzzle) => puzzle.id in prompts
      ? { ...puzzle, prompt: [prompts[puzzle.id]] } : puzzle),
  };
}

/** Light fantasy with place descriptions that stay true when starting items and clues move. */
export const lightFantasyV2 = reword(lightFantasy, {
  mill: 'A narrow channel rushes beneath the mill floor.',
  bridge: 'Moss softens the old stone parapet.',
  orchard: 'Pale blossom hangs above a table for visitors.',
  quay: 'Lanterns hang above the mooring steps.',
  boathouse: 'Oars and coiled ropes cover the inner wall.',
  'reed-bank': 'Tall rushes bend beside a shallow crossing.',
  'herb-garden': 'Thyme and mint spill over low stone beds.',
  archive: 'Tall shelves stand well above the waterline.',
  'map-room': 'Rolled charts crowd a wide drafting table.',
  forge: 'A cold anvil stands beside a workbench.',
  'echo-pool': 'Still water reflects the cave roof.',
  observatory: 'A brass dial rests beneath a sliding roof.',
  'star-terrace': 'A low stone wall frames the northern sky.',
  beacon: 'A sheltered lantern faces the valley below.',
}, { 'align-mirrors': 'Arrange the mirrors to follow the sun labels.' });

/** Cosy mystery with place descriptions that stay true when starting items and clues move. */
export const cosyMysteryV2 = reword(cosyMystery, {
  'post-office': 'Pigeonholes and a brass scale line the counter.',
  library: 'Shelves of mysteries lean towards a tidy front desk.',
  'church-hall': 'A glass display case stands beside stacked folding chairs.',
  'fete-tent': 'Striped canvas shelters the judging tables and prize ribbons.',
  pavilion: 'Cricket bats and old pads share a long bench.',
  allotments: 'Neat vegetable beds run between grassy paths.',
  'potting-shed': 'Clay pots sit stacked beside a watering can.',
  station: 'Hanging baskets brighten the single platform.',
  'antique-shop': 'Old lamps glow among teapots and picture frames.',
  'clock-workshop': 'Tiny tools lie in rows on a cluttered bench.',
  lodge: 'A row of coat hooks hangs by the door.',
  'manor-garden': 'Clipped box hedges line a sunny lawn.',
  conservatory: 'Ferns and potted palms fill the warm glass room.',
});

/** Science fiction with place descriptions that stay true when starting items and clues move. */
export const scienceFictionV2 = reword(scienceFiction, {
  'med-bay': 'Clean bunks line a quiet, white room.',
  'comms-deck': 'Speakers hiss with faint static from deep space.',
  'airlock-hall': 'Suits hang in lockers beside the outer door.',
  'shuttle-hangar': 'A small shuttle waits on polished rails.',
  'engine-room': 'Thick pipes run along the walls in coloured bands.',
  'tool-locker': 'Labelled drawers hold bolts, wire and clamps.',
  'solar-gallery': 'Wide windows look out over folded solar wings.',
  'sensor-lab': 'Screens glow with numbers from the hull.',
  'records-vault': 'Rows of quiet storage drives blink in the dark.',
  'chart-room': 'A glowing table tracks the orbit of the station.',
  'fabricator-bay': 'A parts printer whirrs beside a stack of empty trays.',
  'parts-store': 'Sealed bins line the walls from floor to ceiling.',
  'reactor-core': 'A shielded reactor glows behind thick glass.',
  'view-gallery': 'A long window frames the slowly turning stars.',
  'captain-cabin': 'Mission photos cover a small, tidy desk.',
});
