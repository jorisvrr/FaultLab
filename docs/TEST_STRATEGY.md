# Engineering Test Strategy

## Principles

1. **Test the specification, not the implementation.** [SEMANTICS.md](SEMANTICS.md) is the spec; tests assert its rules.
2. **Every rule gets a negative test.** If the engine must reject something, a test proves that it does.
3. **Prefer exact oracles.** Reference implementations (C, published vectors), reference models (sorted array, stable sort), and exact counts beat "looks plausible".
4. **Randomise inputs, fix seeds.** Property tests explore with a fixed global fast-check seed (`test/setup.ts`), so the suite gives the same verdict on every run; `npm run test:explore` re-runs them with fresh random seeds. Statistical tests use fixed seeds so they can never flake.
5. **A test that cannot fail is not a test.** Critical tests are checked by deliberately breaking the code (mutation sanity checks, below).
6. **Coverage is a signal, not a target.**

## Layers

| Layer | Tool | What it covers | Where |
|---|---|---|---|
| Unit (example-based) | Vitest | Each module's documented behaviour and edge cases | `test/*.test.ts` |
| Property-based | fast-check | Heap = sorted model under interleaved ops; scheduler = stable sort by time; compaction = reference model; PRNG bounds and reproducibility; JSON round-trip; determinism over arbitrary configs; **random fault plans** (invariants, message conservation, replay determinism, step = run, storage consistency) | `priority-queue`, `scheduler`, `random`, `json`, `determinism`, `faults.property` tests |
| Invariant engine | Vitest | Evaluation coverage (every step exactly once), runtime immutability (graph walk), 11 contained mutation attempts, history, policies, ordering, explainable records, 12 config rejections | `invariants-engine.test.ts` |
| Fault exploration | fast-check + greedy minimiser | Random fault plans → violation → shrink → 1-minimal → replay; stored counterexample fixtures replayed exactly | `explore.ts`, `exploration.test.ts`, `counterexamples.test.ts` |
| Protocol safety | Vitest + fast-check | Naive leader: healthy convergence (no startup false positives), crash/recover property, split brain, history-only violations, pure-function unit tests of invariants | `naive-leader.test.ts` |
| Index consistency | fast-check | In-flight index = scheduler = trace-derived set after every step | `inflight.test.ts` |
| Trace oracle | Plain TypeScript, no engine code | An independent re-derivation of lifecycle, timer, message and partition semantics from the trace alone; returns every violated rule. A bug would have to be written twice, the same way, to pass | `test/invariants.ts`, used by lifecycle, network and property tests |
| Reference vectors | C reference, published FNV vectors | PRNG and hash are bit-exact implementations of their algorithms | `random.test.ts`, `hash.test.ts`, `test/reference/xoshiro128.c` |
| Acceptance | Vitest | CP0 and CP1 criteria end-to-end with exact expected counts, times, orderings and ids | `simulation`, `lifecycle`, `network-faults` tests |
| Negative / boundary | Vitest `it.each` tables | Invalid configs (22 cases), invalid fault plans and config fields (42 cases), invalid protocol behaviour incl. storage misuse (18 cases), each asserting the exact error path or message; limit edges | `config`, `faults.config`, `simulation`, `lifecycle` tests |
| Regression (golden) | Vitest | Fingerprints of a fault-free and a fault-heavy reference experiment, pinned to `ENGINE_VERSION`; the CP1 trace projected onto the CP0 format must reproduce the CP0 fingerprint | `determinism`, `faults.property` tests |
| Architecture fitness | Vitest + `node:fs` | Engine source has no `Math.random`/`Date`/timers/async/crypto, imports only itself, declares no runtime deps | `architecture.test.ts` |
| Compile-time guards | `tsc` | Engine compiled without DOM/Node libs; strictest flags | `tsconfig.json` |
| *Later:* metamorphic | fast-check | Snapshot/restore equivalence (CP3); renaming nodes yields isomorphic traces | CP3 |
| *Later:* randomized fault exploration | fast-check + invariants | Thousands of seeds × fault plans per protocol; failing cases shrunk to minimal plans (VOPR/FoundationDB style) | CP4+ |
| *Later:* E2E + cross-browser determinism | Playwright | UI flows; same golden fingerprint in Chromium/Firefox/WebKit | CP5 |
| *Later:* performance | Vitest bench | Events/second, memory per event, regression thresholds | CP9 |

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

