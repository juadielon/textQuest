import type { AdventureWorld, Conditions, Exit, PuzzleStep } from '../adventure-world';
import { useStepOptions } from '../use-rules';
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
  /** Turns that changed progress: moves, takes, successful uses and choices. */
  readonly turns: number;
  /** True once the player has reached the goal or a winning ending. */
  readonly goalReached: boolean;
  /** The state before the last turn, for undo. Null at the start. */
  readonly previous: PlayState | null;
}

/** A player-facing name for a place, item, clue or choice, plus other names to accept. */
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
 * A world ready to play. Without `names`, place and item names come from IDs.
 * Names only change what the player sees and types, never the rules.
 */
export interface PlayWorld extends AdventureWorld {
  readonly names?: WorldNames;
  /** Spoiler-free choice labels keyed by step ID. Missing labels use neutral numbers. */
  readonly choiceNames?: readonly NamedThing[];
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

const normaliseTargetName = (name: string) => normaliseName(name.replace(/[\s.!?]+$/, ''));

// Drop aliases that repeat any name, or that the parser would read as a direction or article.
function usableAliases(targets: readonly CommandTarget[]): CommandTarget[] {
  const names = new Set(targets.map(({ name }) => normaliseTargetName(name)));
  return targets.map((target) => {
    const aliases = [...new Set(target.aliases ?? [])].filter((alias) => {
      if (names.has(normaliseTargetName(alias))) return false;
      const result = parseCommand(`go ${alias}`, [{ id: target.id, kind: 'place', name: alias }]);
      return result.ok && 'targetId' in result.action;
    });
    const { id, kind, name } = target;
    return aliases.length ? { id, kind, name, aliases } : { id, kind, name };
  });
}

// Naming parses every target, which is slow, so each world's names are kept.
// Play never changes a world, so the names stay correct.
const namesByWorld = new WeakMap<PlayWorld, readonly CommandTarget[]>();

// Keep names stable as targets are discovered, including parser normalisation.
function namedTargets(world: PlayWorld): readonly CommandTarget[] {
  const cached = namesByWorld.get(world);
  if (cached) return cached;
  const targets = nameTargets(world);
  const named = world.version === 2 ? stableUseTargets(world, targets) : targets;
  namesByWorld.set(world, named);
  return named;
}

function nameTargets(world: PlayWorld): CommandTarget[] {
  const targets = usableAliases(baseTargets(world));
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
  // A later rename can change how an earlier item's use command is parsed.
  while (true) {
    const index = targets.findIndex((target) => !reachable(target, targets));
    if (index < 0) return targets;
    const target = original[index];
    let attempt = 0;
    while (true) {
      const name = attempt === 0 ? `${target.name} (${target.kind} ${index + 1})`
        : `${target.kind} ${index + 1}${attempt > 1 ? ` ${attempt - 1}` : ''}`;
      const named = { ...target, name, aliases: [target.name, ...target.aliases ?? []] };
      const candidate = parseCommand(`examine ${name}`, targets);
      const withCandidate = targets.map((entry, position) => position === index ? named : entry);
      if (!candidate.ok && candidate.problem === 'unknown-target'
        && reachable(named, withCandidate)) {
        targets[index] = named;
        break;
      }
      attempt++;
    }
  }
}

// Choose item-use fallbacks for the whole world without displaying hidden names.
function stableUseTargets(world: PlayWorld, targets: readonly CommandTarget[]): CommandTarget[] {
  const labels = targets.flatMap(({ name, aliases }) =>
    [name, ...aliases ?? []].map(normaliseTargetName));
  const itemLabels = targets.filter(({ kind }) => kind === 'item')
    .flatMap(({ name, aliases }) => [name, ...aliases ?? []].map(normaliseTargetName));
  const itemNames = new Set(itemLabels);
  const numbers = new Map(world.items.map(({ id }, index) => [id, index + 1]));
  return targets.map((target) => {
    if (target.kind !== 'item') return target;
    const name = normaliseTargetName(target.name);
    const words = target.name.toLowerCase().trim().split(/\s+/);
    const ambiguous = /[.!?]\s*$/.test(target.name)
      || words.some((word, index) => word === 'on'
        && itemNames.has(normaliseName(words.slice(0, index).join(' '))))
      || itemLabels.some((label) => label.startsWith(`${name} on `));
    if (!ambiguous) return target;
    const number = numbers.get(target.id)!;
    let attempt = 0;
    let fallback: string;
    do {
      fallback = `item ${number}${attempt ? ` ${attempt}` : ''}`;
      attempt++;
    } while (labels.some((label) => label.includes(fallback)));
    labels.push(fallback);
    return { ...target, name: fallback, aliases: [target.name, ...target.aliases ?? []] };
  });
}

function nameOf(world: PlayWorld, kind: Target['kind'], id: string): string {
  return namedTargets(world).find((target) => target.kind === kind && target.id === id)?.name
    ?? id;
}

// Pack names are in sentence case and may already start with "The", as in
// "The river guest". Mid-sentence they read as "the river guest". Acronyms
// and ID names keep their capitals.
const withThe = (name: string, packName = false) => {
  if (!packName) return `the ${name}`;
  const bare = name.replace(/^the\s+/i, '');
  return `the ${bare.replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase())}`;
};

const the = (world: PlayWorld, kind: Target['kind'], id: string) =>
  withThe(nameOf(world, kind, id), Boolean(world.names));

function listOf(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const peopleHere = (world: PlayWorld, progress: Progress) => world.names
  ? namedTargets(world).filter(({ kind, id }) => kind === 'person'
    && world.names!.people.some((person) => person.id === id && person.placeId === progress.placeId))
    .map(({ id }) => id)
  : [];

// Pack worlds name exits after where they lead, but only once the player knows that place.
function rawExitName(world: PlayWorld, progress: Progress, exit: Exit): string {
  const base = (entry: Exit) => isOpen(progress, entry) || progress.placesVisited.has(entry.toPlaceId)
    ? `way to ${the(world, 'place', entry.toPlaceId)}`
    : 'locked way';
  const same = exitsFrom(world, exit.fromPlaceId).filter((entry) => base(entry) === base(exit));
  return same.length < 2 ? base(exit) : `${base(exit)} ${same.indexOf(exit) + 1}`;
}

function disambiguateExitTargets(targets: readonly CommandTarget[], protectItems = false): CommandTarget[] {
  const result = usableAliases(targets);
  const choiceAliases = new Map(targets.filter(({ kind }) => kind === 'choice')
    .map(({ id, aliases }) => [id, aliases] as const));
  const reachable = (target: CommandTarget, list: readonly CommandTarget[]) => {
    const verbs = target.kind === 'item' ? ['examine', 'take', 'use']
      : target.kind === 'place' || target.kind === 'exit' ? ['examine', 'go']
        : target.kind === 'person' ? ['examine', 'talk to']
          : target.kind === 'choice' ? ['examine', 'choose'] : ['examine'];
    return verbs.every((verb) => {
      const parsed = parseCommand(`${verb} ${target.name}`, list);
      if (!parsed.ok) return false;
      if (parsed.action.kind === 'use') {
        return parsed.action.itemId === target.id && !('targetId' in parsed.action);
      }
      return 'targetId' in parsed.action && parsed.action.targetId === target.id
        && parsed.action.targetKind === target.kind;
    });
  };
  while (true) {
    let index = protectItems
      ? result.findIndex((target) => target.kind !== 'item' && !reachable(target, result))
      : -1;
    if (index < 0) index = result.findIndex((target) => !reachable(target, result));
    if (index < 0) {
      return usableAliases(result.map((target) => target.kind === 'choice'
        ? { ...target, aliases: choiceAliases.get(target.id) } : target));
    }
    const target = result[index];
    for (let attempt = 0; ; attempt++) {
      const name = attempt === 0 ? `${target.name} (${target.kind} ${index + 1})`
        : `${target.kind} ${index + 1}${attempt > 1 ? ` ${attempt - 1}` : ''}`;
      const renamed = { ...target, name, aliases: [] };
      const candidate = parseCommand(`examine ${name}`, result);
      const withCandidate = result.map((entry, position) => position === index ? renamed : entry);
      if (!candidate.ok && candidate.problem === 'unknown-target'
        && reachable(renamed, withCandidate)) {
        result[index] = renamed;
        break;
      }
    }
  }
}

// Only show names the player can currently discover.
function stateTargets(world: PlayWorld, progress: Progress): CommandTarget[] {
  const exits = exitsFrom(world, progress.placeId);
  const places = new Set([progress.placeId, ...progress.placesVisited,
    ...exits.filter((exit) => isOpen(progress, exit)).map((exit) => exit.toPlaceId)]);
  const names = namedTargets(world);
  const target = (kind: Target['kind']) => (id: string): CommandTarget =>
    names.find((entry) => entry.kind === kind && entry.id === id)!;
  const choices = choicesHere(world, progress).map(({ id, step }): CommandTarget => {
    const label = world.choiceNames?.find((entry) => entry.id === step.id);
    return {
      id, kind: 'choice', name: label?.name ?? idName(id),
      ...label?.aliases?.length ? { aliases: label.aliases } : {},
    };
  });
  const targets = [
    ...inWorldOrder(world.places, places).map(target('place')),
    ...world.names
      ? exits.map((exit): CommandTarget => ({ id: exit.id, kind: 'exit', name: rawExitName(world, progress, exit) }))
      : exits.map(({ id }) => id).map(target('exit')),
    ...(world.names || world.version === 2
      ? inWorldOrder(world.items, new Set([...progress.itemsHeld, ...itemsHere(world, progress)]))
      : [...progress.itemsHeld, ...itemsHere(world, progress)]).map(target('item')),
    ...[...progress.cluesRevealed].map(target('clue')),
    ...peopleHere(world, progress).map(target('person')),
    ...choices,
  ];
  return world.names || choices.length
    ? disambiguateExitTargets(targets, world.version === 2) : targets;
}

function stateNameOf(
  world: PlayWorld, progress: Progress, kind: Target['kind'], id: string,
  targets = stateTargets(world, progress),
): string {
  return targets.find((target) => target.kind === kind && target.id === id)?.name
    ?? nameOf(world, kind, id);
}

function stateThe(
  world: PlayWorld, progress: Progress, kind: Target['kind'], id: string,
  targets = stateTargets(world, progress),
): string {
  return withThe(stateNameOf(world, progress, kind, id, targets), Boolean(world.names));
}

function stateListNames(
  world: PlayWorld, progress: Progress, kind: Target['kind'], ids: readonly string[],
): string {
  const targets = stateTargets(world, progress);
  return listOf(ids.map((id) => stateThe(world, progress, kind, id, targets)));
}

function exitName(
  world: PlayWorld, progress: Progress, exit: Exit, targets?: readonly CommandTarget[],
): string {
  return (targets ?? stateTargets(world, progress)).find(({ kind, id }) => kind === 'exit' && id === exit.id)?.name
    ?? (world.names ? rawExitName(world, progress, exit) : nameOf(world, 'exit', exit.id));
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

function completeStep(world: PlayWorld, progress: Progress, step: PuzzleStep, includeMessages = true): string[] {
  progress.stepsDone.add(step.id);
  const messages: string[] = [];
  for (const effect of step.effects) {
    switch (effect.kind) {
      case 'unlock-exit': {
        progress.unlockedExits.add(effect.exitId);
        if (includeMessages) {
          const exit = world.exits.find(({ id }) => id === effect.exitId)!;
          if (exit.fromPlaceId !== progress.placeId && (world.version === 2
            || (world.names && !progress.placesVisited.has(exit.toPlaceId)))) {
            messages.push('A way is now open.');
          } else {
            messages.push(`${capitalise(withThe(exitName(world, progress, exit)))} is now open.`);
          }
        }
        break;
      }
      case 'give-item':
        progress.itemsHeld.add(effect.itemId);
        if (includeMessages) messages.push(`You now have ${stateListNames(world, progress, 'item', [effect.itemId])}.`);
        break;
      case 'reveal-clue':
        progress.cluesRevealed.add(effect.clueId);
        if (includeMessages) messages.push(`You found ${stateListNames(world, progress, 'clue', [effect.clueId])} clue.`);
        break;
      case 'end-adventure':
        break;
    }
  }
  return messages;
}

// Version 2 decisions: choices and steps that end the adventure. The player
// makes them with choose, so they never happen by themselves or through use.
const isDecision = (step: PuzzleStep) => step.choiceId !== undefined
  || step.effects.some(({ kind }) => kind === 'end-adventure');

function stepsReadyHere(world: PlayWorld, progress: Progress): PuzzleStep[] {
  const closedChoices = new Set<string>();
  if (world.version === 2) {
    for (const step of world.solution.steps) {
      if (progress.stepsDone.has(step.id) && step.choiceId !== undefined) closedChoices.add(step.choiceId);
    }
  }
  return world.solution.steps.filter((step) => step.placeId === progress.placeId
    && !progress.stepsDone.has(step.id) && meets(progress, step.conditions)
    && (step.choiceId === undefined || !closedChoices.has(step.choiceId)));
}

const actionsReadyHere = (world: PlayWorld, progress: Progress) =>
  world.solution.steps.filter((step) => step.placeId === progress.placeId
    && !progress.stepsDone.has(step.id) && !isDecision(step) && meets(progress, step.conditions));

// Only winning endings can be played until checkpoint recovery exists.
function winningEndingReached(world: PlayWorld, progress: Progress): boolean {
  if (world.version === 1) return false;
  const wins = new Set((world.solution.endings ?? [])
    .filter(({ outcome }) => outcome === 'win').map(({ id }) => id));
  return world.solution.steps.some((step) => progress.stepsDone.has(step.id)
    && step.effects.some((effect) => effect.kind === 'end-adventure' && wins.has(effect.endingId)));
}

function choicesHere(world: PlayWorld, progress: Progress): { id: string; step: PuzzleStep }[] {
  if (world.version === 1 || goalMet(world, progress) || winningEndingReached(world, progress)) return [];
  const ready = new Set(stepsReadyHere(world, progress));
  return world.solution.steps.filter(isDecision).flatMap((step, index) =>
    ready.has(step) ? [{ id: `choice-${index + 1}`, step }] : []);
}

// Steps that need no item happen by themselves once their conditions hold.
// Steps that need items wait for the player to use one of those items.
function settle(world: PlayWorld, progress: Progress, includeMessages = true): string[] {
  const messages: string[] = [];
  const automatic = world.solution.steps.filter((step) => step.placeId === progress.placeId
    && !isDecision(step) && !needsItems(step));
  for (let step = automatic.find((entry) => !progress.stepsDone.has(entry.id)
    && meets(progress, entry.conditions)); step;
    step = automatic.find((entry) => !progress.stepsDone.has(entry.id)
      && meets(progress, entry.conditions))) {
    const changes = completeStep(world, progress, step, includeMessages);
    if (includeMessages) messages.push('Something changes here.', ...changes);
  }
  return messages;
}

const isOpen = (progress: Progress, exit: Exit) => !exit.locked || progress.unlockedExits.has(exit.id);

const exitsFrom = (world: PlayWorld, placeId: string) =>
  world.exits.filter((exit) => exit.fromPlaceId === placeId);

const itemsHere = (world: PlayWorld, progress: Progress) => world.items
  .filter((item) => item.placeId === progress.placeId && !progress.itemsHeld.has(item.id))
  .map(({ id }) => id);

// Failure endings stay out of play until checkpoint recovery exists (issue #82).
function validatePlayWorld(world: PlayWorld): void {
  validateWorld(world);
  if ((world.solution.endings ?? []).some(({ outcome }) => outcome === 'failure')) {
    throw new RangeError('Failure endings cannot be played until checkpoint recovery exists.');
  }
}

/**
 * Starts a new play of a world at its starting place. Clues there are found
 * and any steps that need no items happen straight away. The world is not changed.
 *
 * @throws RangeError when the world is invalid, as `checkWinnability` would
 * report, or has a failure ending, which play does not support yet.
 */
export function startPlay(world: PlayWorld): PlayState {
  validatePlayWorld(world);
  const progress: Progress = {
    placeId: world.startPlaceId, itemsHeld: new Set(), placesVisited: new Set(),
    cluesRevealed: new Set(), stepsDone: new Set(), unlockedExits: new Set(),
  };
  arrive(world, progress, world.startPlaceId);
  settle(world, progress, false);
  return {
    ...stateFrom(world, progress), turns: 0, goalReached: goalMet(world, progress), previous: null,
  };
}

/**
 * Lists the things the player has discovered, ready to pass to `parseCommand`.
 * Puzzle steps, the goal, unvisited places out of sight, items elsewhere and
 * unfound clues never appear. World version 2 choices appear only while the
 * player is at their place, their conditions hold and the choice is still
 * open. Finished adventures have no available choices.
 *
 * @remarks
 * Targets use IDs with their kind, because IDs are only unique within their
 * own kind. Choices use stable neutral IDs, not puzzle step IDs. Names come
 * from `world.names` when given, otherwise from IDs. Choice labels come from
 * `world.choiceNames` or neutral numbers, never from solution IDs. People
 * appear only while the player is at their place. Pack worlds
 * call an exit "locked way" until the player knows where it leads. Names
 * that collide, cannot be parsed, or make an item-on-exit command ambiguous
 * get a neutral numbered name where needed. Some original names and aliases
 * may be ignored or ambiguous. Version 2 item names stay usable as choices
 * appear or the player moves. Neutral item-use fallback numbers follow world
 * item order, not inventory or discovered target order.
 */
export function discoveredTargets(world: PlayWorld, state: PlayState): CommandTarget[] {
  const progress = progressFrom(state);
  return stateTargets(world, progress);
}

function describePlace(world: PlayWorld, progress: Progress): string {
  const targets = stateTargets(world, progress);
  const parts = [`You are at ${stateThe(world, progress, 'place', progress.placeId, targets)}.`];
  const people = peopleHere(world, progress).map((id) =>
    stateNameOf(world, progress, 'person', id, targets).replace(/^The\s/, 'the '));
  if (people.length) parts.push(`${capitalise(listOf(people))} ${people.length > 1 ? 'are' : 'is'} here.`);
  const items = itemsHere(world, progress);
  if (items.length) {
    parts.push(`You can see ${listOf(items.map((id) => stateThe(world, progress, 'item', id, targets)))}.`);
  }
  const clues = world.clues.filter((clue) => clue.placeId === progress.placeId).map(({ id }) => id);
  if (clues.length) {
    parts.push(`Clues here: ${listOf(clues.map((id) => stateThe(world, progress, 'clue', id, targets)))}.`);
  }
  const choices = targets.filter(({ kind }) => kind === 'choice');
  if (choices.length) {
    parts.push(`You can choose ${listOf(choices.map(({ name }) => name))}.`);
  }
  const exits = exitsFrom(world, progress.placeId).map((exit) => {
    if (world.names) {
      const name = withThe(exitName(world, progress, exit, targets));
      return isOpen(progress, exit) || name === 'the locked way' ? name : `${name} (locked)`;
    }
    const name = stateNameOf(world, progress, 'exit', exit.id, targets);
    return isOpen(progress, exit)
      ? `the ${name} to the ${stateNameOf(world, progress, 'place', exit.toPlaceId, targets)}`
      : `the ${name} (locked)`;
  });
  parts.push(exits.length ? `Ways out: ${exits.join(', ')}.` : 'There is no way out.');
  return parts.join(' ');
}

function examine(world: PlayWorld, progress: Progress, { kind, id }: Target): string {
  if (kind === 'place' && id === progress.placeId) return describePlace(world, progress);
  const targets = stateTargets(world, progress);
  const name = kind === 'person' || kind === 'choice'
    ? stateNameOf(world, progress, kind, id, targets)
    : stateThe(world, progress, kind, id, targets);
  switch (kind) {
    case 'place':
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
        : `${exitLabel} leads to ${stateThe(world, progress, 'place', exit.toPlaceId, targets)}.`;
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
    case 'choice':
      return choicesHere(world, progress).some((choice) => choice.id === id)
        ? `You could choose ${name} here.`
        : 'That choice is not here.';
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
    case 'choice': return choicesHere(world, progress).some((choice) => choice.id === id);
    default: return false;
  }
}

function talk(world: PlayWorld, progress: Progress, { kind, id }: Target): string {
  const people = peopleHere(world, progress);
  if (!people.length) return 'There is no one here to talk to.';
  if (kind !== 'person') return 'You can only talk to people.';
  if (!people.includes(id)) return 'They are not here.';
  const targets = stateTargets(world, progress);
  return `${capitalise(stateNameOf(world, progress, 'person', id, targets).replace(/^The\s/, 'the '))} greets you.`;
}

interface Change {
  readonly done: boolean;
  readonly message: string;
  readonly arrivalClues?: readonly string[];
}

function describeArrival(world: PlayWorld, progress: Progress, found: readonly string[]): string {
  const parts = [describePlace(world, progress)];
  if (found.length) {
    parts.push(`You found ${stateListNames(world, progress, 'clue', found)} clue${found.length > 1 ? 's' : ''}.`);
  }
  return parts.join(' ');
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
  const targets = stateTargets(world, progress);
  const exits = exitsFrom(world, progress.placeId);
  let exit: Exit | undefined;
  if (kind === 'exit') {
    exit = exits.find((entry) => entry.id === id);
    if (!exit) return { done: false, message: 'That way is not here.' };
  } else if (kind === 'place') {
    if (id === progress.placeId) return { done: false, message: 'You are already here.' };
    const ways = exits.filter((entry) => entry.toPlaceId === id);
    if (!ways.length) {
      return {
        done: false,
        message: `You cannot get to ${stateThe(world, progress, 'place', id, targets)} directly from here.`,
      };
    }
    exit = ways.find((entry) => isOpen(progress, entry)) ?? ways[0];
  } else {
    return { done: false, message: 'You cannot go there.' };
  }
  if (!isOpen(progress, exit)) {
    return { done: false, message: `${capitalise(withThe(exitName(world, progress, exit)))} is locked.` };
  }
  const found = arrive(world, progress, exit.toPlaceId);
  return world.version === 2
    ? { done: true, message: '', arrivalClues: found }
    : { done: true, message: describeArrival(world, progress, found) };
}

function take(world: PlayWorld, progress: Progress, { kind, id }: Target): Change {
  if (kind !== 'item') return { done: false, message: 'You cannot take that.' };
  if (progress.itemsHeld.has(id)) {
    return { done: false, message: `You already have ${stateThe(world, progress, 'item', id)}.` };
  }
  if (!itemsHere(world, progress).includes(id)) return { done: false, message: 'That is not here.' };
  progress.itemsHeld.add(id);
  return { done: true, message: `You take ${stateThe(world, progress, 'item', id)}.` };
}

function use(
  world: PlayWorld, progress: Progress, action: CommandAction & { kind: 'use' },
): Change {
  const id = action.itemId;
  if (!progress.itemsHeld.has(id)) {
    return {
      done: false,
      message: itemsHere(world, progress).includes(id)
        ? `Take ${stateThe(world, progress, 'item', id)} first.`
        : 'You are not carrying that.',
    };
  }
  const target: Target | undefined = 'targetId' in action
    ? { kind: action.targetKind, id: action.targetId }
    : undefined;
  if (target && !isPresent(world, progress, target)) {
    return { done: false, message: 'That is not here.' };
  }
  const options = useStepOptions(actionsReadyHere(world, progress));
  // Prefer a step that opens the exit the player named, but never block progress on the target.
  const step = (target?.kind === 'exit' ? options.byExit.get(target.id)?.get(id) : undefined)
    ?? options.byItem.get(id);
  if (!step) return { done: false, message: 'Nothing happens.' };
  const targets = stateTargets(world, progress);
  const onTarget = !target ? ''
    : target.kind === 'person'
      ? ` on ${stateNameOf(world, progress, 'person', target.id, targets).replace(/^The\s/, 'the ')}`
      : target.kind === 'exit'
        ? ` on ${withThe(exitName(world, progress, world.exits.find(({ id }) => id === target.id)!, targets))}`
        : ` on ${stateThe(world, progress, target.kind, target.id, targets)}`;
  return {
    done: true,
    message: [
      `You use ${stateThe(world, progress, 'item', id, targets)}${onTarget}.`,
      ...completeStep(world, progress, step),
    ].join(' '),
  };
}

function choose(world: PlayWorld, progress: Progress, { kind, id }: Target): Change {
  const choice = kind === 'choice' ? choicesHere(world, progress).find((entry) => entry.id === id) : undefined;
  if (!choice) {
    return { done: false, message: 'There is no choice to make here.' };
  }
  const name = stateNameOf(world, progress, 'choice', id);
  return { done: true, message: [`You choose ${name}.`, ...completeStep(world, progress, choice.step)].join(' ') };
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
      completeStep(world, progress, step, false);
      changed = true;
    }
  }
}

function progressKey(progress: Progress): string {
  return JSON.stringify([progress.placeId, ...[progress.itemsHeld, progress.placesVisited,
    progress.stepsDone, progress.cluesRevealed, progress.unlockedExits].map((ids) => [...ids].sort())]);
}

// Finds the first place to head for on a shortest route to the goal.
const searchLimitReached = Symbol('search-limit');

function nextPlaceToGoal(
  world: PlayWorld,
  start: Progress,
): string | null | typeof searchLimitReached {
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
      if (seen.size >= MAX_SEARCH_STATES) return searchLimitReached;
      seen.add(key);
      queue.push({ progress: next, firstPlaceId: placeId });
    }
  }
  return null;
}

