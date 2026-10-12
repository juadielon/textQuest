import type { AdventureWorld, Clue, Conditions, Exit, Item } from './adventure-world';

/**
 * The most search states `checkWinnability` will create before it stops and
 * reports a world as too large to check.
 *
 * This is a conservative first value. It will be retuned once the adventure
 * generator can produce real worlds to measure.
 */
export const MAX_SEARCH_STATES = 10_000;

/** The result for a world that the checker searched completely. */
export interface CheckedWinnability {
  /** True when at least one route reaches the goal. */
  readonly winnable: boolean;
  /** IDs of puzzle steps that no route can complete, in world order. */
  readonly unreachableStepIds: readonly string[];
}

/**
 * The result for a world that needed more than `MAX_SEARCH_STATES` states.
 * Its winnability is unknown, so it must be treated as rejected.
 */
export interface TooLargeToCheck {
  /** Always false, so the world is never counted as winnable. */
  readonly winnable: false;
  /** Marks a search that stopped at the limit. */
  readonly tooLarge: true;
}

/** What `checkWinnability` found. Use `'tooLarge' in result` to tell them apart. */
export type WinnabilityResult = CheckedWinnability | TooLargeToCheck;

interface SearchState {
  placeId: string;
  itemsHeld: Set<string>;
  placesVisited: Set<string>;
  stepsDone: Set<string>;
  cluesRevealed: Set<string>;
  unlockedExits: Set<string>;
}

/**
 * Checks that a world uses a supported version, has unique non-empty IDs and
 * only refers to things that exist. The world is not changed.
 *
 * @throws RangeError when the world is invalid, with a message naming the problem.
 */
export function validateWorld(world: AdventureWorld): void {
  if (world.version !== 1) {
    throw new RangeError(`World version ${world.version} is not supported.`);
  }

  const idsFor = (entries: readonly { readonly id: string }[], kind: string) => {
    const ids = new Set<string>();
    for (const { id } of entries) {
      if (!id.trim() || ids.has(id)) {
        throw new RangeError(`The ${kind} ID "${id}" is empty or repeated.`);
      }
      ids.add(id);
    }
    return ids;
  };
  const places = idsFor(world.places, 'place');
  const exits = idsFor(world.exits, 'exit');
  const items = idsFor(world.items, 'item');
  const clues = idsFor(world.clues, 'clue');
  const steps = idsFor(world.solution.steps, 'step');
  const requireId = (ids: Set<string>, id: string, kind: string) => {
    if (!ids.has(id)) {
      throw new RangeError(`Unknown ${kind} ID "${id}".`);
    }
  };
  const checkConditions = (conditions: Conditions) => {
    for (const id of conditions.itemsHeld ?? []) requireId(items, id, 'item');
    for (const id of conditions.placesVisited ?? []) requireId(places, id, 'place');
    for (const id of conditions.stepsDone ?? []) requireId(steps, id, 'step');
    for (const id of conditions.cluesRevealed ?? []) requireId(clues, id, 'clue');
  };

  requireId(places, world.startPlaceId, 'place');
  requireId(places, world.solution.goal.placeId, 'place');
  checkConditions(world.solution.goal.conditions);
  for (const exit of world.exits) {
    requireId(places, exit.fromPlaceId, 'place');
    requireId(places, exit.toPlaceId, 'place');
  }
  for (const entry of [...world.items, ...world.clues]) {
    if (entry.placeId !== undefined) requireId(places, entry.placeId, 'place');
  }
  for (const step of world.solution.steps) {
    requireId(places, step.placeId, 'place');
    checkConditions(step.conditions);
    for (const effect of step.effects) {
      switch (effect.kind) {
        case 'unlock-exit': requireId(exits, effect.exitId, 'exit'); break;
        case 'give-item': requireId(items, effect.itemId, 'item'); break;
        case 'reveal-clue': requireId(clues, effect.clueId, 'clue'); break;
        default: throw new RangeError('Unknown puzzle effect.');
      }
    }
  }
}

function meetsConditions(state: SearchState, conditions: Conditions): boolean {
  return (conditions.itemsHeld ?? []).every((id) => state.itemsHeld.has(id))
    && (conditions.placesVisited ?? []).every((id) => state.placesVisited.has(id))
    && (conditions.stepsDone ?? []).every((id) => state.stepsDone.has(id))
    && (conditions.cluesRevealed ?? []).every((id) => state.cluesRevealed.has(id));
}

interface Links {
  readonly outgoing: Map<string, Exit[]>;
  readonly incoming: Map<string, Exit[]>;
}

function linksFor(world: AdventureWorld): Links {
  const outgoing = new Map(world.places.map(({ id }) => [id, [] as Exit[]]));
  const incoming = new Map(world.places.map(({ id }) => [id, [] as Exit[]]));
  for (const exit of world.exits) {
    outgoing.get(exit.fromPlaceId)!.push(exit);
    incoming.get(exit.toPlaceId)!.push(exit);
  }
  return { outgoing, incoming };
}

