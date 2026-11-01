// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdventureSettings, encodeShareWord, parseShareWord, type RandomValueSource } from './adventure-settings';
import { gameTitle, renderStartScreen } from './start-screen';
import { emptyShareWordMessage } from './start-screen-model';

// Always gives seed 0, so new adventures are predictable in tests.
const zeroSource: RandomValueSource = {
  getRandomValues(array) {
    array.fill(0);
    return array;
  },
};

let app: HTMLElement;
const onStart = vi.fn();

beforeEach(() => {
  app = document.createElement('main');
  document.body.append(app);
  onStart.mockClear();
  renderStartScreen(app, { randomSource: zeroSource, onStart });
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

function openShareWord(text: string): void {
  get<HTMLInputElement>('#share-word').value = text;
  get<HTMLFormElement>('#open-share-word').requestSubmit();
}

describe('renderStartScreen', () => {
  it('shows the title, both forms and no adventure yet', () => {
    expect(get('h1').textContent).toBe(gameTitle);
    expect(get<HTMLInputElement>('#length-medium').checked).toBe(true);
    expect(onStart).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(get('h1'));
    expect(get('h1').getAttribute('tabindex')).toBe('-1');
  });

  it('labels every control', () => {
    for (const input of app.querySelectorAll('input')) {
      expect(app.querySelector(`label[for="${input.id}"]`)?.textContent).not.toBe('');
    }
    expect(get('legend').textContent).toBe('Adventure length');
  });

  it.each(['short', 'medium', 'long'] as const)('opens a new %s adventure with its settings', (length) => {
    get<HTMLInputElement>(`#length-${length}`).checked = true;
    get<HTMLFormElement>('#new-adventure').requestSubmit();

    expect(onStart).toHaveBeenCalledExactlyOnceWith(createAdventureSettings(0, length));
    expect(app.textContent).not.toContain('coming soon');
  });

  it('announces share-word errors to screen readers', () => {
    expect(get('#share-word-error').getAttribute('role')).toBe('alert');
  });

  it('shows the same settings when a new adventure share word is typed back in', () => {
    get<HTMLFormElement>('#new-adventure').requestSubmit();
    const created = onStart.mock.calls[0][0];

    openShareWord(encodeShareWord(created).toUpperCase());

    expect(onStart).toHaveBeenLastCalledWith(created);
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('shows the existing message for an invalid word and marks the field', () => {
    const input = get<HTMLInputElement>('#share-word');

    openShareWord('silverlantern2');

    expect(get('#share-word-error').textContent).toMatch(/version 2/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('share-word-error');
    expect(document.activeElement).toBe(input);
    expect(onStart).not.toHaveBeenCalled();
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
    expect(onStart).toHaveBeenCalledExactlyOnceWith(parseShareWord('silverlantern'));
  });

  it('never turns typed text into HTML', () => {
    openShareWord('<img src=x onerror=alert(1)>');

    expect(app.querySelector('img')).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('clears share-word errors when starting a new adventure', () => {
    openShareWord('nope');
    get<HTMLFormElement>('#new-adventure').requestSubmit();

    expect(get('#share-word-error').textContent).toBe('');
    expect(get('#share-word').hasAttribute('aria-invalid')).toBe(false);
    expect(onStart).toHaveBeenCalledExactlyOnceWith(createAdventureSettings(0, 'medium'));
  });
});
