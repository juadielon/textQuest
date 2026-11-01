// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdventureSettings, type AdventureGenre, type AdventureSettings,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import { commandHelp } from './engine/commands';
import { replayCommands, startPlay } from './engine/play';
import * as play from './engine/play';
import { generateAdventureWorld } from './generate-world';
import { describePlay, playScreenTitle, renderPlayScreen, unplayableMessage } from './play-screen';
import {
  createSave, exportSaveFile, MAX_COMMAND_LENGTH, MAX_SAVE_COMMANDS,
  MAX_SAVE_FILE_LENGTH, MAX_SAVE_NAME_LENGTH,
} from './saves';

vi.mock('./generate-world', async (original) => {
  const actual = await original<typeof import('./generate-world')>();
  return { generateAdventureWorld: vi.fn(actual.generateAdventureWorld) };
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
  vi.restoreAllMocks();
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
  it.each([MAX_SAVE_COMMANDS - 1, MAX_SAVE_COMMANDS])('replays %i commands and blocks input beyond the save count limit', (count) => {
    // Check the real history/guard without attaching ten thousand log entries.
    const append = vi.spyOn(HTMLOListElement.prototype, 'append').mockImplementation(() => undefined);
    const execute = vi.spyOn(play, 'playCommand');
    // The boundary needs all commands, but not a puzzle or a large target list.
    vi.mocked(generateAdventureWorld).mockReturnValueOnce({
      ...tinyWorld, places: [{ id: 'gate' }], exits: [], items: [], clues: [],
      solution: { steps: [], goal: { placeId: 'gate', conditions: {} } },
    });
    const target = document.createElement('main');
    document.body.append(target);
    const commands = Array<string>(count).fill('');
    const onCommand = vi.fn<(commands: readonly string[]) => void>();
    const settings = settingsFor('light-fantasy');
    renderPlayScreen(target, settings, { commands, onCommand });
    if (count < MAX_SAVE_COMMANDS) type(target, 'look');
    const recorded = count < MAX_SAVE_COMMANDS ? onCommand.mock.calls[0][0] : commands;
    expect(recorded).toHaveLength(MAX_SAVE_COMMANDS);
    expect(() => exportSaveFile(createSave('My trip', settings, recorded))).not.toThrow();
    const executions = execute.mock.calls.length;
    expect(append).toHaveBeenCalledTimes(MAX_SAVE_COMMANDS);
    for (const command of ['look', 'undo']) {
      type(target, command);
      expect(execute).toHaveBeenCalledTimes(executions);
      expect(append).toHaveBeenCalledTimes(MAX_SAVE_COMMANDS);
      expect(onCommand).toHaveBeenCalledTimes(MAX_SAVE_COMMANDS - count);
      expect(text(target, '#play-response')[0]).toContain('save command limit');
      expect(document.activeElement).toBe(target.querySelector('#play-command'));
      expect(target.querySelector('#play-command')!.getAttribute('aria-invalid')).toBe('true');
    }
  });

  it('counts escaped JSON at the file boundary and keeps rejected input out of history', () => {
    const settings = settingsFor('light-fantasy');
    const name = '\ud800'.repeat(MAX_SAVE_NAME_LENGTH);
    const commands = Array<string>(2400).fill('\\'.repeat(MAX_COMMAND_LENGTH));
    const size = (values: readonly string[]) => JSON.stringify(createSave(name, settings, values), null, 2).length;
    while (MAX_SAVE_FILE_LENGTH - size(commands) > 208) commands.push('a'.repeat(MAX_COMMAND_LENGTH));
    const emptyOverhead = size([...commands, '']) - size(commands);
    commands.push('a'.repeat(MAX_SAVE_FILE_LENGTH - size(commands) - emptyOverhead));
    expect(exportSaveFile(createSave(name, settings, commands))).toHaveLength(MAX_SAVE_FILE_LENGTH);
    const last = commands.pop()!;
    expect(last.length).toBeGreaterThan(0);
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    const target = document.createElement('main');
    document.body.append(target);
    const onCommand = vi.fn<(commands: readonly string[]) => void>();
    renderPlayScreen(target, settings, { commands, onCommand });
    type(target, last + '\\');
    expect(onCommand).not.toHaveBeenCalled();
    expect(text(target, '#play-response')[0]).toContain('save file limit');
    expect(target.querySelectorAll('.play-entry')).toHaveLength(commands.length);
    type(target, last);
    expect(onCommand).toHaveBeenCalledOnce();
    const recorded = onCommand.mock.calls[0][0];
    expect(exportSaveFile(createSave(name, settings, recorded))).toHaveLength(MAX_SAVE_FILE_LENGTH);
    expect(target.querySelector('#play-command')!.hasAttribute('aria-invalid')).toBe(false);
    type(target, 'undo');
    expect(onCommand).toHaveBeenCalledOnce();
    expect(text(target, '#play-response')[0]).toContain('save file limit');
    expect(target.querySelectorAll('.play-entry')).toHaveLength(recorded.length);
    const shortNameSave = createSave('A', settings, recorded);
    expect(exportSaveFile(shortNameSave)).toHaveLength(MAX_SAVE_FILE_LENGTH - 359);
    // A released near-limit save can still replay even without the reserved name space.
    const shortHistory = [...recorded, 'look'];
    expect(() => exportSaveFile(createSave('A', settings, shortHistory))).not.toThrow();
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    const resumed = document.createElement('main');
    document.body.append(resumed);
    const resumedCommand = vi.fn();
    renderPlayScreen(resumed, settings, { commands: shortHistory, onCommand: resumedCommand });
    expect(resumed.querySelectorAll('.play-entry')).toHaveLength(shortHistory.length);
    type(resumed, 'look');
    expect(resumedCommand).not.toHaveBeenCalled();
    expect(text(resumed, '#play-response')[0]).toContain('save file limit');
    expect(() => exportSaveFile(createSave('A', settings, shortHistory))).not.toThrow();
  });

  it('shows a generated world with a labelled command box and empty log', () => {
    const settings = settingsFor('light-fantasy');
    const target = document.createElement('main');

    renderPlayScreen(target, settings);

    const view = describePlay(generateAdventureWorld(settings), startPlay(generateAdventureWorld(settings)));
    expect(target.querySelector('.play-place-name')?.textContent).toBe(view.placeName);
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
    type(target, 'go to old tower');

    expect(ending.hidden).toBe(false);
    expect(ending.textContent).toContain('You reached your goal in 3 turns.');
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

  it('reports every command run so far after each typed command', () => {
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    const target = document.createElement('main');
    const onCommand = vi.fn();
    expect(renderPlayScreen(target, settingsFor('light-fantasy'), { onCommand })).toBe(true);

    type(target, ' take brass key ');
    type(target, 'undo');

    expect(onCommand.mock.calls).toEqual([[['take brass key']], [['take brass key', 'undo']]]);
    expect(target.querySelector<HTMLInputElement>('#play-command')?.maxLength).toBe(MAX_COMMAND_LENGTH);
  });

  it('replays saved commands into the same state and log, without announcing them', () => {
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    const target = document.createElement('main');
    const onCommand = vi.fn();
    const saved = ['take brass key', 'use brass key', 'hint'];

    renderPlayScreen(target, settingsFor('light-fantasy'), { commands: saved, onCommand });

    const view = describePlay(tinyWorld, replayCommands(tinyWorld, saved));
    expect(target.querySelector('.play-place-name')?.textContent).toBe(view.placeName);
    expect(text(target, '.play-sidebar ul')[0]).toBe(view.inventory[0]);
    expect(target.querySelector('.play-sidebar p')?.textContent).toBe(`Turns taken: ${view.turns}`);
    expect(text(target, '.play-typed')).toEqual(saved.map((command) => `> ${command}`));
    expect(target.querySelector('[aria-live="polite"]')?.textContent).toBe('');
    expect(onCommand).not.toHaveBeenCalled();

    type(target, 'go to old tower');
    expect(onCommand).toHaveBeenLastCalledWith([...saved, 'go to old tower']);
    expect(target.querySelector<HTMLElement>('.play-ending')?.hidden).toBe(false);
  });
  it('starts with one focusable h1 above h2 section headings', () => {
    const target = renderTiny();

    const title = target.firstElementChild as HTMLElement;
    expect(title.tagName).toBe('H1');
    expect(title.textContent).toBe(playScreenTitle);
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
      expect(target.querySelector('.play-place-name')?.textContent)
        .toBe(describePlay(world, startPlay(world)).placeName);
      expect(target.querySelector('form')).not.toBeNull();
    },
  );

  it('shows a plain message when the world cannot be generated', () => {
    vi.mocked(generateAdventureWorld).mockImplementationOnce(() => {
      throw new RangeError('The genre does not match this seed and version.');
    });
    const target = document.createElement('main');

    expect(renderPlayScreen(target, settingsFor('light-fantasy'))).toBe(false);

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
