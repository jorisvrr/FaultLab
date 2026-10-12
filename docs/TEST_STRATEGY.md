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
| Snapshots and time travel | fast-check + Vitest | Metamorphic restore equivalence, idempotence, JSON round trips, untrusted-input rejection, exact seeking, regeneration with absolute indices | `snapshot.test.ts`, `time-travel.test.ts` |
| Trace reconstruction | fast-check + Vitest | TraceIndex = engine snapshot after every step; step boundaries = real `step()` calls; cost bound; causality | `packages/trace/test/` |
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

## CP6 results (Gate 3: Configure)

**Tests:** 790 unit tests (+25 draft-model, +2 registry) and the full browser suite in three engines, including 12 new Configure tests per engine. Full report: [CP6_GATE3_CONFIGURE.md](CP6_GATE3_CONFIGURE.md).

| Layer | What it proves | Where |
|---|---|---|
| Draft → effective spec | Reproduces the reference preset exactly and runs to its pinned fingerprint; canonical serialisation (same configuration ⇒ same bytes ⇒ same signature); a disabled fault plan stays in the draft and leaves the spec; the signature changes for every execution-relevant edit and for nothing else; protocol switching replaces the invariant set and raises the node minimum; stale invariant ids never reach the engine; faults naming removed nodes are dropped | `apps/web/test/configure-draft.test.ts` |
| Fault-plan warnings | Six cases that are legal but usually mistakes (recover without crash, heal without partition, partition replacing a partition, link replacing a link in the same direction only, fault past the limit, crash without recovery) and never block a run | same |
| Invariant descriptions | Every registered invariant has a sentence; none claims Raft does log replication or full consensus | `packages/experiments/test/registry.test.ts` |
| Reference preset | `configure-reference` tells its documented story (four faults in order, one split-brain violation at t=477) and keeps fingerprint `6dfb02d2` | same |
| Configure, in-browser | Real registry data; seed exactness and regeneration; protocol switching incl. a protocol with no invariants; node count driving the preview and its accessible names; disable/re-enable retaining plan and signature; fault editor add/edit/remove with the engine's partition and direction semantics; marker → editor; invalid configuration explained and unsubmittable; **the submitted spec matches field-by-field what Configure displayed**; a later UI change does not touch the running experiment | `apps/web/e2e/configure.spec.ts` |

Two real bugs were found by these tests — a run that never started because `load()` is asynchronous, and the stage's stylesheet living on the prototype page — plus one found in screenshot review: input clamping that prevented the engine's validation message from ever appearing. Details in the Gate 3 report §10.

## CP6 results (Gate 2: design system)

**Tests:** 762 unit tests (+6 token tests) and 102 browser tests across Chromium, Firefox and WebKit (98 passing, 4 skipped where no heap API exists). Full report: [CP6_GATE2_DESIGN_SYSTEM.md](CP6_GATE2_DESIGN_SYSTEM.md).

| Layer | What it proves | Where |
|---|---|---|
| Token integrity | Every documented token is declared; every declared semantic token is documented; **no component stylesheet reaches past the semantic layer into `--ref-*`**; every documented colour pairing meets WCAG 2.2 AA (measured 6.33–17.16 : 1); the fault and violation hues stay > 15° apart | `apps/web/test/tokens.test.ts` |
| Gallery integrity | All ten sections render; both font families actually loaded; no page errors and no failed requests | `e2e/design-system.spec.ts` |
| Accessibility | axe-core (`wcag2a/aa`, `wcag21a/aa`, `wcag22aa`, `best-practice`): **0 violations, 43 rules passing** in all three engines. `color-contrast` is *incomplete* there because axe cannot measure through a blur; the token test covers it deterministically | same |
| Keyboard | Every control reachable with a visible `:focus-visible` ring; Space toggles the switch; arrows move within the segmented control and tabs with Home/End; arrows step the number field and range | same |
| Dialogs | Focus moves in, is contained over 12 tabs, Esc closes, focus returns to the opener, the background is inert, nothing is left behind; backdrop and close button both dismiss | same |
| Reduced motion | All three duration tokens become 0 and the spinner stops rotating while staying visible | same |
| Responsive | Five viewports (1586/1440/1280/768/390): no horizontal overflow anywhere; no interactive control under 24 px at ≤ 768 px | same |
| Surface cost | Glass vs matte over the live 3D stage, alternated three times per engine: Firefox 8 → 13 ms p50 (+62 %); Chromium and WebKit vsync-limited at ~17 ms, so the cost is real but invisible there | `e2e/surface-cost.spec.ts` |

Four real defects were found by these tests and fixed: a suppressed focus ring on native controls, a switch whose input was unclickable, a dismissed tooltip still present in the accessibility tree, and WebKit's focus restoration after a dialog (diagnosed as a platform convention, not patched over). Details in the Gate 2 report §8.

## CP6 results (Gate 1: regression fixes and the node prototype)

**Tests:** 756 passing (engine 420, trace 23, protocols 184, experiments 49, runtime 55, demo 10, web 15) plus the CP5 fixture writers; all typechecks and the production build pass. Playwright (production build, Chromium = Chrome 154, Firefox 157.0, WebKit 27.2): 14 CP5 tests + 2 CP6 regression tests + 6 prototype tests, each in three engines. Full report: [CP6_GATE1_NODE.md](CP6_GATE1_NODE.md).

