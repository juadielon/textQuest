import { describe, expect, it } from 'vitest';
import {
  adventureGenres,
  adventureLengths,
  createAdventureSettings,
  parseShareWord,
  ShareWordError,
} from './adventure-settings';
import {
  defaultLength,
  emptyShareWordMessage,
  genreLabels,
  isAdventureLength,
  lengthLabels,
  readShareWord,
  summariseAdventure,
} from './start-screen-model';

function messageFor(input: string): string {
  try {
    parseShareWord(input);
  } catch (error) {
    if (error instanceof ShareWordError) {
      return error.message;
    }
  }
  throw new Error(`Expected "${input}" to be rejected.`);
}

describe('labels', () => {
  it('names every length and genre', () => {
    expect(adventureLengths.map((length) => lengthLabels[length])).toEqual(['Short', 'Medium', 'Long']);
    expect(adventureGenres.map((genre) => genreLabels[genre])).toEqual([
      'Light fantasy',
      'Cosy mystery',
      'Science fiction',
    ]);
  });

  it('starts on a medium adventure', () => {
    expect(defaultLength).toBe('medium');
  });
});

describe('isAdventureLength', () => {
  it('accepts only known lengths', () => {
    for (const length of adventureLengths) {
      expect(isAdventureLength(length)).toBe(true);
    }
    for (const value of ['', 'Short', 'huge', null, undefined, 1]) {
      expect(isAdventureLength(value)).toBe(false);
    }
  });
});

describe('summariseAdventure', () => {
  it('gives the share word and readable genre and length', () => {
    const settings = createAdventureSettings(0, 'short');

    expect(summariseAdventure(settings)).toEqual({
      shareWord: 'ableacorn',
      genreLabel: genreLabels[settings.genre],
      lengthLabel: 'Short',
    });
  });
});

describe('readShareWord', () => {
  it('reads a valid word typed with capitals and spaces', () => {
    const result = readShareWord('  Silver Lantern ');

    expect(result).toEqual({ ok: true, summary: summariseAdventure(parseShareWord('silverlantern')) });
  });

  it('gives the same settings back for a new adventure share word', () => {
    const settings = createAdventureSettings(1234, 'long');
    const { shareWord } = summariseAdventure(settings);

    expect(readShareWord(shareWord)).toEqual({ ok: true, summary: summariseAdventure(settings) });
  });

  it('uses the existing message for a misspelt word', () => {
    expect(readShareWord('silverlanturn')).toEqual({ ok: false, message: messageFor('silverlanturn') });
  });

  it('uses the existing message for a newer version', () => {
    const result = readShareWord('silverlantern2');

    expect(result).toEqual({ ok: false, message: messageFor('silverlantern2') });
    expect(result.ok === false && result.message).toMatch(/version 2/);
  });

  it('asks for a word when the input is blank', () => {
    expect(readShareWord('')).toEqual({ ok: false, message: emptyShareWordMessage });
    expect(readShareWord('   ')).toEqual({ ok: false, message: emptyShareWordMessage });
  });
});
