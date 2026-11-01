// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as adventureSettings from './adventure-settings';
import { discoveredTargets, startPlay } from './engine/play';
import { generateAdventureWorld } from './generate-world';
import { describePlay, playScreenTitle, unplayableMessage } from './play-screen';
import { summariseAdventure } from './start-screen-model';

let app: HTMLElement;
const settings = Array.from({ length: 100 }, (_, seed) =>
  adventureSettings.createAdventureSettings(seed, 'short'))
  .find((value) => value.genre === 'light-fantasy')!;

beforeEach(async () => {
  vi.resetModules();
  app = document.createElement('main');
  app.id = 'app';
  document.body.append(app);
  await import('./main');
});

afterEach(() => {
  vi.restoreAllMocks();
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
  const view = describePlay(world, startPlay(world));
  expect(get('.play-place-name').textContent).toBe(view.placeName);
  expect(get('.play-place p').textContent).toBe(view.placeText);
  expect(shownDetails()).toEqual({
    'Share word': adventureSettings.encodeShareWord(settings),
    Genre: summariseAdventure(settings).genreLabel,
    Length: 'Short',
  });
  expect(document.activeElement).toBe(get('h1'));
  expect(app.querySelectorAll('h1')).toHaveLength(1);
  expect(get('h1').textContent).toBe(playScreenTitle);
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
  },
);

it.each([1, 2])('opens all version %i shared genres directly in play, accepting capitals and hyphens', (version) => {
  for (const genre of adventureSettings.adventureGenres) {
    const sharedSettings = Array.from({ length: 100 }, (_, seed) =>
      adventureSettings.createAdventureSettings(seed, 'short', version))
      .find((value) => value.genre === genre)!;
    openAdventure(` ${adventureSettings.encodeShareWord(sharedSettings).toUpperCase()}- `);

    expectPlay(sharedSettings);
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
  const world = generateAdventureWorld(settings);
  const state = startPlay(world);
  const exit = world.exits.find((value) => value.fromPlaceId === state.placeId && !value.locked)!;
  const target = discoveredTargets(world, state).find((value) => value.kind === 'exit' && value.id === exit.id)!;
  get<HTMLInputElement>('#play-command').value = `go to ${target.name}`;
  get<HTMLFormElement>('.play-command').requestSubmit();
  expect(get('.play-log').children).toHaveLength(1);
  expect(get('.play-sidebar p').textContent).toBe('Turns taken: 1');

  get<HTMLButtonElement>('header button').click();

  expect(get('h1').textContent).toBe('textQuest');
  expect(document.activeElement).toBe(get('h1'));
  expect(app.querySelector('.play-screen')).toBeNull();
  expect(app.querySelector('header')).toBeNull();
  openAdventure(word);
  expectPlay(settings);
  expect(get('.play-log').children).toHaveLength(0);
  expect(get('.play-sidebar p').textContent).toBe('Turns taken: 0');
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