function hint(world: PlayWorld, progress: Progress, canUndo: boolean): string {
  // shortcut: version 2 hints do not search routes; upgrade when search models choices.
  if (world.version === 2) {
    if (choicesHere(world, progress).length) return 'There is a choice to make here. Think before you choose.';
    if (actionsReadyHere(world, progress).length) return 'Something you are carrying could be useful here.';
    return `Look around and think about what you could do next.${canUndo ? ' You can also try undo.' : ''}`;
  }
  const { steps, goal } = world.solution;
  const neededItems = new Set([goal, ...steps].flatMap(({ conditions }) => conditions.itemsHeld ?? []));
  if (itemsHere(world, progress).some((id) => neededItems.has(id))) {
    return 'Look around. Something here is worth taking.';
  }
  if (actionsReadyHere(world, progress).length) {
    return 'Something you are carrying could be useful here.';
  }
  const next = nextPlaceToGoal(world, progress);
  if (next === searchLimitReached) return 'Try exploring somewhere you have not been yet.';
  if (next === null) {
    return `There seems to be no way forward from here.${canUndo ? ' Try undo.' : ''}`;
  }
  return `Try going to ${stateThe(world, progress, 'place', next)}.`;
}

/**
 * Carries out one parsed action and returns the new state and a response.
 * Neither the world nor the input state is changed.
 *
 * @remarks
 * Moves, takes, successful uses and choices count as turns and can be undone. Look,
 * examine, inventory, hint, help and talking are free. People from
 * `world.names` can be talked to and examined at their place. A step that needs items happens
 * when the player uses one of those items at its place; other steps happen by
 * themselves once their conditions hold. These match the winnability
 * checker's rules, so any winnable world can be won with typed commands.
 *
 * World version 2 decisions, meaning steps with a `choiceId` or an
 * `end-adventure` effect, never happen by themselves or through use. Once
 * their conditions hold at their place they are offered as choices, and
 * `choose` makes one. Making one step of a choice shuts out the others. A
 * winning ending finishes the adventure straight away.
 *
 * Hints point at the next useful step without naming puzzle answers, and
 * suggest undo at a dead end only when a previous turn exists. Version 2
 * hints stay general and never suggest a route, because the route search
 * does not model choices yet.
 *
 * @throws RangeError when the world is invalid or has a failure ending.
 */
export function runAction(world: PlayWorld, state: PlayState, action: CommandAction): PlayTurn {
  validatePlayWorld(world);
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
        ? `You are carrying ${stateListNames(world, progress, 'item', state.itemsHeld)}.`
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
    case 'choose':
      change = choose(world, progress, { kind: action.targetKind, id: action.targetId });
      break;
  }
  if (!change.done) return reply(change.message);
  // An ending stops the adventure straight away, as the checker's routes do.
  const endedWell = winningEndingReached(world, progress);
  const settled = endedWell ? [] : settle(world, progress);
  const goalReached = endedWell || goalMet(world, progress);
  const message = change.arrivalClues === undefined
    ? change.message : describeArrival(world, progress, change.arrivalClues);
  const messages = [message, ...settled];
  if (endedWell) messages.push('Your adventure ends here, and you have won. Well done!');
  else if (goalReached) messages.push('You have reached your goal. Well done!');
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
