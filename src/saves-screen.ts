import type { AdventureSettings } from './adventure-settings';
import {
  createSave,
  MAX_SAVE_FILE_LENGTH,
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
  /** Keeps navigation in play while any submitted save is waiting or being written. */
  readonly onPendingChange?: (pending: boolean) => void;
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
 * Submissions queued before that warning cannot create the retry's new save.
 * Browsers without Web Locks always save as a new save instead of updating.
 * Results and problems go to a polite status message as plain text.
 * A failed save leaves any stored version as it was.
 * Pending changes let the caller keep this form visible until all requests finish.
 */
export function buildSaveForm(options: SaveFormOptions): HTMLFormElement {
  const now = options.now ?? (() => new Date());
  const locks = 'locks' in options ? options.locks : browserLocks();
  let current = options.resumed;
  let conflictCount = 0;
  let pending = 0;

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
    const conflictsAtSubmit = conflictCount;
    pending += 1;
    options.onPendingChange?.(true);
    status.textContent = 'Saving adventure. Stay here until saving finishes.';
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      pending -= 1;
      options.onPendingChange?.(pending > 0);
    };
    withSaveLock(locks, () => {
      try {
        if (conflictsAtSubmit !== conflictCount) return;
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
        if (conflict) {
          current = undefined;
          conflictCount += 1;
        }
        status.textContent = conflict ?? messageFor(error);
      } finally {
        finish();
      }
    }, () => {
      if (conflictsAtSubmit === conflictCount) status.textContent = lockFailureMessage;
      finish();
    });
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
 * its name, genre, length and last played time, with Resume, Export and Delete.
 *
 * @remarks
 * Delete confirms the exact listed save under a shared lock; changed saves
 * stay stored and need fresh confirmation. Without a lock, deletion is refused.
 * Keep cancels deletion even while it is waiting for the lock.
 * Saves that can't be read are listed
 * with the reason and kept; only the player can delete them. All text goes in
 * through `textContent`. Export downloads JSON; import validates a file and
 * adds a new save without changing existing ones. Results are announced.
 * Focus moves to the heading.
 */
export function renderSavesScreen(target: HTMLElement, options: SavesScreenOptions): void {
  const locks = 'locks' in options ? options.locks : browserLocks();
  const heading = create('h1', { tabIndex: -1 }, 'Your saves');
  const status = create('p', { className: 'saves-status', id: 'saves-status', tabIndex: -1 });
  status.setAttribute('role', 'status');
  const list = create('ul', { className: 'saves-list' });
  list.setAttribute('aria-label', 'Saved adventures');
  const back = create('button', { type: 'button' }, 'Back to start');
  back.addEventListener('click', options.onBack);
  const fileInput = create('input', {
    type: 'file', id: 'import-save', accept: '.json,application/json',
  });
  fileInput.setAttribute('aria-describedby', status.id);
  const importButton = create('button', { type: 'submit' }, 'Import save');
  const importForm = create('form', { className: 'save-form' },
    create('label', { htmlFor: fileInput.id }, 'Save file'), fileInput, importButton);
  let importing = false;
  importForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (importing) return;
    const file = fileInput.files?.[0];
    if (!file) {
      status.textContent = 'Choose a textQuest save file, then select Import save.';
      fileInput.focus();
      return;
    }
    importing = true;
    fileInput.disabled = importButton.disabled = true;
    status.textContent = 'Reading your save file…';
    try {
      // UTF-8 can use three bytes per UTF-16 character. Keep valid non-ASCII saves.
      if (file.size > MAX_SAVE_FILE_LENGTH * 3) {
        throw new SaveError('too-large', 'This save file is too large for textQuest. Choose a smaller save file.');
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw new SaveError(
          'malformed',
          'This save file could not be read, or its text is damaged. Choose a textQuest save file and try again.',
        );
      }
      // Navigation while reading must not import into a screen the player left.
      if (!target.contains(importForm)) return;
      options.store.importSave(text);
      fileInput.value = '';
      status.textContent = refresh()
        ? 'Imported the save as a new save.'
        : `The save was imported, but the list could not be refreshed. ${status.textContent}`;
    } catch (error) {
      status.textContent = messageFor(error);
    } finally {
      importing = false;
      fileInput.disabled = importButton.disabled = false;
      if (target.contains(importForm)) status.focus();
    }
  });

  const refresh = (): boolean => {
    let entries: SaveListEntry[];
    try {
      entries = options.store.list();
    } catch (error) {
      list.replaceChildren();
      status.textContent = messageFor(error);
      return false;
    }
    list.replaceChildren(...entries.map((entry) => saveItem(entry)));
    if (!entries.length) list.append(create('li', {}, noSavesMessage));
    return true;
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
      actions.append(button('Export', name, () => {
        try {
          downloadSave(options.store.exportSave(entry.id), name);
          status.textContent = `Save file download started for “${name}”.`;
        } catch (error) {
          status.textContent = messageFor(error);
        }
      }));
    } else {
      item.append(create('p', { className: 'error' }, entry.message),
        create('p', { className: 'hint' }, 'It has been kept in case a later version of textQuest can read it.'));
    }

    const remove = button('Delete', name, () => {
      let cancelled = false;
      const keep = button('Keep', name, () => {
        cancelled = true;
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
          if (cancelled) return;
          cancelled = true;
          try {
            options.store.remove(entry.id, entry.snapshot);
            status.textContent = `Deleted “${name}”.`;
          } catch (error) {
            status.textContent = messageFor(error);
          }
          refresh();
          status.focus();
        }, () => {
          if (cancelled) return;
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

  target.replaceChildren(heading, status, importForm, list, back);
  heading.focus();
  refresh();
}

function downloadSave(text: string, name: string): void {
  const fileName = name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'save';
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = create('a', { href: url, download: `textquest-${fileName}.json` });
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Let the browser begin the download before releasing the file.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
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
  ...children: Node[] | [string]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), properties);
  if (typeof children[0] === 'string') {
    element.textContent = children[0];
  } else {
    element.append(...children);
  }
  return element;
}
