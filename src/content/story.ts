import type { AdventureSettings } from '../adventure-settings';
import type { Conditions } from '../adventure-world';
import type { PlayState } from '../engine/play';
import { adventurePlot } from '../generate-world';
import type { ContentPack, ContentEnding, PlotStructure, Prose } from './format';
import type { ContentPackWithWording } from './place-wording';

/** The story information the play screen can show for an adventure. */
export interface StoryView {
  /** The plot title. */
  readonly title: string;
  /** The readable opening that explains what is wrong. */
  readonly introduction: string;
  /** The player's clear objective. */
  readonly objective: string;
  /** The matching authored ending after the goal is reached. */
  readonly ending?: string;
}

/** State fields used to choose the last matching authored ending. */
export interface StoryState {
  readonly itemsHeld: readonly string[];
  readonly placesVisited: readonly string[];
  readonly stepsDone: readonly string[];
  readonly cluesRevealed: readonly string[];
}

/**
 * Returns authored completion text for puzzle steps newly completed by a turn.
 *
 * @param pack - Matching content pack.
 * @param before - State before the turn.
 * @param after - State after the turn.
 * @returns Newly completed puzzle text in pack order.
 */
export function puzzleCompletions(
  pack: ContentPack | ContentPackWithWording,
  before: StoryState,
  after: StoryState,
): readonly string[] {
  const previous = new Set(before.stepsDone);
  return [...pack.puzzles, ...pack.optionalDiscoveries]
    .filter((puzzle) => after.stepsDone.includes(puzzle.id) && !previous.has(puzzle.id))
    .map((puzzle) => resolveProse(pack, puzzle.completion));
}

/**
 * Resolves authored prose into one plain, accessible string.
 *
 * @param pack - Content pack that owns the entity names and prose.
 * @param prose - Literal text and entity references.
 * @throws RangeError if a reference names an entity absent from the pack.
 */
export function resolveProse(pack: ContentPack | ContentPackWithWording, prose: Prose): string {
  const nameOf = (kind: 'place' | 'character' | 'item' | 'clue', id: string): string => {
    const entries = kind === 'place' ? pack.places
      : kind === 'character' ? pack.characters
        : kind === 'item' ? pack.items : pack.clues;
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) throw new RangeError(`The ${pack.genre} pack has no ${kind} "${id}".`);
    return entry.name;
  };
  return prose.map((part) => typeof part === 'string' ? part : nameOf(part.kind, part.id)).join('');
}

/**
 * Returns the story information selected for these settings.
 *
 * @param pack - Matching content pack.
 * @param settings - Adventure settings that select the plot.
 * @param state - Optional play state used to select an authored ending.
 * @throws RangeError if the settings or story references are invalid.
 */
export function storyView(
  pack: ContentPack | ContentPackWithWording,
  settings: AdventureSettings,
  state?: PlayState | StoryState,
): StoryView {
  const plot = adventurePlot(settings, pack);
  const ending = state && 'goalReached' in state && state.goalReached
    ? matchingEnding(pack, plot, state)
    : undefined;
  return {
    title: plot.name,
    introduction: resolveProse(pack, plot.introduction),
    objective: objectiveFor(plot.id),
    ...(ending ? { ending: resolveProse(pack, ending.text) } : {}),
  };
}

function objectiveFor(plotId: string): string {
  switch (plotId) {
    case 'teapot-trail':
      return 'Find who borrowed the Silver Teapot and return it before judging.';
    case 'every-side':
      return 'Compare every account and identify why the teapot moved.';
    case 'two-threads':
      return 'Join the teapot clues with the muddled delivery and explain both.';
    case 'warning-chain':
      return 'Restore each valley warning station and light the beacon.';
    case 'missing-keeper':
      return 'Find the keeper by matching both evidence trails.';
    case 'renew-pact':
      return 'Gather proof of goodwill and renew the valley pact.';
    case 'overdue-ship':
      return 'Repair the station, trace the ship and guide it home.';
    case 'quiet-station':
      return 'Restore each station system and wake the crew safely.';
    case 'station-charter':
      return 'Prove the crew keeps the charter and restore the station.';
    default:
      return 'Complete the required clues and reach the agreed goal.';
  }
}

/**
 * Finds the last authored ending for a plot whose conditions match the state.
 *
 * @param pack - Content pack containing the ending text.
 * @param plot - Selected plot that names the available endings.
 * @param state - Player state to test.
 * @returns The matching ending, or undefined if none matches.
 */
export function matchingEnding(
  pack: ContentPack | ContentPackWithWording,
  plot: PlotStructure,
  state: StoryState,
): ContentEnding | undefined {
  let match: ContentEnding | undefined;
  for (const id of plot.endingIds) {
    const ending = pack.endings.find((candidate) => candidate.id === id);
    if (ending && meetsConditions(ending.conditions, state)) match = ending;
  }
  return match;
}

function meetsConditions(conditions: Conditions, state: StoryState): boolean {
  return (conditions.itemsHeld ?? []).every((id) => state.itemsHeld.includes(id))
    && (conditions.placesVisited ?? []).every((id) => state.placesVisited.includes(id))
    && (conditions.stepsDone ?? []).every((id) => state.stepsDone.includes(id))
    && (conditions.cluesRevealed ?? []).every((id) => state.cluesRevealed.includes(id));
}