| Layer | What it proves | Where |
|---|---|---|
| Investigate under live load | A 123 932-entry Raft run with Investigate open the whole time, follow live on and cause chains growing to 8 001 entries; follow off → navigate to an earlier cause → follow on; a replay through the deepest region; 30 × ←. Asserts the full chain stays reachable (count, root jump to `run.start`, `#0` visible after scrolling) and the responsiveness budgets (block < 250 ms, frame p95 < 50 ms, no frame > 250 ms, click → paint < 250 ms) | `apps/web/e2e/investigate-live.spec.ts` |
| Follow-live control | The checkbox's real `checked` value sampled synchronously, after microtasks and over six frames, in eleven situations (ready, streaming, 49 rapid toggles, `F`, paused, resumed, view switch, historical event, slider drag, run switch) | `apps/web/e2e/follow-control.spec.ts` |
| Session notification source | User changes notify in the same task and in order; data changes coalesce to one notification per frame (deferred scheduler) | `apps/web/test/session.test.ts` |
| Node visual model | Protocol vs interaction states; combinations compose without conflict; a crashed node shows no role or activity; transitions interruptible midway and settling exactly; reduced motion snaps in one step | `apps/web/test/node-visual.test.ts` |
| Rendering architecture (ADR-0025) | One canvas, two draw calls at 1/5/20 nodes, 2 programs / 2 geometries / 0 textures after 15 scene switches; lazy chunk (not loaded by the app, nor by the flat tier); DOM names, `aria-pressed`, keyboard selection; context loss → flat tier → restore; context released on unmount; idle renders nothing; reduced motion | `apps/web/e2e/node-lab.spec.ts` |
| Prototype performance | Shader compile before the first frame; CPU/GPU per frame at 1/5/20 nodes, full and reduced tiers, three engines | `apps/web/e2e/node-lab.spec.ts` → `test-results/node-lab-<browser>.json` |

Both regression tests were run against the pre-fix code and **failed** there (the browser one in all three engines), so they test the defect and not just the current behaviour.

**Gate 1b (material and lighting revision).** The lighting model was fitted by least squares to ≈ 80 000 interior samples of each of the six reference nodes, and the result checked region by region (highlight ramp, colour temperature per angle, texture contrast, rim crossing, blue-field profile, far field) rather than by mean pixel error alone — a mostly dark sphere keeps that mean low even when the material is wrong. Numbers and the rejected alternatives (baked texture, full-screen bloom, size-dependent falloff, a narrower small-node specular, and a further reduction of the veining) are in [CP6_GATE1_NODE.md](CP6_GATE1_NODE.md) §4–6. The prototype suite is unchanged and still passes in all three engines. GPU time is reported as the **median over three runs**, because the p95 of `EXT_disjoint_timer_query_webgl2` on a laptop GPU is scheduling noise (a 1-node reduced-tier frame measured 4.78 ms p95 in one run); on that basis the material costs ≈ 1 ms extra at 20 nodes in the full tier (1.18 → 2.26–2.83 ms, budget 8 ms), with the reduced tier unchanged.

**Retained memory (CP6 Gate 1, replaces the CP5 leak assertion).** `apps/web/e2e/memory.spec.ts`, Chromium only (no heap API elsewhere; it skips rather than pretend to measure). Two warm-up runs, then five measured disposed runs; growth is the least-squares slope over those samples scaled to the window, plus a bound on the series' spread, plus an assertion that every run terminated its Worker. Verified against a deliberately retained Session per run, which the check must fail. Measured: steady-state growth 0 MB and spread ≤ 0.1 MB over nine invocations; with the injected retention, 19–20 MB per run. The CP5 version compared a warmed-up heap against a cold first sample, so it measured warm-up and failed 2 of 5 full-suite runs; full diagnosis, the six conditions it now satisfies and all numbers are in [CP6_GATE1_NODE.md](CP6_GATE1_NODE.md) §6.

## CP5 results

**Tests:** 747 passing across seven workspaces (engine 420, trace 23, protocols 184, experiments 49, runtime 55, demo 10, web 6) plus 13 fixture/result writers that run only on request; all typechecks and both production builds pass. Playwright (`apps/web`, production build, Chromium = Chrome 154, Firefox 157.0, WebKit 27.2): 42 passing (14 tests × 3 engines). The CP2.5 demo's 6 Playwright tests still pass in Chrome.

