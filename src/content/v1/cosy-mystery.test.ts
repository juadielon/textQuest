import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AdventureWorld, Conditions } from '../../adventure-world';
import { checkWinnability } from '../../winnability';
import type { ContentPack, EntityReference, LengthPlan, PlotStructure, Prose } from './format';
import { cosyMystery } from './cosy-mystery';

const pack: ContentPack = cosyMystery;
const steps = [...pack.puzzles, ...pack.optionalDiscoveries];
const ids = {
  place: pack.places.map(({ id }) => id),
  character: pack.characters.map(({ id }) => id),
  item: pack.items.map(({ id }) => id),
  clue: pack.clues.map(({ id }) => id),
  step: steps.map(({ id }) => id),
};

function checkProse(prose: Prose) {
  expect(prose.length).toBeGreaterThan(0);
  expect(prose.some((part) => typeof part === 'string' && part.trim().length > 0)).toBe(true);
  for (const part of prose) {
    if (typeof part === 'string') {
      expect(part.trim()).not.toBe('');
      expect(part).not.toMatch(/\{[^}]+\}/);
    } else {
      expect(ids[part.kind]).toContain(part.id);
    }
  }
}

function checkConditions(conditions: Conditions) {
  for (const id of conditions.itemsHeld ?? []) expect(ids.item).toContain(id);
  for (const id of conditions.placesVisited ?? []) expect(ids.place).toContain(id);
  for (const id of conditions.stepsDone ?? []) expect(ids.step).toContain(id);
  for (const id of conditions.cluesRevealed ?? []) expect(ids.clue).toContain(id);
}

// This fixture adapter checks the documented contract, not seed generation.
function worldFor(plot: PlotStructure, plan: LengthPlan): AdventureWorld {
  const selectedSteps = [...plan.requiredStepIds, ...pack.optionalDiscoveries.map(({ id }) => id)];
  return {
    version: 1,
    startPlaceId: pack.startPlaceId,
    places: pack.places.filter(({ id }) => plan.placeIds.includes(id)),
    exits: pack.exits.filter(({ fromPlaceId, toPlaceId }) =>
      plan.placeIds.includes(fromPlaceId) && plan.placeIds.includes(toPlaceId)),
    items: pack.items.filter(({ placeId }) => !placeId || plan.placeIds.includes(placeId)),
    clues: pack.clues.filter(({ placeId }) => !placeId || plan.placeIds.includes(placeId)),
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
        conditions: { ...pack.solution.goal.conditions, stepsDone: plan.requiredStepIds },
      },
    },
  };
}

