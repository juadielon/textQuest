import type { AdventureSettings } from './adventure-settings';
import type { AdventureWorld, Conditions } from './adventure-world';
import type { CommandTarget } from './engine/commands';
import { parseCommand } from './engine/commands';
import { discoveredTargets, playCommand, startPlay, type PlayState, type PlayWorld } from './engine/play';
import type { EntityReference, PlotStructure, Prose } from './content/v1/format';
import { worldNamesFrom } from './content/v1/world-names';
import { createSeededRandom } from './seeded-random';
import { adventurePack, generateAdventureWorld } from './generate-world';

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

/**
 * The fallback heading when an adventure cannot be played.
 */
export const playScreenTitle = 'Your adventure';

/** Shown instead of the game when a world can't be made from the settings. */
export const unplayableMessage =
  'Sorry, this adventure can’t be played. Please try a different adventure.';

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
 * The screen starts with the authored plot name as a focusable `h1` heading,
 * or {@link playScreenTitle} when the adventure cannot be played. Titles can
 * repeat; the share word remains the exact adventure identifier.
 * Player and world text is only ever inserted with `textContent`. New
 * responses are announced through a polite live region. If the world can't
 * be generated or started because of a validation `RangeError`, a plain
 * message is shown instead of the game. Unexpected errors are rethrown.
 */
export function renderPlayScreen(target: HTMLElement, settings: AdventureSettings): void {
  const title = element('h1', 'play-title', playScreenTitle);
  title.tabIndex = -1;
  let world: PlayWorld;
  let pack: ReturnType<typeof adventurePack>;
  let plot: PlotStructure;
  let state: PlayState;
  try {
    const generated = generateAdventureWorld(settings);
    pack = adventurePack(settings.version, settings.genre);
    world = { ...generated, names: worldNamesFrom(pack, generated) };
    const random = createSeededRandom(settings.seed);
    random.nextUint32();
    plot = pack.plots[random.pickIndex(pack.plots.length)];
    state = startPlay(world);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const problem = element('p', 'status', unplayableMessage);
    problem.setAttribute('role', 'alert');
    target.replaceChildren(title, problem);
    return;
  }

  title.textContent = plot.name;
  const placeName = element('h2', 'play-place-name');
  placeName.id = 'play-place-name';
  const introduction = element('p', 'play-introduction');
  const description = element('p', 'play-description');
  const placeText = element('p');
  const peopleHeading = element('h3', undefined, 'People here');
  const people = element('ul', 'play-people');
  const itemsHeading = element('h3', undefined, 'Things here');
  const itemsHere = element('ul', 'play-items-here');
  const storyHeading = element('h3', undefined, 'Story');
  const story = element('ul', 'play-story');
  const place = element('section', 'play-place', placeName, introduction, description,
    placeText, peopleHeading, people, itemsHeading, itemsHere, storyHeading, story);
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
  const authoredEnding = element('p', 'play-authored-ending');
  const ending = element('section', 'play-ending',
    element('h2', undefined, 'The end'), endingText, authoredEnding);
  ending.setAttribute('aria-label', 'Ending');

  const update = () => {
    const view = describePlay(world, state);
    const targets = discoveredTargets(world, state);
    placeName.textContent = view.placeName;
    introduction.textContent = renderProse(plot.introduction, pack, world, state, targets);
    const authoredPlace = pack.places.find(({ id }) => id === state.placeId);
    description.textContent = authoredPlace
      ? renderProse(authoredPlace.description, pack, world, state, targets) : '';
    description.hidden = !authoredPlace;
    placeText.textContent = view.placeText;
    const presentPeople = pack.characters.filter(({ placeId }) =>
      placeId === state.placeId && world.places.some(({ id }) => id === placeId));
    fillDetails(people, presentPeople.map((person) => ({
      name: person.name,
      text: renderProse(person.description, pack, world, state, targets),
    })));
    peopleHeading.hidden = !presentPeople.length;
    people.hidden = !presentPeople.length;

    const presentItems = world.items.flatMap(({ id, placeId }) => {
      if (placeId !== state.placeId || state.itemsHeld.includes(id)) return [];
      const item = pack.items.find((entry) => entry.id === id);
      return item ? [{ name: item.name, text: renderProse(item.description, pack, world, state, targets) }] : [];
    });
    fillDetails(itemsHere, presentItems);
    itemsHeading.hidden = !presentItems.length;
    itemsHere.hidden = !presentItems.length;

    const placeStory = [...pack.puzzles, ...pack.optionalDiscoveries]
      .filter(({ id, placeId }) => placeId === state.placeId
        && world.solution.steps.some((step) => step.id === id))
      .map((step) => ({
        text: renderProse(state.stepsDone.includes(step.id) ? step.completion : step.prompt,
          pack, world, state, targets),
      }));
    story.replaceChildren(...placeStory.map(({ text }) => element('li', undefined, text)));
    storyHeading.hidden = !placeStory.length;
    story.hidden = !placeStory.length;

    fillDetails(inventory, state.itemsHeld.flatMap((id) => {
      const item = pack.items.find((entry) => entry.id === id);
      return item ? [{ name: item.name, text: renderProse(item.description, pack, world, state, targets) }] : [];
    }), 'You are not carrying anything.');
    fillDetails(clues, state.cluesRevealed.flatMap((id) => {
      const clue = pack.clues.find((entry) => entry.id === id);
      return clue ? [{ name: clue.name, text: renderProse(clue.text, pack, world, state, targets) }] : [];
    }), 'No clues found yet.');
    turns.textContent = `Turns taken: ${view.turns}`;
    ending.hidden = !view.ended;
    endingText.textContent = `You reached your goal in ${view.turns} `
      + `${view.turns === 1 ? 'turn' : 'turns'}. Type undo to go back a turn.`;
    const selectedEnding = view.ended ? endingFor(pack, plot, state) : undefined;
    authoredEnding.textContent = selectedEnding
      ? renderProse(selectedEnding.text, pack, world, state, targets) : '';
    authoredEnding.hidden = !selectedEnding;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = input.value.trim();
    if (!command) return;
    const parsed = parseCommand(command, discoveredTargets(world, state));
    const turn = playCommand(world, state, command);
    state = turn.state;
    const personId = parsed.ok && parsed.action.kind === 'talk' && 'targetId' in parsed.action
      ? parsed.action.targetId : undefined;
    const person = personId ? pack.characters.find(({ id }) => id === personId) : undefined;
    const response = person
      ? `${turn.message} ${renderProse(person.motive, pack, world, state, discoveredTargets(world, state))}`
      : turn.message;
    log.append(element('li', 'play-entry',
      element('p', 'play-typed', `> ${command}`), element('p', undefined, response)));
    log.scrollTop = log.scrollHeight;
    // A fresh node is announced even when the text repeats the last response.
    announcer.replaceChildren(element('span', undefined, response));
    input.value = '';
    input.focus();
    update();
  });

  update();
  const screen = element('div', 'play-screen', place, ending, log, form, sidebar, announcer);
  target.replaceChildren(title, screen);
}

