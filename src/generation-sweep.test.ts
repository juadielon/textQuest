import { describe, expect, it } from 'vitest';
import {
  adventureGenres, adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord,
  type AdventureGenre,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import { cosyMystery } from './content/v1/cosy-mystery';
import { lightFantasy } from './content/v1/light-fantasy';
import { scienceFiction } from './content/v1/science-fiction';
import { generateAdventureWorld } from './generate-world';
import { createSeededRandom } from './seeded-random';
import { checkWinnability } from './winnability';

// A fixed range keeps the sweep repeatable. It is large enough to reach every
// genre and plot many times while staying well inside a normal test run.
const sweepSeedCount = 1_000;

const plotCounts: Record<AdventureGenre, number> = {
  'light-fantasy': lightFantasy.plots.length,
  'cosy-mystery': cosyMystery.plots.length,
  'science-fiction': scienceFiction.plots.length,
};

// Short worlds have the fewest places to move things between, so a few seeds
// share a world. Across every seed, the least varied short group still gives
// 86% distinct worlds; medium and long give 100%.
const minimumDistinctShare = 0.8;

// Repeats the generator's second draw, so worlds can be grouped by plot.
function plotIndexFor(seed: number, genre: AdventureGenre): number {
  const random = createSeededRandom(seed);
  random.nextUint32();
  return random.pickIndex(plotCounts[genre]);
}

function withoutOptionalSteps(world: AdventureWorld): AdventureWorld {
  const requiredStepIds = world.solution.goal.conditions.stepsDone ?? [];
  return {
    ...world,
    solution: {
      ...world.solution,
      steps: world.solution.steps.filter(({ id }) => requiredStepIds.includes(id)),
    },
  };
}

describe('version 1 generation sweep', () => {
  for (const length of adventureLengths) {
    it(`${length}: every seed gives a repeatable, shareable, winnable world`, () => {
      const groups = new Map<string, { genre: AdventureGenre; seeds: number; worlds: Set<string> }>();
      const problems: string[] = [];

      for (let seed = 0; seed < sweepSeedCount; seed += 1) {
        const settings = createAdventureSettings(seed, length);
        const world = generateAdventureWorld(settings);
        const json = JSON.stringify(world);
        const key = `${settings.genre}/${plotIndexFor(seed, settings.genre)}`;
        const group = groups.get(key) ?? { genre: settings.genre, seeds: 0, worlds: new Set<string>() };
        group.seeds += 1;
        group.worlds.add(json);
        groups.set(key, group);

        if (JSON.stringify(generateAdventureWorld(settings)) !== json) {
          problems.push(`seed ${seed}: regenerated world differs`);
        }
        if (JSON.stringify(generateAdventureWorld(parseShareWord(encodeShareWord(settings)))) !== json) {
          problems.push(`seed ${seed}: share word gives a different world`);
        }
        for (const [label, checked] of [['with optional steps', world], ['without optional steps', withoutOptionalSteps(world)]] as const) {
          const result = checkWinnability(checked);
          if ('tooLarge' in result) {
            problems.push(`seed ${seed} ${label}: too large to check`);
          } else if (!result.winnable || result.unreachableStepIds.length > 0) {
            problems.push(`seed ${seed} ${label}: not winnable (${result.unreachableStepIds.join(', ')})`);
          }
        }
      }

      expect(problems).toEqual([]);
      for (const genre of adventureGenres) {
        const plots = [...groups.values()].filter((group) => group.genre === genre);
        expect(plots, genre).toHaveLength(plotCounts[genre]);
      }
      for (const [key, { seeds, worlds }] of groups) {
        // Most seeds of one genre, plot and length should give their own world.
        expect(seeds, key).toBeGreaterThan(50);
        expect(worlds.size, key).toBeGreaterThanOrEqual(Math.ceil(seeds * minimumDistinctShare));
      }
    });
  }

  it('checks that removing optional steps really removes them', () => {
    const world = generateAdventureWorld(createAdventureSettings(0, 'short'));
    const trimmed = withoutOptionalSteps(world);
    expect(trimmed.solution.steps.length).toBeLessThan(world.solution.steps.length);
    expect(trimmed.solution.steps.map(({ id }) => id)).toEqual(world.solution.goal.conditions.stepsDone);
  });
});