| Layer | What it proves | Where |
|---|---|---|
| Experiment registry | Registry identity; 12 rejections with exact paths; JSON round trip; presets behave as described; 13 counterexample presets identical to their fixtures and replay to the recorded fingerprint (CP2 ones via `projectTrace`) | `packages/experiments/test/` |
| Engine streaming APIs | `entriesSince` streams exactly the trace in batches with releases (40 runs); `TraceFingerprint` equals `fingerprintTrace` for every chunking; rejects gaps | `packages/engine/test/streaming-api.test.ts` |
| Worker runtime (in-memory Worker with clone/transfer semantics) | Equality with direct runs (both encodings); slice/budget/chunk/credit/encoding property (25); random pause/step/run scripts (30); exact step(n); pause at a step boundary; stop delivers every entry; flow-control bound; throttling without busy-wait; Start→Stop→Start; Run A→B; stale runId; 5 protocol violations; invalid spec path; abort; watchdog (injected clock); snapshots at current and earlier steps | `packages/runtime/test/runtime.test.ts` |
| Determinism guard | 9 APIs → reproducible `NondeterminismError`; full restore; nesting; traces unchanged; Worker clock unaffected | `guard.test.ts` |
| Contract and architecture | Command/event validation; runtime imports; no React below `apps/web`; only `host.ts` touches timing APIs | `contract.test.ts`, `architecture.test.ts` |
| Incremental TraceIndex | Every single split point of a 150+ entry trace; random multi-splits × checkpoint intervals × protocols (40); prefix equality after each append; record resolution across checkpoints; rejection; cost bound | `packages/trace/test/incremental.test.ts` |
| App state | Follow/cursor, entries/steps/markers navigation, view adapter, reset on load (found an ordering bug) | `apps/web/test/session.test.ts` |
| Cross-browser determinism | 23 reference experiments (engine goldens 7fda34b3 / 6a1dfe65, all presets, all 13 counterexamples), Node-computed and pinned, reproduced in each browser with both encodings | `apps/web/e2e/determinism.spec.ts` + `test/browser-goldens.test.ts` |
| Lifecycle and UX | Lifecycle sequence incl. step; stop + restart; rapid start/stop/start and A→B; keyboard and accessible names; docked controls at 1200×600 | `e2e/lifecycle.spec.ts` |
| Watchdog | Real infinite loop: UI keeps > 20 fps and navigates; `aborted` after the watchdog; never shown as complete; a new run works | `e2e/watchdog.spec.ts` |
| Inspection | Main-thread reconstruction equals the Worker engine's snapshot at 7 step boundaries; violation → cause chain → fixture verification (legacy); markers to exact entries | `e2e/inspection.spec.ts` |
| Performance gate | See below | `e2e/performance.spec.ts`, `tools/perf/` |

### Performance gate (CP5)

**Phase 0 baseline (Node 24 + V8 profilers, `tools/perf/`).** PERF-5 churn: 18.5 → 38.0 µs/step from 20 k to 160 k ticks; profile: `validateVerdict → toFrozenJson → copyObject` 57 % of CPU. PERF-3: index 64–85 MB on a 78 MB trace; child arrays 41.9 MB, message records 16.3 MB. PERF-4: > 100 ms seeks only with the full trace retained; GC pauses explain 0–4 % of them. PERF-2: view ≈ 3.1 µs/step.

**Browser baseline vs Worker** (124 k-entry Raft run, production build; Chrome 154 / Firefox 157 / WebKit 27.2):

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Engine on the main thread: run / longest frame gap | 337 / 363 ms (long task 363 ms) | 421 / 467 ms | 307 / 336 ms |
| Worker, clone: wall / entries per s | 938 ms / 132 k | 945 ms / 131 k | 977 ms / 127 k |
| Worker execute / flush (incl. fingerprint) | 331 / 565 ms | 454 / 466 ms | 355 / 577 ms |
| Main-thread chunk work total / largest chunk | 63 / 1.6 ms | 156 / 8 ms | 76 / 2 ms |
| Longest frame gap while streaming (no React) | 21 ms | 15 ms | 22 ms |
| JSON instead of clone: main-thread chunk work | 104 ms | 221 ms | 122 ms |
| Worker peak retained entries | 3 593 | 2 616 | 3 275 |
| Main-thread seek (`frameAt`) max | 0.2 ms | 1 ms | 1 ms |
| Worker seek (snapshot at a random step) median / max | 6.3 / 9.6 ms | 8 / 13 ms | 6 / 11 ms |
| 40 pause/resume cycles: identical trace / longest gap | ✅ / 21 ms | ✅ / 14 ms | ✅ / 25 ms |
| App with live rendering: frame gap p50 / p95 / max | 17 / 19 / 31 ms | 8 / 12 / 16 ms | 17 / 44 / 83 ms (3 gaps > 50 ms) |
| Leak check (heap after GC, 3 disposed long runs) | 51.1 → 46.2 → 49.6 → 49.6 MB | (no API) | (no API) |

**Acceptance criteria** (asserted in `e2e/performance.spec.ts`): received trace equals the reference after long runs, both encodings and 40 pause/resume cycles; largest main-thread chunk < 50 ms; slowest main-thread seek < 50 ms; longest frame gap while the Worker runs < 250 ms; app p95 frame gap with live rendering < 50 ms; heap growth after three disposed long runs < 10 MB (Chromium); the main-thread baseline must show its own block (> 200 ms), so a broken measurement cannot pass silently.

**Changes made because of the measurements** (each before/after measured): guard per slice instead of per handler call (execution 1258 → ≈ 487 ms in Node, i.e. no overhead); received-trace fingerprint after the run in batches instead of per chunk (main-thread chunk work ≈ 575 → 61–156 ms; app p95 45–51 → 12–44 ms); Worker no longer busy-waits for credit; clone chosen as default encoding; incremental index with typed-array causality (PERF-3); engine `Object.fromEntries` copy (PERF-5).

