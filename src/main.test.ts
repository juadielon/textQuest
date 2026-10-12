// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as adventureSettings from './adventure-settings';
import { discoveredTargets, replayCommands, startPlay } from './engine/play';
import { generateAdventureWorld } from './generate-world';
import { describePlay, unplayableMessage } from './play-screen';
import { summariseAdventure } from './start-screen-model';

let app: HTMLElement;
const settings = Array.from({ length: 100 }, (_, seed) =>
  adventureSettings.createAdventureSettings(seed, 'long'))
  .find((value) => value.genre === 'light-fantasy')!;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
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

function expectPlay(): void {
  const world = generateAdventureWorld(settings);
  const view = describePlay(world, startPlay(world));
  expect(get('.play-place-name').textContent).toBe(view.placeName);
  expect(get('.play-place p').textContent).toBe(view.placeText);
  expect(shownDetails()).toEqual({
    'Share word': adventureSettings.encodeShareWord(settings),
    Genre: summariseAdventure(settings).genreLabel,
    Length: 'Long',
  });
  expect(document.activeElement).toBe(get('h1'));
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

it('opens a new adventure in play with the selected settings', async () => {
  const module = await import('./adventure-settings');
  const create = vi.spyOn(module, 'createNewAdventureSettings').mockReturnValue(settings);
  get<HTMLInputElement>('#length-long').checked = true;

  get<HTMLFormElement>('#new-adventure').requestSubmit();

  expect(create).toHaveBeenCalledExactlyOnceWith('long', undefined);
  expectPlay();
});

it('opens a shared adventure directly in play, accepting capitals and hyphens', () => {
  openAdventure(` ${adventureSettings.encodeShareWord(settings).toUpperCase()}- `);

  expectPlay();
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
  expectPlay();
  expect(get('.play-log').children).toHaveLength(0);
  expect(get('.play-sidebar p').textContent).toBe('Turns taken: 0');
});

it('shows an unsupported-world message and still lets the player return to start', () => {
  const unsupported = Array.from({ length: 100 }, (_, seed) =>
    adventureSettings.createAdventureSettings(seed, 'short'))
    .find((value) => value.genre === 'cosy-mystery')!;
  openAdventure(adventureSettings.encodeShareWord(unsupported));

  expect(get('[role="alert"]').textContent).toBe(unplayableMessage);
  expect(shownDetails()['Share word']).toBe(adventureSettings.encodeShareWord(unsupported));
  expect(document.activeElement).toBe(get('h1'));
  get<HTMLButtonElement>('header button').click();
  expect(get('#new-adventure')).not.toBeNull();
  expect(document.activeElement).toBe(get('h1'));
});

it('saves during play, lists the save and resumes the exact state and log', () => {
  // A short world keeps this test quick, as it is generated several times.
  const short = Array.from({ length: 100 }, (_, seed) =>
    adventureSettings.createAdventureSettings(seed, 'short'))
    .find((value) => value.genre === 'light-fantasy')!;
  openAdventure(adventureSettings.encodeShareWord(short));
  const world = generateAdventureWorld(short);
  const exit = world.exits.find((value) => value.fromPlaceId === world.startPlaceId && !value.locked)!;
  const name = discoveredTargets(world, startPlay(world)).find((value) => value.id === exit.id)!.name;
  const commands = [`go to ${name}`, 'hint', 'look'];
  for (const command of commands) {
    get<HTMLInputElement>('#play-command').value = command;
    get<HTMLFormElement>('.play-command').requestSubmit();
  }
  get<HTMLInputElement>('#save-name').value = 'My trip';
  get<HTMLFormElement>('.save-form').requestSubmit();
  expect(get('#save-status').textContent).toBe('Saved “My trip”.');

  get<HTMLButtonElement>('header button').click();
  get<HTMLButtonElement>('#open-saves').click();
  expect(get('h1').textContent).toBe('Your saves');
  expect(document.activeElement).toBe(get('h1'));
  expect(get('.save-item h2').textContent).toBe('My trip');
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();

  const view = describePlay(world, replayCommands(world, commands));
  expect(get('.play-place-name').textContent).toBe(view.placeName);
  expect(get('.play-sidebar p').textContent).toBe(`Turns taken: ${view.turns}`);
  expect([...app.querySelectorAll('.play-typed')].map((node) => node.textContent))
    .toEqual(commands.map((command) => `> ${command}`));
  expect(get<HTMLInputElement>('#save-name').value).toBe('My trip');
  expect(document.activeElement).toBe(get('h1'));

  get<HTMLInputElement>('#play-command').value = 'inventory';
  get<HTMLFormElement>('.play-command').requestSubmit();
  get<HTMLFormElement>('.save-form').requestSubmit();
  get<HTMLButtonElement>('header button').click();
  get<HTMLButtonElement>('#open-saves').click();
  expect(app.querySelectorAll('.save-item')).toHaveLength(1);
});

it('offers no save form when the world cannot be played', () => {
  const unsupported = Array.from({ length: 100 }, (_, seed) =>
    adventureSettings.createAdventureSettings(seed, 'short'))
    .find((value) => value.genre === 'cosy-mystery')!;
  openAdventure(adventureSettings.encodeShareWord(unsupported));

  expect(app.querySelector('.save-form')).toBeNull();
});