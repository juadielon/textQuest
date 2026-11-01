// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as adventureSettings from './adventure-settings';
import { discoveredTargets, startPlay } from './engine/play';
import { adventurePack, generateAdventureWorld } from './generate-world';
import { worldNamesFrom } from './content/v1/world-names';
import { describePlay, playScreenTitle, renderPlayScreen, unplayableMessage } from './play-screen';
import { summariseAdventure } from './start-screen-model';

let app: HTMLElement;
const settings = Array.from({ length: 100 }, (_, seed) =>
  adventureSettings.createAdventureSettings(seed, 'short'))
  .find((value) => value.genre === 'light-fantasy')!;

beforeEach(async () => {
  vi.resetModules();
  window.history.replaceState(null, '', '/');
  app = document.createElement('main');
  app.id = 'app';
  document.body.append(app);
  await import('./main');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  document.body.replaceChildren();
});

function get<T extends Element>(selector: string): T {
  const element = app.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function openAdventure(word: string): void {
  get<HTMLInputElement>('#share-word').value = word;
  get<HTMLFormElement>('#open-share-word').requestSubmit();
}

function shownDetails(): Record<string, string> {
  const terms = [...app.querySelectorAll('dt')];
  const values = [...app.querySelectorAll('dd')];
  return Object.fromEntries(terms.map((term, index) => [term.textContent, values[index].textContent]));
}

function expectPlay(settings: adventureSettings.AdventureSettings): void {
  const world = generateAdventureWorld(settings);
  const named = { ...world, names: worldNamesFrom(adventurePack(settings.version, settings.genre), world) };
  const view = describePlay(named, startPlay(named));
  expect(get('.play-place-name').textContent).toBe(view.placeName);
  expect(get('.play-place p:nth-of-type(3)').textContent).toBe(view.placeText);
  expect(shownDetails()).toEqual({
    'Share word': adventureSettings.encodeShareWord(settings),
    Genre: summariseAdventure(settings).genreLabel,
    Length: summariseAdventure(settings).lengthLabel,
  });
  expect(document.activeElement).toBe(get('h1'));
  expect(app.querySelectorAll('h1')).toHaveLength(1);
  expect(adventurePack(settings.version, settings.genre).plots.map(({ name }) => name))
    .toContain(get('h1').textContent);
  expect(app.firstElementChild).toBe(get('h1'));
  expect(get('h1').nextElementSibling).toBe(get('header'));
  expect(get('h1').getAttribute('tabindex')).toBe('-1');
  expect(app.querySelector('#new-adventure')).toBeNull();
  expect(app.textContent).not.toContain('coming soon');
}

it('mounts the start screen and focuses its heading', () => {
  expect(get('h1').textContent).toBe('textQuest');
  expect(get('#new-adventure')).not.toBeNull();
  expect(get('#open-share-word')).not.toBeNull();
  expect(document.activeElement).toBe(get('h1'));
});

it.each<adventureSettings.AdventureGenre>(['light-fantasy', 'cosy-mystery', 'science-fiction'])(
  'starts a playable %s adventure from a fresh random seed', async (genre) => {
    const newSettings = Array.from({ length: 100 }, (_, seed) =>
      adventureSettings.createAdventureSettings(seed, 'short'))
      .find((value) => value.genre === genre)!;
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementationOnce((array) => {
      if (!(array instanceof Uint32Array)) throw new Error('Expected a seed buffer');
      array[0] = newSettings.seed;
      return array;
    });
    const module = await import('./adventure-settings');
    const create = vi.spyOn(module, 'createNewAdventureSettings');
    get<HTMLInputElement>('#length-short').checked = true;

    get<HTMLFormElement>('#new-adventure').requestSubmit();

    expect(random).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledExactlyOnceWith('short', undefined);
    expectPlay(newSettings);
    const title = get('h1').textContent;
    const word = shownDetails()['Share word'];
    get<HTMLButtonElement>('header button').click();
    openAdventure(word);
    expectPlay(newSettings);
    expect(get('h1').textContent).toBe(title);
  },
);

it.each([1, 2])('opens all version %i shared genres directly in play, accepting capitals and hyphens', (version) => {
  for (const genre of adventureSettings.adventureGenres) {
    const sharedSettings = Array.from({ length: 100 }, (_, seed) =>
      adventureSettings.createAdventureSettings(seed, 'short', version))
      .find((value) => value.genre === genre)!;
    openAdventure(` ${adventureSettings.encodeShareWord(sharedSettings).toUpperCase()}- `);

    expectPlay(sharedSettings);
    const direct = document.createElement('main');
    renderPlayScreen(direct, sharedSettings);
    expect(get('h1').textContent).toBe(direct.querySelector('h1')?.textContent);
    expect(get('h1').textContent).not.toBe(playScreenTitle);
    get<HTMLButtonElement>('header button').click();
  }
});

it('keeps invalid share words on the start screen without creating markup', () => {
  openAdventure('<img src=x onerror=alert(1)>');

  expect(app.querySelector('.play-screen')).toBeNull();
  expect(app.querySelector('img')).toBeNull();
  expect(get('#share-word-error').textContent).not.toBe('');
  expect(document.activeElement).toBe(get('#share-word'));
});

it('returns to start with heading focus and restarts the share word without progress', () => {
  const word = adventureSettings.encodeShareWord(settings);
  openAdventure(word);
  const generated = generateAdventureWorld(settings);
  const world = {
    ...generated,
    names: worldNamesFrom(adventurePack(settings.version, settings.genre), generated),
  };
  const state = startPlay(world);
  const exit = world.exits.find((value) => value.fromPlaceId === state.placeId && !value.locked)!;
  const target = discoveredTargets(world, state).find((value) => value.kind === 'exit' && value.id === exit.id)!;
  get<HTMLInputElement>('#play-command').value = `go to ${target.name}`;
  get<HTMLFormElement>('.play-command').requestSubmit();
  expect(get('.play-log').children).toHaveLength(1);
  expect(get('.play-sidebar > p:last-child').textContent).toBe('Turns taken: 1');

  get<HTMLButtonElement>('header button').click();

  expect(get('h1').textContent).toBe('textQuest');
  expect(document.activeElement).toBe(get('h1'));
  expect(app.querySelector('.play-screen')).toBeNull();
  expect(app.querySelector('header')).toBeNull();
  openAdventure(word);
  expectPlay(settings);
  expect(get('.play-log').children).toHaveLength(0);
  expect(get('.play-sidebar > p:last-child').textContent).toBe('Turns taken: 0');
});

it('shows a generation error and still lets the player return to start', async () => {
  const generator = await import('./generate-world');
  vi.spyOn(generator, 'generateAdventureWorld').mockImplementationOnce(() => {
    throw new RangeError('The genre does not match this seed and version.');
  });
  openAdventure(adventureSettings.encodeShareWord(settings));

  expect(get('[role="alert"]').textContent).toBe(unplayableMessage);
  expect(shownDetails()['Share word']).toBe(adventureSettings.encodeShareWord(settings));
  expect(app.querySelectorAll('h1')).toHaveLength(1);
  expect(get('h1').textContent).toBe(playScreenTitle);
  expect(app.firstElementChild).toBe(get('h1'));
  expect(get('h1').nextElementSibling).toBe(get('header'));
  expect(document.activeElement).toBe(get('h1'));
  get<HTMLButtonElement>('header button').click();
  expect(get('#new-adventure')).not.toBeNull();
  expect(document.activeElement).toBe(get('h1'));
});

async function openLink(word: string, path = '/textQuest/'): Promise<void> {
  const url = new URL(path, window.location.href);
  url.searchParams.set('adventure', word);
  window.history.replaceState(null, '', url);
  vi.resetModules();
  await import('./main');
}

it.each([1, 2])('opens version %i links in fresh play for all genres and lengths', async (version) => {
  for (const genre of adventureSettings.adventureGenres) {
    for (const length of adventureSettings.adventureLengths) {
      const shared = Array.from({ length: 100 }, (_, seed) =>
        adventureSettings.createAdventureSettings(seed, length, version))
        .find((value) => value.genre === genre)!;
      await openLink(` ${adventureSettings.encodeShareWord(shared).toUpperCase()}- `);
      expectPlay(shared);
      expect(get('.play-log').children).toHaveLength(0);
      expect(get('.play-sidebar > p:last-child').textContent).toBe('Turns taken: 0');
      const link = new URL(get<HTMLInputElement>('#adventure-link').value);
      expect(link.pathname).toBe('/textQuest/');
      expect(link.searchParams.get('adventure')).toBe(adventureSettings.encodeShareWord(shared));
    }
  }
});

it.each(['', 'nope', 'silverlantern3', '<img src=x onerror=alert(1)>'])(
  'keeps the incoming word %j in an accessible error field', async (word) => {
    await openLink(word);
    expect(get<HTMLInputElement>('#share-word').value).toBe(word);
    expect(get('#share-word').getAttribute('aria-invalid')).toBe('true');
    expect(get('#share-word-error').getAttribute('role')).toBe('alert');
    expect(get('#share-word-error').textContent).not.toBe('');
    if (word === 'silverlantern3') expect(get('#share-word-error').textContent).toContain('version 3');
    expect(document.activeElement).toBe(get('#share-word'));
    expect(app.querySelector('.play-screen')).toBeNull();
    expect(app.querySelector('img')).toBeNull();
    openAdventure(adventureSettings.encodeShareWord(settings));
    expectPlay(settings);
  },
);

it('copies the link and announces success without including any progress', async () => {
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const word = adventureSettings.encodeShareWord(settings);
  await openLink(word, '/games/textQuest/index.html?save=private#progress');
  const originalLink = get<HTMLInputElement>('#adventure-link').value;
  const title = get('h1').textContent;
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  get<HTMLButtonElement>('.share-link button').click();
  await vi.waitFor(() => expect(get('[role="status"]').textContent).toBe('Adventure link copied.'));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(originalLink);
  const link = new URL(originalLink);
  expect(link.pathname).toBe('/games/textQuest/index.html');
  expect([...link.searchParams]).toEqual([['adventure', word]]);
  expect(link.hash).toBe('');
  const open = get<HTMLAnchorElement>('.share-link a');
  expect(open.href).toBe(originalLink);
  expect(open.target).toBe('_blank');
  expect(open.rel).toBe('noopener');
  expect(open.textContent).toContain('new tab');
  await openLink(link.searchParams.get('adventure')!, link.pathname);
  expect(get('.play-log').children).toHaveLength(0);
  expectPlay(settings);
  expect(get('h1').textContent).toBe(title);
});

it.each(['missing', 'denied'] as const)('offers an accessible manual link when clipboard is %s', async (failure) => {
  if (failure === 'missing') {
    vi.stubGlobal('navigator', { clipboard: undefined });
  } else {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
  }
  openAdventure(adventureSettings.encodeShareWord(settings));
  const link = get<HTMLInputElement>('#adventure-link');
  expect(link.readOnly).toBe(true);
  expect(get('label[for="adventure-link"]').textContent).toBe('Adventure link');
  expect(link.getAttribute('aria-describedby')).toBe('adventure-link-hint');
  get<HTMLButtonElement>('.share-link button').click();
  await vi.waitFor(() => expect(get('[role="status"]').textContent).toContain('Could not copy'));
  expect(document.activeElement).toBe(link);
  expect(link.selectionStart).toBe(0);
  expect(link.selectionEnd).toBe(link.value.length);
  expect(get<HTMLAnchorElement>('.share-link a').href).toBe(link.value);
});

it('does not move focus back to an ended session when clipboard permission is refused later', async () => {
  let rejectCopy!: (reason: Error) => void;
  vi.spyOn(navigator.clipboard, 'writeText').mockReturnValue(new Promise((_resolve, reject) => {
    rejectCopy = reject;
  }));
  openAdventure(adventureSettings.encodeShareWord(settings));
  get<HTMLButtonElement>('.share-link button').click();
  get<HTMLButtonElement>('header button').click();
  rejectCopy(new Error('Permission refused'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(get('h1'));
  expect(get('h1').textContent).toBe('textQuest');
});

it('clears the incoming adventure on return to start so reloading does not restart it', async () => {
  await openLink(adventureSettings.encodeShareWord(settings));
  get<HTMLButtonElement>('header button').click();
  expect(new URL(window.location.href).searchParams.has('adventure')).toBe(false);
  expect(window.location.pathname).toBe('/textQuest/');
  vi.resetModules();
  await import('./main');
  expect(get('h1').textContent).toBe('textQuest');
  expect(document.activeElement).toBe(get('h1'));
});

it('opens an adventure link without reading or overwriting existing player saves', async () => {
  const getItem = vi.spyOn(Storage.prototype, 'getItem');
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
  await openLink(adventureSettings.encodeShareWord(settings));
  expect(getItem).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
  expect(removeItem).not.toHaveBeenCalled();
});
