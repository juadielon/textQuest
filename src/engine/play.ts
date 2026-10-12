import type { AdventureWorld, Conditions, Exit, PuzzleStep } from '../adventure-world';
import { MAX_SEARCH_STATES, validateWorld } from '../winnability';
import { commandHelp, parseCommand } from './commands';
import type { CommandAction, CommandTarget, Direction } from './commands';

/**
 * A player's progress through one world. It is plain data, so it can be
 * compared, stored or rebuilt by replaying the same commands.
 *
 * @remarks
 * ID lists keep world order. Only pass a state to the world it came from.
 */
export interface PlayState {
  /** Where the player is now. */
  readonly placeId: string;
  /** Items the player is carrying. */
  readonly itemsHeld: readonly string[];
  /** Places the player has been to, including the start. */
  readonly placesVisited: readonly string[];
  /** Clues the player has found. */
  readonly cluesRevealed: readonly string[];
  /** Puzzle steps the player has completed. */
  readonly stepsDone: readonly string[];
  /** Locked exits the player has opened. */
  readonly unlockedExits: readonly string[];
  /** Turns that changed progress: moves, takes and successful uses. */
  readonly turns: number;
  /** True once the player has reached the goal. */
  readonly goalReached: boolean;
  /** The state before the last turn, for undo. Null at the start. */
  readonly previous: PlayState | null;
}

/** The new state after an action, and what to tell the player. */
export interface PlayTurn {
  /** The new state. It is the same object as the input when nothing changed. */
  readonly state: PlayState;
  /** A short Australian English response. */
  readonly message: string;
}

interface Progress {
  placeId: string;
  itemsHeld: Set<string>;
  placesVisited: Set<string>;
  cluesRevealed: Set<string>;
  stepsDone: Set<string>;
  unlockedExits: Set<string>;
}

// World IDs are only unique within their own kind, so targets always carry both.
interface Target {
  readonly kind: CommandTarget['kind'];
  readonly id: string;
}

// Naming parses every target, which is slow, so each world's names are kept.
// Play never changes a world, so the names stay correct.
const namesByWorld = new WeakMap<AdventureWorld, readonly CommandTarget[]>();

// Keep names stable as targets are discovered, including parser normalisation.
function namedTargets(world: AdventureWorld): readonly CommandTarget[] {
  const cached = namesByWorld.get(world);
  if (cached) return cached;
  const named = nameTargets(world);
  namesByWorld.set(world, named);
  return named;
}

function nameTargets(world: AdventureWorld): CommandTarget[] {
  const targets = (['place', 'exit', 'item', 'clue'] as const).flatMap((kind) =>
    world[`${kind}s`].map(({ id }): CommandTarget => ({
      id, kind, name: id.replace(/[-_]+/g, ' ').trim() || id,
    })),
  );
  const original = [...targets];
  const reachable = (target: CommandTarget, list: readonly CommandTarget[]) => {
    const verbs = target.kind === 'item' ? ['examine', 'use']
      : target.kind === 'place' || target.kind === 'exit' ? ['examine', 'go'] : ['examine'];
    return verbs.every((verb) => {
      const result = parseCommand(`${verb} ${target.name}`, list);
      if (!result.ok) return false;
      if (result.action.kind === 'use') {
        return result.action.itemId === target.id && !('targetId' in result.action);
      }
      return 'targetId' in result.action && result.action.targetId === target.id
        && result.action.targetKind === target.kind;
    });
  };
  return targets.map((target, index) => {
    if (reachable(target, original)) return target;
    let name = `${target.name} (${target.kind} ${index + 1})`;
    let named = { ...target, name, aliases: [target.name] };
    const withCandidate = () => targets.map((entry, position) => position === index ? named : entry);
    if (!reachable(named, withCandidate())) name = `${target.kind} ${index + 1}`;
    while (true) {
      const candidate = parseCommand(`examine ${name}`, targets);
      named = { ...target, name, aliases: [target.name] };
      if (!candidate.ok && candidate.problem === 'unknown-target'
        && reachable(named, withCandidate())) break;
      name += '!';
    }
    targets[index] = named;
    return named;
  });
}

function nameOf(world: AdventureWorld, kind: Target['kind'], id: string): string {
  return namedTargets(world).find((target) => target.kind === kind && target.id === id)?.name
    ?? id;
}