### CP1 mutation sanity checks

| Mutation | Tests failing |
|---|---|
| M1 crash leaves timers in the queue | 8 (engine assertion fires) |
| M1b … and the incarnation assertion removed | 13 (trace oracle catches stale timers) |
| M2 recovery keeps the old incarnation | 14 |
| M3 no partition check at delivery | 5 |
| M4 crashed node still receives messages | 12 |
| M5 crash wipes persistent storage | 5 |
| M6 storage persisted after messages | 2 |
| M7 no partition check at send | 3 |
| M8 `retain` without heapify | 2 |
| M9 link fault applied to the reverse direction | 5 |
| M10 drop not linked to its crash (`conditionIndex`) | 8 |
| M11 faults scheduled before node starts | 4 |
| M12 link delay ignores its range | 1 |
| M13 recovery skips `init` | 14 |
| M14 failed handler still commits storage | 1 |

All 15 were caught. Two process lessons, recorded honestly:

- **Generator diversity matters.** The first fault-plan generator produced a recovery in only 19 of 150 sampled plans, because independent `recover` faults mostly hit running nodes. A paired "outage" generator (crash → recover, sometimes at the same tick) raised that to 119/150, with same-tick crash+recover in 85. The probe counts outcome kinds over `fc.sample(...)`; rerun it whenever the generator changes.
- **Mutation harnesses must always restore.** A first shell-based harness piped one mutant into `| true`, which killed the subshell before it restored the file. The next mutant's result (31 failures) was an artefact of that broken file. The harness was replaced by a Python one that restores in `finally`, every source was checksummed against a known-good copy, and the affected mutants were rerun.

Automated mutation testing (Stryker) is a candidate for CP9 once the engine stabilises.

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

## CP2.5 results (browser prototype)

- **Derivation cross-check** (`apps/demo/test/derive.test.ts`, Vitest): after every step, the state reconstructed from the trace (node status, incarnation, state and its provenance, storage, in-flight messages, partition, link conditions) equals what the engine itself exposes to invariants. Covers all five experiments and 40 random fault plans; plus stored-fixture reproduction (violation time, nodes, event number, fingerprint) and boundedness.
- **End-to-end** (`apps/demo/e2e/viewer.spec.ts`, Playwright on local Chrome, 6 tests): replay labelling and engine version; healthy single leader; crash → recovery (`boots` 1 → 2 exactly one entry after `node.recover`) → partition (3 cut links) → heal; split-brain violation highlighted and explained, fixture fingerprint `c5be175f` reproduced in the browser; identical fingerprints across reload and re-execution; playback controls never re-run the engine. Every test also fails on any uncaught page error.

## CP2 results

313 tests passing (+2 fixture writers that run only in update mode) in 18 files; suite runtime ≈ 4.3 s. Coverage: 98.6% lines, 96.1% branches.

### Findings made by the CP2 tests

1. **Shallow freezing (CP0/CP1 bug).** The graph-walk immutability test found that trace entries were only frozen at the top level (`node.crash.cancelledTimers`, `run.start.protocol` were mutable). Fixed in `EventTrace.append` (deep freeze); regression test added; verified to fail on the old code.
2. **Volatile epochs (protocol bug).** The crash/recover property test found that the first naive-leader draft reused epoch 1 after every node had crashed. Fixed by persisting the epoch; pinned as a regression test.
3. **Persistence is not enough without a quorum (protocol weakness).** A 3 000-plan stress run found that epochs can still be reused when the only nodes that know the latest one are down. Kept as a documented weakness with a dedicated test; `single-leader` held for all 4 000 crash-only plans in a separate run.
4. **Test hygiene.** fast-check used a fresh random seed per run (now fixed globally); `inflight.test.ts` imported a test file and silently ran its 10 tests twice (shared arbitraries moved to `test/arbitraries.ts`; the earlier interim count of 322 was inflated, the real count was 312).

### Exploration results (fast-check seed 424242, 500 runs max)

