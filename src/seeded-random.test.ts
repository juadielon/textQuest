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

  it('chooses the exact index when a large product would round up', () => {
    expect(createSeededRandom(1).pickIndex(123584965)).toBe(77496910);
  });

  it.each([
    [1, [0, 0, 0]],
    [3, [1, 0, 1]],
    [7, [4, 0, 3]],
  ])('keeps small-count choices pinned for %i options', (count, indices) => {
    const random = createSeededRandom(1);

    expect(Array.from({ length: 3 }, () => random.pickIndex(count))).toEqual(indices);
  });

  it('keeps the released version 1 genre choice for every supported seed', () => {
    for (let seed = 0; seed < 21760; seed += 1) {
      const originalIndex = Math.floor((createSeededRandom(seed).nextUint32() * 3) / 2 ** 32);

      expect(createSeededRandom(seed).pickIndex(3)).toBe(originalIndex);
    }
  });

  it('matches exact integer maths across count boundaries and random sequences', () => {
    const counts = [
      1, 3, 7, 0xffff, 0x10000, 0x10001, 2 ** 21 - 1, 2 ** 21, 2 ** 21 + 1,
      123584965, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff,
    ];

    for (const seed of [0, 1, 42, 0xffffffff]) {
      for (const count of counts) {
        const choices = createSeededRandom(seed);
        const values = createSeededRandom(seed);

        for (let draw = 0; draw < 64; draw += 1) {
          const exactIndex = Number((BigInt(values.nextUint32()) * BigInt(count)) >> 32n);

          expect(choices.pickIndex(count)).toBe(exactIndex);
        }
      }
    }
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