function isOpen(state: SearchState, exit: Exit): boolean {
  return !exit.locked || state.unlockedExits.has(exit.id);
}

function placesLinkedTo(
  state: SearchState, links: Map<string, Exit[]>, next: (exit: Exit) => string,
): Set<string> {
  const found = new Set([state.placeId]);
  for (const placeId of found) {
    for (const exit of links.get(placeId)!) {
      if (isOpen(state, exit)) found.add(next(exit));
    }
  }
  return found;
}

// Places the player can walk to and still get back from. Visiting them all
// only adds progress, so the search treats them as one area.
function returnablePlaces(world: AdventureWorld, state: SearchState, links: Links): string[] {
  const forward = placesLinkedTo(state, links.outgoing, (exit) => exit.toPlaceId);
  const back = placesLinkedTo(state, links.incoming, (exit) => exit.fromPlaceId);
  return world.places.map(({ id }) => id).filter((id) => forward.has(id) && back.has(id));
}

function visitPlace(world: AdventureWorld, state: SearchState, placeId: string): boolean {
  let changed = !state.placesVisited.has(placeId);
  state.placesVisited.add(placeId);
  const pickUp = (entries: readonly (Item | Clue)[], found: Set<string>) => {
    for (const { id, placeId: foundAt } of entries) {
      if (foundAt !== placeId || found.has(id)) continue;
      found.add(id);
      changed = true;
    }
  };
  pickUp(world.items, state.itemsHeld);
  pickUp(world.clues, state.cluesRevealed);
  for (const step of world.solution.steps) {
    if (step.placeId !== placeId || state.stepsDone.has(step.id)
      || !meetsConditions(state, step.conditions)) continue;
    state.stepsDone.add(step.id);
    changed = true;
    for (const effect of step.effects) {
      switch (effect.kind) {
        case 'unlock-exit': state.unlockedExits.add(effect.exitId); break;
        case 'give-item': state.itemsHeld.add(effect.itemId); break;
        case 'reveal-clue': state.cluesRevealed.add(effect.clueId); break;
      }
    }
  }
  return changed;
}

// Version 1 only adds progress, so taking everything in the area cannot block a win.
function settleArea(world: AdventureWorld, state: SearchState, links: Links): string[] {
  let area: string[];
  let changed: boolean;
  do {
    area = returnablePlaces(world, state, links);
    changed = false;
    for (const placeId of area) {
      if (visitPlace(world, state, placeId)) changed = true;
    }
  } while (changed);
  return area;
}

function stateKey(areaId: string, state: SearchState): string {
  return JSON.stringify([
    areaId,
    ...[state.itemsHeld, state.placesVisited, state.stepsDone,
      state.cluesRevealed, state.unlockedExits].map((ids) => [...ids].sort()),
  ]);
}

/**
 * Checks whether a player can reach the goal of a world, and which puzzle
 * steps can never be completed. The world is not changed.
 *
 * The search creates at most `MAX_SEARCH_STATES` states. Bigger worlds get a
 * `TooLargeToCheck` result. The same world always gives the same result.
 *
 * @throws RangeError when the world has invalid references, empty or repeated
 * IDs, an unsupported version or an unknown effect.
 */
export function checkWinnability(world: AdventureWorld): WinnabilityResult {
  validateWorld(world);
  const links = linksFor(world);
  const queue: SearchState[] = [{
    placeId: world.startPlaceId,
    itemsHeld: new Set(),
    placesVisited: new Set(),
    stepsDone: new Set(),
    cluesRevealed: new Set(),
    unlockedExits: new Set(),
  }];
  // A running total, not the queue length, so the cap still holds if the queue is ever drained.
  let statesCreated = queue.length;
  const seen = new Set<string>();
  const reachableSteps = new Set<string>();
  let winnable = false;

  for (let index = 0; index < queue.length; index++) {
    const state = queue[index];
    const area = settleArea(world, state, links);
    const key = stateKey(area[0], state);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const id of state.stepsDone) reachableSteps.add(id);
    const goal = world.solution.goal;
    if (area.includes(goal.placeId) && meetsConditions(state, goal.conditions)) {
      winnable = true;
    }
    const inArea = new Set(area);
    for (const placeId of area) {
      for (const exit of links.outgoing.get(placeId)!) {
        if (!isOpen(state, exit) || inArea.has(exit.toPlaceId)) continue;
        // Count every state created, including repeats, so both work and memory stay capped.
        if (statesCreated >= MAX_SEARCH_STATES) return { winnable: false, tooLarge: true };
        statesCreated++;
        queue.push({
          placeId: exit.toPlaceId,
          itemsHeld: new Set(state.itemsHeld),
          placesVisited: new Set(state.placesVisited),
          stepsDone: new Set(state.stepsDone),
          cluesRevealed: new Set(state.cluesRevealed),
          unlockedExits: new Set(state.unlockedExits),
        });
      }
    }
  }

  return {
    winnable,
    unreachableStepIds: world.solution.steps
      .filter((step) => !reachableSteps.has(step.id)).map((step) => step.id),
  };
}
