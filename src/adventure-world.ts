export interface Place {
  readonly id: string;
}

export interface Exit {
  readonly id: string;
  readonly fromPlaceId: string;
  readonly toPlaceId: string;
  readonly locked: boolean;
}

export interface Item {
  readonly id: string;
  readonly placeId?: string;
}

export interface Clue {
  readonly id: string;
  readonly placeId?: string;
}

export interface Conditions {
  readonly itemsHeld?: readonly string[];
  readonly placesVisited?: readonly string[];
  readonly stepsDone?: readonly string[];
  readonly cluesRevealed?: readonly string[];
}

export type Effect =
  | { readonly kind: 'unlock-exit'; readonly exitId: string }
  | { readonly kind: 'give-item'; readonly itemId: string }
  | { readonly kind: 'reveal-clue'; readonly clueId: string };

export interface PuzzleStep {
  readonly id: string;
  readonly placeId: string;
  readonly conditions: Conditions;
  readonly effects: readonly Effect[];
}

export interface Goal {
  readonly placeId: string;
  readonly conditions: Conditions;
}

export interface AdventureWorld {
  readonly version: 1;
  readonly startPlaceId: string;
  readonly places: readonly Place[];
  readonly exits: readonly Exit[];
  readonly items: readonly Item[];
  readonly clues: readonly Clue[];
  readonly solution: {
    readonly steps: readonly PuzzleStep[];
    readonly goal: Goal;
  };
}
