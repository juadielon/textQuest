// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdventureSettings, type RandomValueSource } from './adventure-settings';
import { comingSoonMessage, gameTitle, renderStartScreen } from './start-screen';
import { emptyShareWordMessage, summariseAdventure } from './start-screen-model';

// Always gives seed 0, so new adventures are predictable in tests.
const zeroSource: RandomValueSource = {
  getRandomValues(array) {
    array.fill(0);
    return array;
  },
};

let app: HTMLElement;

beforeEach(() => {
  app = document.createElement('main');
  document.body.append(app);
  renderStartScreen(app, { randomSource: zeroSource });
});

afterEach(() => {
  document.body.replaceChildren();
});

function get<T extends Element>(selector: string): T {
  const element = app.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}

function shownSettings(): Record<string, string> {
  const terms = [...app.querySelectorAll('#adventure-result dt')].map((term) => term.textContent ?? '');
  const values = [...app.querySelectorAll('#adventure-result dd')].map((value) => value.textContent ?? '');
  return Object.fromEntries(terms.map((term, index) => [term, values[index]]));
}

function openShareWord(text: string): void {
  get<HTMLInputElement>('#share-word').value = text;
  get<HTMLFormElement>('#open-share-word').requestSubmit();
}

describe('renderStartScreen', () => {
  it('shows the title, both forms and no adventure yet', () => {
    expect(get('h1').textContent).toBe(gameTitle);
    expect(get<HTMLInputElement>('#length-medium').checked).toBe(true);
    expect(get('#adventure-result').children).toHaveLength(0);
  });

  it('labels every control', () => {
    for (const input of app.querySelectorAll('input')) {
      expect(app.querySelector(`label[for="${input.id}"]`)?.textContent).not.toBe('');
    }
    expect(get('legend').textContent).toBe('Adventure length');
  });

  it('starts a new adventure of the chosen length and shows its share word and genre', () => {
    get<HTMLInputElement>('#length-long').checked = true;
    get<HTMLFormElement>('#new-adventure').requestSubmit();

    const expected = summariseAdventure(createAdventureSettings(0, 'long'));
    expect(shownSettings()).toEqual({
      'Share word': expected.shareWord,
      Genre: expected.genreLabel,
      Length: 'Long',
    });
    expect(get('#adventure-result').textContent).toContain(comingSoonMessage);
  });

  it('announces results politely to screen readers', () => {
    expect(get('#adventure-result').getAttribute('aria-live')).toBe('polite');
    expect(get('#share-word-error').getAttribute('role')).toBe('alert');
  });

  it('shows the same settings when a new adventure share word is typed back in', () => {
    get<HTMLFormElement>('#new-adventure').requestSubmit();
    const created = shownSettings();

    openShareWord(created['Share word'].toUpperCase());

    expect(shownSettings()).toEqual(created);
    expect(get('#adventure-result h2').textContent).toBe('Shared adventure');
  });

  it('shows the existing message for an invalid word and marks the field', () => {
    get<HTMLFormElement>('#new-adventure').requestSubmit();
    const input = get<HTMLInputElement>('#share-word');

    openShareWord('silverlantern2');

    expect(get('#share-word-error').textContent).toMatch(/version 2/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('share-word-error');
    expect(document.activeElement).toBe(input);
    expect(get('#adventure-result').children).toHaveLength(0);
  });

  it('asks for a word when the field is blank', () => {
    openShareWord(' ');

    expect(get('#share-word-error').textContent).toBe(emptyShareWordMessage);
  });

  it('clears the error once a valid word is opened', () => {
    openShareWord('nope');
    openShareWord('silverlantern');

    expect(get('#share-word-error').textContent).toBe('');
    expect(get('#share-word').hasAttribute('aria-invalid')).toBe(false);
    expect(shownSettings()['Share word']).toBe('silverlantern');
  });

  it('never turns typed text into HTML', () => {
    openShareWord('<img src=x onerror=alert(1)>');

    expect(app.querySelector('img')).toBeNull();
  });
});