function listNames(world: AdventureWorld, kind: Target['kind'], ids: readonly string[]): string {
  const names = ids.map((id) => `the ${nameOf(world, kind, id)}`);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function meets(progress: Progress, conditions: Conditions): boolean {
  return (conditions.itemsHeld ?? []).every((id) => progress.itemsHeld.has(id))
    && (conditions.placesVisited ?? []).every((id) => progress.placesVisited.has(id))
    && (conditions.stepsDone ?? []).every((id) => progress.stepsDone.has(id))
    && (conditions.cluesRevealed ?? []).every((id) => progress.cluesRevealed.has(id));
}

const needsItems = (step: PuzzleStep) => (step.conditions.itemsHeld ?? []).length > 0;

function progressFrom(state: PlayState): Progress {
  return {
    placeId: state.placeId,
    itemsHeld: new Set(state.itemsHeld),
    placesVisited: new Set(state.placesVisited),
    cluesRevealed: new Set(state.cluesRevealed),
    stepsDone: new Set(state.stepsDone),
    unlockedExits: new Set(state.unlockedExits),
  };
}

function cloneProgress(progress: Progress): Progress {
  return {
    placeId: progress.placeId,
    itemsHeld: new Set(progress.itemsHeld),
    placesVisited: new Set(progress.placesVisited),
    cluesRevealed: new Set(progress.cluesRevealed),
    stepsDone: new Set(progress.stepsDone),
    unlockedExits: new Set(progress.unlockedExits),
  };
}

function inWorldOrder(entries: readonly { readonly id: string }[], ids: Set<string>): string[] {
  return entries.filter(({ id }) => ids.has(id)).map(({ id }) => id);
}

// World order keeps states identical however the player got there.
function stateFrom(world: AdventureWorld, progress: Progress) {
  return {
    placeId: progress.placeId,
    itemsHeld: inWorldOrder(world.items, progress.itemsHeld),
    placesVisited: inWorldOrder(world.places, progress.placesVisited),
    cluesRevealed: inWorldOrder(world.clues, progress.cluesRevealed),
    stepsDone: inWorldOrder(world.solution.steps, progress.stepsDone),
    unlockedExits: inWorldOrder(world.exits, progress.unlockedExits),
  };
}

function goalMet(world: AdventureWorld, progress: Progress): boolean {
  const goal = world.solution.goal;
  return progress.placeId === goal.placeId && meets(progress, goal.conditions);
}

// Arriving shows the place's clues, as the winnability checker does.
function arrive(world: AdventureWorld, progress: Progress, placeId: string): string[] {
  progress.placeId = placeId;
  progress.placesVisited.add(placeId);
  const found = world.clues.filter((clue) => clue.placeId === placeId
    && !progress.cluesRevealed.has(clue.id)).map(({ id }) => id);
  for (const id of found) progress.cluesRevealed.add(id);
  return found;
}

function completeStep(world: AdventureWorld, progress: Progress, step: PuzzleStep): string[] {
  progress.stepsDone.add(step.id);
  return step.effects.map((effect) => {
    switch (effect.kind) {
      case 'unlock-exit':
        progress.unlockedExits.add(effect.exitId);
        return `The ${nameOf(world, 'exit', effect.exitId)} is now open.`;
      case 'give-item':
        progress.itemsHeld.add(effect.itemId);
        return `You now have the ${nameOf(world, 'item', effect.itemId)}.`;
      case 'reveal-clue':
        progress.cluesRevealed.add(effect.clueId);
        return `You found the ${nameOf(world, 'clue', effect.clueId)} clue.`;
    }
  });
}

function stepsReadyHere(world: AdventureWorld, progress: Progress): PuzzleStep[] {
  return world.solution.steps.filter((step) => step.placeId === progress.placeId
    && !progress.stepsDone.has(step.id) && meets(progress, step.conditions));
}

// Steps that need no item happen by themselves once their conditions hold.
// Steps that need items wait for the player to use one of those items.
function settle(world: AdventureWorld, progress: Progress): string[] {
  const messages: string[] = [];
  for (let step = stepsReadyHere(world, progress).find((ready) => !needsItems(ready)); step;
    step = stepsReadyHere(world, progress).find((ready) => !needsItems(ready))) {
    messages.push('Something changes here.', ...completeStep(world, progress, step));
  }
  return messages;
}

const isOpen = (progress: Progress, exit: Exit) => !exit.locked || progress.unlockedExits.has(exit.id);

const exitsFrom = (world: AdventureWorld, placeId: string) =>
  world.exits.filter((exit) => exit.fromPlaceId === placeId);

const itemsHere = (world: AdventureWorld, progress: Progress) => world.items
  .filter((item) => item.placeId === progress.placeId && !progress.itemsHeld.has(item.id))
  .map(({ id }) => id);

/**
 * Starts a new play of a world at its starting place. Clues there are found
 * and any steps that need no items happen straight away. The world is not changed.
 *
 * @throws RangeError when the world is invalid, as `checkWinnability` would report.
 */
export function startPlay(world: AdventureWorld): PlayState {
  validateWorld(world);
  const progress: Progress = {
    placeId: world.startPlaceId, itemsHeld: new Set(), placesVisited: new Set(),
    cluesRevealed: new Set(), stepsDone: new Set(), unlockedExits: new Set(),
  };
  arrive(world, progress, world.startPlaceId);
  settle(world, progress);
  return {
    ...stateFrom(world, progress), turns: 0, goalReached: goalMet(world, progress), previous: null,
  };
}

/**
 * Lists the things the player has discovered, ready to pass to `parseCommand`.
 * Puzzle steps, the goal, unvisited places out of sight, items elsewhere and
 * unfound clues never appear.
 *
 * @remarks
 * Targets use world IDs with their kind, because IDs are only unique within
 * their own kind. Names come from IDs. Names that collide, or that the parser
 * would read as a direction or article, get a stable numbered suffix.
 * Original names remain aliases and may be ambiguous.
 */
export function discoveredTargets(world: AdventureWorld, state: PlayState): CommandTarget[] {
  const progress = progressFrom(state);
  const exits = exitsFrom(world, state.placeId);
  const places = new Set([state.placeId, ...state.placesVisited,
    ...exits.filter((exit) => isOpen(progress, exit)).map((exit) => exit.toPlaceId)]);
  const names = namedTargets(world);
  const target = (kind: Target['kind']) => (id: string): CommandTarget =>
    names.find((target) => target.kind === kind && target.id === id)!;
  return [
    ...inWorldOrder(world.places, places).map(target('place')),
    ...exits.map(({ id }) => id).map(target('exit')),
    ...[...state.itemsHeld, ...itemsHere(world, progress)].map(target('item')),
    ...state.cluesRevealed.map(target('clue')),
  ];
}

function describePlace(world: AdventureWorld, progress: Progress): string {
  const parts = [`You are at the ${nameOf(world, 'place', progress.placeId)}.`];
  const items = itemsHere(world, progress);
  if (items.length) parts.push(`You can see ${listNames(world, 'item', items)}.`);
  const clues = world.clues.filter((clue) => clue.placeId === progress.placeId).map(({ id }) => id);
  if (clues.length) parts.push(`Clues here: ${listNames(world, 'clue', clues)}.`);
  const exits = exitsFrom(world, progress.placeId).map((exit) => isOpen(progress, exit)
    ? `the ${nameOf(world, 'exit', exit.id)} to the ${nameOf(world, 'place', exit.toPlaceId)}`
    : `the ${nameOf(world, 'exit', exit.id)} (locked)`);
  parts.push(exits.length ? `Ways out: ${exits.join(', ')}.` : 'There is no way out.');
  return parts.join(' ');
}

function examine(world: AdventureWorld, progress: Progress, { kind, id }: Target): string {
  const name = nameOf(world, kind, id);
  switch (kind) {
    case 'place':
      if (id === progress.placeId) return describePlace(world, progress);
      return progress.placesVisited.has(id)
        ? `You remember the ${name}. Go there to look around.`
        : `The ${name} is nearby. Go there to look around.`;
    case 'exit': {
      const exit = exitsFrom(world, progress.placeId).find((entry) => entry.id === id);
      if (!exit) return 'That is not here.';
      return isOpen(progress, exit)
        ? `The ${name} leads to the ${nameOf(world, 'place', exit.toPlaceId)}.`
        : `The ${name} is locked.`;
    }
    case 'item':
      if (progress.itemsHeld.has(id)) return `You are carrying the ${name}.`;
      return itemsHere(world, progress).includes(id)
        ? `The ${name} is here. You could take it.`
        : 'That is not here.';
    case 'clue':
      return progress.cluesRevealed.has(id) ? `You have found the ${name} clue.` : 'You have not found that.';
    default:
      return 'You see nothing special.';
  }
}

// Is the target something the player can point at from here?
function isPresent(world: AdventureWorld, progress: Progress, { kind, id }: Target): boolean {
  switch (kind) {
    case 'place': return id === progress.placeId;
    case 'exit': return exitsFrom(world, progress.placeId).some((exit) => exit.id === id);
    case 'item': return progress.itemsHeld.has(id) || itemsHere(world, progress).includes(id);
    case 'clue': return progress.cluesRevealed.has(id);
    default: return false;
  }
}

interface Change {
  readonly done: boolean;
  readonly message: string;
}

function move(
  world: AdventureWorld, progress: Progress,
  action: { readonly direction: Direction }
    | { readonly targetId: string; readonly targetKind: Target['kind'] },
): Change {
  if ('direction' in action) {
    return { done: false, message: 'This adventure does not mark compass directions yet. Try go <place>.' };
  }
  const { targetKind: kind, targetId: id } = action;
  const exits = exitsFrom(world, progress.placeId);
  let exit: Exit | undefined;
  if (kind === 'exit') {
    exit = exits.find((entry) => entry.id === id);
    if (!exit) return { done: false, message: 'That way is not here.' };
  } else if (kind === 'place') {
    if (id === progress.placeId) return { done: false, message: 'You are already here.' };
    const ways = exits.filter((entry) => entry.toPlaceId === id);
    if (!ways.length) {
      return { done: false, message: `You cannot get to the ${nameOf(world, 'place', id)} directly from here.` };
    }
    exit = ways.find((entry) => isOpen(progress, entry)) ?? ways[0];
  } else {
    return { done: false, message: 'You cannot go there.' };
  }
  if (!isOpen(progress, exit)) {
    return { done: false, message: `The ${nameOf(world, 'exit', exit.id)} is locked.` };
  }
  const found = arrive(world, progress, exit.toPlaceId);
  const parts = [describePlace(world, progress)];
  if (found.length) parts.push(`You found ${listNames(world, 'clue', found)} clue${found.length > 1 ? 's' : ''}.`);
  return { done: true, message: parts.join(' ') };
}

function take(world: AdventureWorld, progress: Progress, { kind, id }: Target): Change {
  if (kind !== 'item') return { done: false, message: 'You cannot take that.' };
  if (progress.itemsHeld.has(id)) return { done: false, message: `You already have the ${nameOf(world, 'item', id)}.` };
  if (!itemsHere(world, progress).includes(id)) return { done: false, message: 'That is not here.' };
  progress.itemsHeld.add(id);
  return { done: true, message: `You take the ${nameOf(world, 'item', id)}.` };
}

function use(
  world: AdventureWorld, progress: Progress, action: CommandAction & { kind: 'use' },
): Change {
  const id = action.itemId;
  if (!progress.itemsHeld.has(id)) {
    return {
      done: false,
      message: itemsHere(world, progress).includes(id)
        ? `Take the ${nameOf(world, 'item', id)} first.`
        : 'You are not carrying that.',
    };
  }
  const target: Target | undefined = 'targetId' in action
    ? { kind: action.targetKind, id: action.targetId }
    : undefined;
  if (target && !isPresent(world, progress, target)) {
    return { done: false, message: 'That is not here.' };
  }
  const ready = stepsReadyHere(world, progress)
    .filter((step) => (step.conditions.itemsHeld ?? []).includes(id));
  // Prefer a step that opens the exit the player named, but never block progress on the target.
  const step = ready.find((entry) => target?.kind === 'exit'
    && entry.effects.some((effect) => effect.kind === 'unlock-exit' && effect.exitId === target.id))
    ?? ready[0];
  if (!step) return { done: false, message: 'Nothing happens.' };
  const onTarget = target ? ` on the ${nameOf(world, target.kind, target.id)}` : '';
  return {
    done: true,
    message: [`You use the ${nameOf(world, 'item', id)}${onTarget}.`, ...completeStep(world, progress, step)].join(' '),
  };
}

// Takes and uses everything possible here. Progress only grows in version 1,
// so this never blocks a win and lets the route search treat a place as one step.
function settleGreedily(world: AdventureWorld, progress: Progress): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of itemsHere(world, progress)) {
      progress.itemsHeld.add(id);
      changed = true;
    }
    for (const step of stepsReadyHere(world, progress)) {
      completeStep(world, progress, step);
      changed = true;
    }
  }
}

