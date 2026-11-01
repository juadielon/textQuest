// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adventureLengths, createAdventureSettings, encodeShareWord, parseShareWord,
  type AdventureGenre, type AdventureSettings,
} from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import type { ContentPack } from './content/v1/format';
import { commandHelp } from './engine/commands';
import * as play from './engine/play';
import { adventurePack, generateAdventureWorld } from './generate-world';
import { worldNamesFrom } from './content/v1/world-names';
import { describePlay, playScreenTitle, renderPlayScreen, unplayableMessage } from './play-screen';
import {
  createSave, exportSaveFile, MAX_COMMAND_LENGTH, MAX_SAVE_COMMANDS,
  MAX_SAVE_FILE_LENGTH, MAX_SAVE_NAME_LENGTH,
} from './saves';

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

function completeSteps(
  world: AdventureWorld, stepIds: readonly string[], destination?: string,
): { readonly commands: readonly string[]; readonly state: play.PlayState } {
  const idWorld: play.PlayWorld = { ...world, names: undefined };
  const commands: string[] = [];
  let state = play.startPlay(idWorld);
  const run = (command: string) => {
    commands.push(command);
    state = play.playCommand(idWorld, state, command).state;
  };
  const routeTo = (placeId: string) => {
    const previous = new Map<string, string | null>([[state.placeId, null]]);
    const queue = [state.placeId];
    for (let index = 0; index < queue.length && !previous.has(placeId); index += 1) {
      const from = queue[index];
      for (const exit of idWorld.exits.filter(({ fromPlaceId }) => fromPlaceId === from)) {
        if (exit.locked && !state.unlockedExits.includes(exit.id)) continue;
        if (previous.has(exit.toPlaceId)) continue;
        previous.set(exit.toPlaceId, from);
        queue.push(exit.toPlaceId);
      }
    }
    if (!previous.has(placeId)) throw new Error(`No open route to ${placeId}.`);
    const route: string[] = [];
    for (let current = placeId; current !== state.placeId; current = previous.get(current)!) {
      route.push(current);
    }
    route.reverse().forEach((current) => run(`go to ${current.replace(/[-_]+/g, ' ')}`));
  };
  const completeStep = (id: string, resolving = new Set<string>()) => {
    if (state.stepsDone.includes(id)) return;
    if (resolving.has(id)) throw new Error(`The ${id} step has a dependency cycle.`);
    resolving.add(id);
    const step = idWorld.solution.steps.find((entry) => entry.id === id);
    if (!step) throw new Error(`The generated world has no ${id} step.`);
    for (const dependency of step.conditions.stepsDone ?? []) completeStep(dependency, resolving);
    for (const placeId of step.conditions.placesVisited ?? []) routeTo(placeId);
    for (const clueId of step.conditions.cluesRevealed ?? []) {
      const clue = idWorld.clues.find((entry) => entry.id === clueId);
      if (!clue) throw new Error(`The generated world has no ${clueId} clue.`);
      const placeId = clue.placeId;
      if (!placeId) throw new Error(`The ${clueId} clue is not available on the route.`);
      routeTo(placeId);
    }
    for (const itemId of step.conditions.itemsHeld ?? []) {
      if (state.itemsHeld.includes(itemId)) continue;
      const item = idWorld.items.find((entry) => entry.id === itemId);
      const placeId = item?.placeId;
      if (!placeId) throw new Error(`The ${itemId} item is not available on the route.`);
      routeTo(placeId);
      run(`take ${itemId.replace(/[-_]+/g, ' ')}`);
    }
    routeTo(step.placeId);
    for (const itemId of step.conditions.itemsHeld ?? []) {
      run(`use ${itemId.replace(/[-_]+/g, ' ')}`);
    }
    if (!state.stepsDone.includes(id)) throw new Error(`The ${id} step did not complete.`);
    resolving.delete(id);
  };
  stepIds.forEach((id) => completeStep(id));
  if (destination) routeTo(destination);
  return { commands, state };
}

