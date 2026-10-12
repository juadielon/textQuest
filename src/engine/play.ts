import type { AdventureWorld, Conditions, Exit, PuzzleStep } from '../adventure-world';
import { MAX_SEARCH_STATES, validateWorld } from '../winnability';
import { commandHelp, normaliseName, parseCommand } from './commands';
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

/** A player-facing name for one place, item or clue, plus other names to accept. */
export interface NamedThing {
  /** The world ID this name belongs to. */
  readonly id: string;
  /** The name shown to the player. */
  readonly name: string;
  /** Other names the player can type. Aliases that clash with a name are ignored. */
  readonly aliases?: readonly string[];
}

/** Someone the player can talk to while they are at the same place. */
export interface NamedPerson extends NamedThing {
  /** Where the person stays. */
  readonly placeId: string;
}

/**
 * Content-pack names for a world. Things missing from a list fall back to
 * names built from their IDs. Exits have no authored names, so they are
 * named after where they lead once the player knows that place.
 */
export interface WorldNames {
  readonly places: readonly NamedThing[];
  readonly items: readonly NamedThing[];
  readonly clues: readonly NamedThing[];
  readonly people: readonly NamedPerson[];
}

/**
 * A world ready to play. Without `names`, every name comes from an ID.
 * Names only change what the player sees and types, never the rules.
 */
