import { createAdventureSettings, type AdventureGenre, type AdventureSettings } from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import type { ContentPack } from './content/v1/format';
import { cosyMystery } from './content/v1/cosy-mystery';
import { lightFantasy } from './content/v1/light-fantasy';
import { scienceFiction } from './content/v1/science-fiction';
import { createSeededRandom } from './seeded-random';

// A full record makes the compiler reject a version 1 genre without a pack.
const versionOnePacks: Readonly<Record<AdventureGenre, ContentPack>> = {
  'light-fantasy': lightFantasy,
  'cosy-mystery': cosyMystery,
  'science-fiction': scienceFiction,
};

/**
 * Builds a detached world from the version 1 content pack for the seed's genre.
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

  return structuredClone({
    version: 1,
    startPlaceId: pack.startPlaceId,
    places: pack.places.filter(({ id }) => plan.placeIds.includes(id)).map(({ id }) => ({ id })),
    exits: pack.exits.filter(({ fromPlaceId, toPlaceId }) =>
      plan.placeIds.includes(fromPlaceId) && plan.placeIds.includes(toPlaceId)),
    items: pack.items.filter(({ placeId }) => placeId === undefined || plan.placeIds.includes(placeId))
      .map(({ id, placeId }) => placeId === undefined ? { id } : { id, placeId }),
    clues: pack.clues.filter(({ placeId }) => placeId === undefined || plan.placeIds.includes(placeId))
      .map(({ id, placeId }) => placeId === undefined ? { id } : { id, placeId }),
    solution: {
      steps: pack.solution.steps.filter(({ id }) => selectedSteps.includes(id)).map((step) => ({
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