function progressKey(progress: Progress): string {
  return JSON.stringify([progress.placeId, ...[progress.itemsHeld, progress.placesVisited,
    progress.stepsDone, progress.cluesRevealed, progress.unlockedExits].map((ids) => [...ids].sort())]);
}

// Finds the first place to head for on a shortest route to the goal.
function nextPlaceToGoal(world: AdventureWorld, start: Progress): string | null | 'too-large' {
  const first = cloneProgress(start);
  settleGreedily(world, first);
  const queue: { progress: Progress; firstPlaceId: string | null }[] = [{ progress: first, firstPlaceId: null }];
  const seen = new Set([progressKey(first)]);
  for (let index = 0; index < queue.length; index++) {
    const { progress, firstPlaceId } = queue[index];
    for (const exit of exitsFrom(world, progress.placeId)) {
      if (!isOpen(progress, exit)) continue;
      const next = cloneProgress(progress);
      arrive(world, next, exit.toPlaceId);
      settleGreedily(world, next);
      const placeId = firstPlaceId ?? exit.toPlaceId;
      if (goalMet(world, next)) return placeId;
      const key = progressKey(next);
      if (seen.has(key)) continue;
      if (seen.size >= MAX_SEARCH_STATES) return 'too-large';
      seen.add(key);
      queue.push({ progress: next, firstPlaceId: placeId });
    }
  }
  return null;
}

