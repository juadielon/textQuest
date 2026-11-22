import { discoveredTargets, playCommand, startPlay, type PlayState, type PlayWorld } from './engine/play';

/** The largest number of states the solution runner will search. */
export const SOLUTION_SEARCH_LIMIT = 10_000;

/**
 * True only when the Vite environment explicitly enables solution mode.
 *
 * Normal Docker and production runs remain ordinary player sessions.
 */
export function solutionModeEnabled(): boolean {
  return (import.meta.env.VITE_SOLUTION_MODE === '1');
}

/**
 * Finds a deterministic command route to the goal in a playable world.
 *
 * @param world - The generated version 1 world to solve.
 * @returns Oldest-first commands that reach the goal, or an empty list if no route is found.
 * @remarks
 * This is a development route finder. It uses the real parser and play module,
 * never changes the world, and does not write commands into saves.
 */
export function findWinningCommands(world: PlayWorld, from?: PlayState): readonly string[] {
  if (world.version !== 1) return [];
  return deriveCommands(world, from ?? startPlay(world));
}

function deriveCommands(world: PlayWorld, start: PlayState): readonly string[] {
  let state = start;
  const commands: string[] = [];
  const required = world.solution.goal.conditions.stepsDone ?? [];
  for (const stepId of required) {
    if (state.stepsDone.includes(stepId)) continue;
    const step = world.solution.steps.find((candidate) => candidate.id === stepId);
    if (!step) return [];
    for (const itemId of step.conditions.itemsHeld ?? []) {
      if (state.itemsHeld.includes(itemId)) continue;
      const item = world.items.find((candidate) => candidate.id === itemId);
      if (item?.placeId) {
        const moved = moveTo(world, state, item.placeId, commands);
        if (!moved.state.goalReached && moved.state.placeId !== item.placeId) return [];
        state = moved.state;
      }
      const itemName = discoveredTargets(world, state).find(({ kind, id }) => kind === 'item' && id === itemId)?.name;
      if (!itemName) continue;
      const turn = playCommand(world, state, `take ${itemName}`);
      if (turn.state === state) continue;
      commands.push(`take ${itemName}`);
      state = turn.state;
    }
    for (const clueId of step.conditions.cluesRevealed ?? []) {
      if (state.cluesRevealed.includes(clueId)) continue;
      const clue = world.clues.find((candidate) => candidate.id === clueId);
      if (clue?.placeId) {
        const moved = moveTo(world, state, clue.placeId, commands);
        if (moved.state.placeId !== clue.placeId) return [];
        state = moved.state;
      }
    }
    if (state.placeId !== step.placeId) {
      const moved = moveTo(world, state, step.placeId, commands);
      if (moved.state.placeId !== step.placeId) return [];
      state = moved.state;
    }
    for (const itemId of step.conditions.itemsHeld ?? []) {
      const itemName = discoveredTargets(world, state).find(({ kind, id }) => kind === 'item' && id === itemId)?.name;
      if (!itemName) continue;
      const turn = playCommand(world, state, `use ${itemName}`);
      if (turn.state !== state) {
        commands.push(`use ${itemName}`);
        state = turn.state;
      }
    }
  }
  if (!state.goalReached && state.placeId !== world.solution.goal.placeId) {
    const moved = moveTo(world, state, world.solution.goal.placeId, commands);
    state = moved.state;
  }
  return state.goalReached ? commands : [];
}

function shortestMove(world: PlayWorld, start: string, goal: string): readonly string[] {
  if (start === goal) return [];
  const queue: { readonly placeId: string; readonly route: readonly string[] }[] =
    [{ placeId: start, route: [] }];
  const seen = new Set([start]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const exit of world.exits) {
      if (exit.fromPlaceId !== current.placeId || seen.has(exit.toPlaceId)) continue;
      const route = [...current.route, exit.toPlaceId];
      if (exit.toPlaceId === goal) return route;
      seen.add(exit.toPlaceId);
      queue.push({ placeId: exit.toPlaceId, route });
    }
  }
  return [];
}

function moveTo(
  world: PlayWorld,
  state: PlayState,
  placeId: string,
  commands: string[],
): { readonly state: PlayState } {
  let current = state;
  for (const nextPlaceId of shortestMove(world, current.placeId, placeId)) {
    const name = discoveredTargets(world, current).find(({ kind, id }) =>
      kind === 'place' && id === nextPlaceId)?.name ?? nextPlaceId;
    const turn = playCommand(world, current, `go to ${name}`);
    if (turn.state === current) break;
    commands.push(`go to ${name}`);
    current = turn.state;
  }
  return { state: current };
}