const text = (target: HTMLElement, selector: string) =>
  [...target.querySelectorAll(selector)].map((node) => node.textContent);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('describePlay', () => {
  it('names the place, carried items and found clues without changing the state', () => {
    const state = play.startPlay(tinyWorld);
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
  it('shows rejected control characters visibly and clears the error on valid play', () => {
    const target = renderTiny();
    type(target, 'look\taround');
    const response = target.querySelector<HTMLElement>('#play-response')!;
    expect(response.textContent).toContain('plain text');
    expect(response.classList.contains('visually-hidden')).toBe(false);
    expect(response.getAttribute('aria-live')).toBe('polite');
    expect(target.querySelector('.play-command')!.nextElementSibling).toBe(response);
    expect(response.nextElementSibling).toBe(target.querySelector('.play-sidebar'));
    expect(target.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(target.querySelectorAll('.play-entry')).toHaveLength(0);
    type(target, 'look');
    expect(response.classList.contains('visually-hidden')).toBe(true);
    expect(response.textContent).not.toContain('plain text');
    expect(target.querySelectorAll('.play-entry')).toHaveLength(1);
    expect(target.querySelector('#play-command')!.hasAttribute('aria-invalid')).toBe(false);
  });

  it.each([MAX_SAVE_COMMANDS - 1, MAX_SAVE_COMMANDS])('replays %i commands and blocks input beyond the save count limit', (count) => {
    // Check the real history/guard without attaching ten thousand log entries.
    const append = vi.spyOn(HTMLOListElement.prototype, 'append').mockImplementation(() => undefined);
    const execute = vi.spyOn(play, 'playCommand');
    // The boundary needs all commands, but not a puzzle or a large target list.
    vi.mocked(generateAdventureWorld).mockReturnValueOnce({
      ...tinyWorld, places: [{ id: 'gate' }], exits: [], items: [], clues: [],
      solution: { steps: [], goal: { placeId: 'gate', conditions: {} } },
    });
    vi.mocked(adventurePack).mockReturnValueOnce(tinyPack);
    const target = document.createElement('main');
    document.body.append(target);
    const commands = Array<string>(count).fill('');
    const onCommand = vi.fn();
    const settings = settingsFor('light-fantasy');
    renderPlayScreen(target, settings, {
      commands, commandModes: Array<play.CommandReplayMode>(count).fill('id'), onCommand,
    });
    if (count < MAX_SAVE_COMMANDS) type(target, 'look');
    const recorded = count < MAX_SAVE_COMMANDS ? onCommand.mock.calls[0][0] : commands;
    const modes: play.CommandReplayMode[] = count < MAX_SAVE_COMMANDS
      ? onCommand.mock.calls[0][1] : Array<play.CommandReplayMode>(count).fill('id');
    expect(recorded).toHaveLength(MAX_SAVE_COMMANDS);
    expect(() => exportSaveFile(createSave('My trip', settings, recorded, new Date(), modes))).not.toThrow();
    const executions = execute.mock.calls.length;
    expect(append).toHaveBeenCalledTimes(MAX_SAVE_COMMANDS);
    for (const command of ['look', 'undo']) {
      type(target, command);
      expect(execute).toHaveBeenCalledTimes(executions);
      expect(append).toHaveBeenCalledTimes(MAX_SAVE_COMMANDS);
      expect(onCommand).toHaveBeenCalledTimes(MAX_SAVE_COMMANDS - count);
      expect(text(target, '#play-response')[0]).toContain('save command limit');
      expect(target.querySelector('#play-response')!.classList.contains('visually-hidden')).toBe(false);
      expect(document.activeElement).toBe(target.querySelector('#play-command'));
      expect(target.querySelector('#play-command')!.getAttribute('aria-invalid')).toBe('true');
    }
  });

  it('counts escaped JSON at the file boundary and keeps rejected input out of history', () => {
    const settings = settingsFor('light-fantasy');
    const name = '\ud800'.repeat(MAX_SAVE_NAME_LENGTH);
    const fullCommand = '\ud800'.repeat(MAX_COMMAND_LENGTH);
    const commands = Array<string>(900).fill(fullCommand);
    const modes = Array<play.CommandReplayMode>(commands.length).fill('id');
    const size = (values: readonly string[], replayModes: readonly play.CommandReplayMode[]) =>
      JSON.stringify(createSave(name, settings, values, new Date(), replayModes), null, 2).length;
    const baseSize = size([...commands, '', 'look'], [...modes, 'id', 'content']);
    const nextSize = size([...commands, fullCommand, '', 'look'], [...modes, 'id', 'id', 'content']);
    expect(baseSize).toBeLessThan(MAX_SAVE_FILE_LENGTH);
    const entrySize = nextSize - baseSize;
    const fullEntries = Math.floor((MAX_SAVE_FILE_LENGTH - baseSize) / entrySize);
    for (let index = 0; index < fullEntries; index += 1) {
      commands.push(fullCommand);
      modes.push('id');
    }
    let fillerSize = MAX_SAVE_FILE_LENGTH - size([...commands, '', 'look'], [...modes, 'id', 'content']);
    const exactContent = (length: number): string | undefined => {
      for (let surrogateCount = 0; surrogateCount <= MAX_COMMAND_LENGTH; surrogateCount += 1) {
        for (let slashCount = 0; slashCount + surrogateCount <= MAX_COMMAND_LENGTH; slashCount += 1) {
          const plainCount = length - surrogateCount * 6 - slashCount * 2;
          if (plainCount >= 0 && plainCount + slashCount + surrogateCount <= MAX_COMMAND_LENGTH) {
            return 'a'.repeat(plainCount) + '\\'.repeat(slashCount) + '\ud800'.repeat(surrogateCount);
          }
        }
      }
      return undefined;
    };
    let filler = exactContent(fillerSize);
    while (filler === undefined) {
      const modeIndex = modes.lastIndexOf('id');
      if (modeIndex < 0) throw new Error('Could not construct an exact-size save fixture.');
      modes[modeIndex] = 'content';
      fillerSize -= 5;
      filler = exactContent(fillerSize);
    }
    if (filler === '') {
      commands[0] = `a${commands[0].slice(1)}`;
      fillerSize += 5;
      filler = exactContent(fillerSize)!;
    }
    commands.push(filler);
    modes.push('id');
    expect(size([...commands, 'look'], [...modes, 'content'])).toBe(MAX_SAVE_FILE_LENGTH);

    const append = vi.spyOn(HTMLOListElement.prototype, 'append').mockImplementation(() => undefined);
    const execute = vi.spyOn(play, 'playCommand').mockImplementation((_world, state) => ({
      state, message: 'A saved command was replayed.',
    }));
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    vi.mocked(adventurePack).mockReturnValueOnce(tinyPack);
    const target = document.createElement('main');
    document.body.append(target);
    const onCommand = vi.fn();
    renderPlayScreen(target, settings, { commands, commandModes: modes, onCommand });
    type(target, 'look');
    expect(onCommand).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledTimes(commands.length + 1);
    const executions = execute.mock.calls.length;
    const recorded = onCommand.mock.calls[0][0];
    const recordedModes = onCommand.mock.calls[0][1];
    expect(recordedModes).toEqual([...modes, 'content']);
    expect(exportSaveFile(createSave(name, settings, recorded, new Date(), recordedModes)))
      .toHaveLength(MAX_SAVE_FILE_LENGTH);
    expect(target.querySelector('#play-command')!.hasAttribute('aria-invalid')).toBe(false);
    expect(target.querySelector('#play-response')!.classList.contains('visually-hidden')).toBe(true);
    type(target, 'look');
    expect(onCommand).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(executions);
    expect(append).toHaveBeenCalledTimes(recorded.length);
    expect(text(target, '#play-response')[0]).toContain('save file limit');
    type(target, 'undo');
    expect(onCommand).toHaveBeenCalledOnce();
    expect(text(target, '#play-response')[0]).toContain('save file limit');
    expect(target.querySelector('#play-response')!.classList.contains('visually-hidden')).toBe(false);
    expect(append).toHaveBeenCalledTimes(recorded.length);
    const shortNameSave = createSave('A', settings, recorded, new Date(), recordedModes);
    expect(exportSaveFile(shortNameSave)).toHaveLength(MAX_SAVE_FILE_LENGTH - 359);
    // A released near-limit save can still replay even without the reserved name space.
    const shortHistory = [...recorded, 'look'];
    const shortModes = [...recordedModes, 'id'] as const;
    expect(() => exportSaveFile(createSave('A', settings, shortHistory, new Date(), shortModes))).not.toThrow();
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    const resumed = document.createElement('main');
    document.body.append(resumed);
    const resumedCommand = vi.fn();
    vi.mocked(adventurePack).mockReturnValueOnce(tinyPack);
    renderPlayScreen(resumed, settings, {
      commands: shortHistory, commandModes: shortModes, onCommand: resumedCommand,
    });
    expect(append).toHaveBeenCalledTimes(recorded.length + shortHistory.length);
    type(resumed, 'look');
    expect(resumedCommand).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(recorded.length + shortHistory.length);
    expect(text(resumed, '#play-response')[0]).toContain('save file limit');
    expect(() => exportSaveFile(createSave('A', settings, shortHistory, new Date(), shortModes))).not.toThrow();
  });

  it('shows a generated world with a labelled command box and empty log', () => {
    const settings = settingsFor('light-fantasy');
    const target = document.createElement('main');

    renderPlayScreen(target, settings);

    const generated = generateAdventureWorld(settings);
    const named = { ...generated, names: worldNamesFrom(adventurePack(settings.version, settings.genre), generated) };
    const view = describePlay(named, play.startPlay(named));
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

  it('does not present an automatic optional action or its ending consequence as chosen', () => {
    const choiceWorld: AdventureWorld = {
      ...tinyWorld,
      exits: [{ ...tinyWorld.exits[0], locked: false }],
      solution: {
        steps: [
          { id: 'push-cart', placeId: 'gate', conditions: {}, effects: [] },
          { id: 'offer-token', placeId: 'gate', conditions: { itemsHeld: ['brass-key'] }, effects: [] },
        ],
        goal: { placeId: 'old-tower', conditions: {} },
      },
    };
    const choicePack: ContentPack = {
      ...tinyPack,
      optionalDiscoveries: [{
        id: 'push-cart', placeId: 'gate', family: 'help-character', choice: 'non-graphic-force',
        prompt: ['You could push the cart.'], completion: ['You pushed the cart.'],
      }, {
        id: 'offer-token', placeId: 'gate', family: 'use-item', choice: 'peaceful',
        prompt: ['Offer the brass key as a promise.'], completion: ['You offer the brass key peacefully.'],
      }],
      plots: [{ ...tinyPack.plots[0], endingIds: ['plain-ending', 'force-ending'] }],
      endings: [
        tinyPack.endings[0],
        {
          id: 'force-ending', conditions: { stepsDone: ['push-cart'] },
          text: ['The courier blames you for pushing the cart.'],
        },
      ],
      solution: choiceWorld.solution,
    };
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(choiceWorld);
    vi.mocked(adventurePack).mockReturnValueOnce(choicePack);
    const target = document.createElement('main');
    renderPlayScreen(target, settingsFor('light-fantasy'));

    expect(target.querySelector('.play-story')?.textContent).not.toContain('pushed the cart');
    expect(target.querySelector('.play-story')?.textContent).toContain('Offer the brass key as a promise.');
    type(target, 'take brass key');
    type(target, 'use brass key');
    expect(target.querySelector('.play-story')?.textContent).toContain('You offer the brass key peacefully.');
    type(target, 'go old tower');
    expect(target.querySelector('.play-authored-ending')?.textContent).toBe('A plain ending.');
    expect(target.querySelector('.play-authored-ending')?.textContent).not.toContain('blames you');
  });

  it.each([
    ['light-fantasy', 'mill', 'force-yard', 'You shove past'],
    ['science-fiction', 'hydroponics', 'force-bulkhead', 'You push past'],
  ] as const)('does not present the automatic %s force action', (genre, placeId, stepId, completion) => {
    const settings = settingsFor(genre);
    const world = generateAdventureWorld(settings);
    const { commands, state } = completeSteps(world, [], placeId);
    const target = document.createElement('main');
    renderPlayScreen(target, settings, { commands, commandModes: commands.map(() => 'id') });

    expect(state.stepsDone).toContain(stepId);
    expect(target.textContent).not.toContain(completion);
  });

  it('inserts typed text as plain text, never as markup', () => {
    const target = renderTiny();

    type(target, '<img src=x onerror=alert(1)>');

    expect(target.querySelector('img')).toBeNull();
    expect(text(target, '.play-typed')).toEqual(['> <img src=x onerror=alert(1)>']);
  });

  it('reports every command run so far after each typed command', () => {
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    vi.mocked(adventurePack).mockReturnValueOnce(tinyPack);
    const target = document.createElement('main');
    const onCommand = vi.fn();
    expect(renderPlayScreen(target, settingsFor('light-fantasy'), { onCommand })).toBe(true);

    type(target, ' take brass key ');
    type(target, 'undo');

    expect(onCommand.mock.calls).toEqual([
      [['take brass key'], ['content']],
      [['take brass key', 'undo'], ['content', 'content']],
    ]);
    expect(target.querySelector<HTMLInputElement>('#play-command')?.maxLength).toBe(MAX_COMMAND_LENGTH);
  });

  it('replays saved commands into the same state and log, without announcing them', () => {
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    vi.mocked(adventurePack).mockReturnValueOnce(tinyPack);
    const target = document.createElement('main');
    const onCommand = vi.fn();
    const saved = ['take brass key', 'use brass key', 'hint'];

    renderPlayScreen(target, settingsFor('light-fantasy'), { commands: saved, onCommand });

    const view = describePlay(tinyWorld, play.replayCommands(tinyWorld, saved));
    expect(target.querySelector('.play-place-name')?.textContent).toBe(view.placeName);
    expect(text(target, '.play-sidebar ul')[0]).toBe(view.inventory[0]);
    expect(target.querySelector('.play-sidebar > p')?.textContent).toBe(`Turns taken: ${view.turns}`);
    expect(text(target, '.play-typed')).toEqual(saved.map((command) => `> ${command}`));
    expect(target.querySelector('[aria-live="polite"]')?.textContent).toBe('');
    expect(onCommand).not.toHaveBeenCalled();

    type(target, 'go to old tower');
    expect(onCommand).toHaveBeenLastCalledWith(
      [...saved, 'go to old tower'], [...saved.map(() => 'id'), 'content'],
    );
    expect(target.querySelector<HTMLElement>('.play-ending')?.hidden).toBe(false);
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
        .toBe(describePlay(named, play.startPlay(named)).placeName);
      expect(target.querySelector('form')).not.toBeNull();
    },
  );

  it.each([
    [0, 'Restore the warning chain'],
    [1, 'Follow the teapot trail'],
    [2, 'Science fiction adventure'],
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

  it.each([1, 2])('keeps hidden names and aliases out of version %i titles, including resumed games', (version) => {
    const settings = settingsFor('light-fantasy', version);
    const commands = ['take brass key', 'use brass key', 'go to old tower'];
    for (const history of [[], commands]) {
      vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
      vi.mocked(adventurePack).mockReturnValueOnce({
        ...tinyPack,
        plots: [{ ...tinyPack.plots[0], name: 'Find quiet gem at the tower' }],
      });
      const target = document.createElement('main');
      renderPlayScreen(target, parseShareWord(encodeShareWord(settings)), {
        commands: history, commandModes: history.map(() => 'content'),
      });
      expect(target.querySelector('h1')?.textContent).toBe('Light fantasy adventure');
      if (history.length) {
        expect(target.querySelector('.play-place-name')?.textContent).toBe('old tower');
        type(target, 'look');
        type(target, 'undo');
        expect(target.querySelector('h1')?.textContent).toBe('Light fantasy adventure');
      }
    }
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

  it('hides an undiscovered place named in a visible item description', () => {
    const settings = createAdventureSettings(6, 'long', 2);
    expect(settings.genre).toBe('cosy-mystery');
    const world = generateAdventureWorld(settings);
    const pack = adventurePack(settings.version, settings.genre);
    const roseCottage = pack.places.find(({ id }) => id === 'rose-cottage')!;
    const parcel = pack.items.find(({ id }) => id === 'parcel')!;
    const named = { ...world, names: worldNamesFrom(pack, world) };
    const start = play.startPlay(named);

    expect(world.items.some(({ id, placeId }) => id === parcel.id && placeId === world.startPlaceId))
      .toBe(true);
    expect(play.discoveredTargets(named, start)
      .some(({ kind, id }) => kind === 'place' && id === roseCottage.id)).toBe(false);
    expect(parcel.description.join('')).toContain('Rose Cottage');

    const target = document.createElement('main');
    renderPlayScreen(target, settings);

    const visibleItems = target.querySelector('.play-items-here')!.textContent!;
    expect(visibleItems).toContain('Stray parcel');
    expect(visibleItems.toLowerCase()).not.toContain('rose cottage');
    expect(visibleItems).toContain('a place');
  });

  it('hides an undiscovered item named in a character description', () => {
    const settings = createAdventureSettings(6, 'long', 2);
    const world = generateAdventureWorld(settings);
    const scorecard = world.items.find(({ id }) => id === 'scorecard')!;
    expect(scorecard.placeId).toBe('library');

    const target = document.createElement('main');
    renderPlayScreen(target, settings);
    type(target, 'go to Primrose tea room');
    type(target, 'go to Corner bakery');
    expect(target.textContent).not.toContain('You shove the cart clear of the yard gate.');
    type(target, 'go to Fete tent');
    type(target, 'go to Bowls club');

    expect(target.querySelector('.play-place-name')?.textContent).toBe('Bowls club');
    expect(target.querySelector('.play-people')?.textContent).not.toContain('lost scorecard');
    expect(target.querySelector('.play-people')?.textContent).toContain('an item');
  });

  it('hides an undiscovered clue named in a puzzle prompt', () => {
    const settings = createAdventureSettings(10, 'long', 2);
    const world = generateAdventureWorld(settings);
    const clue = world.clues.find(({ id }) => id === 'sundial-motto')!;
    expect(clue.placeId).toBe('reading-room');

    const target = document.createElement('main');
    renderPlayScreen(target, settings);
    for (const command of [
      'go to Primrose tea room', 'go to Corner bakery', 'go to Fete tent', 'go to Bowls club',
      'go to Cricket pavilion', 'go to Allotments', 'go to Potting shed', 'go to Railway station',
      'go to Signal box', 'go to Antique shop', 'go to Clock workshop', 'go to Bramble lane',
      'go to Rose cottage', 'go to Gate lodge', 'go to Manor garden',
    ]) type(target, command);

    expect(target.querySelector('.play-place-name')?.textContent).toBe('Manor garden');
    expect(target.querySelector('.play-story')?.textContent).toContain('Use the clue');
    expect(target.querySelector('.play-story')?.textContent).not.toContain('sundial motto');
  });

  it('does not mask a prose word used as an ambiguous alias', () => {
    const pack: ContentPack = {
      ...tinyPack,
      places: tinyPack.places.map((place) => ({
        ...place,
        name: place.id === 'gate' ? 'North the Hall' : 'South the Hall',
      })),
      plots: tinyPack.plots.map((plot) => ({ ...plot, introduction: ['We gather in the hall.'] })),
    };
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(tinyWorld);
    vi.mocked(adventurePack).mockReturnValueOnce(pack);
    const target = document.createElement('main');

    renderPlayScreen(target, settingsFor('light-fantasy'));

    expect(target.querySelector('.play-introduction')?.textContent).toBe('We gather in the hall.');
  });

  it('hides a unique alias for an undiscovered place in found clue text', () => {
    const settings = createAdventureSettings(1, 'long', 1);
    expect(settings.genre).toBe('cosy-mystery');
    const world = generateAdventureWorld(settings);
    const pack = adventurePack(settings.version, settings.genre);
    const { commands, state } = completeSteps(world, [], 'potting-shed');
    expect(state.placesVisited).not.toContain('lighthouse');
    expect(play.discoveredTargets(world, state)
      .some(({ kind, id }) => kind === 'place' && id === 'lighthouse')).toBe(false);
    expect(state.cluesRevealed).toContain('swap-ledger');
    expect(pack.clues.find(({ id }) => id === 'swap-ledger')!.text.join(''))
      .toContain('sent up to the lighthouse');

    const target = document.createElement('main');
    renderPlayScreen(target, settings, {
      commands, commandModes: commands.map(() => 'id'),
    });

    const clueList = target.querySelectorAll('.play-sidebar ul')[1];
    expect(clueList?.textContent).toContain('sent up to the place');
    expect(clueList?.textContent).not.toContain('lighthouse');
  });

  it('hides an undiscovered place named in a puzzle completion', () => {
    const settings = createAdventureSettings(1, 'long', 2);
    const generated = generateAdventureWorld(settings);
    const pack = adventurePack(settings.version, settings.genre);
    const { commands, state } = completeSteps(generated, ['cheer-bowler'], 'bowls-club');

    expect(state.placeId).toBe('bowls-club');
    expect(state.placesVisited).not.toContain('allotments');
    expect(pack.puzzles.find(({ id }) => id === 'cheer-bowler')!.completion.join(''))
      .toContain('the allotments');

    const target = document.createElement('main');
    renderPlayScreen(target, settings, {
      commands, commandModes: commands.map(() => 'id'),
    });

    expect(target.querySelector('.play-story')?.textContent).toContain('the place');
    expect(target.querySelector('.play-story')?.textContent).not.toContain('allotments');
  });

  it('keeps an exposed place name in prose after leaving, replaying and undoing', () => {
    const world: AdventureWorld = {
      ...tinyWorld,
      places: [...tinyWorld.places, { id: 'secret-garden' }],
      exits: [...tinyWorld.exits, {
        id: 'garden-walk', fromPlaceId: 'old-tower', toPlaceId: 'secret-garden', locked: false,
      }],
      solution: { ...tinyWorld.solution, goal: { placeId: 'secret-garden', conditions: {} } },
    };
    const pack: ContentPack = {
      ...tinyPack,
      places: [...tinyPack.places, {
        id: 'secret-garden', name: 'Secret garden', description: [],
      }],
      plots: tinyPack.plots.map((plot) => ({
        ...plot,
        introduction: [...plot.introduction, ' Remember ', { kind: 'place', id: 'secret-garden' },
          ' and Secret garden.'],
      })),
    };
    const commands = ['take brass key', 'use brass key', 'go old tower', 'go gate'];
    const commandModes = commands.map(() => 'content' as const);
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(world);
    vi.mocked(adventurePack).mockReturnValueOnce(pack);
    const target = document.createElement('main');
    document.body.append(target);

    renderPlayScreen(target, settingsFor('light-fantasy'), { commands, commandModes });

    expect(target.querySelector('.play-place-name')?.textContent).toBe('gate');
    expect(target.querySelector('.play-introduction')?.textContent)
      .toBe('Find quiet gem and hidden note. Remember Secret garden and Secret garden.');
    type(target, 'go Secret garden');
    expect(target.querySelector('.play-log')?.lastElementChild?.textContent)
      .toContain('That name is not one you have discovered.');
    type(target, 'undo');

    expect(target.querySelector('.play-place-name')?.textContent).toBe('old tower');
    expect(target.querySelector('.play-introduction')?.textContent)
      .toBe('Find quiet gem and hidden note. Remember Secret garden and Secret garden.');

    const replayed = document.createElement('main');
    document.body.append(replayed);
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(world);
    vi.mocked(adventurePack).mockReturnValueOnce(pack);
    renderPlayScreen(replayed, settingsFor('light-fantasy'), { commands, commandModes });
    expect(replayed.querySelector('.play-place-name')?.textContent).toBe('gate');
    expect(replayed.querySelector('.play-introduction')?.textContent)
      .toBe('Find quiet gem and hidden note. Remember Secret garden and Secret garden.');
  });

  it('does not select a blame ending for an automatic force step', () => {
    const settings = createAdventureSettings(6, 'short', 2);
    const generated = generateAdventureWorld(settings);
    const pack = adventurePack(settings.version, settings.genre);
    const { commands, state } = completeSteps(
      generated, generated.solution.goal.conditions.stepsDone ?? [], generated.solution.goal.placeId,
    );
    const forceEnding = pack.endings.find(({ id }) => id === 'trail-cross')!;
    expect(state.goalReached).toBe(true);
    expect(state.stepsDone).toContain('push-cart');
    expect(forceEnding.text.join('')).toContain('still cross about his cart');

    const target = document.createElement('main');
    renderPlayScreen(target, settings, {
      commands, commandModes: commands.map(() => 'id'),
    });

    expect(target.querySelector('.play-authored-ending')?.textContent)
      .not.toContain('still cross about his cart');
    expect(target.querySelector('.play-authored-ending')?.textContent).not.toContain('apology');
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

  it('keeps names in prose after their items and people have been discovered', () => {
    const world: AdventureWorld = {
      ...tinyWorld,
      solution: {
        ...tinyWorld.solution,
          goal: { placeId: 'old-tower', conditions: { itemsHeld: ['hidden-gem'] } },
      },
    };
    const pack: ContentPack = {
      ...tinyPack,
      characters: [...tinyPack.characters, {
        id: 'tower-keeper', name: 'Tower keeper', placeId: 'old-tower',
        description: ['A quiet guardian.'], motive: [],
      }],
      plots: tinyPack.plots.map((plot) => ({
        ...plot,
        introduction: [...plot.introduction, ' Remember ', { kind: 'character', id: 'tower-keeper' },
          ' and ', { kind: 'item', id: 'hidden-gem' }, '.'],
      })),
    };
    vi.mocked(generateAdventureWorld).mockReturnValueOnce(world);
    vi.mocked(adventurePack).mockReturnValueOnce(pack);
    const target = document.createElement('main');
    renderPlayScreen(target, settingsFor('light-fantasy'));

    expect(target.querySelector('.play-introduction')?.textContent)
      .toBe('Find something and a clue. Remember someone and something.');
    type(target, 'take brass key');
    type(target, 'use brass key');
    type(target, 'go old tower');
    expect(target.querySelector('.play-introduction')?.textContent)
      .toBe('Find quiet gem and hidden note. Remember Tower keeper and quiet gem.');
    type(target, 'go gate');

    expect(target.querySelector('.play-introduction')?.textContent)
      .toBe('Find quiet gem and hidden note. Remember Tower keeper and quiet gem.');
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
    ['play setup', play.startPlay],
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
