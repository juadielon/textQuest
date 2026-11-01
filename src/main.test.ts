// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as adventureSettings from './adventure-settings';
import { discoveredTargets, replayCommands, startPlay } from './engine/play';
import { generateAdventureWorld } from './generate-world';
import { describePlay, playScreenTitle, unplayableMessage } from './play-screen';
import { createSave, createSaveStore, PLAYED_KEY_PREFIX, SAVE_KEY_PREFIX } from './saves';
import { formatSaveTime, SAVE_LOCK_NAME } from './saves-screen';
import { summariseAdventure } from './start-screen-model';

let app: HTMLElement;
const settings = Array.from({ length: 100 }, (_, seed) =>
  adventureSettings.createAdventureSettings(seed, 'short'))
  .find((value) => value.genre === 'light-fantasy')!;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  app = document.createElement('main');
  app.id = 'app';
  document.body.append(app);
  await import('./main');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'locks');
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
  const view = describePlay(world, startPlay(world));
  expect(get('.play-place-name').textContent).toBe(view.placeName);
  expect(get('.play-place p').textContent).toBe(view.placeText);
  expect(shownDetails()).toEqual({
    'Share word': adventureSettings.encodeShareWord(settings),
    Genre: summariseAdventure(settings).genreLabel,
    Length: summariseAdventure(settings).lengthLabel,
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

it.each([1, 2])('saves, exports, imports and resumes version %i from a share link without sharing progress', async (version) => {
  // Like Web Locks shared by every tab: tasks run one at a time, later, in order.
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, task: () => unknown) => (queue = queue.then(task)));
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  // A short world keeps this test quick, as it is generated several times.
  const short = Array.from({ length: 100 }, (_, seed) =>
    adventureSettings.createAdventureSettings(seed, 'short', version))
    .find((value) => value.genre === 'light-fantasy')!;
  const word = adventureSettings.encodeShareWord(short);
  await openLink(word, '/textQuest/?unrelated=private#progress');
  expectPlay(short);
  expect(get<HTMLInputElement>('#save-name').value).toBe(word);
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
  await queue;
  expect(get('#save-status').textContent).toBe('Saved “My trip”.');

  get<HTMLButtonElement>('header button').click();
  expect(new URL(window.location.href).searchParams.has('adventure')).toBe(false);
  get<HTMLButtonElement>('#open-saves').click();
  expect(get('h1').textContent).toBe('Your saves');
  expect(document.activeElement).toBe(get('h1'));
  expect(get('.save-item h2').textContent).toBe('My trip');
  get<HTMLButtonElement>('.saves-list + button').click();
  expect(get('h1').textContent).toBe('textQuest');
  expect(document.activeElement).toBe(get('h1'));
  expect(get('#share-word-error').textContent).toBe('');
  get<HTMLButtonElement>('#open-saves').click();
  let exported: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    if (blob instanceof Blob) exported = blob;
    return 'blob:save-file';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const before = new Map(Object.entries(localStorage));
  get<HTMLButtonElement>('button[aria-label="Export: My trip"]').click();
  expect(exported).toBeDefined();
  const text = await exported!.text();
  expect(JSON.parse(text).settings.version).toBe(version);
  const input = get<HTMLInputElement>('#import-save');
  Object.defineProperty(input, 'files', {
    configurable: true, value: [new File([text], 'trip.json', { type: 'application/json' })],
  });
  get<HTMLFormElement>('.save-form').requestSubmit();
  await vi.waitFor(() => expect(get('#import-status').textContent).toMatch(/Imported/));
  for (const [key, value] of before) expect(localStorage.getItem(key)).toBe(value);
  expect(app.querySelectorAll('.save-item')).toHaveLength(2);
  expect(document.activeElement).toBe(get('#import-status'));
  const imported = createSaveStore(localStorage).list()
    .find((entry) => entry.status === 'ready' && entry.name === 'My trip' && !entry.lastPlayedAt);
  if (!imported) throw new Error('Missing imported save');
  const importedTitle = document.getElementById(`save-${imported.id}`);
  const resumeImported = importedTitle?.closest('.save-item')
    ?.querySelector<HTMLButtonElement>('button[aria-label^="Resume:"]');
  if (!resumeImported) throw new Error('Missing imported save');
  resumeImported.click();

  expect(shownDetails()['Share word']).toBe(word);
  const view = describePlay(world, replayCommands(world, commands));
  expect(get('.play-place-name').textContent).toBe(view.placeName);
  expect(get('.play-sidebar p').textContent).toBe(`Turns taken: ${view.turns}`);
  expect([...app.querySelectorAll('.play-typed')].map((node) => node.textContent))
    .toEqual(commands.map((command) => `> ${command}`));
  expect(get<HTMLInputElement>('#save-name').value).toBe('My trip');
  expect(document.activeElement).toBe(get('h1'));
  const sharedLink = new URL(get<HTMLInputElement>('#adventure-link').value);
  expect(sharedLink.pathname).toBe('/textQuest/');
  expect([...sharedLink.searchParams]).toEqual([['adventure', word]]);
  expect(sharedLink.hash).toBe('');

  get<HTMLInputElement>('#play-command').value = 'inventory';
  get<HTMLFormElement>('.play-command').requestSubmit();
  get<HTMLFormElement>('.save-form').requestSubmit();
  await queue;
  expect(get('#save-status').textContent).toBe('Saved “My trip”.');
  get<HTMLButtonElement>('header button').click();
  get<HTMLButtonElement>('#open-saves').click();
  expect(app.querySelectorAll('.save-item')).toHaveLength(2);
  for (const [key, value] of before) expect(localStorage.getItem(key)).toBe(value);
  expect(request).toHaveBeenCalledTimes(5);
  const key = localStorage.key(0)!;
  const saved = localStorage.getItem(key);

  await openLink(sharedLink.searchParams.get('adventure')!, sharedLink.pathname);

  expectPlay(short);
  expect(get('.play-log').children).toHaveLength(0);
  expect(localStorage.getItem(key)).toBe(saved);
  get<HTMLButtonElement>('header button').click();
  get<HTMLButtonElement>('#open-saves').click();
  const secondResumeImported = document.getElementById(`save-${imported.id}`)
    ?.closest('.save-item')?.querySelector<HTMLButtonElement>('button[aria-label^="Resume:"]');
  if (!secondResumeImported) throw new Error('Missing imported save');
  secondResumeImported.click();
  expect([...app.querySelectorAll('.play-typed')].map((node) => node.textContent))
    .toEqual([...commands, 'inventory'].map((command) => `> ${command}`));
});

