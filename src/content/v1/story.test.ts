// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createAdventureSettings } from '../../adventure-settings';
import { startPlay } from '../../engine/play';
import { adventurePlot, generateAdventureWorld } from '../../generate-world';
import { lightFantasy } from './light-fantasy';
import { cosyMystery } from './cosy-mystery';
import { matchingEnding, puzzleCompletions, resolveProse, storyView } from './story';

describe('adventure story', () => {
  it('selects the same plot from settings and renders its prose with names', () => {
    const settings = createAdventureSettings(0, 'short', 1);
    const world = generateAdventureWorld(settings);
    const plot = adventurePlot(settings, lightFantasy);
    const view = storyView(lightFantasy, settings, startPlay(world));

    expect(plot).toBe(lightFantasy.plots.find((candidate) => candidate.id === plot.id));
    expect(view.title).toBe(plot.name);
    expect(view.objective).not.toBe(plot.name);
    expect(view.introduction).toBe(resolveProse(lightFantasy, plot.introduction));
    expect(view.introduction).not.toContain('{');
  });

  it('uses the last matching authored ending for the completed plot', () => {
    const settings = createAdventureSettings(0, 'short', 1);
    const plot = adventurePlot(settings, lightFantasy);
    const state = {
      itemsHeld: [] as string[],
      placesVisited: [] as string[],
      stepsDone: [] as string[],
      cluesRevealed: [] as string[],
    };

    const ending = matchingEnding(lightFantasy, plot, state);
    expect(ending).toBeDefined();
    expect(plot.endingIds).toContain(ending?.id);
    expect(state.stepsDone).not.toContain('offer-token');
  });

  it('adds no ending before the goal is reached', () => {
    const settings = createAdventureSettings(0, 'short', 1);
    const world = generateAdventureWorld(settings);
    const view = storyView(lightFantasy, settings, startPlay(world));

    expect(view.ending).toBeUndefined();
  });

  it('shows only newly completed authored puzzle text', () => {
    const before = {
      itemsHeld: [] as string[],
      placesVisited: [] as string[],
      stepsDone: [] as string[],
      cluesRevealed: [] as string[],
    };
    const after = { ...before, stepsDone: ['calm-baker'] };

    expect(puzzleCompletions(cosyMystery, before, after)).toEqual([
      'You return Spare apron; she remembers a bicycle bell outside the hall at dusk.',
    ]);
  });
});
