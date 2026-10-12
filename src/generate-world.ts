import { createAdventureSettings, type AdventureGenre, type AdventureSettings } from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import type { ContentPack } from './content/v1/format';
import { lightFantasy } from './content/v1/light-fantasy';
import { createSeededRandom } from './seeded-random';

const versionOnePacks: Readonly<Partial<Record<AdventureGenre, ContentPack>>> = {
  'light-fantasy': lightFantasy,
};

/**
 * The version 1 content pack the generator uses for a genre, so play can
 * show that pack's names and text. Undefined while a genre has no pack.
 */
export function versionOnePack(genre: AdventureGenre): ContentPack | undefined {
  return versionOnePacks[genre];
}

/**
 * Builds a detached world from version 1's authored light fantasy plans.
 *
 * @param settings - Valid settings whose genre matches the seed and version.
 * @returns The same world for the same settings, without changing the content pack.
 * @throws RangeError for invalid settings or a genre without a content pack.
 * @remarks Changes to these selection rules require a new adventure version.
 */
export function generateAdventureWorld(settings: AdventureSettings): AdventureWorld {
  const expected = createAdventureSettings(settings.seed, settings.length, settings.version);
  if (settings.genre !== expected.genre) {
    throw new RangeError('The genre does not match this seed and version.');
  }
  const pack = versionOnePacks[settings.genre];
  if (!pack) {
    throw new RangeError(`World generation for ${settings.genre} is not supported yet.`);
  }

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
