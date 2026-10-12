import type { AdventureGenre, AdventureLength } from '../../adventure-settings';
import type { Clue, Conditions, Exit, Goal, Item, Place, PuzzleStep } from '../../adventure-world';

/** A name reference, resolved only from entities included in the adventure. */
export type EntityReference = {
  readonly kind: 'place' | 'character' | 'item' | 'clue';
  readonly id: string;
};

/** Literal prose interleaved with entity names; not executable interpolation. */
export type Prose = readonly (string | EntityReference)[];

/** A named place whose description must remain true before and after puzzles. */
export interface ContentPlace extends Place {
  readonly name: string;
  readonly description: Prose;
}

/** A character and the reason they take part in the story. */
export interface ContentCharacter {
  readonly id: string;
  readonly name: string;
  readonly placeId: string;
  readonly description: Prose;
  readonly motive: Prose;
}

/** An item, either placed initially or awarded by a step. */
export interface ContentItem extends Item {
  readonly name: string;
  readonly description: Prose;
}

/** A clue, either placed initially or revealed by a step. */
export interface ContentClue extends Clue {
  readonly name: string;
  readonly text: Prose;
}

/** Puzzle families describe the player's reasoning, not runtime command syntax. */
export type PuzzleFamily = 'use-item' | 'read-clue' | 'help-character' | 'compare-clues';

/** Show the prompt before completion, and completion text only after its step. */
export interface PuzzleTemplate extends Pick<PuzzleStep, 'id' | 'placeId'> {
  readonly family: PuzzleFamily;
  readonly prompt: Prose;
  readonly completion: Prose;
}

/** Optional actions use the same condition and effect rules as required puzzles. */
export interface OptionalDiscovery extends PuzzleTemplate {
  readonly choice: 'peaceful' | 'non-graphic-force' | 'discovery';
}

/** After the goal, use the last matching ending in the plot's ordered ending IDs. */
export interface ContentEnding {
  readonly id: string;
  readonly text: Prose;
  readonly conditions: Conditions;
}

/** An authored selection, not a promise about arbitrary subsets of the pack. */
export interface LengthPlan {
  readonly placeIds: readonly string[];
  readonly requiredStepIds: readonly string[];
}

/** Merge dependencies into local conditions; the goal requires every selected step. */
export interface PlotStructure {
  readonly id: string;
  readonly name: string;
  readonly introduction: Prose;
  readonly lengths: Readonly<Record<AdventureLength, LengthPlan>>;
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
  readonly endingIds: readonly string[];
}

/** Released authored data; arrays and IDs are part of seed compatibility. */
export interface ContentPack {
  readonly version: 1;
  readonly genre: AdventureGenre;
  readonly startPlaceId: string;
  readonly places: readonly ContentPlace[];
  readonly exits: readonly Exit[];
  readonly characters: readonly ContentCharacter[];
  readonly items: readonly ContentItem[];
  readonly clues: readonly ContentClue[];
  readonly puzzles: readonly PuzzleTemplate[];
  readonly optionalDiscoveries: readonly OptionalDiscovery[];
  readonly plots: readonly PlotStructure[];
  readonly endings: readonly ContentEnding[];
  readonly solution: {
    readonly steps: readonly PuzzleStep[];
    readonly goal: Goal;
  };
}