it('offers no save form when the world cannot be played', async () => {
  const generator = await import('./generate-world');
  vi.spyOn(generator, 'generateAdventureWorld').mockImplementationOnce(() => {
    throw new RangeError('The world cannot be generated.');
  });
  openAdventure(adventureSettings.encodeShareWord(settings));

  expect(app.querySelector('.save-form')).toBeNull();
  expect(get('[role="alert"]').textContent).toBe(unplayableMessage);
});

it.each(['changed', 'deleted', 'rejected'])('keeps pending-save %s failures visible after choosing Back', async (failure) => {
  let run!: () => void;
  let reject!: (error: Error) => void;
  const request = vi.fn((_name: string, task: () => void) => new Promise<void>((resolve, fail) => {
    run = () => { task(); resolve(); };
    reject = fail;
  }));
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  const saved = createSave('My trip', settings, ['look'], new Date('2026-10-01T09:00:00.000Z'));
  const store = createSaveStore(localStorage);
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  get<HTMLInputElement>('#play-command').value = 'inventory';
  get<HTMLFormElement>('.play-command').requestSubmit();
  const form = get<HTMLFormElement>('.save-form');
  form.requestSubmit();
  const back = get<HTMLButtonElement>('header button');
  back.click();
  expect(form.isConnected).toBe(true);
  expect(back.disabled).toBe(true);
  expect(get('#save-status').textContent).toContain('Saving');

  if (failure === 'changed') store.put(id, { ...saved, name: 'Other tab' });
  if (failure === 'deleted') store.remove(id);
  if (failure === 'rejected') reject(new DOMException('Lock unavailable', 'SecurityError'));
  else run();
  await vi.waitFor(() => expect(back.disabled).toBe(false));

  expect(get('h1').textContent).toBe(playScreenTitle);
  expect(form.isConnected).toBe(true);
  expect(get('#save-status').textContent).toContain(failure === 'rejected' ? 'could not lock' : failure);
  expect([...app.querySelectorAll('.play-typed')].map((node) => node.textContent))
    .toEqual(['> look', '> inventory']);
  expect(store.list()).toHaveLength(failure === 'deleted' ? 0 : 1);
  if (failure !== 'deleted') expect(store.load(id).commands).toEqual(['look']);

  form.requestSubmit();
  run();
  await vi.waitFor(() => expect(back.disabled).toBe(false));
  expect(get('#save-status').textContent).toContain('Saved');
  expect(store.list().filter((entry) => entry.status === 'ready' && entry.commandCount === 2))
    .toHaveLength(1);
  expect(form.isConnected).toBe(true);
  back.click();
  expect(get('h1').textContent).toBe('textQuest');
});

it('keeps Back blocked until every queued successful save finishes without navigating automatically', async () => {
  const waiting: (() => void)[] = [];
  const request = vi.fn((_name: string, task: () => void) => new Promise<void>((resolve) => {
    waiting.push(() => { task(); resolve(); });
  }));
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  openAdventure(adventureSettings.encodeShareWord(settings));
  const form = get<HTMLFormElement>('.save-form');
  form.requestSubmit();
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  form.requestSubmit();
  const back = get<HTMLButtonElement>('header button');
  back.click();
  expect(form.isConnected).toBe(true);
  waiting.shift()!();
  expect(back.disabled).toBe(true);
  expect(get('#save-status').textContent).toContain('Saving');
  expect(get('#save-status').textContent).not.toContain('Saved');
  back.click();
  expect(form.isConnected).toBe(true);
  waiting.shift()!();
  await vi.waitFor(() => expect(back.disabled).toBe(false));
  expect(form.isConnected).toBe(true);
  expect(get('#save-status').textContent).toContain('Saved');
  const saves = createSaveStore(localStorage).list();
  expect(saves).toHaveLength(1);
  expect(createSaveStore(localStorage).load(saves[0].id).commands).toEqual(['look']);
  back.click();
  expect(get('h1').textContent).toBe('textQuest');
});