**Known:** WebKit renders the live app with more long frames than Chromium and Firefox (p95 44 ms, max 83 ms); to be profiled with the real CP6 renderer before tuning anything. Browser heap per structure is not measurable reliably (see FAILURE_MODES W10).

### CP5 mutation pass (25 mutants; harness restores in `finally`, checksums verified)

| Group | Mutants (failing tests) | Result |
|---|---|---|
| Client | C1 chunk order/gap check removed (2) · C2 stale runId check removed (1) · C3 credit never returned (7, by timeout) · C4 watchdog fires while idle (1) · C5 previous Worker not terminated (7) · C6 reset after announcing the new run (1, app Session test) · C7 verification result ignored (1) | caught |
| Worker core | W1 never throttles (2) · W2 busy-waits while throttled (1) · W3 finishes before all entries are sent (2) · W4 pause does not stop execution (1) · W5 step(n) runs n+1 steps (2) · W6 snapshot from a later keyframe (1) · W7 Worker retains the whole trace (1) | caught |
| Guard | G1 never restores (25) · G2 Date statics unguarded (1) | caught |
| Incremental index | T1 outcome never recorded (1) · T2 step range not extended (3) · T3 sibling links corrupted (2) · T4 append accepts gaps (2) | caught |
| Contract / registry / engine | K1 chunk positions unchecked (1) · X1 protocol version ignored (1) · S1 unknown spec fields accepted (1) · E1 fingerprint without separators (1) · E2 entriesSince off by one (2) | caught |

**Result: 25 of 25 detected — after closing two gaps found by the first pass (23 / 25).** W7 survived because nothing observed the Worker's memory: the Worker now reports `maxRetainedEntries`, and a test bounds it. C7 survived twice: first because no test fed a wrong fingerprint (test added), then because the mutant itself was mis-specified (it set "verified" while the real verification still ran and overwrote it); redefined as "verification result ignored", it is caught.

## CP4 results

**Tests:** engine 416 (+3 fixture writers), `@faultlab/trace` 18, `@faultlab/protocols` 184 (+10 fixture/result writers that run only on request), demo 10, Playwright 6; all green; typechecks and the demo build pass. Coverage: protocols 100 % lines / 97.8 % branches; engine 98.1 % lines / 96.4 % branches; trace 100 % lines / 95.4 % branches (two TraceIndex liveness tests added after review: phases after every step vs. the engine, `liveness.missed` as a step trigger, markers).

| Layer | What it proves | Where |
|---|---|---|
| Raft transitions | Every Figure 2 election rule as an explicit state-machine transition (recording `NodeContext`: exact sends, timer sets/cancels, storage writes) | `protocols/test/raft-transitions.test.ts` (25) |
| Raft invariants | Positive and negative cases on hand-made views: stale leader in another term is legal; leader with a lying vote counter; undelivered / other-term / duplicated grants; non-durable self-vote; split-vote retry regression; conflicting voters; 4-node majority | `raft-invariants.test.ts` (20) |
| Liveness framework | Config validation; exact deadline, as trigger of its own step, caused by its armed entry; quiet scheduler; cancellation on progress; disarm and re-arm; re-arm on lost progress; time-only conditions seen at the next step; faulty checks; snapshots with pending deadlines and 7 tamperings | `engine/test/liveness.test.ts` (37) |
| Raft liveness | Healthy-group and progress predicates on hand-made views; healthy start (3/4/5 nodes × 20 seeds); leader isolation re-armed and met (10 seeds, isolating the actual leader); 2\|2\|1, 2\|2 and crash-only minorities disarm; a real miss on Raft (D = 100); re-arm after a leader crash; one degraded link keeps a 5-node check eligible, disarms a 3-node one | `raft-liveness.test.ts` (17) |
| Exploration | Correct Raft, all five invariants, CI subset of 1 000 experiments (fixed seed) + coverage of 18 scenario categories + liveness eligibility + default-timing liveness + leaders never hold an election timer (R15) + replay | `raft-exploration.test.ts` |
| Broken variants | Each found, 1-minimal, byte-identical replay, correct protocol clean under the same experiment; focused `no-step-down` regression (leader established first, then a higher term); `ignore-higher-term` never elects | `raft-broken-variants.test.ts` |
| Stored counterexamples | 10 Raft fixtures (`/2`): versions, exact violation and fingerprint, replay from a mid-run snapshot (segment), 1-minimality, recorded correct-protocol outcome | `raft-counterexample-replay.test.ts` |
| Replay compatibility | Snapshot/restore equivalence with Raft + liveness (40 runs, with/without prefix, JSON); time-travel seek (25); TraceIndex frames incl. liveness phases vs. the engine after every step (20); causal chain of an election | `raft-replay.test.ts` |
| Comparison | Scenarios A–F + B2, qualitative assertions + pinned metrics and fingerprints | `comparison.test.ts` (14) |
| Architecture | Protocols import engine types only; no runtime deps; no `Math.random`/`Date`/timers | `protocols/test/architecture.test.ts` |

### Exploration (≥ 10 000 experiments)

