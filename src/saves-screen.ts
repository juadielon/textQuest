import type { AdventureSettings } from './adventure-settings';
import {
  createSave,
  MAX_SAVE_NAME_LENGTH,
  SaveError,
  type AdventureSave,
  type SaveListEntry,
  type SaveStore,
} from './saves';
import { genreLabels, lengthLabels } from './start-screen-model';

/** Shown when a typed save name can't be used. */
export const saveNameMessage = `Give your save a name of 1 to ${MAX_SAVE_NAME_LENGTH} characters on one line.`;

/** Shown on the saves screen when there are no saves yet. */
export const noSavesMessage = 'You have no saves yet. Save during an adventure to see it here.';

// Names are single lines; tabs and other control characters can sneak in by pasting.
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Turns a save's ISO time into a short, readable local date and time,
 * such as "12 Oct 2026, 3:40 pm".
 */
export function formatLastPlayed(isoTime: string): string {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(isoTime));
}

/** The part of the browser's Web Locks API that saves use, so tabs take turns changing saves. */
export type SaveLocks = Pick<LockManager, 'request'>;

/** The Web Locks name shared by every tab that updates or deletes saves. */
export const SAVE_LOCK_NAME = 'textquest:saves';

// Without Web Locks the task runs straight away, and callers must not update in place.
function withSaveLock(locks: SaveLocks | undefined, task: () => void, onFailure: () => void): void {
  if (locks) {
    try {
      void locks.request(SAVE_LOCK_NAME, () => task()).catch(onFailure);
    } catch {
      onFailure();
    }
  } else {
    task();
  }
}

const lockFailureMessage = 'Your browser could not lock save storage. Nothing was changed. Please try again.';

function browserLocks(): SaveLocks | undefined {
  return globalThis.navigator?.locks ?? undefined;
}

/** A save the player is playing, and the ID it is stored under. */
export interface StoredSave {
  readonly id: string;
  readonly save: AdventureSave;
}

/** Options for {@link buildSaveForm}. */
export interface SaveFormOptions {
  /** Where saves are kept. */
  readonly store: SaveStore;
  /** The adventure's starting settings. */
  readonly settings: AdventureSettings;
  /** Every command typed so far, oldest first. */
  readonly commands: () => readonly string[];
  /** The save this adventure was resumed from, so saving updates it. */
  readonly resumed?: StoredSave;
  /** The name to suggest for a new save. */
  readonly suggestedName: string;
  /** The current time. Defaults to the clock. */
  readonly now?: () => Date;
  /** Locks shared between tabs. Defaults to the browser's Web Locks, if it has them. */
  readonly locks?: SaveLocks;
}

/**
 * Builds the form that saves the current adventure. The first save adds a
 * new save; later saves, or saves of a resumed adventure, update that one
 * and keep its created time.
 *
 * @remarks
 * An update happens under a lock shared by every tab, and only if the stored
 * save is still exactly the version this form last loaded or wrote. If
 * another tab or window changed or deleted it, nothing is overwritten or
 * brought back; the player is told and can save again as a new save.
 * Browsers without Web Locks always save as a new save instead of updating.
 * Results and problems go to a polite status message as plain text.
 * A failed save leaves any stored version as it was.
 */
export function buildSaveForm(options: SaveFormOptions): HTMLFormElement {
  const now = options.now ?? (() => new Date());
  const locks = 'locks' in options ? options.locks : browserLocks();
  let current = options.resumed;

  const input = create('input', {
    type: 'text', id: 'save-name', maxLength: MAX_SAVE_NAME_LENGTH, autocomplete: 'off',
    value: current?.save.name ?? options.suggestedName,
  });
  const status = create('p', { className: 'save-status', id: 'save-status' });
  status.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', status.id);
  const form = create('form', { className: 'save-form', noValidate: true },
    create('label', { htmlFor: input.id }, 'Save name'), input,
    create('button', { type: 'submit' }, 'Save adventure'), status);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name || name.length > MAX_SAVE_NAME_LENGTH || controlCharacterPattern.test(name)) {
      status.textContent = saveNameMessage;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    // Take the commands now, so a save matches the moment the player chose.
    const commands = [...options.commands()];
    const time = now();
    withSaveLock(locks, () => {
      try {
        const fresh = createSave(name, options.settings, commands, time);
        if (current && locks) {
          // A clock set backwards must not make the update look older than the save.
          const createdAt = current.save.createdAt;
          const updatedAt = current.save.updatedAt;
          const save = { ...fresh, createdAt, updatedAt: fresh.updatedAt < updatedAt ? updatedAt : fresh.updatedAt };
          options.store.replace(current.id, current.save, save);
          current = { id: current.id, save };
          status.textContent = `Saved “${name}”.`;
        } else {
          const copied = current !== undefined;
          current = { id: options.store.add(fresh), save: fresh };
          status.textContent = copied ? `Saved “${name}” as a new save. ${noLocksMessage}` : `Saved “${name}”.`;
        }
      } catch (error) {
        const conflict = conflictMessage(error);
        if (conflict) current = undefined;
        status.textContent = conflict ?? messageFor(error);
      }
    }, () => { status.textContent = lockFailureMessage; });
  });
  return form;
}

/** Shown when a browser without Web Locks saves a resumed adventure as a new save. */
export const noLocksMessage = 'This browser can’t safely update a save that may be open in another tab.';

