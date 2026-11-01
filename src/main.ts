import './style.css';
import { renderStartScreen } from './start-screen';
import { renderPlayScreen } from './play-screen';
import { summariseAdventure } from './start-screen-model';
import type { AdventureSettings } from './adventure-settings';
import { createAdventureLink } from './share-links';

const app = document.querySelector<HTMLElement>('#app');

if (app) {
  const showStart = (shareWord?: string): void => {
    renderStartScreen(app, { onStart: showPlay, shareWord });
  };

  const showPlay = (settings: AdventureSettings): void => {
    renderPlayScreen(app, settings);

    const header = document.createElement('header');
    const heading = app.querySelector('h1')!;
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
    back.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('adventure');
      window.history.replaceState(null, '', url);
      showStart();
    });
    const link = document.createElement('input');
    link.id = 'adventure-link';
    link.type = 'text';
    link.readOnly = true;
    link.value = createAdventureLink(settings, window.location.href);
    link.addEventListener('focus', () => link.select());
    const label = document.createElement('label');
    label.htmlFor = link.id;
    label.textContent = 'Adventure link';
    const hint = document.createElement('p');
    hint.id = 'adventure-link-hint';
    hint.className = 'hint';
    hint.textContent = 'Only the starting adventure is shared, not your progress. You can select the link and copy it yourself.';
    link.setAttribute('aria-describedby', hint.id);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy link';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const selectLink = (): void => {
      if (!header.isConnected) return;
      status.textContent = 'Could not copy the link. It is selected so you can copy it yourself, or use Open starting adventure.';
      link.focus();
      link.select();
    };
    copy.addEventListener('click', async () => {
      if (!navigator.clipboard?.writeText) {
        selectLink();
        return;
      }
      try {
        await navigator.clipboard.writeText(link.value);
      } catch {
        selectLink();
        return;
      }
      if (header.isConnected) status.textContent = 'Adventure link copied.';
    });
    const open = document.createElement('a');
    open.href = link.value;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'Open starting adventure (new tab)';
    const sharing = document.createElement('div');
    sharing.className = 'share-link';
    sharing.append(label, hint, link, copy, open, status);
    const notice = document.createElement('p');
    notice.className = 'hint';
    notice.textContent = 'Going back ends this play session. Keep the share word to start again.';
    header.append(details, back, notice, sharing);
    heading.after(header);
    heading.focus();
  };

  showStart(new URL(window.location.href).searchParams.get('adventure') ?? undefined);
}