Generator (`protocols/test/raft-experiments.ts`): 3/4/5 nodes; default timeouts [150, 300] (⅔) or deliberately tight [150, 155] (⅓); base latency 1–10 or 1–25; 10 % fault-free; otherwise up to 8 fault groups over t ∈ [0, 1500]: crash+recovery outages (0–600 ticks), crashes, arbitrary partitions into 2–3 groups, heals, lossy links (20–100 %), delayed links (+0–500 ticks), link restores. Run length 2 500 ticks; all five invariants (record-and-continue); liveness D = 1500.

| Run | Experiments | Safety violations | Liveness misses, default timing | Liveness misses, tight timing | Time |
|---|---|---|---|---|---|
| `FAULTLAB_EXPLORE=full`, fixed seed 20261008 | 10 000 | **0** | **0** / 6 688 | 282 / 3 312 | 44 s |
| `npm run test:explore`, random seed −2125180925 | 10 000 | **0** | **0** / 6 681 | 266 / 3 319 | ≈ 45 s |
| CI subset (every `npm test`), seed 20261008 | 1 000 | 0 | 0 | reported | ≈ 5 s |

Scenario coverage in the fixed-seed run (experiments in which it occurred): competing candidates in one term 6 542 · failed election (a term with a candidate but no leader) 6 195 · leader elected 9 144 · old leader met a higher term 1 679 · stale-term message delivered 2 179 · two leader beliefs at once (different terms) 602 · recovery 4 992 · partition 4 869 · heal 3 786 · lost message 1 330 · delayed link 3 809 · liveness met 8 073. Highest term reached: 16. **Passing is evidence, not a proof**: it covers what this generator produces.

**Was the liveness check actually exercised?** Every run starts healthy, so "armed at least once" (100 %) proves nothing. Measured eligibility (the healthy-majority assumption holds) in the 1 000-experiment CI subset:

| Subset | Experiments | Eligible after the first fault (experiments) | Share of post-fault time eligible | Share of all time eligible | Waiting periods | Met | Missed |
|---|---|---|---|---|---|---|---|
| all | 1 000 | — | — | 60.8 % | 1 488 | 1 166 | 35 |
| with faults | 798 | 78.9 % | 43.9 % | 50.9 % | 1 286 | 970 | 20 |
| fault-free | 202 | — | — | 100 % | 202 | 196 | 15 (all tight timing) |
| default timing | 654 | 63.3 % | 43.8 % | 60.5 % | 1 005 | 858 | **0** |
| 3 / 4 / 5 nodes | 329 / 326 / 345 | 60.5 / 51.2 / 76.5 % | 40.6 / 32.0 / 57.9 % | 57.0 / 54.2 / 70.8 % | 503 / 444 / 541 | 399 / 311 / 456 | 0 / 17 / 18 |

| **full run, 10 000 (seed 20261008)** | 10 000 | 78.9 % of the 7 877 with faults | 41.4 % | 60.0 % | 14 683 | 11 667 | 282 (all tight timing; 0 with default timing) |

(Percentages for timing and size subsets are over all their experiments, fault-free ones included.) So under faults the check is eligible in most experiments and for a substantial part of the time, with more periods met than experiments (it re-arms after lost progress). It is ineligible for ≈ 56 % of post-fault time, mostly because the generator applies many permanent partitions and degraded links, and because the health filter is conservative: in a 3-node cluster a single degraded link removes 2 of 3 nodes (tested). The exploration test asserts lower bounds on these figures, so the checker cannot silently go idle.

**Liveness findings during exploration.** The first healthy-group rule produced 13 misses in 1 000 experiments although one leader was serving all healthy nodes (it could drop the leader itself from the group). Fixed in the check, not by raising D (FAILURE_MODES H6). Misses with tight timeouts are the expected effect of too little randomization (Raft paper §9.3) and are reported, not asserted.

**Choice of D = 1500.** Election durations (time to `liveness.met`) over 500 seeds each:

| n | healthy start p50 / p99 / max | leader crash p50 / p99 / max | leader isolation p50 / p99 / max |
|---|---|---|---|
| 3 | 196 / 281 / 410 | 196 / 548 / 885 | 191 / 533 / 669 |
| 4 | 193 / 420 / 577 | 186 / 614 / 865 | 183 / 656 / 865 |
| 5 | 188 / 265 / 521 | 175 / 357 / 421 | 170 / 362 / 409 |
| 7 | 184 / 250 / 355 | 169 / 356 / 380 | 164 / 351 / 397 |

### Broken variants (fast-check seed 4242 unless noted; all stored in `protocols/test/counterexamples/`)

| Variant (rule broken) | Invariant | Experiment | Minimal plan | Violation |
|---|---|---|---|---|
| `volatile-voted-for` (Fig. 2 persistent state) | one-vote-per-term | 3 nodes, tight | crash+recover n1 at 151 | n1 voted for n1 and then for n2 in term 1 |
| `volatile-voted-for` (seed 777, run 951) | election-safety | 3 nodes | 5 faults | Term 1 led by n1 and also by n3 |
| `volatile-term` | term-monotonic | 4 nodes | crash+recover n2 at 211 | currentTerm 1 → 0 (incarnation 2) |
| `volatile-term` (seed 777, run 951) | election-safety | 3 nodes | 5 faults | Term 1 led by n1 and also by n3 |
| `double-vote` (RequestVote rule 2) | one-vote-per-term | 3 nodes | **no faults** | n2 voted for n2 and then for n3 in term 1 |
| `double-vote` | election-safety | 3 nodes | **no faults** | Term 1 led by n2 and also by n3 |
| `ceil-half-majority` (majority) | leader-has-quorum | 4 nodes | **no faults** | 2 votes evidenced; 3 required |
| `ceil-half-majority` | election-safety | 4 nodes | partition 2\|2 at 0 | Term 1 led by n3 and also by n1 |
| `no-step-down` (All Servers rule: "convert to follower") | election-safety | 5 nodes | partition 3\|2 at 0, then [n2] alone at 369 | Term 2 led by n4 and also by n1 |
| `ignore-higher-term` (All Servers rule as a whole) | term-adoption | 3 nodes | **no faults** | n3 stayed in term 0 |

