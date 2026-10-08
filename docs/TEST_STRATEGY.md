# Engineering Test Strategy

## Principles

1. **Test the specification, not the implementation.** [SEMANTICS.md](SEMANTICS.md) is the spec; tests assert its rules.
2. **Every rule gets a negative test.** If the engine must reject something, a test proves that it does.
3. **Prefer exact oracles.** Reference implementations (C, published vectors), reference models (sorted array, stable sort), and exact counts beat "looks plausible".
4. **Randomise inputs, fix seeds.** Property tests explore; statistical tests use fixed seeds so they can never flake.
5. **A test that cannot fail is not a test.** Critical tests are checked by deliberately breaking the code (mutation sanity checks, below).
6. **Coverage is a signal, not a target.**

## Layers

| Layer | Tool | What it covers | Where |
|---|---|---|---|
| Unit (example-based) | Vitest | Each module's documented behaviour and edge cases | `test/*.test.ts` |
| Property-based | fast-check | Heap = sorted model under interleaved ops; scheduler = stable sort by time; PRNG bounds and reproducibility; JSON round-trip; determinism over arbitrary configs | `priority-queue`, `scheduler`, `random`, `json`, `determinism` tests |
| Reference vectors | C reference, published FNV vectors | PRNG and hash are bit-exact implementations of their algorithms | `random.test.ts`, `hash.test.ts`, `test/reference/xoshiro128.c` |
| Acceptance | Vitest | CP0 criteria end-to-end with exact expected counts, times and orderings | `simulation.test.ts` |
| Negative / boundary | Vitest `it.each` tables | Invalid configs (22 cases, each asserting the exact error path), invalid protocol behaviour (10+ cases), limit edges | `config.test.ts`, `simulation.test.ts` |
| Regression (golden) | Vitest | Fingerprint, event count, and final time of a reference experiment pinned to `ENGINE_VERSION` | `determinism.test.ts` |
| Architecture fitness | Vitest + `node:fs` | Engine source has no `Math.random`/`Date`/timers/async/crypto, imports only itself, declares no runtime deps | `architecture.test.ts` |
| Compile-time guards | `tsc` | Engine compiled without DOM/Node libs; strictest flags | `tsconfig.json` |
| *Later:* metamorphic | fast-check | Snapshot/restore equivalence (CP4); renaming nodes yields isomorphic traces | CP4 |
| *Later:* randomized fault exploration | fast-check + invariants | Thousands of seeds × fault plans per protocol; failing cases shrunk to minimal plans (VOPR/FoundationDB style) | CP5+ |
| *Later:* E2E + cross-browser determinism | Playwright | UI flows; same golden fingerprint in Chromium/Firefox/WebKit | CP6 |
| *Later:* performance | Vitest bench | Events/second, memory per event, regression thresholds | CP10 |

## The golden-trace rule

`determinism.test.ts` pins `{ engine, eventsProcessed, finalTime, fingerprint }` for one reference experiment. When it fails:

- **Unintended change?** You found a determinism or semantics regression. Fix the code.
- **Intended change?** Bump `ENGINE_VERSION`, update the expected values, and say in the commit message *what* observable behaviour changed.

Never update the fingerprint without bumping the version. Old shared experiments rely on the version to detect drift.

## Mutation sanity checks (done for CP0)

Each line below is a deliberate bug that was introduced, after which the suite was run and the code restored:

| Mutation | Result |
|---|---|
| LIFO tie-breaking in `compareScheduled` | 10 tests fail |
| Wrong SplitMix32 constant | 4 fail |
| Latency off by one | 6 fail |
| `maxEvents` check `>=` → `>` | 2 fail |
| All nodes share one PRNG stream | 1 fails |
| Payloads/states not frozen | 1 fails |
| `Math.random` added to engine source | 1 fails |
| **Rejection sampling removed** | **0 failed at first.** Modulo bias at small ranges is ~10⁻⁹, statistically invisible. Two tests were added (an exact-spec test against a cloned generator, and a bias test at range 3·2³⁰); both now fail on this mutation. |

Automated mutation testing (Stryker) is a candidate for CP10 once the engine stabilises.

## Regenerating PRNG reference vectors

```bash
clang -O2 -o /tmp/xoshiro128 packages/engine/test/reference/xoshiro128.c && /tmp/xoshiro128
```

## Commands

```bash
npm run check      # typecheck (src with no DOM/Node libs, tests with Node types) + all tests
npm test           # tests only
npm run coverage   # V8 coverage report
```

## CP0 results

125 tests in 9 files, all passing; suite runtime ≈ 0.3 s. Coverage: 97% lines, 95% branches. The uncovered lines are defensive invariant branches (`VirtualClock` misuse) and unused accessors. Measured throughput with full tracing: about 440 000 events/s (200 000 events → 600 001 trace entries in ≈ 450 ms on an Apple-silicon laptop, Node 24).
