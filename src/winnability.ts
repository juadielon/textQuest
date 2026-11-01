import type { AdventureWorld, Clue, Conditions, Exit, Item, PuzzleStep } from './adventure-world';

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
  /** True when at least one route reaches the goal or a winning ending. */
  readonly winnable: boolean;
  /** IDs of puzzle steps that no route can complete, in world order. */
  readonly unreachableStepIds: readonly string[];
  /** World version 2 only. IDs of endings some route can reach, in world order. */
  readonly reachableEndingIds?: readonly string[];
  /**
   * World version 2 only. True when some route reaches a point where the
   * player can no longer win. Failure endings don't count, but the point just
   * before each one must still be able to win, so recovery from it works.
   */
  readonly canGetStuck?: boolean;
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
 * @remarks
 * Choices, endings and `end-adventure` effects need world version 2. Each
 * choice needs at least two steps, and a step can end the adventure only once.
 *
 * @throws RangeError when the world is invalid, with a message naming the problem.
 */
export function validateWorld(world: AdventureWorld): void {
  if (world.version !== 1 && world.version !== 2) {
    throw new RangeError(`World version ${world.version} is not supported.`);
  }
  const needsVersionTwo = () => {
    if (world.version === 1) {
      throw new RangeError('Choices and endings need world version 2.');
    }
  };

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
  if (world.solution.endings !== undefined) needsVersionTwo();
  const endings = idsFor(world.solution.endings ?? [], 'ending');
  for (const ending of world.solution.endings ?? []) {
    if (ending.outcome !== 'win' && ending.outcome !== 'failure') {
      throw new RangeError(`The ending "${ending.id}" has an unknown outcome.`);
    }
  }
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
  const choiceSizes = new Map<string, number>();
  for (const step of world.solution.steps) {
    requireId(places, step.placeId, 'place');
    checkConditions(step.conditions);
    if (step.choiceId !== undefined) {
      needsVersionTwo();
      if (typeof step.choiceId !== 'string' || !step.choiceId.trim()) {
        throw new RangeError(`The step "${step.id}" has an empty choice ID.`);
      }
      choiceSizes.set(step.choiceId, (choiceSizes.get(step.choiceId) ?? 0) + 1);
    }
    let endingEffects = 0;
    for (const effect of step.effects) {
      switch (effect.kind) {
        case 'unlock-exit': requireId(exits, effect.exitId, 'exit'); break;
        case 'give-item': requireId(items, effect.itemId, 'item'); break;
        case 'reveal-clue': requireId(clues, effect.clueId, 'clue'); break;
        case 'end-adventure':
          needsVersionTwo();
          requireId(endings, effect.endingId, 'ending');
          endingEffects++;
          break;
        default: throw new RangeError('Unknown puzzle effect.');
      }
    }
    if (endingEffects > 1) {
      throw new RangeError(`The step "${step.id}" ends the adventure more than once.`);
    }
  }
  for (const [choiceId, size] of choiceSizes) {
    if (size < 2) {
      throw new RangeError(`The choice "${choiceId}" needs at least two steps.`);
    }
  }
}

// Decisions change what can happen next, so the search tries each one
// separately instead of taking it automatically.
function isDecision(step: PuzzleStep): boolean {
  return step.choiceId !== undefined || step.effects.some(({ kind }) => kind === 'end-adventure');
}

// Only decisions have a choice, so automatic steps can omit the closed choices.
function canTakeStep(
  state: SearchState, step: PuzzleStep, closedChoices: ReadonlySet<string> = new Set(),
): boolean {
  return !state.stepsDone.has(step.id) && meetsConditions(state, step.conditions)
    && (step.choiceId === undefined || !closedChoices.has(step.choiceId));
}

// Returns the ending the step leads to, if any.
function completeStep(state: SearchState, step: PuzzleStep): string | undefined {
  state.stepsDone.add(step.id);
  let endingId: string | undefined;
  for (const effect of step.effects) {
    switch (effect.kind) {
      case 'unlock-exit': state.unlockedExits.add(effect.exitId); break;
      case 'give-item': state.itemsHeld.add(effect.itemId); break;
      case 'reveal-clue': state.cluesRevealed.add(effect.clueId); break;
      case 'end-adventure': endingId = effect.endingId; break;
    }
  }
  return endingId;
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
    if (step.placeId !== placeId || isDecision(step) || !canTakeStep(state, step)) continue;
    completeStep(state, step);
    changed = true;
  }
  return changed;
}

// Steps taken here only add progress, so taking everything in the area cannot
// block a win. Decisions are tried separately by the search.
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

// Only arrival and automatic steps are forced; taking and using items can end play.
function settleHere(world: AdventureWorld, state: SearchState): string[] {
  state.placesVisited.add(state.placeId);
  for (const clue of world.clues) {
    if (clue.placeId === state.placeId) state.cluesRevealed.add(clue.id);
  }
  for (let step = world.solution.steps.find((entry) => entry.placeId === state.placeId
    && !isDecision(entry) && !(entry.conditions.itemsHeld ?? []).length
    && canTakeStep(state, entry)); step;
    step = world.solution.steps.find((entry) => entry.placeId === state.placeId
      && !isDecision(entry) && !(entry.conditions.itemsHeld ?? []).length
      && canTakeStep(state, entry))) {
    completeStep(state, step);
  }
  return [state.placeId];
}

