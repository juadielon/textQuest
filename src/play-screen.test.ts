// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord,
  type AdventureGenre, type AdventureSettings,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import type { ContentPack } from './content/v1/format';
import { commandHelp } from './engine/commands';
import { startPlay } from './engine/play';
import { adventurePack, generateAdventureWorld } from './generate-world';
import { worldNamesFrom } from './content/v1/world-names';
import { describePlay, playScreenTitle, renderPlayScreen, unplayableMessage } from './play-screen';

vi.mock('./generate-world', async (original) => {
  const actual = await original<typeof import('./generate-world')>();
  return {
    ...actual,
    generateAdventureWorld: vi.fn(actual.generateAdventureWorld),
    adventurePack: vi.fn(actual.adventurePack),
  };
});

vi.mock('./engine/play', async (original) => {
  const actual = await original<typeof import('./engine/play')>();
  return { ...actual, startPlay: vi.fn(actual.startPlay) };
});

// A tiny world that is quick to win, so the ending can be checked.
const tinyWorld: AdventureWorld = {
  version: 1,
  startPlaceId: 'gate',
  places: [{ id: 'gate' }, { id: 'old-tower' }],
  exits: [
    { id: 'path', fromPlaceId: 'gate', toPlaceId: 'old-tower', locked: true },
    { id: 'steps', fromPlaceId: 'old-tower', toPlaceId: 'gate', locked: false },
  ],
  items: [{ id: 'brass-key', placeId: 'gate' }, { id: 'hidden-gem', placeId: 'old-tower' }],
  clues: [{ id: 'carved-note', placeId: 'gate' }, { id: 'hidden-note', placeId: 'old-tower' }],
  solution: {
    steps: [{
      id: 'open-path', placeId: 'gate', conditions: { itemsHeld: ['brass-key'] },
      effects: [{ kind: 'unlock-exit', exitId: 'path' }],
    }],
    goal: { placeId: 'old-tower', conditions: { stepsDone: ['open-path'] } },
  },
};

const tinyPack: ContentPack = {
  version: 1,
  genre: 'light-fantasy',
  startPlaceId: 'gate',
  places: [
    { id: 'gate', name: 'gate', description: [] },
    { id: 'old-tower', name: 'old tower', description: [] },
  ],
  exits: [],
  characters: [{
    id: 'keeper', name: 'The old keeper', placeId: 'gate',
    description: ['The keeper holds a lamp.'],
    motive: ['She wants ', { kind: 'item', id: 'hidden-gem' }, ' kept safe.'],
  }],
  items: [
    { id: 'brass-key', placeId: 'gate', name: 'brass key', description: [] },
    { id: 'hidden-gem', placeId: 'remote-room', name: 'quiet gem', description: ['It glimmers softly.'] },
  ],
  clues: [
    { id: 'carved-note', placeId: 'gate', name: 'carved note', text: [] },
    { id: 'hidden-note', placeId: 'old-tower', name: 'hidden note', text: ['It names the unseen garden.'] },
  ],
  puzzles: [{
    id: 'open-path', placeId: 'gate', family: 'use-item',
    prompt: ['Try ', { kind: 'item', id: 'brass-key' }, '.'],
    completion: ['The way is open.'],
  }],
  optionalDiscoveries: [],
  plots: [{
    id: 'tiny', name: 'Tiny adventure',
    introduction: ['Find ', { kind: 'item', id: 'hidden-gem' }, ' and ', { kind: 'clue', id: 'hidden-note' }, '.'],
    lengths: {
      short: { placeIds: ['gate', 'old-tower'], requiredStepIds: [] },
      medium: { placeIds: ['gate', 'old-tower'], requiredStepIds: [] },
      long: { placeIds: ['gate', 'old-tower'], requiredStepIds: [] },
    },
    dependencies: {}, endingIds: ['plain-ending', 'key-ending', 'unmatched-ending'],
  }],
  endings: [
    { id: 'plain-ending', conditions: {}, text: ['A plain ending.'] },
    { id: 'key-ending', conditions: { itemsHeld: ['brass-key'] }, text: ['A good ending.'] },
    { id: 'unmatched-ending', conditions: { placesVisited: ['missing-place'] }, text: ['Never shown.'] },
  ],
  solution: { steps: [], goal: { placeId: 'old-tower', conditions: {} } },
};

function settingsFor(genre: AdventureGenre, version = 2): AdventureSettings {
  for (let seed = 0; ; seed += 1) {
    const settings = createAdventureSettings(seed, 'short', version);
    if (settings.genre === genre) return settings;
  }
}

