// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdventureSettings, type AdventureGenre, type AdventureSettings,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import { commandHelp } from './engine/commands';
import { startPlay } from './engine/play';
import { generateAdventureWorld } from './generate-world';
import { describePlay, renderPlayScreen, unplayableMessage } from './play-screen';

vi.mock('./generate-world', async (original) => {
  const actual = await original<typeof import('./generate-world')>();
  return { generateAdventureWorld: vi.fn(actual.generateAdventureWorld) };
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
  items: [{ id: 'brass-key', placeId: 'gate' }],
  clues: [{ id: 'carved-note', placeId: 'gate' }],
  solution: {
    steps: [{
      id: 'open-path', placeId: 'gate', conditions: { itemsHeld: ['brass-key'] },
      effects: [{ kind: 'unlock-exit', exitId: 'path' }],
    }],
    goal: { placeId: 'old-tower', conditions: { stepsDone: ['open-path'] } },
  },
};

function settingsFor(genre: AdventureGenre): AdventureSettings {
  for (let seed = 0; ; seed += 1) {
    const settings = createAdventureSettings(seed, 'short');
    if (settings.genre === genre) return settings;
  }
}

function renderTiny(): HTMLElement {
  vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
  const target = document.createElement('main');
  document.body.append(target);
  renderPlayScreen(target, settingsFor('light-fantasy'));
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

    const view = describePlay(generateAdventureWorld(settings), startPlay(generateAdventureWorld(settings)));
    expect(target.querySelector('h2')?.textContent).toBe(view.placeName);
    expect(target.querySelector('label')?.textContent).toBe('What do you do?');
    expect(target.querySelector<HTMLLabelElement>('label')?.htmlFor).toBe('play-command');
    expect(target.querySelector('.play-log')?.children).toHaveLength(0);
    expect(target.querySelector<HTMLElement>('.play-ending')?.hidden).toBe(true);
  });

  it('runs typed commands, logs them and announces each response', () => {
    const target = renderTiny();

    type(target, '  take brass key ');

    expect(text(target, '.play-typed')).toEqual(['> take brass key']);
    expect(target.querySelector('[aria-live="polite"]')?.textContent)
      .toMatch(/brass key/);
    expect(text(target, '.play-sidebar ul')[0]).toBe('brass key');
    expect(target.querySelector('.play-sidebar p')?.textContent).toBe('Turns taken: 1');
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

  it('shows the ending when the goal is reached and hides it again after undo', () => {
    const target = renderTiny();
    const ending = target.querySelector<HTMLElement>('.play-ending')!;

    type(target, 'take brass key');
    type(target, 'use brass key');
    type(target, 'go to old tower');

    expect(ending.hidden).toBe(false);
    expect(ending.textContent).toContain('You reached your goal in 3 turns.');
    expect(target.querySelector('h2')?.textContent).toBe('old tower');

    type(target, 'undo');
    expect(ending.hidden).toBe(true);
  });

  it('inserts typed text as plain text, never as markup', () => {
    const target = renderTiny();

    type(target, '<img src=x onerror=alert(1)>');

    expect(target.querySelector('img')).toBeNull();
    expect(text(target, '.play-typed')).toEqual(['> <img src=x onerror=alert(1)>']);
  });

  it('shows a plain message when the world cannot be generated', () => {
    vi.mocked(generateAdventureWorld).mockImplementationOnce(() => {
      throw new RangeError('World generation for cosy-mystery is not supported yet.');
    });
    const target = document.createElement('main');

    renderPlayScreen(target, settingsFor('cosy-mystery'));

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(unplayableMessage);
    expect(target.querySelector('form')).toBeNull();
  });
});

