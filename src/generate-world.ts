import { createAdventureSettings, type AdventureGenre, type AdventureSettings } from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import type { ContentPack, PlotStructure } from './content/v1/format';
import {
  cosyMysteryV2, lightFantasyV2, scienceFictionV2, type VersionTwoContentPack,
} from './content/v2/place-wording';
import { createSeededRandom } from './seeded-random';
import { prepareSeededPlacement } from './seeded-placement';

const versionTwoPacks: Readonly<Record<AdventureGenre, VersionTwoContentPack>> = {
  'light-fantasy': lightFantasyV2,
  'cosy-mystery': cosyMysteryV2,
  'science-fiction': scienceFictionV2,
};

/**
 * Returns the matching released content for a genre.
 */
export function adventurePack(
  versionOrGenre: number | AdventureGenre,
  genre?: AdventureGenre,
): ContentPack | VersionTwoContentPack {
  if (typeof versionOrGenre === 'number') {
    if (versionOrGenre !== 2) {
      throw new RangeError(`Adventure version ${versionOrGenre} is not supported.`);
    }
    if (!genre) throw new RangeError('Choose an adventure genre.');
    return versionTwoPacks[genre];
  }
  return versionTwoPacks[versionOrGenre];
}

/**
 * Returns the plot selected for the settings, without generating or changing
 * the adventure world.
 *
 * @param settings - Valid adventure settings.
 * @param pack - Optional matching content pack. Defaults to the released pack
 * for the settings.
 * @throws RangeError if the settings or genre mismatch are invalid.
 */
export function adventurePlot(
  settings: AdventureSettings,
  pack: ContentPack | VersionTwoContentPack = adventurePack(settings.genre),
): PlotStructure {
  const expected = createAdventureSettings(settings.seed, settings.length);
  if (settings.genre !== expected.genre) {
    throw new RangeError('The genre does not match this seed and version.');
  }
  if (pack.genre !== settings.genre) {
    throw new RangeError('The content pack does not match this adventure genre.');
  }
  const random = createSeededRandom(settings.seed);
  random.nextUint32();
  return pack.plots[random.pickIndex(pack.plots.length)];
}

/**
 * Builds a detached world from the matching adventure version's content.
 *
 * @param settings - Valid settings whose genre matches the seed and version.
 * @returns The same world for the same settings, without changing the content pack.
 * @throws RangeError for invalid settings.
 * @remarks Item then clue positions are drawn after genre and plot.
 */
export function generateAdventureWorld(settings: AdventureSettings): AdventureWorld {
  const expected = createAdventureSettings(settings.seed, settings.length);
  if (settings.genre !== expected.genre) {
    throw new RangeError('The genre does not match this seed and version.');
  }
  const pack = adventurePack(settings.genre);

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

  const world = structuredClone({
    version: 2,
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
  return prepareSeededPlacement(world, random);
}