function hint(world: AdventureWorld, progress: Progress, canUndo: boolean): string {
  const { steps, goal } = world.solution;
  const neededItems = new Set([goal, ...steps].flatMap(({ conditions }) => conditions.itemsHeld ?? []));
  if (itemsHere(world, progress).some((id) => neededItems.has(id))) {
    return 'Look around. Something here is worth taking.';
  }
  if (stepsReadyHere(world, progress).length) {
    return 'Something you are carrying could be useful here.';
  }
  const next = nextPlaceToGoal(world, progress);
  if (next === 'too-large') return 'Try exploring somewhere you have not been yet.';
  if (next === null) {
    return `There seems to be no way forward from here.${canUndo ? ' Try undo.' : ''}`;
  }
  return `Try going to the ${nameOf(world, 'place', next)}.`;
}

/**
 * Carries out one parsed action and returns the new state and a response.
 * Neither the world nor the input state is changed.
 *
 * @remarks
 * Moves, takes and successful uses count as turns and can be undone. Look,
 * examine, inventory, hint and help are free. A step that needs items happens
 * when the player uses one of those items at its place; other steps happen by
 * themselves once their conditions hold. These match the winnability
 * checker's rules, so any winnable world can be won with typed commands.
 * Hints point at the next useful step without naming puzzle answers, and
 * suggest undo at a dead end only when a previous turn exists.
 *
 * @throws RangeError when the world is invalid.
 */
