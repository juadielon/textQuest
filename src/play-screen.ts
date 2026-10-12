import type { AdventureSettings } from './adventure-settings';
import type { AdventureWorld } from './adventure-world';
import type { CommandTarget } from './engine/commands';
import { discoveredTargets, playCommand, startPlay, type PlayState } from './engine/play';
import { generateAdventureWorld } from './generate-world';
import { MAX_COMMAND_LENGTH } from './saves';

/** Options for {@link renderPlayScreen}. */
export interface PlayScreenOptions {
  /** Commands to replay first, such as a save's. They fill the log without being announced. */
  readonly commands?: readonly string[];
  /** Called after each typed command with every command run so far, oldest first. */
  readonly onCommand?: (commands: readonly string[]) => void;
}

/** What the play screen shows for one moment of play, without any DOM. */
export interface PlayView {
  /** Name of the place the player is in. */
  readonly placeName: string;
  /** What the player sees there, as a `look` command would say. */
  readonly placeText: string;
  /** Names of carried items, in world order. */
  readonly inventory: readonly string[];
  /** Names of found clues, in world order. */
  readonly clues: readonly string[];
  /** Turns taken so far. */
  readonly turns: number;
  /** True once the goal is reached, so the ending should show. */
  readonly ended: boolean;
}

/** Shown instead of the game when a world can't be made from the settings. */
export const unplayableMessage =
  'Sorry, this adventure can’t be played yet. Please try a different adventure.';

/**
 * Describes the play screen for a state. Names come from discovered targets,
 * so nothing hidden from the player is shown. Neither argument is changed.
 */
export function describePlay(world: AdventureWorld, state: PlayState): PlayView {
  const targets = discoveredTargets(world, state);
  const nameOf = (kind: CommandTarget['kind'], id: string) =>
    targets.find((target) => target.kind === kind && target.id === id)?.name ?? id;
  return {
    placeName: nameOf('place', state.placeId),
    placeText: playCommand(world, state, 'look').message,
    inventory: state.itemsHeld.map((id) => nameOf('item', id)),
    clues: state.cluesRevealed.map((id) => nameOf('clue', id)),
    turns: state.turns,
    ended: state.goalReached,
  };
}

/**
 * Generates the world for `settings` and replaces the contents of `target`
 * with a playable screen: the current place, a response log, a command box,
 * inventory and found clues. Typed commands run through the play module,
 * including help, hint and undo. The ending shows once the goal is reached.
 *
 * @remarks
 * Player and world text is only ever inserted with `textContent`. New
 * responses are announced through a polite live region. If the world can't
 * be generated, a plain message is shown instead of the game.
 *
 * @param options - Saved commands to replay and a hook that hears each new command.
 * @returns False when the world can't be played, so there is nothing to save.
 */
export function renderPlayScreen(
  target: HTMLElement, settings: AdventureSettings, options: PlayScreenOptions = {},
): boolean {
  let world: AdventureWorld;
  let state: PlayState;
  try {
    world = generateAdventureWorld(settings);
    state = startPlay(world);
  } catch {
    const problem = element('p', 'status', unplayableMessage);
    problem.setAttribute('role', 'alert');
    target.replaceChildren(problem);
    return false;
  }

  const placeName = element('h2', 'play-place-name');
  placeName.id = 'play-place-name';
  const placeText = element('p');
  const place = element('section', 'play-place', placeName, placeText);
  place.setAttribute('aria-labelledby', placeName.id);

  const log = element('ol', 'play-log');
  log.tabIndex = 0;
  log.setAttribute('aria-label', 'What has happened so far');

  const announcer = element('p', 'visually-hidden');
  announcer.setAttribute('aria-live', 'polite');

  const input = element('input');
  input.id = 'play-command';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = MAX_COMMAND_LENGTH;
  const label = element('label', undefined, 'What do you do?');
  label.htmlFor = input.id;
  const form = element('form', 'play-command', label, input, element('button', undefined, 'Go'));

  const inventory = element('ul');
  const clues = element('ul');
  const turns = element('p');
  const sidebar = element('aside', 'play-sidebar',
    element('h2', undefined, 'Inventory'), inventory,
    element('h2', undefined, 'Clues found'), clues, turns);
  sidebar.setAttribute('aria-label', 'Your progress');

  const endingText = element('p');
  const ending = element('section', 'play-ending', element('h2', undefined, 'The end'), endingText);
  ending.setAttribute('aria-label', 'Ending');

  const update = () => {
    const view = describePlay(world, state);
    placeName.textContent = view.placeName;
    placeText.textContent = view.placeText;
    fillList(inventory, view.inventory, 'You are not carrying anything.');
    fillList(clues, view.clues, 'No clues found yet.');
    turns.textContent = `Turns taken: ${view.turns}`;
    ending.hidden = !view.ended;
    endingText.textContent = `You reached your goal in ${view.turns} `
      + `${view.turns === 1 ? 'turn' : 'turns'}. Type undo to go back a turn.`;
  };

  const commands: string[] = [];
  const run = (command: string): string => {
    const turn = playCommand(world, state, command);
    state = turn.state;
    commands.push(command);
    log.append(element('li', 'play-entry',
      element('p', 'play-typed', `> ${command}`), element('p', undefined, turn.message)));
    return turn.message;
  };
  options.commands?.forEach((command) => run(command));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = input.value.trim();
    if (!command) return;
    const message = run(command);
    log.scrollTop = log.scrollHeight;
    // A fresh node is announced even when the text repeats the last response.
    announcer.replaceChildren(element('span', undefined, message));
    input.value = '';
    input.focus();
    update();
    options.onCommand?.([...commands]);
  });

  update();
  const screen = element('div', 'play-screen', place, ending, log, form, sidebar, announcer);
  target.replaceChildren(screen);
  return true;
}

function fillList(list: HTMLElement, names: readonly string[], empty: string): void {
  list.replaceChildren(...(names.length ? names : [empty]).map((name) => element('li', undefined, name)));
}

// One place to build elements, so text always goes in through textContent.
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