it('keeps a queued lock failure visible through an intermediate successful save', async () => {
  const waiting: { run: () => void; reject: (error: Error) => void }[] = [];
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve, reject) => {
      waiting.push({ run: () => { task(); resolve(); }, reject });
    }) },
  });
  openAdventure(adventureSettings.encodeShareWord(settings));
  const form = get<HTMLFormElement>('.save-form');
  form.requestSubmit();
  form.requestSubmit();
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  form.requestSubmit();
  const back = get<HTMLButtonElement>('header button');
  waiting.shift()!.reject(new DOMException('Lock unavailable', 'SecurityError'));
  await vi.waitFor(() => expect(get('#save-status').textContent).toContain('could not lock'));
  const warning = get('#save-status').textContent;
  waiting.shift()!.run();
  expect(back.disabled).toBe(true);
  expect(get('#save-status').textContent).toBe(warning);
  waiting.shift()!.run();
  expect(back.disabled).toBe(false);
  expect(get('#save-status').textContent).toBe(warning);
  const store = createSaveStore(localStorage);
  expect(store.load(store.list()[0].id).commands).toEqual(['look']);
});

it('retains the conflict and play session until both queued saves have finished', () => {
  const waiting: (() => void)[] = [];
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }) },
  });

  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const store = createSaveStore(localStorage);
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  waiting.shift()!();
  const form = get<HTMLFormElement>('.save-form');
  form.requestSubmit();
  form.requestSubmit();
  store.put(id, { ...saved, name: 'Other tab' });
  waiting.shift()!();
  const warning = get('#save-status').textContent;
  const back = get<HTMLButtonElement>('header button');
  expect(warning).toContain('changed');
  expect(back.disabled).toBe(true);
  back.click();
  waiting.shift()!();
  expect(back.disabled).toBe(false);
  expect(form.isConnected).toBe(true);
  expect(get('#save-status').textContent).toBe(warning);
  expect(store.list()).toHaveLength(1);
  expect(store.load(id).name).toBe('Other tab');
});

it('keeps a newer invalid-name error when an earlier snapshot finishes saving', () => {
  let run!: () => void;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
      run = () => { task(); resolve(); };
    }) },
  });
  openAdventure(adventureSettings.encodeShareWord(settings));
  const form = get<HTMLFormElement>('.save-form');
  form.requestSubmit();
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  const name = get<HTMLInputElement>('#save-name');
  name.value = '';
  form.requestSubmit();
  const warning = get('#save-status').textContent;
  expect(warning).toContain('Give your save a name');
  run();
  expect(get('#save-status').textContent).toBe(warning);
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(name);
  expect(get<HTMLButtonElement>('header button').disabled).toBe(false);
  const store = createSaveStore(localStorage);
  expect(store.load(store.list()[0].id).commands).toEqual([]);
  name.value = 'Latest trip';
  form.requestSubmit();
  run();
  expect(name.hasAttribute('aria-invalid')).toBe(false);
  expect(get('#save-status').textContent).toBe('Saved “Latest trip”.');
  expect(store.list()).toHaveLength(1);
  expect(store.load(store.list()[0].id).commands).toEqual(['look']);
});

it.each(['success', 'conflict', 'rejection'])('keeps a pending delete %s on the saves screen when Back or Resume is chosen', async (result) => {
  let run!: () => void;
  let reject!: (error: Error) => void;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve, fail) => {
      run = () => { task(); resolve(); };
      reject = fail;
    }) },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  store.add({ ...saved, name: 'Other trip' });
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Delete: My trip"]').click();
  get<HTMLButtonElement>('button[aria-label="Yes, delete: My trip"]').click();
  const back = get<HTMLButtonElement>('.saves-list + button');
  const resume = get<HTMLButtonElement>('button[aria-label="Resume: Other trip"]');
  expect(back.disabled).toBe(true);
  expect(resume.disabled).toBe(true);
  back.click();
  resume.click();
  expect(get('h1').textContent).toBe('Your saves');
  if (result === 'conflict') store.put(id, { ...saved, name: 'Other tab' });
  if (result === 'rejection') reject(new DOMException('blocked', 'SecurityError'));
  else run();
  await vi.waitFor(() => expect(back.disabled).toBe(false));
  expect(get('h1').textContent).toBe('Your saves');
  expect(document.activeElement).toBe(get('.saves-status'));
  expect(get('.saves-status').textContent).toContain(
    result === 'success' ? 'Deleted' : result === 'conflict' ? 'not deleted' : 'could not lock',
  );
  expect(store.list()).toHaveLength(result === 'success' ? 1 : 2);
  back.click();
  expect(get('h1').textContent).toBe('textQuest');
});

