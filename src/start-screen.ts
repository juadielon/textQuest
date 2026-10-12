import {
  adventureLengths,
  createNewAdventureSettings,
  type RandomValueSource,
} from './adventure-settings';
import {
  defaultLength,
  isAdventureLength,
  lengthLabels,
  readShareWord,
  summariseAdventure,
  type AdventureSummary,
} from './start-screen-model';

/** The game's name, shown as the page heading. */
export const gameTitle = 'textQuest';

/** Explains that play isn't in the browser yet, so the screen doesn't fake it. */
export const comingSoonMessage =
  'Playing adventures is coming soon. Keep your share word so you can start this adventure when play arrives.';

/** Options for {@link renderStartScreen}. */
export interface StartScreenOptions {
  /** Where new seeds get random numbers. Defaults to browser cryptographic randomness. */
  readonly randomSource?: RandomValueSource;
}

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), properties);
  element.append(...children);
  return element;
}

function buildNewAdventureForm(): HTMLFormElement {
  const options = adventureLengths.map((length) => {
    const input = create('input', {
      type: 'radio',
      name: 'length',
      value: length,
      id: `length-${length}`,
      checked: length === defaultLength,
    });
    return create('div', { className: 'choice' }, input, create('label', { htmlFor: input.id }, lengthLabels[length]));
  });

  return create(
    'form',
    { className: 'panel', id: 'new-adventure' },
    create('h2', {}, 'Start a new adventure'),
    create('fieldset', {}, create('legend', {}, 'Adventure length'), ...options),
    create('button', { type: 'submit' }, 'Start new adventure'),
  );
}

function buildShareWordForm(): HTMLFormElement {
  const input = create('input', {
    type: 'text',
    name: 'share-word',
    id: 'share-word',
    autocomplete: 'off',
    spellcheck: false,
  });
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('aria-describedby', 'share-word-hint share-word-error');

  // role="alert" makes screen readers announce a new message straight away.
  const error = create('p', { className: 'error', id: 'share-word-error' });
  error.setAttribute('role', 'alert');

  return create(
    'form',
    { className: 'panel', id: 'open-share-word', noValidate: true },
    create('h2', {}, 'Open a shared adventure'),
    create('label', { htmlFor: input.id }, 'Share word'),
    create('p', { className: 'hint', id: 'share-word-hint' }, 'For example, silverlantern. Capitals, spaces and hyphens are fine.'),
    input,
    error,
    create('button', { type: 'submit' }, 'Open adventure'),
  );
}

function showSummary(result: HTMLElement, heading: string, summary: AdventureSummary): void {
  const details = create('dl');
  for (const [term, value] of [
    ['Share word', summary.shareWord],
    ['Genre', summary.genreLabel],
    ['Length', summary.lengthLabel],
  ]) {
    details.append(create('dt', {}, term), create('dd', {}, value));
  }
  result.replaceChildren(
    create('h2', {}, heading),
    details,
    create('p', { className: 'coming-soon' }, comingSoonMessage),
  );
}

/**
 * Replaces the contents of `target` with the start screen. Players can start
 * a new adventure of a chosen length or type a share word to see its settings.
 *
 * @remarks
 * Only settings are shown; play and saves are not part of this screen yet.
 * Typed text is only ever shown with `textContent`, never as HTML.
 *
 * @param target - The element to render into, usually `#app`.
 * @param options - Optional test hooks, such as a fixed random source.
 */
export function renderStartScreen(target: HTMLElement, options: StartScreenOptions = {}): void {
  const newForm = buildNewAdventureForm();
  const shareForm = buildShareWordForm();
  const shareInput = shareForm.querySelector<HTMLInputElement>('#share-word')!;
  const shareError = shareForm.querySelector<HTMLElement>('#share-word-error')!;

  // A polite live region so screen readers hear the new settings.
  const result = create('section', { className: 'result', id: 'adventure-result' });
  result.setAttribute('aria-live', 'polite');
  result.setAttribute('aria-label', 'Adventure settings');

  const clearError = (): void => {
    shareError.textContent = '';
    shareInput.removeAttribute('aria-invalid');
  };

  newForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const length = new FormData(newForm).get('length');
    if (!isAdventureLength(length)) {
      return;
    }
    clearError();
    showSummary(result, 'Your new adventure', summariseAdventure(createNewAdventureSettings(length, options.randomSource)));
  });

  shareForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const outcome = readShareWord(shareInput.value);
    if (outcome.ok) {
      clearError();
      showSummary(result, 'Shared adventure', outcome.summary);
      return;
    }
    // Remove old settings so they can't be mistaken for this word's.
    result.replaceChildren();
    shareError.textContent = outcome.message;
    shareInput.setAttribute('aria-invalid', 'true');
    shareInput.focus();
  });

  target.replaceChildren(
    create('h1', {}, gameTitle),
    create('p', { className: 'intro' }, 'Start a new text adventure, or type a share word to open one a friend made.'),
    create('div', { className: 'panels' }, newForm, shareForm),
    result,
  );
}