describe('version 1 cosy mystery content', () => {
  it('allows prose references only to entities with display names', () => {
    expectTypeOf<EntityReference['kind']>().toEqualTypeOf<'place' | 'character' | 'item' | 'clue'>();
  });

  it('has unique, non-empty IDs and named entities', () => {
    const allIds = [
      ...Object.values(ids).flat(), ...pack.exits.map(({ id }) => id),
      ...pack.plots.map(({ id }) => id), ...pack.endings.map(({ id }) => id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const id of allIds) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    for (const entity of [...pack.places, ...pack.characters, ...pack.items, ...pack.clues, ...pack.plots]) {
      expect(entity.name.trim()).not.toBe('');
    }
    expect(pack.version).toBe(1);
    expect(pack.genre).toBe('cosy-mystery');
  });

  it('resolves every prose reference and has no empty text', () => {
    for (const entity of [...pack.places, ...pack.characters, ...pack.items]) checkProse(entity.description);
    for (const character of pack.characters) checkProse(character.motive);
    for (const clue of pack.clues) checkProse(clue.text);
    for (const step of steps) {
      checkProse(step.prompt);
      checkProse(step.completion);
    }
    for (const plot of pack.plots) checkProse(plot.introduction);
    for (const ending of pack.endings) checkProse(ending.text);
  });

  it('resolves placements, dependencies, conditions and effects', () => {
    expect(ids.place).toContain(pack.startPlaceId);
    expect(ids.place).toContain(pack.solution.goal.placeId);
    checkConditions(pack.solution.goal.conditions);
    for (const entity of [...pack.characters, ...pack.items, ...pack.clues, ...steps]) {
      if (entity.placeId !== undefined) expect(ids.place).toContain(entity.placeId);
    }
    for (const exit of pack.exits) {
      expect(ids.place).toContain(exit.fromPlaceId);
      expect(ids.place).toContain(exit.toPlaceId);
    }
    expect(pack.solution.steps.map(({ id }) => id).sort()).toEqual([...ids.step].sort());
    for (const step of pack.solution.steps) {
      expect(step.placeId).toBe(steps.find(({ id }) => id === step.id)?.placeId);
      checkConditions(step.conditions);
      for (const effect of step.effects) {
        if (effect.kind === 'unlock-exit') expect(pack.exits.map(({ id }) => id)).toContain(effect.exitId);
        else if (effect.kind === 'give-item') expect(ids.item).toContain(effect.itemId);
        else expect(ids.clue).toContain(effect.clueId);
      }
    }
    for (const ending of pack.endings) checkConditions(ending.conditions);
    for (const plot of pack.plots) {
      expect(Object.keys(plot.dependencies).sort()).toEqual(pack.puzzles.map(({ id }) => id).sort());
      for (const [id, dependencies] of Object.entries(plot.dependencies)) {
        expect(ids.step).toContain(id);
        for (const dependency of dependencies) expect(ids.step).toContain(dependency);
      }
      for (const id of plot.endingIds) expect(pack.endings.map(({ id }) => id)).toContain(id);
    }
  });

  it('provides several genuinely different dependency graphs', () => {
    expect(pack.plots.length).toBeGreaterThanOrEqual(3);
    for (const length of ['short', 'medium', 'long'] as const) {
      const graphs = pack.plots.map((plot) =>
        JSON.stringify(plot.lengths[length].requiredStepIds.map((id) => plot.dependencies[id])));
      expect(new Set(graphs).size).toBe(pack.plots.length);
    }
  });

  for (const plot of pack.plots) {
    for (const [length, placeRange, stepRange] of [
      ['short', [6, 8], [3, 4]],
      ['medium', [12, 16], [6, 8]],
      ['long', [20, 28], [10, 14]],
    ] as const) {
      it(`${plot.id}: ${length} has the required size, families and a winnable world`, () => {
        const plan = plot.lengths[length];
        expect(new Set(plan.placeIds).size).toBe(plan.placeIds.length);
        expect(new Set(plan.requiredStepIds).size).toBe(plan.requiredStepIds.length);
        expect(plan.placeIds.length).toBeGreaterThanOrEqual(placeRange[0]);
        expect(plan.placeIds.length).toBeLessThanOrEqual(placeRange[1]);
        expect(plan.requiredStepIds.length).toBeGreaterThanOrEqual(stepRange[0]);
        expect(plan.requiredStepIds.length).toBeLessThanOrEqual(stepRange[1]);
        for (const id of plan.placeIds) expect(ids.place).toContain(id);
        const selected = pack.puzzles.filter(({ id }) => plan.requiredStepIds.includes(id));
        expect(selected.length).toBe(plan.requiredStepIds.length);
        expect(new Set(selected.map(({ family }) => family)).size).toBeGreaterThanOrEqual(3);
        for (const id of plan.requiredStepIds) {
          for (const dependency of plot.dependencies[id]) expect(plan.requiredStepIds).toContain(dependency);
        }
        const world = worldFor(plot, plan);
        const included = {
          ...ids,
          place: plan.placeIds,
          character: pack.characters.filter(({ placeId }) => plan.placeIds.includes(placeId)).map(({ id }) => id),
          item: world.items.map(({ id }) => id),
          clue: world.clues.map(({ id }) => id),
          step: world.solution.steps.map(({ id }) => id),
        };
        const prose = [
          plot.introduction,
          ...pack.places.filter(({ id }) => plan.placeIds.includes(id)).map(({ description }) => description),
          ...pack.characters.filter(({ id }) => included.character.includes(id)).flatMap(({ description, motive }) => [description, motive]),
          ...pack.items.filter(({ id }) => included.item.includes(id)).map(({ description }) => description),
          ...pack.clues.filter(({ id }) => included.clue.includes(id)).map(({ text }) => text),
          ...[...selected, ...pack.optionalDiscoveries].flatMap(({ prompt, completion }) => [prompt, completion]),
          ...pack.endings.filter(({ id }) => plot.endingIds.includes(id)).map(({ text }) => text),
        ];
        for (const text of prose) {
          for (const part of text) if (typeof part !== 'string') expect(included[part.kind]).toContain(part.id);
        }
        expect(checkWinnability(world)).toEqual({ winnable: true, unreachableStepIds: [] });
        expect(checkWinnability({
          ...world,
          solution: { ...world.solution, steps: world.solution.steps.filter(({ id }) => plan.requiredStepIds.includes(id)) },
        })).toEqual({ winnable: true, unreachableStepIds: [] });
        for (const id of plot.endingIds) {
          const ending = pack.endings.find((entry) => entry.id === id)!;
          const allowedSteps = [...plan.requiredStepIds, 'hear-gossip', ...ending.conditions.stepsDone ?? []];
          expect(checkWinnability({
            ...world,
            solution: {
              ...world.solution,
              steps: world.solution.steps.filter(({ id }) => allowedSteps.includes(id)),
              goal: { ...world.solution.goal, conditions: { ...ending.conditions, stepsDone: [...plan.requiredStepIds, ...ending.conditions.stepsDone ?? []] } },
            },
          })).toEqual({ winnable: true, unreachableStepIds: [] });
        }
      });
    }
  }

  it('contains optional discoveries, route choices and consequence endings', () => {
    expect(pack.optionalDiscoveries.map(({ choice }) => choice)).toEqual(['discovery', 'peaceful', 'non-graphic-force']);
    for (const choice of pack.optionalDiscoveries.filter(({ choice }) => choice !== 'discovery')) {
      const solution = pack.solution.steps.find(({ id }) => id === choice.id)!;
      expect(solution.effects.some((effect) => effect.kind === 'unlock-exit'
        && pack.exits.some((exit) => exit.id === effect.exitId && exit.locked))).toBe(true);
      for (const plot of pack.plots) {
        expect(pack.endings.some((ending) => plot.endingIds.includes(ending.id)
          && ending.conditions.stepsDone?.includes(choice.id))).toBe(true);
      }
    }
    for (const plot of pack.plots) {
      const endings = plot.endingIds.map((id) => pack.endings.find((ending) => ending.id === id)!);
      expect(endings.map(({ conditions }) => conditions.stepsDone ?? [])).toEqual([
        [], ['ask-permission'], ['push-cart'],
      ]);
    }
  });

  it('keeps a cosy tone with no violent or grisly words', () => {
    const text: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') text.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(pack);
    for (const entry of text) {
      expect(entry).not.toMatch(/\b(?:blood\w*|kill\w*|murder\w*|dead|death|corpse|body|weapon\w*|knife|knives|gun\w*|stab\w*|poison\w*|attack\w*|wound\w*|injur\w*|fight\w*|punch\w*)\b/i);
    }
  });

  it('pins the complete released content, including array order', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(pack)));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('7f1074da3a3dc3309b50b17e9deae5babf083b7e9de77147192b6c68ce9760b3');
  });
});
