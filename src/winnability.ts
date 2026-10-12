import type { AdventureWorld, Conditions } from './adventure-world';

export interface WinnabilityResult {
  readonly winnable: boolean;
  readonly unreachableStepIds: readonly string[];
}

interface SearchState {
  placeId: string;
  itemsHeld: Set<string>;
  placesVisited: Set<string>;
  stepsDone: Set<string>;
  cluesRevealed: Set<string>;
  unlockedExits: Set<string>;
}

function validateWorld(world: AdventureWorld): void {
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

function finishAvailableSteps(world: AdventureWorld, state: SearchState): void {
  state.placesVisited.add(state.placeId);
  for (const item of world.items) {
    if (item.placeId === state.placeId) state.itemsHeld.add(item.id);
  }
  for (const clue of world.clues) {
    if (clue.placeId === state.placeId) state.cluesRevealed.add(clue.id);
  }

  // Version 1 only adds progress, so taking every available step cannot block a win.
  let changed: boolean;
  do {
    changed = false;
    for (const step of world.solution.steps) {
      if (step.placeId !== state.placeId || state.stepsDone.has(step.id)
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
  } while (changed);
}

function stateKey(state: SearchState): string {
  return JSON.stringify([
    state.placeId,
    ...[state.itemsHeld, state.placesVisited, state.stepsDone,
      state.cluesRevealed, state.unlockedExits].map((ids) => [...ids].sort()),
  ]);
}

export function checkWinnability(world: AdventureWorld): WinnabilityResult {
  validateWorld(world);
  const queue: SearchState[] = [{
    placeId: world.startPlaceId,
    itemsHeld: new Set(),
    placesVisited: new Set(),
    stepsDone: new Set(),
    cluesRevealed: new Set(),
    unlockedExits: new Set(),
  }];
  const seen = new Set<string>();
  const reachableSteps = new Set<string>();
  let winnable = false;

  for (let index = 0; index < queue.length; index++) {
    const state = queue[index];
    finishAvailableSteps(world, state);
    const key = stateKey(state);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const id of state.stepsDone) reachableSteps.add(id);
    const goal = world.solution.goal;
    if (state.placeId === goal.placeId && meetsConditions(state, goal.conditions)) {
      winnable = true;
    }
    for (const exit of world.exits) {
      if (exit.fromPlaceId !== state.placeId
        || (exit.locked && !state.unlockedExits.has(exit.id))) continue;
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

  return {
    winnable,
    unreachableStepIds: world.solution.steps
      .filter((step) => !reachableSteps.has(step.id)).map((step) => step.id),
  };
}
