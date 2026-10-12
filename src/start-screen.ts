import {
  adventureLengths,
  createNewAdventureSettings,
  type AdventureSettings,
  type RandomValueSource,
} from './adventure-settings';
import {
  defaultLength,
  isAdventureLength,
  lengthLabels,
  readShareWord,
} from './start-screen-model';

/** The game's name, shown as the page heading. */
export const gameTitle = 'textQuest';

/** Options for {@link renderStartScreen}. */
export interface StartScreenOptions {
  /** Opens play with the chosen or shared adventure's settings. */
  readonly onStart: (settings: AdventureSettings) => void;
  /** Where new seeds get random numbers. Defaults to browser cryptographic randomness. */
  readonly randomSource?: RandomValueSource;
  /** Opens the saves screen. When missing, no saves button is shown. */
  readonly onOpenSaves?: () => void;
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

/**
 * Replaces the contents of `target` with the start screen. Players can start
 * a new adventure of a chosen length or open a share word through `onStart`.
 *
 * @remarks
 * Focus moves to the heading. Invalid share words stay on this screen with
 * a plain-text error; typed text is never inserted as HTML.
 *
 * @param target - The element to render into, usually `#app`.
 * @param options - The navigation callback and optional fixed random source.
 */
export function renderStartScreen(target: HTMLElement, options: StartScreenOptions): void {
  const newForm = buildNewAdventureForm();
  const shareForm = buildShareWordForm();
  const shareInput = shareForm.querySelector<HTMLInputElement>('#share-word')!;
  const shareError = shareForm.querySelector<HTMLElement>('#share-word-error')!;

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
    options.onStart(createNewAdventureSettings(length, options.randomSource));
  });

  shareForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const outcome = readShareWord(shareInput.value);
    if (outcome.ok) {
      clearError();
      options.onStart(outcome.settings);
      return;
    }
    shareError.textContent = outcome.message;
    shareInput.setAttribute('aria-invalid', 'true');
    shareInput.focus();
  });

  const heading = create('h1', { tabIndex: -1 }, gameTitle);
  target.replaceChildren(
    heading,
    create('p', { className: 'intro' }, 'Start a new text adventure, or type a share word to open one a friend made.'),
    create('div', { className: 'panels' }, newForm, shareForm),
  );
  if (options.onOpenSaves) {
    const saves = create('button', { type: 'button', id: 'open-saves' }, 'Your saves');
    saves.addEventListener('click', options.onOpenSaves);
    target.append(create('p', { className: 'saves-link' }, saves));
  }
  heading.focus();
}