it('allows Back after Keep and ignores a cancelled deletion rejection on the next screen', async () => {
  let reject!: (error: Error) => void;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: () => new Promise<void>((_resolve, fail) => { reject = fail; }) },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Delete: My trip"]').click();
  get<HTMLButtonElement>('button[aria-label="Yes, delete: My trip"]').click();
  get<HTMLButtonElement>('button[aria-label="Keep: My trip"]').click();
  get<HTMLButtonElement>('.saves-list + button').click();
  reject(new DOMException('blocked', 'SecurityError'));
  await Promise.resolve();
  expect(get('h1').textContent).toBe('textQuest');
  expect(document.activeElement).toBe(get('h1'));
  expect(store.load(id)).toEqual(saved);
});

it.each(['conflict', 'deleted', 'lock', 'storage'])('keeps name validation and an older %s save failure visible together', async (failure) => {
  let run!: () => void;
  let reject!: (error: Error) => void;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve, fail) => {
      run = () => { task(); resolve(); };
      reject = fail;
    }) },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, ['look'], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  const form = get<HTMLFormElement>('.save-form');
  form.requestSubmit();
  const name = get<HTMLInputElement>('#save-name');
  name.value = '';
  form.requestSubmit();
  if (failure === 'conflict') store.put(id, { ...saved, name: 'Other tab' });
  if (failure === 'deleted') store.remove(id);
  const write = failure === 'storage' ? vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  }) : undefined;
  if (failure === 'lock') reject(new DOMException('blocked', 'SecurityError'));
  else run();
  await vi.waitFor(() => expect(get<HTMLButtonElement>('header button').disabled).toBe(false));
  expect(get('#save-status').textContent).toContain('Give your save a name');
  expect(get('#save-status').textContent).toContain(
    failure === 'lock' ? 'could not lock' : failure === 'storage' ? 'storage' : failure === 'deleted' ? 'deleted' : 'changed',
  );
  expect(get('#save-status').textContent).not.toContain('Saving');
  expect(document.activeElement).toBe(name);
  expect(name.getAttribute('aria-invalid')).toBe('true');
  write?.mockRestore();
});

it('reports an older conflict after name correction and skips the pre-warning queued retry', () => {
  const waiting: (() => void)[] = [];
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }) },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  waiting.shift()!();
  const form = get<HTMLFormElement>('.save-form');
  form.requestSubmit();
  const name = get<HTMLInputElement>('#save-name');
  name.value = '';
  form.requestSubmit();
  name.value = 'Corrected trip';
  form.requestSubmit();
  store.put(id, { ...saved, name: 'Other tab' });
  waiting.shift()!();
  waiting.shift()!();
  expect(get<HTMLButtonElement>('header button').disabled).toBe(false);
  expect(get('#save-status').textContent).toContain('changed');
  expect(get('#save-status').textContent).toContain('Choose Save adventure again');
  expect(get('#save-status').textContent).not.toContain('Saving');
  expect(store.list()).toHaveLength(1);
  form.requestSubmit();
  waiting.shift()!();
  expect(get('#save-status').textContent).toBe('Saved “Corrected trip”.');
  expect(store.list()).toHaveLength(2);
});

async function openLink(word: string, path = '/textQuest/'): Promise<void> {
  const url = new URL(path, window.location.href);
  url.searchParams.set('adventure', word);
  window.history.replaceState(null, '', url);
  vi.resetModules();
  await import('./main');
}

it('records Last played on Resume and each command without changing the stored save', async () => {
  // Like Web Locks shared by every tab: tasks run one at a time, later, in order.
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, task: () => unknown) => (queue = queue.then(task)));
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  const text = localStorage.getItem(SAVE_KEY_PREFIX + id);
  get<HTMLButtonElement>('#open-saves').click();
  expect(shownDetails()['Last played']).toBe('Not recorded');
  expect(shownDetails()['Last saved']).toBe(formatSaveTime(saved.updatedAt));

  const times = [new Date('2026-10-05T01:00:00.000Z'), new Date('2026-10-05T02:00:00.000Z')];
  vi.useFakeTimers({ toFake: ['Date'], now: times[0] });
  try {
    get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
    // Written under the lock every tab shares, never straight away.
    expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBeNull();
    await queue;
    expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBe(times[0].toISOString());
    vi.setSystemTime(times[1]);
    get<HTMLInputElement>('#play-command').value = 'look';
    get<HTMLFormElement>('.play-command').requestSubmit();
    await queue;
    expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBe(times[1].toISOString());
    expect(request.mock.calls.map(([name]) => name)).toEqual([SAVE_LOCK_NAME, SAVE_LOCK_NAME]);
  } finally {
    vi.useRealTimers();
  }
  get<HTMLButtonElement>('header button').click();
  get<HTMLButtonElement>('#open-saves').click();

  expect(localStorage.getItem(SAVE_KEY_PREFIX + id)).toBe(text);
  expect(store.load(id)).toEqual(saved);
  expect(shownDetails()['Last played']).toBe(formatSaveTime(times[1].toISOString()));
  expect(shownDetails()['Last saved']).toBe(formatSaveTime(saved.updatedAt));
});

