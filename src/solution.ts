import { discoveredTargets, playCommand, startPlay, type PlayState, type PlayWorld } from './engine/play';

/** The largest number of states the solution runner will search. */
export const SOLUTION_SEARCH_LIMIT = 100_000;

interface SearchNode {
  readonly state: PlayState;
  readonly parent: SearchNode | null;
  readonly command: string;
}

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
 * @param world - The generated world to solve.
 * @returns Oldest-first commands that reach the goal, or an empty list if no route is found.
 * @remarks
 * This is a development route finder. It uses the real parser and play module,
 * never changes the world, and does not write commands into saves.
 */
export function findWinningCommands(world: PlayWorld, from?: PlayState): readonly string[] {
  return deriveCommands(world, from ?? startPlay(world));
}

function deriveCommands(world: PlayWorld, start: PlayState): readonly string[] {
  const queue: SearchNode[] = [{ state: start, parent: null, command: '' }];
  const seen = new Set([stateKey(start)]);
  const requiredSteps = requiredStepIds(world);
  for (let searched = 0; queue.length && seen.size <= SOLUTION_SEARCH_LIMIT; searched += 1) {
    const current = popBest(queue, world, requiredSteps);
    if (searched >= SOLUTION_SEARCH_LIMIT) break;
    if (current.state.goalReached) {
      const commands: string[] = [];
      let cursor: SearchNode | null = current;
      while (cursor?.parent) {
        commands.push(cursor.command);
        cursor = cursor.parent;
      }
      return commands.reverse();
    }
    for (const command of candidateCommands(world, current.state)) {
      const turn = playCommand(world, current.state, command);
      if (turn.state === current.state) continue;
      const key = stateKey(turn.state);
      if (seen.has(key)) continue;
      seen.add(key);
      pushHeap(queue, { state: turn.state, parent: current, command }, world, requiredSteps);
    }
  }
  return [];
}

function requiredStepIds(world: PlayWorld): ReadonlySet<string> {
  const requiredSteps = new Set(world.solution.goal.conditions.stepsDone ?? []);
  for (const step of world.solution.steps) {
    for (const id of step.conditions.stepsDone ?? []) requiredSteps.add(id);
  }
  return requiredSteps;
}

function stateScore(world: PlayWorld, state: PlayState, requiredSteps: ReadonlySet<string>): number {
  const progress = state.stepsDone.filter((id) => requiredSteps.has(id)).length;
  const goalDistance = state.placeId === world.solution.goal.placeId ? 100 : 0;
  return progress * 1000 + state.itemsHeld.length * 100
    + state.cluesRevealed.length * 10 + goalDistance;
}

function pushHeap(
  heap: SearchNode[],
  node: SearchNode,
  world: PlayWorld,
  requiredSteps: ReadonlySet<string>,
): void {
  heap.push(node);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (stateScore(world, heap[parent].state, requiredSteps)
      >= stateScore(world, heap[index].state, requiredSteps)) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function popBest(
  heap: SearchNode[],
  world: PlayWorld,
  requiredSteps: ReadonlySet<string>,
): SearchNode {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    heap[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < heap.length && stateScore(world, heap[left].state, requiredSteps)
        > stateScore(world, heap[best].state, requiredSteps)) best = left;
      if (right < heap.length && stateScore(world, heap[right].state, requiredSteps)
        > stateScore(world, heap[best].state, requiredSteps)) best = right;
      if (best === index) break;
      [heap[index], heap[best]] = [heap[best], heap[index]];
      index = best;
    }
  }
  return first;
}

function candidateCommands(world: PlayWorld, state: PlayState): readonly string[] {
  const moves: string[] = [];
  const items: string[] = [];
  const choices: string[] = [];
  for (const target of discoveredTargets(world, state)) {
    if (target.kind === 'place' && target.id !== state.placeId) moves.push(`go to ${target.name}`);
    if (target.kind === 'item') {
      if (!state.itemsHeld.includes(target.id)) items.push(`take ${target.name}`);
      else items.push(`use ${target.name}`);
    }
    if (target.kind === 'choice') choices.push(`choose ${target.name}`);
  }
  return [...new Set([...choices, ...items, ...moves])];
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
