import { fnv1a32 } from './hash';

/**
 * Deterministic source of randomness handed to the network model and to protocol code.
 * Every method is a pure function of the generator's internal state.
 */
export interface RandomSource {
  /** Uniform integer in [0, 2^32). */
  nextUint32(): number;
  /** Uniform float in [0, 1) with 32 bits of precision. */
  nextFloat(): number;
  /** Uniform integer in [min, max] (both inclusive) without modulo bias. */
  nextInt(min: number, max: number): number;
  /** true with probability p, for p in [0, 1]. chance(0) is never true, chance(1) always. */
  chance(p: number): boolean;
}

export type Xoshiro128State = readonly [number, number, number, number];

const TWO_POW_32 = 2 ** 32;

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));

/**
 * xoshiro128** 1.1 by David Blackman and Sebastiano Vigna (https://prng.di.unimi.it/).
 *
 * Why this generator: 128 bits of state, period 2^128 - 1, passes BigCrush, and it only needs
 * 32-bit operations — exactly what JavaScript's bitwise operators and Math.imul provide, so
 * results are bit-identical in every engine. It is not cryptographically secure, which is fine:
 * we need reproducibility, not unpredictability.
 *
 * Its output is checked against the reference C implementation in test/random.test.ts.
 */
export class Xoshiro128 implements RandomSource {
  #s0: number;
  #s1: number;
  #s2: number;
  #s3: number;

  private constructor(state: Xoshiro128State) {
    [this.#s0, this.#s1, this.#s2, this.#s3] = state.map((word) => word | 0) as [number, number, number, number];
    if ((this.#s0 | this.#s1 | this.#s2 | this.#s3) === 0) {
      throw new RangeError('xoshiro128** state must not be all zero');
    }
  }

  /**
   * Expand a 32-bit seed into 128 bits of state with SplitMix32.
   *
   * SplitMix32 here = a Weyl sequence (x += 0x9e3779b9) passed through MurmurHash3's fmix32
   * finaliser. fmix32 is a bijection on 32-bit integers and the four Weyl inputs are distinct,
   * so at most one of the four state words can be zero: the forbidden all-zero state is
   * impossible for every seed.
   */
  static fromSeed(seed: number): Xoshiro128 {
    if (!Number.isInteger(seed) || seed < 0 || seed >= TWO_POW_32) {
      throw new RangeError(`seed must be an integer in [0, 2^32), got ${String(seed)}`);
    }
    let x = seed | 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) | 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return z ^ (z >>> 16);
    };
    return new Xoshiro128([next(), next(), next(), next()]);
  }

  /** Restore a generator from a previously captured state (used by future snapshots). */
  static fromState(state: Xoshiro128State): Xoshiro128 {
    return new Xoshiro128(state);
  }

  /** Current state as unsigned 32-bit words. Restoring it reproduces all future outputs. */
  getState(): Xoshiro128State {
    return [this.#s0 >>> 0, this.#s1 >>> 0, this.#s2 >>> 0, this.#s3 >>> 0];
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.#s1, 5), 7), 9);
    const t = this.#s1 << 9;
    this.#s2 ^= this.#s0;
    this.#s3 ^= this.#s1;
    this.#s1 ^= this.#s2;
    this.#s0 ^= this.#s3;
    this.#s2 ^= t;
    this.#s3 = rotl(this.#s3, 11);
    return result >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / TWO_POW_32;
  }

  nextInt(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError(`nextInt needs safe integers with min <= max, got [${String(min)}, ${String(max)}]`);
    }
    const range = max - min + 1;
    if (range > TWO_POW_32) {
      throw new RangeError(`nextInt range ${range} exceeds 2^32`);
    }
    // Rejection sampling: `x % range` is only uniform if x is drawn from a multiple of
    // `range`, so discard the top `2^32 mod range` values. At worst (range just above 2^31)
    // about half the draws are rejected; the expected number of draws is always < 2.
    const limit = TWO_POW_32 - (TWO_POW_32 % range);
    let x = this.nextUint32();
    while (x >= limit) x = this.nextUint32();
    return min + (x % range);
  }

  chance(p: number): boolean {
    if (!(p >= 0 && p <= 1)) {
      throw new RangeError(`chance needs a probability in [0, 1], got ${String(p)}`);
    }
    // Always consume one value so the stream position does not depend on p.
    const x = this.nextFloat();
    return x < p;
  }
}

/**
 * Derive an independent generator for a named stream ("network", "node:n1", ...).
 *
 * Giving each consumer its own stream isolates them: an extra random draw by node n1 does not
 * shift the values seen by node n2 or by the network model. That keeps small protocol changes
 * from reshuffling unrelated randomness and makes experiments easier to compare.
 */
export function deriveStream(rootSeed: number, label: string): Xoshiro128 {
  return Xoshiro128.fromSeed(fnv1a32(`${rootSeed >>> 0}/${label}`));
}
