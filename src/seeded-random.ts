/**
 * Repeatable random numbers for adventure generation. The same seed always
 * gives the same sequence, using exact integer maths, so results do not
 * depend on the browser, time, locale or `Math.random()`.
 *
 * @packageDocumentation
 */

/** A repeatable stream of random numbers made from one seed. */
export interface SeededRandom {
  /**
   * Moves to the next value in the sequence.
   *
   * @returns A whole number from 0 to 4,294,967,295.
   */
  nextUint32(): number;
  /**
   * Picks an option using exactly one value from the sequence.
   *
   * @param count - How many options there are, from 1 to 4,294,967,295.
   * @returns An index from 0 to `count - 1`.
   * @throws RangeError if `count` is not a whole number in that range.
   */
  pickIndex(count: number): number;
}

/**
 * Checks whether a value is a whole number that fits in 32 unsigned bits.
 *
 * @param value - The value to check.
 * @returns `true` for a whole number from 0 to 4,294,967,295.
 */
export function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;
}

/**
 * Makes a repeatable random stream using Mulberry32.
 *
 * Do not change this algorithm: released share codes rely on it.
 *
 * @param seed - A whole number from 0 to 4,294,967,295.
 * @returns A random stream that always gives the same sequence for `seed`.
 * @throws RangeError if `seed` is not a whole number in that range.
 */
export function createSeededRandom(seed: number): SeededRandom {
  if (!isUint32(seed)) {
    throw new RangeError('A seed must be a whole number from 0 to 4294967295.');
  }

  let state = seed;

  function nextUint32(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  }

  function pickIndex(count: number): number {
    if (!Number.isInteger(count) || count < 1 || count > 0xffffffff) {
      throw new RangeError('Choose from at least one option.');
    }
    // Split into 16-bit halves to keep every intermediate integer exact in a double.
    const value = nextUint32();
    const valueLow = value & 0xffff;
    const valueHigh = value >>> 16;
    const countLow = count & 0xffff;
    const countHigh = count >>> 16;
    const middle = valueHigh * countLow + valueLow * countHigh
      + Math.floor((valueLow * countLow) / 0x10000);
    return valueHigh * countHigh + Math.floor(middle / 0x10000);
  }

  return { nextUint32, pickIndex };
}
