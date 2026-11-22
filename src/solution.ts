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
  if (world.version !== 1 && world.version !== 2) return [];
  return deriveCommands(world, from ?? startPlay(world));
}

function deriveCommands(world: PlayWorld, start: PlayState): readonly string[] {
  const queue: { readonly state: PlayState; readonly parent: number; readonly command: string }[] =
    [{ state: start, parent: -1, command: '' }];
  const seen = new Set([stateKey(start)]);
  for (let index = 0; index < queue.length && seen.size <= SOLUTION_SEARCH_LIMIT; index += 1) {
    const current = queue[index];
    if (current.state.goalReached) {
      const commands: string[] = [];
      let cursor = index;
      while (cursor > 0) {
        commands.push(queue[cursor].command);
        cursor = queue[cursor].parent;
      }
      return commands.reverse();
    }
    for (const command of candidateCommands(world, current.state)) {
      const turn = playCommand(world, current.state, command);
      if (turn.state === current.state) continue;
      const key = stateKey(turn.state);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ state: turn.state, parent: index, command });
    }
  }
  return [];
}

function candidateCommands(world: PlayWorld, state: PlayState): readonly string[] {
  const commands: string[] = [];
  for (const target of discoveredTargets(world, state)) {
    if (target.kind === 'place') commands.push(`go to ${target.name}`);
    if (target.kind === 'item') {
      if (!state.itemsHeld.includes(target.id)) commands.push(`take ${target.name}`);
      else commands.push(`use ${target.name}`);
    }
    if (target.kind === 'choice') commands.push(`choose ${target.name}`);
  }
  return [...new Set(commands)];
}

function stateKey(state: PlayState): string {
  return JSON.stringify([
    state.placeId,
    [...state.itemsHeld].sort(),
    [...state.placesVisited].sort(),
    [...state.cluesRevealed].sort(),
    [...state.stepsDone].sort(),
    [...state.unlockedExits].sort(),
    state.goalReached,
  ]);
}
