import { createAdventureSettings, type AdventureGenre, type AdventureSettings } from './adventure-settings';
import type { AdventureWorld, Clue, Conditions, Exit, Item } from './adventure-world';
import type { ContentPack } from './content/v1/format';
import { cosyMystery } from './content/v1/cosy-mystery';
import { lightFantasy } from './content/v1/light-fantasy';
import { scienceFiction } from './content/v1/science-fiction';
import { createSeededRandom, type SeededRandom } from './seeded-random';

// A full record makes the compiler reject a version 1 genre without a pack.
const versionOnePacks: Readonly<Record<AdventureGenre, ContentPack>> = {
  'light-fantasy': lightFantasy,
  'cosy-mystery': cosyMystery,
  'science-fiction': scienceFiction,
};

// How many open exits the player must take from the start to reach each place.
function stepsFromStart(startPlaceId: string, exits: readonly Exit[]): Map<string, number> {
  const distances = new Map([[startPlaceId, 0]]);
  for (const [placeId, distance] of distances) {
    for (const exit of exits) {
      if (!exit.locked && exit.fromPlaceId === placeId && !distances.has(exit.toPlaceId)) {
        distances.set(exit.toPlaceId, distance + 1);
      }
    }
  }
  return distances;
}

// Moves each starting item or clue to a place the player can walk to from the
// start without unlocking anything, and no further away than where it's first
// needed. Things nothing needs, or that start unplaced, stay as authored.
function scatter(
  entries: readonly (Item | Clue)[], neededBy: readonly { placeId: string; ids: readonly string[] }[],
  placeIds: readonly string[], distances: ReadonlyMap<string, number>, random: SeededRandom,
): (Item | Clue)[] {
  return entries.map(({ id, placeId }) => {
    if (placeId === undefined) return { id };
    const nearest = Math.min(...neededBy.filter(({ ids }) => ids.includes(id))
      .map(({ placeId: needAt }) => distances.get(needAt) ?? Infinity));
    if (nearest === Infinity) return { id, placeId };
    const spots = placeIds.filter((spot) => (distances.get(spot) ?? Infinity) <= nearest);
    return { id, placeId: spots[random.pickIndex(spots.length)] };
  });
}

/**
 * Builds a detached world from the version 1 content pack for the seed's genre.
 *
 * The first seeded draw chose the genre and the second picks the plot. Later
 * draws move each starting item and clue to a reachable place no further from
 * the start than where it's first needed, so most seeds give a different world.
 *
 * @param settings - Valid settings whose genre matches the seed and version.
 * @returns The same world for the same settings, without changing the content pack.
 * @throws RangeError for invalid settings.
 * @remarks Changes to these selection rules require a new adventure version.
 */
export function generateAdventureWorld(settings: AdventureSettings): AdventureWorld {
  const expected = createAdventureSettings(settings.seed, settings.length, settings.version);
  if (settings.genre !== expected.genre) {
    throw new RangeError('The genre does not match this seed and version.');
  }
  const pack = versionOnePacks[settings.genre];

  const random = createSeededRandom(settings.seed);
  // The first draw chose the genre; the next chooses the plot independently.
  random.nextUint32();
  const plot = pack.plots[random.pickIndex(pack.plots.length)];
  const plan = plot.lengths[settings.length];
  const selectedSteps = [
    ...plan.requiredStepIds,
    ...pack.optionalDiscoveries
      .filter(({ placeId }) => plan.placeIds.includes(placeId))
      .map(({ id }) => id),
  ];
  const exits = pack.exits.filter(({ fromPlaceId, toPlaceId }) =>
    plan.placeIds.includes(fromPlaceId) && plan.placeIds.includes(toPlaceId));
  const steps = pack.solution.steps.filter(({ id }) => selectedSteps.includes(id));
  const needs = (pick: (conditions: Conditions) => readonly string[] | undefined) =>
    [...steps, pack.solution.goal].map(({ placeId, conditions }) => ({ placeId, ids: pick(conditions) ?? [] }));
  const distances = stepsFromStart(pack.startPlaceId, exits);
  const inPlan = ({ placeId }: Item | Clue) => placeId === undefined || plan.placeIds.includes(placeId);

  return structuredClone({
    version: 1,
    startPlaceId: pack.startPlaceId,
    places: pack.places.filter(({ id }) => plan.placeIds.includes(id)).map(({ id }) => ({ id })),
    exits,
    items: scatter(pack.items.filter(inPlan), needs(({ itemsHeld }) => itemsHeld), plan.placeIds, distances, random),
    clues: scatter(pack.clues.filter(inPlan), needs(({ cluesRevealed }) => cluesRevealed), plan.placeIds, distances, random),
    solution: {
      steps: steps.map((step) => ({
        ...step,
        conditions: {
          ...step.conditions,
          stepsDone: [...step.conditions.stepsDone ?? [], ...plot.dependencies[step.id] ?? []],
        },
      })),
      goal: {
        ...pack.solution.goal,
        conditions: {
          ...pack.solution.goal.conditions,
          stepsDone: [...pack.solution.goal.conditions.stepsDone ?? [], ...plan.requiredStepIds],
        },
      },
    },
  } satisfies AdventureWorld);
}
