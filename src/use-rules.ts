import type { PuzzleStep } from './adventure-world';

/**
 * Finds the first ready step for each item and the first that opens each
 * named exit. Pass ready steps at the current place in world order.
 */
export function useStepOptions(steps: readonly PuzzleStep[]): {
  readonly byItem: ReadonlyMap<string, PuzzleStep>;
  readonly byExit: ReadonlyMap<string, ReadonlyMap<string, PuzzleStep>>;
} {
  const byItem = new Map<string, PuzzleStep>();
  const byExit = new Map<string, Map<string, PuzzleStep>>();
  for (const step of steps) {
    for (const itemId of step.conditions.itemsHeld ?? []) {
      if (!byItem.has(itemId)) byItem.set(itemId, step);
      for (const effect of step.effects) {
        if (effect.kind !== 'unlock-exit') continue;
        let items = byExit.get(effect.exitId);
        if (!items) {
          items = new Map();
          byExit.set(effect.exitId, items);
        }
        if (!items.has(itemId)) items.set(itemId, step);
      }
    }
  }
  return { byItem, byExit };
}
