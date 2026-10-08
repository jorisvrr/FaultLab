import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveStream, Xoshiro128 } from '../src/random';

const take = (rng: Xoshiro128, n: number): number[] => Array.from({ length: n }, () => rng.nextUint32());

describe('Xoshiro128', () => {
  // Vectors produced by the reference C implementation (docs/TEST_STRATEGY.md shows how).
  it('matches the reference xoshiro128** output for state [1, 2, 3, 4]', () => {
    const rng = Xoshiro128.fromState([1, 2, 3, 4]);
    expect(take(rng, 8)).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849]);
  });

  it.each([
    [0, [2462723854, 1020716019, 454327756, 1275600319], [3809008728, 1133695204, 53579671, 2891528803, 139681546, 2203266335]],
    [42, [939911724, 3948730756, 321366731, 3317318717], [2837322924, 544945897, 479756282, 3500138142, 339756180, 113173290]],
    [4294967295, [920564995, 4230986166, 697614773, 1778835764], [835879718, 1921286648, 2356205009, 1885780724, 980451116, 1053911718]],
  ])('seeds %i via SplitMix32 exactly like the reference', (seed, state, outputs) => {
    const rng = Xoshiro128.fromSeed(seed);
    expect(rng.getState()).toEqual(state);
    expect(take(rng, 6)).toEqual(outputs);
  });

  it('is reproducible: same seed, same sequence (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        expect(take(Xoshiro128.fromSeed(seed), 16)).toEqual(take(Xoshiro128.fromSeed(seed), 16));
      }),
    );
  });

  it('resumes identically from a captured state', () => {
    const rng = Xoshiro128.fromSeed(7);
    take(rng, 5);
    const resumed = Xoshiro128.fromState(rng.getState());
    expect(take(resumed, 10)).toEqual(take(rng, 10));
  });

  it('rejects invalid seeds and the all-zero state', () => {
    for (const seed of [-1, 2 ** 32, 1.5, Number.NaN]) expect(() => Xoshiro128.fromSeed(seed)).toThrow(RangeError);
    expect(() => Xoshiro128.fromState([0, 0, 0, 0])).toThrow(RangeError);
  });

  it('nextInt stays within inclusive bounds (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        (seed, min, span) => {
          const rng = Xoshiro128.fromSeed(seed);
          for (let i = 0; i < 20; i++) {
            const x = rng.nextInt(min, min + span);
            expect(Number.isSafeInteger(x)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(min);
            expect(x).toBeLessThanOrEqual(min + span);
          }
        },
      ),
    );
  });

  it('nextInt is roughly uniform (chi-squared sanity check, fixed seed)', () => {
    const rng = Xoshiro128.fromSeed(123);
    const buckets = new Array<number>(10).fill(0);
    const samples = 100_000;
    for (let i = 0; i < samples; i++) buckets[rng.nextInt(0, 9)]! += 1;
    const expected = samples / 10;
    const chi2 = buckets.reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0);
    // 9 degrees of freedom: p = 0.001 critical value is 27.88. Fixed seed => no flakiness.
    expect(chi2).toBeLessThan(27.88);
  });

  it('nextInt rejects draws above the largest multiple of the range (exact spec)', () => {
    // range = 3·2^30 does not divide 2^32, so raw values >= 3·2^30 must be skipped.
    const range = 3 * 2 ** 30;
    const rng = Xoshiro128.fromSeed(2024);
    const clone = Xoshiro128.fromState(rng.getState());
    for (let i = 0; i < 1000; i++) {
      let raw = clone.nextUint32();
      while (raw >= range) raw = clone.nextUint32();
      expect(rng.nextInt(0, range - 1)).toBe(raw);
    }
  });

  it('nextInt has no modulo bias where naive modulo would be badly biased', () => {
    // With plain `x % range`, results below 2^30 would occur with probability 1/2, not 1/3.
    const range = 3 * 2 ** 30;
    const rng = Xoshiro128.fromSeed(77);
    let low = 0;
    const samples = 30_000;
    for (let i = 0; i < samples; i++) if (rng.nextInt(0, range - 1) < 2 ** 30) low++;
    expect(low / samples).toBeGreaterThan(0.32);
    expect(low / samples).toBeLessThan(0.35);
  });

  it('nextInt handles degenerate and maximal ranges', () => {
    const rng = Xoshiro128.fromSeed(1);
    expect(rng.nextInt(5, 5)).toBe(5);
    const x = rng.nextInt(0, 2 ** 32 - 1);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(() => rng.nextInt(0, 2 ** 32)).toThrow(RangeError);
    expect(() => rng.nextInt(3, 2)).toThrow(RangeError);
    expect(() => rng.nextInt(0.5, 2)).toThrow(RangeError);
  });

  it('nextFloat is in [0, 1) and chance() honours its endpoints', () => {
    const rng = Xoshiro128.fromSeed(9);
    for (let i = 0; i < 1000; i++) {
      const f = rng.nextFloat();
      expect(f >= 0 && f < 1).toBe(true);
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
    expect(() => rng.chance(1.1)).toThrow(RangeError);
    expect(() => rng.chance(Number.NaN)).toThrow(RangeError);
  });
});

describe('deriveStream', () => {
  it('is deterministic per (seed, label) and independent across labels', () => {
    expect(take(deriveStream(1, 'node:n1'), 4)).toEqual(take(deriveStream(1, 'node:n1'), 4));
    expect(take(deriveStream(1, 'node:n1'), 4)).not.toEqual(take(deriveStream(1, 'node:n2'), 4));
    expect(take(deriveStream(1, 'network'), 4)).not.toEqual(take(deriveStream(2, 'network'), 4));
  });
});
