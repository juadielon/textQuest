import './style.css';
import { renderStartScreen } from './start-screen';
import { renderPlayScreen } from './play-screen';
import { summariseAdventure } from './start-screen-model';
import type { AdventureSettings } from './adventure-settings';

const app = document.querySelector<HTMLElement>('#app');

if (app) {
  const showStart = (): void => {
    renderStartScreen(app, { onStart: showPlay });
  };

  const showPlay = (settings: AdventureSettings): void => {
    renderPlayScreen(app, settings);

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
    notice.textContent = 'Going back ends this play session. Keep the share word to start again.';
    header.append(heading, details, back, notice);
    app.prepend(header);
    heading.focus();
  };

  showStart();
}
