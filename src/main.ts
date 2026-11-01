import './style.css';
import { renderStartScreen } from './start-screen';
import { renderPlayScreen } from './play-screen';
import { buildSaveForm, recordPlayed, renderSavesScreen, type StoredSave } from './saves-screen';
import { createSaveStore, type StorageLike } from './saves';
import { summariseAdventure } from './start-screen-model';
import type { AdventureSettings } from './adventure-settings';
import { createAdventureLink } from './share-links';

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
  let refreshSaves: (() => void) | undefined;
  const trackingStatus = document.createElement('p');
  trackingStatus.id = 'play-tracking-status';
  trackingStatus.className = 'hint';
  trackingStatus.setAttribute('role', 'status');
  const trackingWarnings = new Map<string, string>();
  const deletedSaveWarning = 'This save was deleted in another tab. Last played was not recorded; save this adventure again to keep your current progress.';
  const showTrackingWarnings = (): void => {
    trackingStatus.textContent = [...new Set(trackingWarnings.values())].join(' ');
  };

  const showStart = (shareWord?: string): void => {
    renderStartScreen(app, { onStart: showPlay, onOpenSaves: showSaves, shareWord });
    app.append(trackingStatus);
  };

  const backToStart = (): void => {
    refreshSaves = undefined;
    const url = new URL(window.location.href);
    url.searchParams.delete('adventure');
    window.history.replaceState(null, '', url);
    showStart();
  };

  const showSaves = (): void => {
    refreshSaves = renderSavesScreen(app, {
      store,
      onBack: backToStart,
      onResume: (saved) => showPlay(saved.save.settings, saved),
    });
    app.append(trackingStatus);
  };

  const showPlay = (settings: AdventureSettings, resumed?: StoredSave): void => {
    refreshSaves = undefined;
    let commands: readonly string[] = resumed?.save.commands ?? [];
    let playing = resumed?.id;
    let pendingPlayTime: Date | undefined;
    let latestPlayTime: Date | undefined;
    let detachedSaveId: string | undefined;
    const record = (id: string, time: Date): void => {
      recordPlayed(store, id, {
        now: time,
        isCurrent: () => playing === id,
        onResult: (result) => {
          if (result === 'recorded') {
            trackingWarnings.delete(id);
            showTrackingWarnings();
            refreshSaves?.();
          } else if (result === 'missing') {
            trackingWarnings.set(id, deletedSaveWarning);
            showTrackingWarnings();
            refreshSaves?.();
          } else {
            trackingWarnings.set(id, 'Last played time could not be recorded. Your saved progress was not changed, and you can keep playing.');
            showTrackingWarnings();
          }
        },
      });
    };
    const markPlayed = (): void => {
      const time = new Date();
      latestPlayTime = time;
      if (playing === undefined) pendingPlayTime = time;
      else record(playing, time);
    };
    const playable = renderPlayScreen(app, settings, {
      commands,
      onCommand: (latest) => {
        commands = latest;
        markPlayed();
      },
    });
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
    back.addEventListener('click', backToStart);
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
    notice.textContent = playable
      ? 'Going back ends this play session. Save first to carry on later.'
      : 'Going back ends this play session. Keep the share word to start again.';
    header.append(details, back, notice, trackingStatus, sharing);
    if (playable) {
      header.append(buildSaveForm({
        store, settings, resumed, suggestedName: summary.shareWord, commands: () => commands,
        onPendingChange: (pending) => { back.disabled = pending; },
        onStoredChange: (saved) => {
          const previousId = playing;
          playing = saved?.id;
          if (!saved) {
            detachedSaveId = previousId;
            pendingPlayTime = latestPlayTime;
            return;
          }
          if (pendingPlayTime) record(saved.id, pendingPlayTime);
          pendingPlayTime = undefined;
          if (detachedSaveId && trackingWarnings.get(detachedSaveId) === deletedSaveWarning) {
            trackingWarnings.delete(detachedSaveId);
            showTrackingWarnings();
          }
          detachedSaveId = undefined;
        },
      }));
    }
    heading.after(header);
    if (playable) markPlayed();
    heading.focus();
  };

  showStart(new URL(window.location.href).searchParams.get('adventure') ?? undefined);
}
