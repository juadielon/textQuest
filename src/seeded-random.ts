// Repeatable random numbers for adventure generation. The same seed always
// gives the same sequence, using exact integer maths, so results do not
// depend on the browser, time, locale or Math.random().

export interface SeededRandom {
  nextUint32(): number;
  pickIndex(count: number): number;
}

export function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;
}

// Mulberry32. Do not change this algorithm: released share codes rely on it.
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