function copyState(state: SearchState, placeId: string): SearchState {
  return {
    placeId,
    itemsHeld: new Set(state.itemsHeld),
    placesVisited: new Set(state.placesVisited),
    stepsDone: new Set(state.stepsDone),
    cluesRevealed: new Set(state.cluesRevealed),
    unlockedExits: new Set(state.unlockedExits),
  };
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
 * @remarks
 * For world version 2, the search tries moves, item takes, uses and decisions
 * separately, stopping each route at its goal or early ending. It also reports
 * reachable endings and whether a player can get stuck. Version 1 keeps its
 * original area search and result shape.
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
  const reachedEndings = new Set<string>();
  const winningOutcome = new Set((world.solution.endings ?? [])
    .filter(({ outcome }) => outcome === 'win').map(({ id }) => id));
  const decisions = world.solution.steps.filter((step) =>
    isDecision(step) || (world.version === 2 && (step.conditions.itemsHeld ?? []).length > 0));
  const choiceOfStep = new Map(world.solution.steps.flatMap(({ id, choiceId }) =>
    choiceId === undefined ? [] : [[id, choiceId] as const]));
  // Links each searched state to the states it leads to, to find any that can't win.
  const parents: (string | null)[] = [null];
  const ledFrom = new Map<string, string[]>();
  const winningKeys: string[] = [];
  let winnable = false;
  const enqueue = (next: SearchState, parentKey: string): boolean => {
    // Count every state created, including repeats, so both work and memory stay capped.
    if (statesCreated >= MAX_SEARCH_STATES) return false;
    statesCreated++;
    queue.push(next);
    parents.push(parentKey);
    return true;
  };

  for (let index = 0; index < queue.length; index++) {
    const state = queue[index];
    const area = world.version === 1 ? settleArea(world, state, links) : settleHere(world, state);
    const key = stateKey(area[0], state);
    const parentKey = parents[index];
    if (parentKey !== null && world.version === 2) {
      const sources = ledFrom.get(key);
      if (sources) sources.push(parentKey);
      else ledFrom.set(key, [parentKey]);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    for (const id of state.stepsDone) reachableSteps.add(id);
    const goal = world.solution.goal;
    let wins = area.includes(goal.placeId) && meetsConditions(state, goal.conditions);
    if (wins && world.version === 2) {
      winnable = true;
      winningKeys.push(key);
      continue;
    }
    const inArea = new Set(area);
    if (world.version === 2) {
      for (const item of world.items) {
        if (item.placeId !== state.placeId || state.itemsHeld.has(item.id)) continue;
        const taken = copyState(state, state.placeId);
        taken.itemsHeld.add(item.id);
        if (!enqueue(taken, key)) return { winnable: false, tooLarge: true };
      }
    }
    // Built once per state, so each option is checked without rescanning every step.
    const closedChoices = new Set<string>();
    for (const id of state.stepsDone) {
      const choiceId = choiceOfStep.get(id);
      if (choiceId !== undefined) closedChoices.add(choiceId);
    }
    for (const step of decisions) {
      if (!inArea.has(step.placeId) || !canTakeStep(state, step, closedChoices)) continue;
      if (statesCreated >= MAX_SEARCH_STATES) return { winnable: false, tooLarge: true };
      const chosen = copyState(state, step.placeId);
      const endingId = completeStep(chosen, step);
      if (endingId === undefined) {
        if (!enqueue(chosen, key)) return { winnable: false, tooLarge: true };
        continue;
      }
      // An ending stops the adventure, so there is no later state to search.
      statesCreated++;
      reachableSteps.add(step.id);
      reachedEndings.add(endingId);
      if (winningOutcome.has(endingId)) wins = true;
    }
    if (wins) {
      winnable = true;
      winningKeys.push(key);
    }
    for (const placeId of area) {
      for (const exit of links.outgoing.get(placeId)!) {
        if (!isOpen(state, exit) || inArea.has(exit.toPlaceId)) continue;
        if (!enqueue(copyState(state, exit.toPlaceId), key)) return { winnable: false, tooLarge: true };
      }
    }
  }

  const unreachableStepIds = world.solution.steps
    .filter((step) => !reachableSteps.has(step.id)).map((step) => step.id);
  if (world.version === 1) return { winnable, unreachableStepIds };

  const canStillWin = new Set(winningKeys);
  for (const key of canStillWin) {
    for (const parentKey of ledFrom.get(key) ?? []) canStillWin.add(parentKey);
  }
  return {
    winnable,
    unreachableStepIds,
    reachableEndingIds: (world.solution.endings ?? [])
      .filter(({ id }) => reachedEndings.has(id)).map(({ id }) => id),
    canGetStuck: canStillWin.size < seen.size,
  };
}
