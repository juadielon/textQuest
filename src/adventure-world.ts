/*
 * The data format for an adventure's world: places, exits, items, clues,
 * puzzle steps and the goal. IDs are plain strings and must be unique within
 * their own kind.
 */

/** A location the player can visit. */
export interface Place {
  /** Unique place ID. */
  readonly id: string;
}

/** A one-way path from one place to another. Add a second exit for a return path. */
export interface Exit {
  /** Unique exit ID. */
  readonly id: string;
  /** The place the exit leads from. */
  readonly fromPlaceId: string;
  /** The place the exit leads to. */
  readonly toPlaceId: string;
  /** Whether the exit starts locked. An `unlock-exit` effect opens it. */
  readonly locked: boolean;
}

/** Something the player can carry. */
export interface Item {
  /** Unique item ID. */
  readonly id: string;
  /** Where the item starts. Leave it out if only a puzzle step gives it. */
  readonly placeId?: string;
}

/** A piece of information that helps solve a puzzle. */
export interface Clue {
  /** Unique clue ID. */
  readonly id: string;
  /** Where the clue is found. Leave it out if only a puzzle step reveals it. */
  readonly placeId?: string;
}

/** What must be true before something can happen. Every listed ID is required. */
export interface Conditions {
  /** Items the player must be carrying. */
  readonly itemsHeld?: readonly string[];
  /** Places the player must have visited. */
  readonly placesVisited?: readonly string[];
  /** Puzzle steps that must be done. */
  readonly stepsDone?: readonly string[];
  /** Clues the player must have found. */
  readonly cluesRevealed?: readonly string[];
}

/**
 * A change a puzzle step makes to the world when it's done.
 *
 * @remarks
 * `end-adventure` needs world version 2. It ends the adventure straight away
 * with one of the world's {@link Ending | endings}.
 */
export type Effect =
  | { readonly kind: 'unlock-exit'; readonly exitId: string }
  | { readonly kind: 'give-item'; readonly itemId: string }
  | { readonly kind: 'reveal-clue'; readonly clueId: string }
  | { readonly kind: 'end-adventure'; readonly endingId: string };

/** An action the player can complete once its conditions are met. */
export interface PuzzleStep {
  /** Unique step ID. */
  readonly id: string;
  /** Where the player must be to do the step. */
  readonly placeId: string;
  /** What must be true first. */
  readonly conditions: Conditions;
  /** What happens when the step is done. */
  readonly effects: readonly Effect[];
  /**
   * Needs world version 2. Steps that share a choice ID are mutually
   * exclusive: once one is done, the others can never be done. Each choice
   * needs at least two steps.
   */
  readonly choiceId?: string;
}

/**
 * A way a world version 2 adventure can end early through an
 * `end-adventure` effect. Reaching the goal is always a win as well.
 *
 * @remarks
 * This is engine data only. It is separate from the authored ending text in
 * content packs, which is chosen after the goal.
 */
export interface Ending {
  /** Unique ending ID. */
  readonly id: string;
  /**
   * A `win` finishes the adventure successfully. A `failure` must be
   * recoverable: the player returns to just before the step that caused it.
   */
  readonly outcome: 'win' | 'failure';
}

/** How the player wins: reach the place once the conditions are met. */
export interface Goal {
  /** The place where the adventure can be won. */
  readonly placeId: string;
  /** What must be true to win there. */
  readonly conditions: Conditions;
}

/**
 * A whole adventure world.
 *
 * @remarks
 * `solution` holds puzzle answers. Keep it separate from anything the player
 * sees, so hints and suggestions never give answers away.
 *
 * Version 1 worlds only ever add progress. Version 2 adds mutually exclusive
 * choices and early endings. Released adventures generate version 1 worlds.
 * Play accepts version 2 worlds only when every ending is a win.
 */
export interface AdventureWorld {
  /** World format version. */
  readonly version: 1 | 2;
  /** Where the player begins. */
  readonly startPlaceId: string;
  /** Every place in the world. */
  readonly places: readonly Place[];
  /** Every exit between places. */
  readonly exits: readonly Exit[];
  /** Every item in the world. */
  readonly items: readonly Item[];
  /** Every clue in the world. */
  readonly clues: readonly Clue[];
  /** The puzzle steps and goal. Don't show this to the player. */
  readonly solution: {
    readonly steps: readonly PuzzleStep[];
    readonly goal: Goal;
    /** Needs world version 2. Endings that steps can lead to. */
    readonly endings?: readonly Ending[];
  };
}