In every case the correct protocol, under the identical experiment, has 0 violations (recorded in each fixture and re-checked).

**The step-down variant, corrected before the first commit.** The first CP4 draft had one variant called `no-step-down` that *ignored* every message with a higher term. Review asked whether it exercised the intended defect, and it did not: with that bug no node ever adopts a candidate's newer term, so no candidate gets a second vote and **no leader is ever elected** (0 of 300 sampled experiments). The step-down path (a leader meeting a higher term) was therefore never reached in a real run; only a unit test on a hand-made leader state touched it. The variant was split, each still breaking exactly one rule:

- `ignore-higher-term`: the old behaviour under an honest name. Detected by `raft-term-adoption`; it elects nobody, so it shows no Election Safety violation (reported, not invented).
- `no-step-down`: adopts and persists the higher term but keeps its role. A focused regression test (5 nodes, seed 1) shows the full chain: n5 is elected at t=202 under healthy conditions with no violation; it is isolated at 400 and healed at 900; at t=909 it delivers a term-2 message, persists term 2 and stays leader while n4 leads term 2 → `raft-election-safety`: "Term 2 was led by n4 and also by n5" (references both leaderships; `raft-leader-has-quorum` also fires: no votes for term 2). Correct Raft under the identical plan: n5 becomes follower in term 2, 0 violations. Exploration finds it independently (run 25, 2 faults: leader n4 of term 1 adopts n1's term 2 while still leading and even grants n1 its vote).

The superseded, never-committed fixture `raft.no-step-down.raft-term-adoption.json` was deleted and its successor regenerated as `raft.ignore-higher-term.raft-term-adoption.json` (same experiment and fault plan; only the variant name differs). Persistence bugs also fail `leader-has-quorum` at the first election (non-durable self-vote = missing evidence, stated in the violation text).

The CP2 **crash-only** counterexample existed only inline (`naive-leader.test.ts`); CP4 rediscovered it with crash/recover-only exploration (seed 424242, run 41, 9 → 5 faults) and stored `engine/test/counterexamples/naive-leader.crash-only.unique-leader-per-epoch.json` (format `/1`, engine `0.4.0-cp4`, fingerprint `2205e14a`). The two CP2 fixtures are unchanged and replay through `projectTrace`.

### Naive vs Raft (pinned in `protocols/test/comparison/results.json`)

| | Naive | Raft |
|---|---|---|
| A healthy, 5 nodes | 1 leader (n5) at t=64; safe | 1 leader at t=202; safe; liveness met 212 |
| B isolate leader n5 (400–900) | 2 leader beliefs for 450 ticks; majority side led 88 % | 2 beliefs (stale n5, older term) 373 ticks; new leader in a higher term with quorum; majority side led 72.8 %; recovered 9 ticks after heal; **0 safety violations** |
| B2 same, seed 3 (n5 is a follower) | as B | safe; n5's inflated term deposes the healthy leader after the heal (no PreVote) |
| C CP2 two-partition fixture, 4 nodes | **Epoch 2 led by n3 and later by n2** | no leader at all (no majority after the 2\|2 split); safe; liveness disarmed |
| D CP2 crash-only fixture, 4 nodes | **Epoch 1 led by n3 and later by n1** | no leader (a majority is never running); safe |
| E5 split 2\|3 | leaders on both sides for 752 ticks | leader only on the majority side; safe |
| E4 split 2\|2 | leaders on both sides | **no election during the split**; leader 27 ticks after the heal; safe |
| F `votedFor` not durable (stored fixture) | no violation | broken Raft: **Term 1 led by n1 and also by n3**; correct Raft: 0 violations |

### Performance (Apple-silicon laptop, Node 24; `npm run bench --workspace @faultlab/protocols`)

| Nodes | first leader median / max (50 seeds) | run 20 000 ticks | steps | entries | entries/tick | trace JSON |
|---|---|---|---|---|---|---|
| 3 | 192 / 282 | 8 ms | 1 987 | 6 763 | 0.34 | 1.3 MB |
| 5 | 182 / 268 | 14 ms | 3 577 | 12 330 | 0.62 | 2.4 MB |
| 7 | 177 / 257 | 21 ms | 5 168 | 17 906 | 0.90 | 3.6 MB |
| 9 | 171 / 233 | 26 ms | 6 774 | 23 523 | 1.18 | 4.7 MB |
| 15 | 167 / 196 | 49 ms | 11 556 | 40 266 | 2.01 | 8.1 MB |
| 25 | 165 / 339 | 85 ms | 19 624 | 68 369 | 3.42 | 13.9 MB |

- **Heartbeat trace volume:** ≈ 0.11–0.14 entries per tick per node in steady state. Per heartbeat and follower: deliver, timer cancel, timer set, response send, and a `state.update` (the new election-timer id is part of the state). Relevant to PERF-3.
- **Timer cancellation / compaction:** 5 nodes, 200 000 ticks: 15 989 cancelled timers, heap never above 29 entries, **0 compactions**. Election timers are reset every 50 ticks but expire within 300, so dead entries leave the heap on their own; ADR-0011's threshold (1 024 dead) is never reached.
- **Invariant and liveness overhead** (5 nodes, 20 000 ticks, 3 577 steps, 9 interleaved runs): none 13 ms · five invariants 36 ms · liveness only 34 ms · both 49 ms (≈ 6 µs per step each, mostly frozen-view construction: PERF-2).
- **Invariant history growth:** with one stable leader the history is constant (≈ 0.5 KB). With leader churn (one isolation per 1 000 ticks, a new term every ≈ 350 ticks) it grows linearly with terms: 4.7 KB at 29 terms, 18 KB at 114, 72 KB at 465 (one-vote-per-term 48 KB, leader-has-quorum 18 KB, election-safety 5.5 KB, term-monotonic 0.2 KB).
- **New: PERF-5.** Under that churn the per-step cost with invariants rises from 14 µs (20 000 ticks) to 36 µs (160 000 ticks), without invariants it stays ≈ 5 µs: the engine deep-copies (`toFrozenJson`) every returned history every step, even when unchanged. Recorded in the ROADMAP; not optimised in CP4.

### CP4 mutation pass (33 mutants; harness restores in `finally`, checksums verified; run on the final code)

| Group | Mutants (failing tests) | Result |
|---|---|---|
| Raft rules | R1 term not persisted (46) · R2 vote not persisted (45) · R3 ⌈n/2⌉ (22) · R4 grant stale terms (1) · R5 ignore votedFor (29) · R6 grant does not reset timer (32) · R7 count other-term votes (3) · R8 count a voter twice (1) · R9 reject current-term AppendEntries (38) · R10 heartbeat does not reset timer (32) · R11 step-down keeps votedFor (7) · R12 step down on equal term (80) · R13 no term increment (40) · R14 no immediate heartbeat (23) · R16 recovery ignores durable term (17) · R17 heartbeat not re-armed (27) | caught |
| | R15 leader may start an election | **equivalent** under the reachable protocol states: `becomeLeader` cancels the election timer and sets it to `null`, and only leaving the leader role creates a new one, so no fired timer can match `state.electionTimer` while leading and the role guard is redundant. Confirmed by a test over 300 generated runs (> 1 000 leader states, every one with `electionTimer: null`), which, as expected for an equivalent mutant, does not kill R15 |
| Raft invariants | I1 election safety never flags (29) · I2 term-monotonic tolerates −1 (1) · I3 self-votes ignored (4) · I4 quorum off by one (10) · I5 conflicting voters ignored (1) · I6 self-vote trusted without storage (2) · I7 sent instead of delivered grants (48) · I8 term adoption off by one (1) | caught |
| Raft liveness | L1 degraded links healthy (5) · L2 progress without acknowledgement (6) · L3 minority assumptions (8) | caught |
| Engine liveness | S1 no re-arm on lost progress (4 + 1 engine) · S2 progress does not cancel the deadline (25 + 4) · S3 deadline one tick late (3 + 9) · S4 disarm does not cancel (12 + 2) · S5 no deadline event (2 + 10) | caught |

**Result: 32 of 33 detected; R15 classified as equivalent under the established reachable protocol states.** Weakest kills (one test): R4, R8, I2, I5, I8. Each is caught by a precise unit test; the system-level tests do not distinguish them, which is expected for defensive rules whose violation needs a specific message order.

## CP3 results

**Tests:** engine 371 passing (+2 fixture writers), `@faultlab/trace` 16, demo 10, Playwright 6, all green; typechecks and the demo build pass. Coverage: engine 98.9 % lines / 96.1 % branches (`snapshot.ts` 100 / 97.8, `time-travel.ts` 100 / 89.7); trace 100 % lines / 96.6 % branches.

**Determinism:** all CP0–CP2 golden fingerprints and both stored counterexamples pass **unchanged** (no golden or fixture file was modified; `ENGINE_VERSION` remains `0.3.0-cp2` because no trace changed).

**Correctness tests added:** metamorphic snapshot/restore over random protocols × fault plans × invariant policies × snapshot points, with and without trace prefix, through JSON (120 runs); idempotence (80); snapshot-after-every-step (30); independence; immutability; counterexamples replayed from mid-run snapshots; 34 malformed/incompatible-snapshot rejections; exact seek vs. uninterrupted runs for K ∈ {1, 2, 7, 64} (60 runs); interval independence; burst-step bound; regeneration over random ranges (60); keyframes-only reconstruction; TraceIndex vs. the engine's own snapshot after **every** step (60 random experiments × checkpoint intervals), step boundaries vs. real `step()` calls (60), cost bound, markers, inverse causality.

### CP3 mutation pass (23 mutants)

| Mutant | Result |
|---|---|
| S1 `nextSeq` not restored · S2 timers reversed · S3 node PRNG not restored · S4 network PRNG not restored · S5 message counter not restored · S6 `crashedAt` · S7 `stateEntry` · S8 invariant monitor · S9 links reversed · S10 in-flight index not rebuilt · S11 stop reason · S12 incarnation · S14 segment off by one · S15 no last-entry check · S17 out-of-order events accepted · S18 seek uses a later keyframe · S19 regenerate loses `run.end` · S20 TraceIndex keeps timers after crash · S21 send-time drops counted as steps | caught (1–5 failing tests each) |
| S13 storage restored in reverse order | **survived** at first: every fixture protocol stores ≤ 1 key per node. New multi-key test → caught |
| S16 timer↔event consistency check skipped | **survived** at first: the negative test hit a different check. New "timer without event" test → caught |
| S23 trace release drops the newest entry | **survived** at first: `TimeTravel` snapshots before releasing. New "snapshot after release" test → caught |
| S22 TraceIndex checkpoint taken after its entry | survives: an **equivalent mutant** with respect to the public TraceIndex API (definition below) |

**Final result: 22 of 23 mutants detected; S22 classified as equivalent.** The tests added for S13, S16 and S23 stay in the suite as regression tests.

**Why S22 is equivalent, precisely.** *Equivalence is defined relative to the TraceIndex's observable behaviour: the return values of its public methods (`frameAt`, `lastFrameCost`, `steps`, `stepOf`, `markers`, causality and navigation methods) for every valid trace and argument.* The mutant stores checkpoint c as the state *after* applying entry `c·C` instead of before. `frameAt(i)` always uses checkpoint `⌊i / C⌋`, so `i ≥ c·C`, and then applies entries `c·C … i`; under the mutant, entry `c·C` is therefore applied **twice**. That is unobservable because `apply` is **idempotent per entry**, i.e. `apply(apply(W, e), e) = apply(W, e)` for every entry kind in the current semantics:

- assignments (status, incarnation, state, `stateEntry`, partition, `stopped`) set the same values again;
- map writes and deletes (`timers`, `inFlight`, `links`, `open`) are set/delete operations, so repeating them changes nothing; `link.fault` deletes then re-inserts, ending in the same order;
- the storage merge and deletions, and a crash clearing timers, end in the same state.

`lastFrameCost` counts loop iterations from the checkpoint and is identical; the other methods do not use checkpoints at all. **What could detect it:** a test inspecting private checkpoint contents, memory or timing (outside the defined observable behaviour); or any future `apply` that is *not* idempotent (e.g. a counter of handled messages), which would turn S22 into a detectable mutant. Per-entry idempotence of `apply` is therefore a documented assumption of the TraceIndex.

### CP3 benchmarks

Workload: naive leader, 8 nodes, healthy network, 100 000 steps (287 533 entries); Apple-silicon laptop, Node 24. Times are medians (min/max where noted); memory is **retained** heap measured by dropping the object and forcing GC (median of 3).

| Snapshot (end of run, 32 pending events) | |
|---|---|
| capture | 0.17 ms |
| size as JSON | 9 980 bytes (inputs 401 bytes) |
| restore with 287k-entry prefix / segment / from parsed JSON | 0.45 / 0.09 / 0.31 ms |
| retained memory, shared vs. parsed copy | 0.03 MB / 0.03 MB (states here are tiny: structural sharing makes no measurable difference for this workload) |

| Keyframe interval K (steps) | 64 | 256 | 1 024 | 4 096 |
|---|---|---|---|---|
| keyframes | 1 563 | 391 | 98 | 25 |
| record time (plain run: 545 ms) | 730 ms | 582 ms | 530 ms | 526 ms |
| retained memory, keyframes only | 33.0 MB | 8.3 MB | 2.1 MB | 0.5 MB |
| seek median / max (40 targets) | 0.27 / 0.88 ms | 0.74 / 146 ms | 2.97 / 123 ms | 9.24 / 114 ms |
| most steps re-executed (bound K − 1) | 63 | 251 | 979 | 4 040 |
| regenerate 10 000 steps (28 750 entries) | 51 ms | 58 ms | 56 ms | 73 ms |

Full trace for the same run: **78.3 MB** retained. At K = 1 024, keyframes cost ~21 KB each in memory (8.2 KB as JSON): keyframes-only recording does **not** retain historical data. The occasional 100+ ms seek maxima are not explained yet (tracked as **PERF-4**; GC pauses are a hypothesis only).

| TraceIndex checkpoint interval C (entries) | 64 | 256 | 1 024 | 4 096 |
|---|---|---|---|---|
| build | 119 ms | 97 ms | 91 ms | 90 ms |
| retained memory (on top of the 78 MB trace) | 82.6 MB | 69.1 MB | 65.3 MB | 64.3 MB |
| `frameAt` median / max (200 queries) | 0.015 / 0.29 ms | 0.020 / 0.11 ms | 0.048 / 0.21 ms | 0.147 / 0.54 ms |

The index roughly doubles memory: recorded as **PERF-3**, to be investigated **before** the performance-sensitive frontend integration (ROADMAP, performance gate).

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