it('records play for a new save once saved, and stops after a conflict', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, task: () => void) => { task(); } },
  });
  openAdventure(adventureSettings.encodeShareWord(settings));
  const play = (command: string) => {
    get<HTMLInputElement>('#play-command').value = command;
    get<HTMLFormElement>('.play-command').requestSubmit();
  };
  play('look');
  expect(localStorage.length).toBe(0);
  get<HTMLFormElement>('.save-form').requestSubmit();
  await vi.waitFor(() => expect(get('#save-status').textContent).toContain('Saved'));
  const store = createSaveStore(localStorage);
  const [{ id }] = store.list();
  play('inventory');
  const recorded = localStorage.getItem(PLAYED_KEY_PREFIX + id);
  expect(recorded).not.toBeNull();

  const stored = store.load(id);
  store.put(id, { ...stored, name: 'Other tab' });
  localStorage.removeItem(PLAYED_KEY_PREFIX + id);
  get<HTMLFormElement>('.save-form').requestSubmit();
  await vi.waitFor(() => expect(get('#save-status').textContent).toContain('changed'));
  play('look');
  expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBeNull();
  expect(store.load(id).name).toBe('Other tab');
});

it('records the latest play time on a new save immediately after a conflict', async () => {
  const resumedAt = new Date('2026-10-05T01:00:00.000Z');
  const playedAt = new Date('2026-10-05T02:00:00.000Z');
  const copiedAt = new Date('2026-10-05T03:00:00.000Z');
  vi.useFakeTimers({ toFake: ['Date'], now: resumedAt });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, task: () => void) => { task(); } },
  });
  try {
    const store = createSaveStore(localStorage);
    const saved = createSave('My trip', settings, [], resumedAt);
    const id = store.add(saved);
    get<HTMLButtonElement>('#open-saves').click();
    get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();

    vi.setSystemTime(playedAt);
    get<HTMLInputElement>('#play-command').value = 'look';
    get<HTMLFormElement>('.play-command').requestSubmit();
    const timeBeforeConflict = localStorage.getItem(PLAYED_KEY_PREFIX + id);
    store.put(id, { ...saved, name: 'Other tab' });
    get<HTMLFormElement>('.save-form').requestSubmit();
    await vi.waitFor(() => expect(get('#save-status').textContent).toContain('changed'));

    vi.setSystemTime(copiedAt);
    get<HTMLFormElement>('.save-form').requestSubmit();
    const copy = store.list().find((entry) => entry.id !== id);

    expect(copy).toMatchObject({ status: 'ready', lastPlayedAt: playedAt.toISOString() });
    expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBe(timeBeforeConflict);
    expect(store.load(id).name).toBe('Other tab');
  } finally {
    vi.useRealTimers();
  }
});

it('clears only the deleted-save warning after recovery as a new save', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, task: () => void) => { task(); } },
  });
  const store = createSaveStore(localStorage);
  const deletedId = store.add(createSave('Deleted', settings, [], new Date('2026-10-01T09:00:00.000Z')));
  const otherId = store.add(createSave('Other', settings, [], new Date('2026-10-02T09:00:00.000Z')));
  get<HTMLButtonElement>('#open-saves').click();
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const failedWrite = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === PLAYED_KEY_PREFIX + otherId) throw new DOMException('blocked', 'SecurityError');
    originalSetItem(key, value);
  });
  try {
    get<HTMLButtonElement>('button[aria-label="Resume: Other"]').click();
    expect(get('#play-tracking-status').textContent).toContain('Last played time could not be recorded');
  } finally {
    failedWrite.mockRestore();
  }

  get<HTMLButtonElement>('header button').click();
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: Deleted"]').click();
  store.remove(deletedId);
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  expect(get('#play-tracking-status').textContent).toContain('This save was deleted in another tab');
  get<HTMLFormElement>('.save-form').requestSubmit();
  await vi.waitFor(() => expect(get('#save-status').textContent).toContain('deleted'));
  get<HTMLFormElement>('.save-form').requestSubmit();

  expect(get('#play-tracking-status').textContent).toContain('Last played time could not be recorded');
  expect(get('#play-tracking-status').textContent).not.toContain('This save was deleted in another tab');
  const recovered = store.list().find((entry) => entry.id !== otherId);
  expect(recovered).toMatchObject({ status: 'ready', lastPlayedAt: expect.any(String) });
});

