import './style.css';
import { renderStartScreen } from './start-screen';
import { renderPlayScreen } from './play-screen';
import { buildSaveForm, renderSavesScreen, type StoredSave } from './saves-screen';
import { createSaveStore, type StorageLike } from './saves';
import { summariseAdventure } from './start-screen-model';
import type { AdventureSettings } from './adventure-settings';

const app = document.querySelector<HTMLElement>('#app');

// Reading localStorage itself can throw when the browser blocks storage, so
// each call looks it up inside the store, which turns errors into clear messages.
const browserStorage: StorageLike = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
  key: (index) => localStorage.key(index),
  get length() {
    return localStorage.length;
  },
};

if (app) {
  const store = createSaveStore(browserStorage);

  const showStart = (): void => {
    renderStartScreen(app, { onStart: (settings) => showPlay(settings), onOpenSaves: showSaves });
  };

  const showSaves = (): void => {
    renderSavesScreen(app, { store, onBack: showStart, onResume: (saved) => showPlay(saved.save.settings, saved) });
  };

  const showPlay = (settings: AdventureSettings, resumed?: StoredSave): void => {
    let commands: readonly string[] = resumed?.save.commands ?? [];
    const playable = renderPlayScreen(app, settings, {
      commands,
      onCommand: (latest) => {
        commands = latest;
      },
    });

    const header = document.createElement('header');
    const heading = document.createElement('h1');
    heading.textContent = 'Your adventure';
    heading.tabIndex = -1;
    const details = document.createElement('dl');
    const summary = summariseAdventure(settings);
    for (const [label, value] of [
      ['Share word', summary.shareWord],
      ['Genre', summary.genreLabel],
      ['Length', summary.lengthLabel],
    ]) {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      details.append(term, description);
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Back to start';
    back.addEventListener('click', showStart);
    const notice = document.createElement('p');
    notice.className = 'hint';
    notice.textContent = playable
      ? 'Going back ends this play session. Save first to carry on later.'
      : 'Going back ends this play session. Keep the share word to start again.';
    header.append(heading, details, back, notice);
    if (playable) {
      header.append(buildSaveForm({
        store, settings, resumed, suggestedName: summary.shareWord, commands: () => commands,
      }));
    }
    app.prepend(header);
    heading.focus();
  };

  showStart();
}