function conflictMessage(error: unknown): string | undefined {
  if (!(error instanceof SaveError) || (error.problem !== 'changed' && error.problem !== 'not-found')) {
    return undefined;
  }
  const what = error.problem === 'changed' ? 'changed' : 'deleted';
  return `This save was ${what} in another tab or window, so it was not overwritten. Choose Save adventure again to keep this progress as a new save.`;
}

/** Options for {@link renderSavesScreen}. */
export interface SavesScreenOptions {
  /** Where saves are kept. */
  readonly store: SaveStore;
  /** Opens play for a loaded save. */
  readonly onResume: (saved: StoredSave) => void;
  /** Returns to the start screen. */
  readonly onBack: () => void;
  /** Locks shared between tabs. Defaults to the browser's Web Locks, if it has them. */
  readonly locks?: SaveLocks;
}

/**
 * Replaces the contents of `target` with the list of saves. Each save shows
 * its name, genre, length and last played time, with Resume and Delete.
 *
 * @remarks
 * Delete confirms the exact listed save under a shared lock; changed saves
 * stay stored and need fresh confirmation. Without a lock, deletion is refused.
 * Saves that can't be read are listed
 * with the reason and kept; only the player can delete them. All text goes in
 * through `textContent`. Focus moves to the heading.
 */
export function renderSavesScreen(target: HTMLElement, options: SavesScreenOptions): void {
  const locks = 'locks' in options ? options.locks : browserLocks();
  const heading = create('h1', { tabIndex: -1 }, 'Your saves');
  const status = create('p', { className: 'saves-status', tabIndex: -1 });
  status.setAttribute('role', 'status');
  const list = create('ul', { className: 'saves-list' });
  list.setAttribute('aria-label', 'Saved adventures');
  const back = create('button', { type: 'button' }, 'Back to start');
  back.addEventListener('click', options.onBack);

  const refresh = (): void => {
    let entries: SaveListEntry[];
    try {
      entries = options.store.list();
    } catch (error) {
      list.replaceChildren();
      status.textContent = messageFor(error);
      return;
    }
    list.replaceChildren(...entries.map((entry) => saveItem(entry)));
    if (!entries.length) list.append(create('li', {}, noSavesMessage));
  };

  const saveItem = (entry: SaveListEntry): HTMLLIElement => {
    const name = entry.status === 'ready' ? entry.name : 'Unreadable save';
    const titleId = `save-${entry.id}`;
    const item = create('li', { className: 'save-item' }, create('h2', { id: titleId }, name));
    item.setAttribute('aria-labelledby', titleId);
    const actions = create('div', { className: 'save-actions' });

    if (entry.status === 'ready') {
      item.append(details([
        ['Genre', genreLabels[entry.settings.genre]],
        ['Length', lengthLabels[entry.settings.length]],
        ['Last played', formatLastPlayed(entry.updatedAt)],
      ]));
      actions.append(button('Resume', name, () => {
        let save: AdventureSave;
        try {
          save = options.store.load(entry.id);
        } catch (error) {
          status.textContent = messageFor(error);
          return;
        }
        // Problems starting play are not save problems, so they are not caught here.
        options.onResume({ id: entry.id, save });
      }));
    } else {
      item.append(create('p', { className: 'error' }, entry.message),
        create('p', { className: 'hint' }, 'It has been kept in case a later version of textQuest can read it.'));
    }

    const remove = button('Delete', name, () => {
      const keep = button('Keep', name, () => {
        confirmation.replaceWith(actions);
        remove.focus();
      });
      // Delete waits for any save in progress in another tab, so that save can't bring it back.
      const confirm = button('Yes, delete', name, () => {
        if (!locks) {
          status.textContent = 'This browser can’t safely delete saves without Web Locks. Your save has been kept.';
          status.focus();
          return;
        }
        withSaveLock(locks, () => {
          try {
            options.store.remove(entry.id, entry.snapshot);
            status.textContent = `Deleted “${name}”.`;
          } catch (error) {
            status.textContent = messageFor(error);
          }
          refresh();
          status.focus();
        }, () => {
          status.textContent = lockFailureMessage;
          status.focus();
        });
      });
      const question = create('p', { id: `delete-question-${entry.id}` }, `Delete “${name}”? This can’t be undone.`);
      // Screen readers hear the question along with whichever button has focus.
      for (const choice of [confirm, keep]) choice.setAttribute('aria-describedby', question.id);
      const confirmation = create('div', { className: 'save-actions' }, question, confirm, keep);
      actions.replaceWith(confirmation);
      keep.focus();
    });
    actions.append(remove);
    item.append(actions);
    return item;
  };

  refresh();
  target.replaceChildren(heading, status, list, back);
  heading.focus();
}

function messageFor(error: unknown): string {
  return error instanceof SaveError ? error.message : 'Something went wrong with your saves. Please try again.';
}

function details(rows: readonly (readonly [string, string])[]): HTMLDListElement {
  return create('dl', {}, ...rows.flatMap(([term, value]) => [create('dt', {}, term), create('dd', {}, value)]));
}

// The visible label stays short; the accessible name says which save it acts on.
function button(label: string, saveName: string, onClick: () => void): HTMLButtonElement {
  const node = create('button', { type: 'button' }, label);
  node.setAttribute('aria-label', `${label}: ${saveName}`);
  node.addEventListener('click', onClick);
  return node;
}

// Text always goes in as text nodes, never as markup.
function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), properties);
  element.append(...children);
  return element;
}