it('does not record a queued command after the save changes while the lock waits', () => {
  const waiting: (() => void)[] = [];
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }) },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  waiting.shift()!();
  localStorage.removeItem(PLAYED_KEY_PREFIX + id);

  get<HTMLFormElement>('.save-form').requestSubmit();
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  const changed = { ...saved, name: 'Other tab', commands: ['north'] };
  store.put(id, changed);
  waiting.shift()!();
  waiting.shift()!();

  expect(store.load(id)).toEqual(changed);
  expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBeNull();
});

it('keeps a command played while the first save waits for its lock', () => {
  const waiting: (() => void)[] = [];
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }) },
  });
  const first = new Date('2026-10-05T01:00:00.000Z');
  const second = new Date('2026-10-05T02:00:00.000Z');
  vi.useFakeTimers({ toFake: ['Date'], now: first });
  try {
    openAdventure(adventureSettings.encodeShareWord(settings));
    const play = (command: string) => {
      get<HTMLInputElement>('#play-command').value = command;
      get<HTMLFormElement>('.play-command').requestSubmit();
    };
    play('look');
    vi.setSystemTime(new Date('2026-10-05T01:30:00.000Z'));
    get<HTMLFormElement>('.save-form').requestSubmit();
    vi.setSystemTime(second);
    play('inventory');
    expect(localStorage.length).toBe(0);

    waiting.shift()!();
    waiting.shift()!();

    const store = createSaveStore(localStorage);
    const [entry] = store.list();
    expect(entry.status).toBe('ready');
    if (entry.status !== 'ready') throw new Error('Expected the new save to be readable.');
    expect(entry.lastPlayedAt).toBe(second.toISOString());
    expect(store.load(entry.id).commands).toEqual(['look']);
  } finally {
    vi.useRealTimers();
  }
});

it('does not record queued play time when the first save fails', () => {
  const waiting: (() => void)[] = [];
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }) },
  });
  openAdventure(adventureSettings.encodeShareWord(settings));
  const play = (command: string) => {
    get<HTMLInputElement>('#play-command').value = command;
    get<HTMLFormElement>('.play-command').requestSubmit();
  };
  play('look');
  get<HTMLFormElement>('.save-form').requestSubmit();
  play('inventory');
  const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  try {
    waiting.shift()!();
    expect(localStorage.length).toBe(0);
    expect(get('#save-status').textContent).toContain('no room left');
    expect(get('.play-log').children).toHaveLength(2);
  } finally {
    write.mockRestore();
  }
});

it('refreshes the reopened saves list when a queued Resume time is recorded', () => {
  const waiting: (() => void)[] = [];
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
      waiting.push(() => { task(); resolve(); });
    }) },
  });
  const store = createSaveStore(localStorage);
  const first = store.add(createSave('First', settings, [], new Date('2026-10-01T09:00:00.000Z')));
  const second = store.add(createSave('Second', settings, [], new Date('2026-10-02T09:00:00.000Z')));
  get<HTMLButtonElement>('#open-saves').click();
  const initialOrder = [...app.querySelectorAll('.save-item h2')].map((node) => node.textContent!);
  const playedName = initialOrder[1]!;
  const otherName = initialOrder[0]!;
  get<HTMLButtonElement>(`button[aria-label="Resume: ${playedName}"]`).click();
  get<HTMLButtonElement>('header button').click();
  get<HTMLButtonElement>('#open-saves').click();
  const focused = get<HTMLButtonElement>(`button[aria-label="Delete: ${otherName}"]`);
  focused.focus();
  expect([...app.querySelectorAll('.save-item h2')].map((node) => node.textContent)).toEqual(initialOrder);

  waiting.shift()!();

  expect([...app.querySelectorAll('.save-item h2')].map((node) => node.textContent)).toEqual([playedName, otherName]);
  expect(document.activeElement?.getAttribute('aria-label')).toBe(`Delete: ${otherName}`);
  expect(store.list()[0]).toMatchObject({ id: playedName === 'First' ? first : second, lastPlayedAt: expect.any(String) });
});

it.each(['start', 'saves', 'another play'])(
  'reports a queued Last played failure on the current %s screen without replacing other statuses',
  (destination) => {
    const waiting: (() => void)[] = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
          waiting.push(() => { task(); resolve(); });
        }),
      },
    });
    const store = createSaveStore(localStorage);
    const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
    const id = store.add(saved);
    get<HTMLButtonElement>('#open-saves').click();
    get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
    get<HTMLButtonElement>('header button').click();

    if (destination === 'saves') {
      get<HTMLButtonElement>('#open-saves').click();
    } else if (destination === 'another play') {
      openAdventure(adventureSettings.encodeShareWord(settings));
      get<HTMLInputElement>('#play-command').value = 'look';
      get<HTMLFormElement>('.play-command').requestSubmit();
    } else {
      get<HTMLInputElement>('#share-word').value = 'not-a-share-word';
      get<HTMLFormElement>('#open-share-word').requestSubmit();
    }

    const otherStatus = destination === 'start'
      ? get('#share-word-error')
      : destination === 'saves'
        ? get('#saves-status')
        : get('.share-link [role="status"]');
    if (destination !== 'start') otherStatus.textContent = 'An earlier screen message.';
    const previousMessage = otherStatus.textContent;
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === PLAYED_KEY_PREFIX + id) throw new DOMException('blocked', 'SecurityError');
      originalSetItem(key, value);
    });
    try {
      waiting.shift()!();

      expect(get('#play-tracking-status').textContent)
        .toContain('Last played time could not be recorded');
      expect(otherStatus.textContent).toBe(previousMessage);
      expect(app.querySelector('h1')?.textContent).toBe(
        destination === 'start' ? 'textQuest' : destination === 'saves' ? 'Your saves' : playScreenTitle,
      );
    } finally {
      write.mockRestore();
    }
  },
);