function fillDetails(
  list: HTMLElement, details: readonly { readonly name: string; readonly text: string }[], empty?: string,
): void {
  const rows = details.map(({ name, text }) =>
    element('li', undefined, element('strong', undefined, name), element('p', undefined, text)));
  if (!rows.length && empty) rows.push(element('li', undefined, empty));
  list.replaceChildren(...rows);
}

function renderProse(
  prose: Prose, pack: ReturnType<typeof adventurePack>, world: PlayWorld,
  state: PlayState, targets: readonly CommandTarget[],
): string {
  return prose.map((part) => typeof part === 'string'
    ? part : entityName(part, pack, world, state, targets)).join('');
}

function entityName(
  reference: EntityReference, pack: ReturnType<typeof adventurePack>, world: PlayWorld,
  state: PlayState, targets: readonly CommandTarget[],
): string {
  const targetKind = reference.kind === 'character' ? 'person' : reference.kind;
  const discovered = targets.find(({ id, kind }) => id === reference.id && kind === targetKind);
  if (discovered) return discovered.name;

  switch (reference.kind) {
    case 'place':
      return 'a place';
    case 'character': {
      const person = pack.characters.find(({ id }) => id === reference.id);
      return person && world.places.some(({ id }) => id === person.placeId)
        && state.placesVisited.includes(person.placeId) ? person.name : 'someone';
    }
    case 'item': {
      const item = world.items.find(({ id }) => id === reference.id);
      return item
        && (state.itemsHeld.includes(reference.id)
          || Boolean(item.placeId && state.placesVisited.includes(item.placeId)))
        ? pack.items.find(({ id }) => id === reference.id)?.name ?? 'something' : 'something';
    }
    case 'clue':
      return state.cluesRevealed.includes(reference.id) ? pack.clues
        .find(({ id }) => id === reference.id)?.name ?? 'a clue' : 'a clue';
  }
}

function endingFor(
  pack: ReturnType<typeof adventurePack>, plot: PlotStructure, state: PlayState,
): (typeof pack.endings)[number] | undefined {
  let selected: (typeof pack.endings)[number] | undefined;
  for (const id of plot.endingIds) {
    const ending = pack.endings.find((entry) => entry.id === id);
    if (ending && conditionsMatch(ending.conditions, state)) selected = ending;
  }
  return selected;
}

function conditionsMatch(conditions: Conditions, state: PlayState): boolean {
  return (conditions.itemsHeld ?? []).every((id) => state.itemsHeld.includes(id))
    && (conditions.placesVisited ?? []).every((id) => state.placesVisited.includes(id))
    && (conditions.stepsDone ?? []).every((id) => state.stepsDone.includes(id))
    && (conditions.cluesRevealed ?? []).every((id) => state.cluesRevealed.includes(id));
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