| Target invariant | Runs to first failure | First failing plan | Shrink steps | Minimised plan | Violation |
|---|---|---|---|---|---|
| `single-leader` | 1 | 3 faults | 2 | 1 fault: partition `[n3]` at t=150 | t=209, n3 + n4 |
| `unique-leader-per-epoch` | 19 | 10 faults | 28 | 2 faults: partition `[n3]` at 150, partition `[n3,n4]` at 196 | t=249, epoch 2 led by n3, then n2 |

Both are 1-minimal (verified), stored in `test/counterexamples/`, and replay to fingerprints `c5be175f` and `9e7ae94a`. Regenerate deliberately with `FAULTLAB_UPDATE_COUNTEREXAMPLES=1 npx vitest run test/exploration.test.ts`.

### Runtime-verification overhead

Workload: naive leader election, 8 nodes, healthy network, 100 000 events (287 533 trace entries), no invariant ever fails. Configurations interleaved round-robin after a warm-up; 15 runs each, two independent passes.

| Invariants | Median (pass 1 / pass 2) | p25–p75 | Min–max |
|---|---|---|---|
| 0 | 525 / 504 ms | 501–556 ms | 493–649 ms |
| 1 (`single-leader`) | 1 137 / 1 127 ms | 1 120–1 160 ms | 1 101–1 235 ms |
| 5 (all naive-leader invariants) | 2 637 / 2 677 ms | 2 529–2 815 ms | 2 453–2 879 ms |

Decomposition (9 interleaved runs each): no invariants 528 ms; one invariant that does nothing 1 026 ms; `single-leader` 1 166 ms. So **≈ 5 µs per step is engine-side view construction**, paid once per step regardless of how many invariants run, and the `single-leader` check itself costs ≈ 1.4 µs per step. Not optimised in CP2 (tracked as **PERF-2**, ROADMAP CP9). Zero-invariant runs skip view construction entirely; their overhead versus CP1 was not separately A/B-measured.

### CP2 mutation sanity checks

| Mutation | Tests failing |
|---|---|
| C1 invariants evaluated in reverse order | 2 |
| C2 no episode de-duplication | 4 |
| C3 no `invariant.cleared` entries | 2 |
| C4 checker errors do not stop the run | 23 |
| C5 node views not frozen | 2 |
| C6 history neither copied nor frozen | 2 |
| C7 delivered messages stay in the in-flight index | 7 |
| C8 cited references not validated | 2 |
| C9 active partition not reported | 3 |
| C10 state provenance not tracked | 5 |
| C11 stop-on-first ignores violations | 6 |
| C12 `maxViolations` not enforced | 1 |
| C13 evidence not validated as JSON | 1 |
| C14 naive leader claims without the startup delay | 18 |
| C15 naive leader epoch not persisted | 1 |
| C16 leader does not step down for a higher node | 3 |
| C17 historical invariant forgets its history | 8 |

All 17 caught (counts from the suite before the duplicate-import fix and the extra unit tests; the verdicts are what matter).

## CP1 results

224 tests in 13 files, all passing; suite runtime ≈ 1.8 s (the five fault-plan property tests run 480 randomized experiments). Coverage: 98.2% lines, 96.2% branches. The uncovered lines are defensive invariant branches and unused accessors.

Performance, measured on the same Apple-silicon laptop (Node 24) by running the CP0 commit and CP1 side by side in two git worktrees, 21 runs each, 200 000-event echo workload without faults: median **459 ms (CP0) vs 477 ms (CP1)**, about 4% overhead from incarnation fields, the context's storage object and the network's partition/link checks. CP1 shows an occasional slow tail (547–660 ms) that CP0 shows less often; the cause is not yet profiled and is tracked as investigation PERF-1 in [ROADMAP CP9](ROADMAP.md). It does not affect correctness: the determinism tests show identical traces on every run. A fault-heavy workload (8 nodes, 1 360 faults, 200 000 events, ~899 000 trace entries) runs in ≈ 1.4 s.

## CP0 results

125 tests in 9 files, all passing; suite runtime ≈ 0.3 s. Coverage: 97% lines, 95% branches. The uncovered lines are defensive invariant branches (`VirtualClock` misuse) and unused accessors. Measured throughput with full tracing: about 440 000 events/s (200 000 events → 600 001 trace entries in ≈ 450 ms on an Apple-silicon laptop, Node 24).