it('reports a queued lock rejection after navigation without replacing other statuses', async () => {
  let reject!: (error: DOMException) => void;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: () => new Promise<void>((_resolve, fail) => { reject = fail; }),
    },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  get<HTMLButtonElement>('header button').click();
  get<HTMLInputElement>('#share-word').value = 'not-a-share-word';
  get<HTMLFormElement>('#open-share-word').requestSubmit();
  const shareError = get('#share-word-error').textContent;

  reject(new DOMException('blocked', 'SecurityError'));
  await vi.waitFor(() => expect(get('#play-tracking-status').textContent)
    .toContain('Last played time could not be recorded'));

  expect(get('#share-word-error').textContent).toBe(shareError);
  expect(get('h1').textContent).toBe('textQuest');
});

it('reports when a save disappears before its queued Last played write runs', () => {
  const waiting: (() => void)[] = [];
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, task: () => void) => new Promise<void>((resolve) => {
        waiting.push(() => { task(); resolve(); });
      }),
    },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  store.remove(id);

  waiting.shift()!();

  expect(get('#play-tracking-status').textContent)
    .toContain('This save was deleted in another tab');
  expect(get('#play-tracking-status').textContent).not.toContain('Your save is safe');
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  waiting.shift()!();
  expect(get('.play-log').children).toHaveLength(1);
  expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBeNull();
});

it('keeps playing when the browser cannot record Last played', () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, task: () => void) => { task(); } },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  try {
    get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
    get<HTMLInputElement>('#play-command').value = 'look';
    get<HTMLFormElement>('.play-command').requestSubmit();

    expect(get('h1').textContent).toBe(playScreenTitle);
    expect([...app.querySelectorAll('.play-typed')].map((node) => node.textContent)).toEqual(['> look']);
    expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBeNull();
    expect(store.load(id)).toEqual(saved);
    expect(get('.hint[role="status"]').textContent).toContain('Last played time could not be recorded');
  } finally {
    write.mockRestore();
  }
});

it('keeps playing without Web Locks and announces that Last played is unavailable', () => {
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();

  expect(get('h1').textContent).toBe(playScreenTitle);
  expect([...app.querySelectorAll('.play-typed')].map((node) => node.textContent)).toEqual(['> look']);
  expect(localStorage.getItem(PLAYED_KEY_PREFIX + id)).toBeNull();
  expect(store.load(id)).toEqual(saved);
  expect(store.list()[0]).not.toHaveProperty('lastPlayedAt');
  expect(get('.hint[role="status"]').textContent).toContain('Last played time could not be recorded');
});

it('announces a rejected play-time lock without stopping play', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: () => Promise.reject(new DOMException('blocked', 'SecurityError')) },
  });
  const store = createSaveStore(localStorage);
  const saved = createSave('My trip', settings, [], new Date('2026-10-01T09:00:00.000Z'));
  const id = store.add(saved);
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Resume: My trip"]').click();
  await vi.waitFor(() => expect(get('.hint[role="status"]').textContent).toContain('Last played time could not be recorded'));
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();

  expect([...app.querySelectorAll('.play-typed')].map((node) => node.textContent)).toEqual(['> look']);
  expect(store.load(id)).toEqual(saved);
  expect(store.list()[0]).not.toHaveProperty('lastPlayedAt');
});

