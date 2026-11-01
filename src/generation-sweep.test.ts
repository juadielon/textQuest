import { describe, expect, it } from 'vitest';
import {
  adventureGenres, adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord,
  type AdventureGenre,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import { cosyMystery } from './content/v1/cosy-mystery';
import { lightFantasy } from './content/v1/light-fantasy';
import { scienceFiction } from './content/v1/science-fiction';
import { adventurePack, generateAdventureWorld } from './generate-world';
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

function recordSeedExceptions(seed: number, problems: string[], check: () => void): void {
  try {
    check();
  } catch (error) {
    problems.push(`seed ${seed}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

describe.each([1, 2])('version %i generation sweep', (version) => {
  for (const length of adventureLengths) {
    // Checking every seed takes a few seconds, so a busy machine can push it past
    // Vitest's 5-second default. Give it more room.
    it(`${length}: every seed gives a repeatable, shareable, winnable world`, () => {
      const worldsByGenre = new Map<AdventureGenre, Set<string>>(
        adventureGenres.map((genre) => [genre, new Set<string>()]),
      );
      const problems: string[] = [];
      const groups = new Map<string, { seeds: number; worlds: Set<string> }>();

      for (let seed = 0; seed < sweepSeedCount; seed += 1) {
        recordSeedExceptions(seed, problems, () => {
          const settings = createAdventureSettings(seed, length, version);
          const world = generateAdventureWorld(settings);
          const json = JSON.stringify(world);
          worldsByGenre.get(settings.genre)!.add(json);
          const random = createSeededRandom(seed);
          random.nextUint32();
          const plot = random.pickIndex(adventurePack(version, settings.genre).plots.length);
          const key = `${settings.genre}/${plot}`;
          const group = groups.get(key) ?? { seeds: 0, worlds: new Set<string>() };
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
        });
      }

      expect(problems).toEqual([]);
      for (const genre of adventureGenres) {
        // Each plot gives exactly one world per genre and length, so the
        // count of distinct worlds shows every plot was reached.
        if (version === 1) expect(worldsByGenre.get(genre)!.size, genre).toBe(plotCounts[genre]);
      }
      expect(groups.size).toBe(9);
      for (const [key, { seeds, worlds }] of groups) {
        expect(seeds, key).toBeGreaterThan(50);
        if (version === 1) expect(worlds.size, key).toBe(1);
        if (version === 2) expect(worlds.size, key).toBeGreaterThanOrEqual(Math.ceil(seeds * 0.8));
      }
    }, 30_000);
  }

  it('records the seed and original exception while continuing the sweep', () => {
    const problems: string[] = [];
    const error = new Error('test failure');
    const otherError: unknown = 'plain failure';
    let checkedNext = false;

    recordSeedExceptions(42, problems, () => { throw error; });
    recordSeedExceptions(43, problems, () => { throw otherError; });
    recordSeedExceptions(44, problems, () => { checkedNext = true; });

    expect(problems).toEqual([
      `seed 42: ${error.stack ?? error.message}`,
      'seed 43: plain failure',
    ]);
    expect(checkedNext).toBe(true);
  });

  it('checks that removing optional steps really removes them', () => {
    const world = generateAdventureWorld(createAdventureSettings(0, 'short', version));
    const trimmed = withoutOptionalSteps(world);
    expect(trimmed.solution.steps.length).toBeLessThan(world.solution.steps.length);
    expect(trimmed.solution.steps.map(({ id }) => id)).toEqual(world.solution.goal.conditions.stepsDone);
  });
});
