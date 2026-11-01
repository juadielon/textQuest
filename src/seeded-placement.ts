import type { AdventureWorld, Clue, Conditions, Item } from './adventure-world';
import type { SeededRandom } from './seeded-random';

function distancesFromStart(world: AdventureWorld): Map<string, number> {
  // Only use open paths with an open return path, so a pickup cannot trap the player.
  const exits = world.exits.filter((exit) => !exit.locked && world.exits.some((back) =>
    !back.locked && back.fromPlaceId === exit.toPlaceId && back.toPlaceId === exit.fromPlaceId));
  const distances = new Map([[world.startPlaceId, 0]]);
  for (const [placeId, distance] of distances) {
    for (const exit of exits) {
      if (exit.fromPlaceId === placeId && !distances.has(exit.toPlaceId)) {
        distances.set(exit.toPlaceId, distance + 1);
      }
    }
  }
  return distances;
}

/**
 * Places items and clues using the released adventure version 2 rules.
 *
 * @param world - A valid authored world with its selected steps and goal.
 * @param random - The seeded stream, already advanced past the genre and plot draws.
 * @returns A detached world with pickups no further away than their nearest use.
 * @remarks Items then clues use authored array order, skipping awarded and unused
 * pickups. Keep this draw order unchanged; version 1 must never call it.
 */
export function prepareSeededPlacement(world: AdventureWorld, random: SeededRandom): AdventureWorld {
  const distances = distancesFromStart(world);
  const needs = (pick: (conditions: Conditions) => readonly string[] | undefined) =>
    [...world.solution.steps, world.solution.goal]
      .map(({ placeId, conditions }) => ({ placeId, ids: pick(conditions) ?? [] }));
  const scatter = (
    entries: readonly (Item | Clue)[], neededBy: readonly { placeId: string; ids: readonly string[] }[],
  ): (Item | Clue)[] => entries.map(({ id, placeId }) => {
    if (placeId === undefined) return { id };
    const nearest = Math.min(...neededBy.filter(({ ids }) => ids.includes(id))
      .map(({ placeId: needAt }) => distances.get(needAt) ?? Infinity));
    // Keep unused pickups, or ones only needed beyond a gate, as authored.
    if (nearest === Infinity) return { id, placeId };
    const spots = world.places.filter(({ id: spot }) => (distances.get(spot) ?? Infinity) <= nearest);
    return { id, placeId: spots[random.pickIndex(spots.length)].id };
  });

  return structuredClone({
    ...world,
    items: scatter(world.items, needs(({ itemsHeld }) => itemsHeld)),
    clues: scatter(world.clues, needs(({ cluesRevealed }) => cluesRevealed)),
  });
}
