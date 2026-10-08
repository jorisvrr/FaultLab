# ADR-0004: PRNG — xoshiro128** with SplitMix32 seeding and named streams

**Status:** Accepted (CP0)

**Problem.** Latency, election timeouts, loss and jitter need randomness that is reproducible from a seed, bit-identical in every JavaScript engine, and capturable for snapshots.

**Decision.** xoshiro128\*\* 1.1 (128-bit state, period 2¹²⁸−1), using only 32-bit integer operations (`Math.imul`, shifts, xor). A 32-bit seed is expanded into state by SplitMix32 (a Weyl sequence through MurmurHash3's `fmix32`). Every consumer gets its own **named stream** derived from `FNV-1a("<seed>/<label>")`: `network`, `node:<id>`. `nextInt` uses rejection sampling; `chance(p)` always consumes exactly one draw.

**Alternatives.**
- `Math.random`: not seedable.
- *mulberry32:* tiny, but only 32-bit state (period 2³²) and weaker statistical quality.
- *PCG32:* excellent, but needs 64-bit multiplication, i.e. BigInt or manual emulation in JS.
- *`seedrandom` library:* a dependency for ~40 lines, and state capture isn't first-class.
- *One global stream:* simplest, but any extra draw anywhere shifts every later value: a one-line protocol change reshuffles all network latencies.

**Trade-off.** Not cryptographically secure (irrelevant here). Stream derivation hashes to 32 bits, so two labels could collide with probability ≈ k²/2³³. That is acceptable at our scale and documented.

**Invariant.** Same (seed, label) ⇒ same sequence; state is never all-zero (proof: `fmix32` is a bijection and the four Weyl inputs are distinct, so at most one word is zero); `nextInt(min, max)` is exactly uniform.

**Tested by.** Bit-exact vectors from the reference C implementation (`test/reference/xoshiro128.c`); seeding vectors; state capture/restore; bounds property; chi-squared sanity check on a fixed seed; exact rejection-sampling spec plus a large-range bias test; stream-isolation test at simulation level.
