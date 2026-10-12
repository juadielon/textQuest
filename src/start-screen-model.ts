import {
  adventureLengths,
  encodeShareWord,
  parseShareWord,
  ShareWordError,
  type AdventureGenre,
  type AdventureLength,
  type AdventureSettings,
} from './adventure-settings';

/*
 * Start screen logic with no DOM code, so it can be unit tested on its own.
 */

/** Player-facing names for each adventure length. */
export const lengthLabels: Readonly<Record<AdventureLength, string>> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};

/** Player-facing names for each genre. */
export const genreLabels: Readonly<Record<AdventureGenre, string>> = {
  'light-fantasy': 'Light fantasy',
  'cosy-mystery': 'Cosy mystery',
  'science-fiction': 'Science fiction',
};

/** The length picked on the start screen before the player changes it. */
export const defaultLength: AdventureLength = 'medium';

/** Shown when the player tries to open a share word without typing one. */
export const emptyShareWordMessage = 'Type a share word, such as silverlantern.';

/** What the start screen shows about an adventure's starting settings. */
export interface AdventureSummary {
  /** The canonical lowercase share word, such as "silverlantern". */
  readonly shareWord: string;
  /** The genre name, such as "Light fantasy". */
  readonly genreLabel: string;
  /** The length name, such as "Medium". */
  readonly lengthLabel: string;
}

/** Settings and their summary from a typed share word, or a message to show. */
export type ShareWordResult =
  | { readonly ok: true; readonly settings: AdventureSettings; readonly summary: AdventureSummary }
  | { readonly ok: false; readonly message: string };

/**
 * Checks whether a form value is a known adventure length.
 *
 * @param value - The value from a length control.
 * @returns True for "short", "medium" or "long".
 */
export function isAdventureLength(value: unknown): value is AdventureLength {
  return adventureLengths.includes(value as AdventureLength);
}

/**
 * Describes adventure settings in words a player can read.
 *
 * @param settings - Valid adventure settings.
 * @returns The share word, genre name and length name.
 * @throws RangeError if the settings are invalid.
 */
export function summariseAdventure(settings: AdventureSettings): AdventureSummary {
  return {
    shareWord: encodeShareWord(settings),
    genreLabel: genreLabels[settings.genre],
    lengthLabel: lengthLabels[settings.length],
  };
}

/**
 * Reads a share word the player typed, without throwing for bad input.
 *
 * @param input - The text the player entered.
 * @returns The settings and summary, or the plain-English message from
 * {@link parseShareWord} (or {@link emptyShareWordMessage} for blank input).
 */
export function readShareWord(input: string): ShareWordResult {
  if (input.trim() === '') {
    return { ok: false, message: emptyShareWordMessage };
  }
  try {
    const settings = parseShareWord(input);
    return { ok: true, settings, summary: summariseAdventure(settings) };
  } catch (error) {
    if (error instanceof ShareWordError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