export function runAction(world: AdventureWorld, state: PlayState, action: CommandAction): PlayTurn {
  validateWorld(world);
  const progress = progressFrom(state);
  const reply = (message: string): PlayTurn => ({ state, message });
  switch (action.kind) {
    case 'help': return reply(commandHelp);
    case 'look': return reply(describePlace(world, progress));
    case 'examine':
      return reply(examine(world, progress, { kind: action.targetKind, id: action.targetId }));
    case 'inventory':
      return reply(state.itemsHeld.length
        ? `You are carrying ${listNames(world, 'item', state.itemsHeld)}.`
        : 'You are not carrying anything.');
    case 'hint':
      return reply(state.goalReached ? 'You have already finished this adventure.'
        : hint(world, progress, state.previous !== null));
    case 'undo':
      return state.previous
        ? { state: state.previous, message: 'You undo your last turn.' }
        : reply('There is nothing to undo.');
    default:
      break;
  }
  if (state.goalReached) {
    return reply('You have already finished this adventure. Type undo to go back a turn.');
  }
  let change: Change;
  switch (action.kind) {
    case 'move': change = move(world, progress, action); break;
    case 'take':
      change = take(world, progress, { kind: action.targetKind, id: action.targetId });
      break;
    case 'use': change = use(world, progress, action); break;
    case 'talk': change = { done: false, message: 'There is no one here to talk to.' }; break;
    case 'choose': change = { done: false, message: 'There is no choice to make here.' }; break;
  }
  if (!change.done) return reply(change.message);
  const messages = [change.message, ...settle(world, progress)];
  const goalReached = goalMet(world, progress);
  if (goalReached) messages.push('You have reached your goal. Well done!');
  return {
    state: { ...stateFrom(world, progress), turns: state.turns + 1, goalReached, previous: state },
    message: messages.join(' '),
  };
}

/**
 * Parses typed input against the player's discovered names, then runs it.
 * Parser problems come back as the message, with the state unchanged.
 */
export function playCommand(world: AdventureWorld, state: PlayState, input: string): PlayTurn {
  const result = parseCommand(input, discoveredTargets(world, state));
  return result.ok ? runAction(world, state, result.action) : { state, message: result.message };
}

/**
 * Starts a world and plays a list of typed commands in order. The same world
 * and commands always give the same state, so a save can store the command list.
 */
export function replayCommands(world: AdventureWorld, inputs: readonly string[]): PlayState {
  return inputs.reduce((state, input) => playCommand(world, state, input).state, startPlay(world));
}