function renderTiny(version = 2): HTMLElement {
  vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
  vi.mocked(adventurePack).mockReturnValueOnce(tinyPack);
  const target = document.createElement('main');
  document.body.append(target);
  renderPlayScreen(target, settingsFor('light-fantasy', version));
  return target;
}

function type(target: HTMLElement, command: string): void {
  const input = target.querySelector<HTMLInputElement>('#play-command')!;
  input.value = command;
  target.querySelector('form')!.requestSubmit();
}

const text = (target: HTMLElement, selector: string) =>
  [...target.querySelectorAll(selector)].map((node) => node.textContent);

afterEach(() => {
  document.body.replaceChildren();
});

describe('describePlay', () => {
  it('names the place, carried items and found clues without changing the state', () => {
    const state = startPlay(tinyWorld);
    const before = structuredClone(state);

    expect(describePlay(tinyWorld, state)).toEqual({
      placeName: 'gate',
      placeText: expect.stringContaining('You are at the gate.'),
      inventory: [],
      clues: ['carved note'],
      turns: 0,
      ended: false,
    });
    expect(state).toEqual(before);
  });
});

describe('renderPlayScreen', () => {
  it('shows a generated world with a labelled command box and empty log', () => {
    const settings = settingsFor('light-fantasy');
    const target = document.createElement('main');

    renderPlayScreen(target, settings);

    const generated = generateAdventureWorld(settings);
    const named = { ...generated, names: worldNamesFrom(adventurePack(settings.version, settings.genre), generated) };
    const view = describePlay(named, startPlay(named));
    expect(target.querySelector('.play-place-name')?.textContent).toBe(view.placeName);
    expect(target.querySelector('label')?.textContent).toBe('What do you do?');
    expect(target.querySelector<HTMLLabelElement>('label')?.htmlFor).toBe('play-command');
    expect(target.querySelector('.play-log')?.children).toHaveLength(0);
    expect(target.querySelector<HTMLElement>('.play-ending')?.hidden).toBe(true);
  });

  it('runs typed commands, logs them and announces each response', () => {
    const target = renderTiny();

    expect(target.querySelector('.play-story')?.textContent).toBe('Try brass key.');
    type(target, '  take brass key ');

    expect(text(target, '.play-typed')).toEqual(['> take brass key']);
    expect(target.querySelector('[aria-live="polite"]')?.textContent)
      .toMatch(/brass key/);
    expect(text(target, '.play-sidebar ul')[0]).toBe('brass key');
    expect(target.querySelector('.play-story')?.textContent).toBe('Try brass key.');
    expect(target.querySelector('.play-sidebar > p')?.textContent).toBe('Turns taken: 1');
    expect(target.querySelector<HTMLInputElement>('#play-command')?.value).toBe('');
  });

  it('supports help, hint and undo, and ignores blank input', () => {
    const target = renderTiny();

    type(target, '   ');
    type(target, 'help');
    type(target, 'hint');
    type(target, 'take brass key');
    type(target, 'undo');

    expect(text(target, '.play-typed')).toEqual(['> help', '> hint', '> take brass key', '> undo']);
    const responses = text(target, '.play-entry p:not(.play-typed)');
    expect(responses[0]).toBe(commandHelp);
    expect(responses[1]).not.toBe('');
    expect(responses[3]).toBe('You undo your last turn.');
    expect(text(target, '.play-sidebar ul')[0]).toBe('You are not carrying anything.');
  });

  it('keeps focus in the command box and re-announces a repeated response', () => {
    const target = renderTiny();
    const input = target.querySelector<HTMLInputElement>('#play-command')!;
    const announcer = target.querySelector('[aria-live="polite"]')!;
    target.querySelector('button')!.focus();

    type(target, 'hint');
    const first = announcer.firstChild;
    type(target, 'hint');

    expect(document.activeElement).toBe(input);
    expect(announcer.children).toHaveLength(1);
    expect(announcer.firstChild).not.toBe(first);
    expect(announcer.textContent).toBe(first?.textContent);
  });

  it('shows the ending when the goal is reached and hides it again after undo', () => {
    const target = renderTiny();
    const ending = target.querySelector<HTMLElement>('.play-ending')!;

    type(target, 'take brass key');
    type(target, 'use brass key');
    expect(target.querySelector('.play-story')?.textContent).toBe('The way is open.');
    type(target, 'go to old tower');

    expect(ending.hidden).toBe(false);
    expect(ending.textContent).toContain('You reached your goal in 3 turns.');
    expect(ending.textContent).toContain('A good ending.');
    expect(ending.textContent).not.toContain('Never shown.');
    expect(target.querySelector('.play-place-name')?.textContent).toBe('old tower');

    type(target, 'undo');
    expect(ending.hidden).toBe(true);
  });

  it('says "1 turn" for a one-move win', () => {
    vi.mocked(generateAdventureWorld).mockReturnValueOnce({
      ...tinyWorld,
      exits: [{ ...tinyWorld.exits[0], locked: false }],
      solution: { steps: [], goal: { placeId: 'old-tower', conditions: {} } },
    });
    vi.mocked(adventurePack).mockReturnValueOnce(tinyPack);
    const target = document.createElement('main');
    document.body.append(target);
    renderPlayScreen(target, settingsFor('light-fantasy'));

    type(target, 'go to old tower');

    expect(target.querySelector('.play-ending')?.textContent)
      .toContain('You reached your goal in 1 turn.');
  });

  it('inserts typed text as plain text, never as markup', () => {
    const target = renderTiny();

    type(target, '<img src=x onerror=alert(1)>');

    expect(target.querySelector('img')).toBeNull();
    expect(text(target, '.play-typed')).toEqual(['> <img src=x onerror=alert(1)>']);
  });

  it('starts with one focusable h1 above h2 section headings', () => {
    const target = renderTiny();

    const title = target.firstElementChild as HTMLElement;
    expect(title.tagName).toBe('H1');
    expect(title.textContent).toBe('Tiny adventure');
    expect(title.tabIndex).toBe(-1);
    expect(target.querySelectorAll('h1')).toHaveLength(1);
    expect(text(target, 'h2')).toEqual(['gate', 'The end', 'Inventory', 'Clues found']);
  });

  it.each<AdventureGenre>(['light-fantasy', 'cosy-mystery', 'science-fiction'])(
    'shows a playable %s world', (genre) => {
      const settings = settingsFor(genre);
      const target = document.createElement('main');

      renderPlayScreen(target, settings);

      const world = generateAdventureWorld(settings);
      const pack = adventurePack(settings.version, settings.genre);
      const named = { ...world, names: worldNamesFrom(pack, world) };
      expect(target.querySelector('.play-place-name')?.textContent)
        .toBe(describePlay(named, startPlay(named)).placeName);
      expect(target.querySelector('form')).not.toBeNull();
    },
  );

  it.each([
    [0, 'Restore the warning chain'],
    [1, 'Follow the teapot trail'],
    [2, 'Guide the overdue ship'],
    [5, 'Honour the station charter'],
    [8, 'Find the missing keeper'],
    [9, 'Renew the river pact'],
    [10, 'Follow two threads'],
    [11, 'Hear every side'],
    [20, 'Wake the quiet station'],
  ] as const)('pins seed %i title "%s" across released versions and lengths', (seed, title) => {
    const target = document.createElement('main');
    for (const version of [1, 2]) for (const length of adventureLengths) {
      const settings = createAdventureSettings(seed, length, version);
      const before = generateAdventureWorld(settings);
      const word = encodeShareWord(settings);
      renderPlayScreen(target, settings);
      expect(target.querySelector('h1')?.textContent).toBe(title);
      renderPlayScreen(target, parseShareWord(word));
      expect(target.querySelector('h1')?.textContent).toBe(title);
      expect(generateAdventureWorld(settings)).toEqual(before);
      expect(encodeShareWord(settings)).toBe(word);
    }
  });

  it('keeps the story title unchanged by commands and undo', () => {
    const target = renderTiny();
    type(target, 'take brass key');
    type(target, 'undo');
    expect(target.querySelector('h1')?.textContent).toBe('Tiny adventure');
    expect(target.querySelector('.play-plot-name')).toBeNull();
  });

  it('inserts the authored title as plain text', () => {
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    vi.mocked(adventurePack).mockReturnValueOnce({
      ...tinyPack, plots: [{ ...tinyPack.plots[0], name: '<img src=x onerror=alert(1)>' }],
    });
    const target = document.createElement('main');
    renderPlayScreen(target, settingsFor('light-fantasy'));
    expect(target.querySelector('h1')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(target.querySelector('img')).toBeNull();
  });

  it.each([1, 2])('shows authored names and safe prose for adventure version %i', (version) => {
    const settings = settingsFor('light-fantasy', version);
    const world = generateAdventureWorld(settings);
    const pack = adventurePack(version, settings.genre);
    const target = document.createElement('main');

    renderPlayScreen(target, settings);

    expect(target.querySelector('.play-place-name')?.textContent)
      .toBe(pack.places.find(({ id }) => id === world.startPlaceId)?.name);
    expect(target.querySelector('.play-description')?.textContent)
      .toBe(pack.places.find(({ id }) => id === world.startPlaceId)?.description.join(''));
    expect(target.querySelector('.play-introduction')?.textContent).not.toBe('');
    expect(target.textContent).not.toContain('river-token');
    expect(target.querySelector('form')).not.toBeNull();
  });

  it.each([1, 2])('uses the generated item location for prose references in version %i', (version) => {
    const target = renderTiny(version);
    expect(target.querySelector('.play-introduction')?.textContent).toBe('Find something and a clue.');
    expect(target.textContent).not.toContain('quiet gem');

    type(target, 'take brass key');
    type(target, 'use brass key');
    type(target, 'go old tower');
    expect(target.querySelector('.play-items-here')?.textContent).toContain('It glimmers softly.');
    expect(text(target, '.play-sidebar ul').join('')).toContain('It names the unseen garden.');
    type(target, 'go gate');
    expect(target.querySelector('.play-introduction')?.textContent)
      .toBe('Find quiet gem and hidden note.');
  });

  it.each([1, 2])('does not reveal a moved item at its authored pack location in version %i', (version) => {
    vi.mocked(generateAdventureWorld).mockReturnValueOnce({
      ...tinyWorld,
      items: tinyWorld.items.map((item) =>
        item.id === 'hidden-gem' ? { ...item, placeId: 'old-tower' } : item),
    });
    vi.mocked(adventurePack).mockReturnValueOnce(tinyPack);
    const target = document.createElement('main');
    document.body.append(target);
    renderPlayScreen(target, settingsFor('light-fantasy', version));

    expect(target.querySelector('.play-introduction')?.textContent).toBe('Find something and a clue.');
    expect(target.querySelector('.play-introduction')?.textContent).not.toContain('quiet gem');
  });

  it('shows a person’s motive only after the player talks to them', () => {
    const target = renderTiny();

    expect(target.querySelector('.play-people')?.textContent).toContain('The keeper holds a lamp.');
    expect(target.textContent).not.toContain('She wants');
    type(target, 'talk to old keeper');
    expect(target.querySelector('.play-log')?.textContent).toContain('She wants something kept safe.');
    expect(target.querySelector('.play-people')?.textContent).not.toContain('She wants');
  });

  it('shows a plain message when the world cannot be generated', () => {
    vi.mocked(generateAdventureWorld).mockImplementationOnce(() => {
      throw new RangeError('The genre does not match this seed and version.');
    });
    const target = document.createElement('main');

    renderPlayScreen(target, settingsFor('light-fantasy'));

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(unplayableMessage);
    expect(target.querySelector('h1')?.textContent).toBe(playScreenTitle);
    expect(target.querySelector('form')).toBeNull();
  });

  it('shows the accessible message for invalid settings', () => {
    const target = document.createElement('main');

    renderPlayScreen(target, { ...settingsFor('light-fantasy'), seed: -1 });

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(unplayableMessage);
    expect(target.querySelector<HTMLElement>('h1')?.tabIndex).toBe(-1);
    expect(target.querySelector('form')).toBeNull();
  });

  it('shows the accessible message for an invalid world', () => {
    vi.mocked(generateAdventureWorld).mockReturnValueOnce({
      ...tinyWorld, startPlaceId: 'missing-place',
    });
    const target = document.createElement('main');

    renderPlayScreen(target, settingsFor('light-fantasy'));

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(unplayableMessage);
    expect(target.querySelector<HTMLElement>('h1')?.tabIndex).toBe(-1);
    expect(target.querySelector('form')).toBeNull();
  });

  it.each([
    ['world generation', generateAdventureWorld],
    ['play setup', startPlay],
  ] as const)('rethrows unexpected errors from %s without showing the unplayable message', (_, operation) => {
    const error = new TypeError('Unexpected programming error.');
    vi.mocked(operation).mockImplementationOnce(() => { throw error; });
    const target = document.createElement('main');
    target.textContent = 'Previous screen';

    expect(() => renderPlayScreen(target, settingsFor('light-fantasy'))).toThrow(error);
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(target.textContent).toBe('Previous screen');
  });
});