it.each([1, 2])('opens version %i links in fresh play for all genres and lengths', async (version) => {
  for (const genre of adventureSettings.adventureGenres) {
    for (const length of adventureSettings.adventureLengths) {
      const shared = Array.from({ length: 100 }, (_, seed) =>
        adventureSettings.createAdventureSettings(seed, length, version))
        .find((value) => value.genre === genre)!;
      await openLink(` ${adventureSettings.encodeShareWord(shared).toUpperCase()}- `);
      expectPlay(shared);
      expect(get('.play-log').children).toHaveLength(0);
      expect(get('.play-sidebar p').textContent).toBe('Turns taken: 0');
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
  get<HTMLInputElement>('#play-command').value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  get<HTMLButtonElement>('.share-link button').click();
  await vi.waitFor(() => expect(get('.share-link [role="status"]').textContent).toBe('Adventure link copied.'));
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
  await vi.waitFor(() => expect(get('.share-link [role="status"]').textContent).toContain('Could not copy'));
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

it.each([1, 2])('opens a link without reading or overwriting an existing version %i save', async (version) => {
  const savedSettings = adventureSettings.createAdventureSettings(settings.seed, 'short', version);
  const saved = createSave('Existing trip', savedSettings, ['look'], new Date('2026-10-01T09:00:00.000Z'));
  const store = createSaveStore(localStorage);
  const id = store.add(saved);
  const getItem = vi.spyOn(Storage.prototype, 'getItem');
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
  await openLink(adventureSettings.encodeShareWord(settings));
  expect(getItem).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
  expect(removeItem).not.toHaveBeenCalled();
  expect(store.load(id)).toEqual(saved);
});

it('keeps a changed version 1 save when deleting it after opening a share link', async () => {
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, task: () => unknown) => (queue = queue.then(task)));
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  const oldSettings = adventureSettings.createAdventureSettings(settings.seed, 'short', 1);
  const old = createSave('Old trip', oldSettings, ['look'], new Date('2026-10-01T09:00:00.000Z'));
  const store = createSaveStore(localStorage);
  const id = store.add(old);
  await openLink(adventureSettings.encodeShareWord(settings));
  get<HTMLButtonElement>('header button').click();
  get<HTMLButtonElement>('#open-saves').click();
  get<HTMLButtonElement>('button[aria-label="Delete: Old trip"]').click();

  const changed = { ...old, name: 'Changed trip', commands: ['look', 'inventory'] };
  await request(SAVE_LOCK_NAME, () => store.put(id, changed));
  get<HTMLButtonElement>('button[aria-label="Yes, delete: Old trip"]').click();
  await queue;

  expect(request).toHaveBeenCalledTimes(2);
  expect(store.load(id)).toEqual(changed);
  expect(get('[role="status"]').textContent).toMatch(/not deleted.*confirm Delete again/);
  expect(get('.save-item h2').textContent).toBe('Changed trip');
  get<HTMLButtonElement>('button[aria-label="Resume: Changed trip"]').click();
  expect(shownDetails()['Share word']).toBe(adventureSettings.encodeShareWord(oldSettings));
  expect([...app.querySelectorAll('.play-typed')].map((node) => node.textContent))
    .toEqual(['> look', '> inventory']);
});

it('opens saves and returns to start after an invalid adventure link', async () => {
  const saved = createSave('Existing trip', settings, ['look'], new Date('2026-10-01T09:00:00.000Z'));
  const store = createSaveStore(localStorage);
  const id = store.add(saved);
  await openLink('silverlantern3', '/textQuest/index.html?theme=dark&lang=en#saves');
  expect(get('#share-word-error').textContent).toContain('version 3');
  expect(document.activeElement).toBe(get('#share-word'));

  get<HTMLButtonElement>('#open-saves').click();
  expect(get('.save-item h2').textContent).toBe('Existing trip');
  get<HTMLButtonElement>('.saves-list + button').click();

  expect(get('h1').textContent).toBe('textQuest');
  expect(document.activeElement).toBe(get('h1'));
  expect(get<HTMLInputElement>('#share-word').value).toBe('');
  expect(get('#share-word-error').textContent).toBe('');
  expect(store.load(id)).toEqual(saved);
  expect(new URL(window.location.href).searchParams.has('adventure')).toBe(false);
  expect(window.location.pathname).toBe('/textQuest/index.html');
  expect(window.location.search).toBe('?theme=dark&lang=en');
  expect(window.location.hash).toBe('#saves');
  vi.resetModules();
  await import('./main');
  expect(get('h1').textContent).toBe('textQuest');
  expect(document.activeElement).toBe(get('h1'));
  expect(get('#share-word-error').textContent).toBe('');
  expect(store.load(id)).toEqual(saved);
  expect(window.location.pathname).toBe('/textQuest/index.html');
  expect(window.location.search).toBe('?theme=dark&lang=en');
  expect(window.location.hash).toBe('#saves');
});

it.each(['\t', '\u0085', '\u2028'])('rejects a pasted %j before recording commands, then saves normally', (character) => {
  openAdventure(adventureSettings.encodeShareWord(settings));
  const input = get<HTMLInputElement>('#play-command');
  input.value = `look${character}around`;
  get<HTMLFormElement>('.play-command').requestSubmit();

  expect(get('.play-log').children).toHaveLength(0);
  expect(get('.play-sidebar p').textContent).toBe('Turns taken: 0');
  expect(get('[aria-live="polite"]').textContent).toMatch(/plain text.*tabs/);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(input);

  input.value = 'look';
  get<HTMLFormElement>('.play-command').requestSubmit();
  get<HTMLInputElement>('#save-name').value = 'Safe trip';
  get<HTMLFormElement>('.save-form').requestSubmit();

  expect(get('#save-status').textContent).toBe('Saved “Safe trip”.');
  expect(input.hasAttribute('aria-invalid')).toBe(false);
  const store = createSaveStore(localStorage);
  expect(store.load(store.list()[0].id).commands).toEqual(['look']);
});
