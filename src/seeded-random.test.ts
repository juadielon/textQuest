import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from './seeded-random';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSeededRandom', () => {
  it('gives the same fixed sequence for a seed', () => {
    const random = createSeededRandom(1);

    expect([random.nextUint32(), random.nextUint32(), random.nextUint32()]).toEqual([
      2693262067, 11749833, 2265367787,
    ]);
  });

  it('repeats choices for the same seed without using Math.random or the clock', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('The clock must not be used');
    });

    const pick = (seed: number) => {
      const random = createSeededRandom(seed);
      return Array.from({ length: 20 }, () => random.pickIndex(7));
    };

    expect(pick(42)).toEqual(pick(42));
    expect(pick(42)).not.toEqual(pick(43));
    expect(pick(42).every((index) => index >= 0 && index < 7)).toBe(true);
  });

  it('rejects seeds that are not 32-bit whole numbers', () => {
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) {
      expect(() => createSeededRandom(seed)).toThrow(RangeError);
    }
  });

  it('rejects an empty or invalid number of options', () => {
    const random = createSeededRandom(1);

    expect(() => random.pickIndex(0)).toThrow(RangeError);
    expect(() => random.pickIndex(2.5)).toThrow(RangeError);
  });
});