export interface PlayWorld extends AdventureWorld {
  readonly names?: WorldNames;
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

const idName = (id: string) => id.replace(/[-_]+/g, ' ').trim() || id;

function baseTargets(world: PlayWorld): CommandTarget[] {
  const { names } = world;
  if (!names) {
    return (['place', 'exit', 'item', 'clue'] as const).flatMap((kind) =>
      world[`${kind}s`].map(({ id }): CommandTarget => ({ id, kind, name: idName(id) })));
  }
  const target = (kind: CommandTarget['kind'], id: string, found?: NamedThing): CommandTarget => ({
    id, kind, name: found?.name ?? idName(id), ...found?.aliases?.length ? { aliases: found.aliases } : {},
  });
  const placeIds = new Set(world.places.map(({ id }) => id));
  return [
    ...(['place', 'item', 'clue'] as const).flatMap((kind) => world[`${kind}s`].map(({ id }) =>
      target(kind, id, names[`${kind}s`].find((entry) => entry.id === id)))),
    ...names.people.filter(({ placeId }) => placeIds.has(placeId))
      .map((person) => target('person', person.id, person)),
  ];
}

// Drop aliases that repeat any name, or that the parser would read as a direction or article.
function usableAliases(targets: readonly CommandTarget[]): CommandTarget[] {
  const names = new Set(targets.map(({ name }) => normaliseName(name)));
  return targets.map((target) => {
    const aliases = [...new Set(target.aliases ?? [])].filter((alias) => {
      if (names.has(normaliseName(alias))) return false;
      const result = parseCommand(`go ${alias}`, [{ id: target.id, kind: 'place', name: alias }]);
      return result.ok && 'targetId' in result.action;
    });
    const { id, kind, name } = target;
    return aliases.length ? { id, kind, name, aliases } : { id, kind, name };
  });
}

const namedTargetCache = new WeakMap<PlayWorld, CommandTarget[]>();

// Keep names stable as targets are discovered, including parser normalisation.
function namedTargets(world: PlayWorld): CommandTarget[] {
  const cached = namedTargetCache.get(world);
  if (cached) return cached;
  const targets = usableAliases(baseTargets(world));
  const original = [...targets];
  // Places and exits must also work with go, where words such as north mean a direction.
  const reachable = (target: CommandTarget, list: readonly CommandTarget[]) => {
    if (target.kind !== 'place' && target.kind !== 'exit') return true;
    const result = parseCommand(`go ${target.name}`, list);
    return result.ok && 'targetId' in result.action;
  };
  const named = targets.map((target, index) => {
    const result = parseCommand(`examine ${target.name}`, original);
    if (result.ok && reachable(target, original)) return target;
    let name = `${target.name} (${target.kind} ${index + 1})`;
    while (true) {
      const candidate = parseCommand(`examine ${name}`, targets);
      if (!candidate.ok && candidate.problem === 'unknown-target') break;
      name += '!';
    }
    const renamed = { ...target, name, aliases: [target.name, ...target.aliases ?? []] };
    targets[index] = renamed;
    return renamed;
  });
  namedTargetCache.set(world, named);
  return named;
}

function nameOf(world: PlayWorld, kind: Target['kind'], id: string): string {
  return namedTargets(world).find((target) => target.kind === kind && target.id === id)?.name
    ?? id;
}

// Pack names are in sentence case and may already start with "The", as in
// "The river guest". Mid-sentence they read as "the river guest". Acronyms
// and ID names keep their capitals.
const withThe = (name: string, packName = false) => {
  const bare = name.replace(/^the\s+/i, '');
  return `the ${packName ? bare.replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase()) : bare}`;
};

const the = (world: PlayWorld, kind: Target['kind'], id: string) =>
  withThe(nameOf(world, kind, id), Boolean(world.names));

function listNames(world: PlayWorld, kind: Target['kind'], ids: readonly string[]): string {
  return listOf(ids.map((id) => the(world, kind, id)));
}

function listOf(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// A person's name mid-sentence, so "The river guest" reads as "the river guest".
const personName = (world: PlayWorld, id: string) => nameOf(world, 'person', id).replace(/^The\s/, 'the ');

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const peopleHere = (world: PlayWorld, progress: Progress) => world.names
  ? namedTargets(world).filter(({ kind, id }) => kind === 'person'
    && world.names!.people.some((person) => person.id === id && person.placeId === progress.placeId))
    .map(({ id }) => id)
  : [];

// Pack worlds name exits after where they lead, but only once the player knows that place.
function exitName(world: PlayWorld, progress: Progress, exit: Exit): string {
  if (!world.names) return nameOf(world, 'exit', exit.id);
  const base = (entry: Exit) => isOpen(progress, entry) || progress.placesVisited.has(entry.toPlaceId)
    ? `way to ${the(world, 'place', entry.toPlaceId)}`
    : 'locked way';
  const same = exitsFrom(world, exit.fromPlaceId).filter((entry) => base(entry) === base(exit));
  return same.length < 2 ? base(exit) : `${base(exit)} ${same.indexOf(exit) + 1}`;
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
function stateFrom(world: PlayWorld, progress: Progress) {
  return {
    placeId: progress.placeId,
    itemsHeld: inWorldOrder(world.items, progress.itemsHeld),
    placesVisited: inWorldOrder(world.places, progress.placesVisited),
    cluesRevealed: inWorldOrder(world.clues, progress.cluesRevealed),
    stepsDone: inWorldOrder(world.solution.steps, progress.stepsDone),
    unlockedExits: inWorldOrder(world.exits, progress.unlockedExits),
  };
}

function goalMet(world: PlayWorld, progress: Progress): boolean {
  const goal = world.solution.goal;
  return progress.placeId === goal.placeId && meets(progress, goal.conditions);
}

// Arriving shows the place's clues, as the winnability checker does.
function arrive(world: PlayWorld, progress: Progress, placeId: string): string[] {
  progress.placeId = placeId;
  progress.placesVisited.add(placeId);
  const found = world.clues.filter((clue) => clue.placeId === placeId
    && !progress.cluesRevealed.has(clue.id)).map(({ id }) => id);
  for (const id of found) progress.cluesRevealed.add(id);
  return found;
}

function completeStep(world: PlayWorld, progress: Progress, step: PuzzleStep): string[] {
  progress.stepsDone.add(step.id);
  return step.effects.map((effect) => {
    switch (effect.kind) {
      case 'unlock-exit': {
        progress.unlockedExits.add(effect.exitId);
        const exit = world.exits.find(({ id }) => id === effect.exitId)!;
        return `${capitalise(withThe(exitName(world, progress, exit)))} is now open.`;
      }
      case 'give-item':
        progress.itemsHeld.add(effect.itemId);
        return `You now have ${listNames(world, 'item', [effect.itemId])}.`;
      case 'reveal-clue':
        progress.cluesRevealed.add(effect.clueId);
        return `You found ${listNames(world, 'clue', [effect.clueId])} clue.`;
    }
  });
}

function stepsReadyHere(world: PlayWorld, progress: Progress): PuzzleStep[] {
  return world.solution.steps.filter((step) => step.placeId === progress.placeId
    && !progress.stepsDone.has(step.id) && meets(progress, step.conditions));
}

// Steps that need no item happen by themselves once their conditions hold.
// Steps that need items wait for the player to use one of those items.
function settle(world: PlayWorld, progress: Progress): string[] {
  const messages: string[] = [];
  for (let step = stepsReadyHere(world, progress).find((ready) => !needsItems(ready)); step;
    step = stepsReadyHere(world, progress).find((ready) => !needsItems(ready))) {
    messages.push('Something changes here.', ...completeStep(world, progress, step));
  }
  return messages;
}

const isOpen = (progress: Progress, exit: Exit) => !exit.locked || progress.unlockedExits.has(exit.id);

const exitsFrom = (world: PlayWorld, placeId: string) =>
  world.exits.filter((exit) => exit.fromPlaceId === placeId);

const itemsHere = (world: PlayWorld, progress: Progress) => world.items
  .filter((item) => item.placeId === progress.placeId && !progress.itemsHeld.has(item.id))
  .map(({ id }) => id);

/**
 * Starts a new play of a world at its starting place. Clues there are found
 * and any steps that need no items happen straight away. The world is not changed.
 *
 * @throws RangeError when the world is invalid, as `checkWinnability` would report.
 */
export function startPlay(world: PlayWorld): PlayState {
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
 * their own kind. Names come from `world.names` when given, otherwise from
 * IDs. People appear only while the player is at their place. Pack worlds
 * call an exit "locked way" until the player knows where it leads. Names
 * that collide, or that the parser would read as a direction or article,
 * get a stable numbered suffix. Original names remain aliases and may be
 * ambiguous.
 */
export function discoveredTargets(world: PlayWorld, state: PlayState): CommandTarget[] {
  const progress = progressFrom(state);
  const exits = exitsFrom(world, state.placeId);
  const places = new Set([state.placeId, ...state.placesVisited,
    ...exits.filter((exit) => isOpen(progress, exit)).map((exit) => exit.toPlaceId)]);
  const names = namedTargets(world);
  const target = (kind: Target['kind']) => (id: string): CommandTarget =>
    names.find((target) => target.kind === kind && target.id === id)!;
  return [
    ...inWorldOrder(world.places, places).map(target('place')),
    ...world.names
      ? exits.map((exit): CommandTarget => ({ id: exit.id, kind: 'exit', name: exitName(world, progress, exit) }))
      : exits.map(({ id }) => id).map(target('exit')),
    ...[...state.itemsHeld, ...itemsHere(world, progress)].map(target('item')),
    ...state.cluesRevealed.map(target('clue')),
    ...peopleHere(world, progress).map(target('person')),
  ];
}

function describePlace(world: PlayWorld, progress: Progress): string {
  const parts = [`You are at ${the(world, 'place', progress.placeId)}.`];
  const people = peopleHere(world, progress).map((id) => personName(world, id));
  if (people.length) parts.push(`${capitalise(listOf(people))} ${people.length > 1 ? 'are' : 'is'} here.`);
  const items = itemsHere(world, progress);
  if (items.length) parts.push(`You can see ${listNames(world, 'item', items)}.`);
  const clues = world.clues.filter((clue) => clue.placeId === progress.placeId).map(({ id }) => id);
  if (clues.length) parts.push(`Clues here: ${listNames(world, 'clue', clues)}.`);
  const exits = exitsFrom(world, progress.placeId).map((exit) => {
    if (world.names) {
      const name = withThe(exitName(world, progress, exit));
      return isOpen(progress, exit) || name === 'the locked way' ? name : `${name} (locked)`;
    }
    return isOpen(progress, exit)
      ? `the ${nameOf(world, 'exit', exit.id)} to the ${nameOf(world, 'place', exit.toPlaceId)}`
      : `the ${nameOf(world, 'exit', exit.id)} (locked)`;
  });
  parts.push(exits.length ? `Ways out: ${exits.join(', ')}.` : 'There is no way out.');
  return parts.join(' ');
}

function examine(world: PlayWorld, progress: Progress, { kind, id }: Target): string {
  const name = kind === 'person' ? nameOf(world, kind, id) : the(world, kind, id);
  switch (kind) {
    case 'place':
      if (id === progress.placeId) return describePlace(world, progress);
      return progress.placesVisited.has(id)
        ? `You remember ${name}. Go there to look around.`
        : `${capitalise(name)} is nearby. Go there to look around.`;
    case 'exit': {
      const exit = exitsFrom(world, progress.placeId).find((entry) => entry.id === id);
      if (!exit) return 'That is not here.';
      const exitLabel = capitalise(withThe(exitName(world, progress, exit)));
      if (!isOpen(progress, exit)) return `${exitLabel} is locked.`;
      return world.names
        ? `${exitLabel} is open.`
        : `${exitLabel} leads to ${the(world, 'place', exit.toPlaceId)}.`;
    }
    case 'item':
      if (progress.itemsHeld.has(id)) return `You are carrying ${name}.`;
      return itemsHere(world, progress).includes(id)
        ? `${capitalise(name)} is here. You could take it.`
        : 'That is not here.';
    case 'clue':
      return progress.cluesRevealed.has(id) ? `You have found ${name} clue.` : 'You have not found that.';
    case 'person':
      return peopleHere(world, progress).includes(id) ? `${name} is here.` : 'They are not here.';
    default:
      return 'You see nothing special.';
  }
}

// Is the target something the player can point at from here?
function isPresent(world: PlayWorld, progress: Progress, { kind, id }: Target): boolean {
  switch (kind) {
    case 'place': return id === progress.placeId;
    case 'exit': return exitsFrom(world, progress.placeId).some((exit) => exit.id === id);
    case 'item': return progress.itemsHeld.has(id) || itemsHere(world, progress).includes(id);
    case 'clue': return progress.cluesRevealed.has(id);
    case 'person': return peopleHere(world, progress).includes(id);
    default: return false;
  }
}

function talk(world: PlayWorld, progress: Progress, { kind, id }: Target): string {
  const people = peopleHere(world, progress);
  if (!people.length) return 'There is no one here to talk to.';
  if (kind !== 'person') return 'You can only talk to people.';
  if (!people.includes(id)) return 'They are not here.';
  return `${capitalise(personName(world, id))} greets you.`;
}

interface Change {
  readonly done: boolean;
  readonly message: string;
}

function move(
  world: PlayWorld, progress: Progress,
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
      return { done: false, message: `You cannot get to ${the(world, 'place', id)} directly from here.` };
    }
    exit = ways.find((entry) => isOpen(progress, entry)) ?? ways[0];
  } else {
    return { done: false, message: 'You cannot go there.' };
  }
  if (!isOpen(progress, exit)) {
    return { done: false, message: `${capitalise(withThe(exitName(world, progress, exit)))} is locked.` };
  }
  const found = arrive(world, progress, exit.toPlaceId);
  const parts = [describePlace(world, progress)];
  if (found.length) parts.push(`You found ${listNames(world, 'clue', found)} clue${found.length > 1 ? 's' : ''}.`);
  return { done: true, message: parts.join(' ') };
}

function take(world: PlayWorld, progress: Progress, { kind, id }: Target): Change {
  if (kind !== 'item') return { done: false, message: 'You cannot take that.' };
  if (progress.itemsHeld.has(id)) return { done: false, message: `You already have ${the(world, 'item', id)}.` };
  if (!itemsHere(world, progress).includes(id)) return { done: false, message: 'That is not here.' };
  progress.itemsHeld.add(id);
  return { done: true, message: `You take ${the(world, 'item', id)}.` };
}

function use(
  world: PlayWorld, progress: Progress, action: CommandAction & { kind: 'use' },
): Change {
  const id = action.itemId;
  if (!progress.itemsHeld.has(id)) {
    return {
      done: false,
      message: itemsHere(world, progress).includes(id)
        ? `Take ${the(world, 'item', id)} first.`
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
  const onTarget = !target ? ''
    : target.kind === 'person' ? ` on ${personName(world, target.id)}`
      : target.kind === 'exit' ? ` on ${withThe(exitName(world, progress, world.exits.find(({ id }) => id === target.id)!))}`
        : ` on ${the(world, target.kind, target.id)}`;
  return {
    done: true,
    message: [`You use ${the(world, 'item', id)}${onTarget}.`, ...completeStep(world, progress, step)].join(' '),
  };
}

// Takes and uses everything possible here. Progress only grows in version 1,
// so this never blocks a win and lets the route search treat a place as one step.
function settleGreedily(world: PlayWorld, progress: Progress): void {
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
function nextPlaceToGoal(world: PlayWorld, start: Progress): string | null | 'too-large' {
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

function hint(world: PlayWorld, progress: Progress): string {
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
  if (next === null) return 'There seems to be no way forward from here. Try undo.';
  return `Try going to ${the(world, 'place', next)}.`;
}

/**
 * Carries out one parsed action and returns the new state and a response.
 * Neither the world nor the input state is changed.
 *
 * @remarks
 * Moves, takes and successful uses count as turns and can be undone. Look,
 * examine, inventory, hint, help and talking are free. People from
 * `world.names` can be talked to and examined at their place. A step that needs items happens
 * when the player uses one of those items at its place; other steps happen by
 * themselves once their conditions hold. These match the winnability
 * checker's rules, so any winnable world can be won with typed commands.
 * Hints point at the next useful step without naming puzzle answers.
 *
 * @throws RangeError when the world is invalid.
 */
export function runAction(world: PlayWorld, state: PlayState, action: CommandAction): PlayTurn {
  validateWorld(world);
  const progress = progressFrom(state);
  const reply = (message: string): PlayTurn => ({ state, message });
  switch (action.kind) {
    case 'help': return reply(commandHelp);
    case 'look': return reply(describePlace(world, progress));
    case 'examine':
      return reply(examine(world, progress, { kind: action.targetKind, id: action.targetId }));
    case 'talk':
      return reply(talk(world, progress, { kind: action.targetKind, id: action.targetId }));
    case 'inventory':
      return reply(state.itemsHeld.length
        ? `You are carrying ${listNames(world, 'item', state.itemsHeld)}.`
        : 'You are not carrying anything.');
    case 'hint':
      return reply(state.goalReached ? 'You have already finished this adventure.' : hint(world, progress));
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
export function playCommand(world: PlayWorld, state: PlayState, input: string): PlayTurn {
  const result = parseCommand(input, discoveredTargets(world, state));
  return result.ok ? runAction(world, state, result.action) : { state, message: result.message };
}

/**
 * Starts a world and plays a list of typed commands in order. The same world
 * and commands always give the same state, so a save can store the command list.
 */
export function replayCommands(world: PlayWorld, inputs: readonly string[]): PlayState {
  return inputs.reduce((state, input) => playCommand(world, state, input).state, startPlay(world));
}
