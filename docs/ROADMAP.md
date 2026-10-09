# Checkpoint Roadmap

Each checkpoint ends with passing tests, updated docs, an updated [ENGINEERLOG.md](../ENGINEERLOG.md), and an ADR for every significant decision. A checkpoint is *done* when its acceptance criteria are demonstrably met, not when its code exists. Order matters: each one relies on guarantees proven by the previous ones.

> **Renumbering note (CP1).** CP1 was widened to cover all fault injection, including network faults (previously a separate CP2). Every later checkpoint moved down by one number; all documents use the new numbers.

## CP0 — Deterministic core ✅

Three independently modelled nodes · virtual clock · deterministic priority queue · seeded PRNG · messages delivered at scheduled virtual times · reproducible trace · defined ordering of simultaneous events · `maxEvents` · unit + property tests · identical traces for identical inputs · determinism documentation.

## CP1 — Fault injection and node lifecycle ✅

Design: [ADR-0008](adr/0008-node-lifecycle-persistence-incarnations.md) (lifecycle, persistence, incarnations), [ADR-0009](adr/0009-fault-plan-as-input.md) (fault plan), [ADR-0010](adr/0010-network-fault-semantics.md) (network faults, in-flight messages), [ADR-0011](adr/0011-scheduler-heap-compaction.md) (heap compaction). Semantics: [SEMANTICS §6–9](SEMANTICS.md).

**Acceptance criteria** (each has at least one automated test):

1. A node crashes at a specified virtual time. While crashed it executes no handler, fires no timer, sends no message, and changes neither state nor storage. The crash appears in the trace with the timers it cancelled.
2. A crashed node recovers at a specified time with incarnation + 1. Volatile state is rebuilt by `init`; persistent storage (`sync-on-commit`) survives; runtime and infrastructure state follow the table in ADR-0008.
3. No timer from an earlier incarnation ever fires, including when a crash, a recovery and a timer share one tick.
4. Deterministic scheduling of crash, recover, partition, heal, link delay, link loss and link restore, all from the configuration's fault plan, which is validated and recorded in `run.start`.
5. Messages in flight follow ADR-0010 (partition checked at delivery; link conditions fixed at send; crashed receivers drop).
6. Every injected fault yields exactly one trace entry (applied or skipped) caused by `run.start`. Every drop links to its send (`cause`) and to the fault responsible (`conditionIndex`).
7. Same config + seed + protocol version + engine version + fault plan ⇒ same trace (property-tested over random fault plans; golden fingerprint for a fault-heavy reference experiment).
8. Resource limits hold under fault-heavy runs. The cancelled-timer accumulation is investigated, decided (ADR-0011), and covered by regression tests.
9. All CP0 tests still pass, apart from deliberate trace-format changes (the CP0 golden updated together with an `ENGINE_VERSION` bump).
10. ENGINEERLOG.md has a CP1 entry.

## CP2 — Invariant checking, explainable violations, fault exploration ✅

Design: [ADR-0012](adr/0012-invariant-model.md) (invariant model), [ADR-0013](adr/0013-violation-policies.md) (policies, explainable records), [ADR-0014](adr/0014-fault-exploration-and-shrinking.md) (exploration and shrinking). Bounded liveness is **deferred to CP4**.

**Acceptance criteria:**

1. Invariants are evaluated after every committed step, in configuration order, over a deeply frozen view; a graph-walk test proves runtime immutability, and mutation attempts are contained as `invariant.error` without changing the simulation.
2. Historical invariants keep explicit, versioned, JSON history that is validated, frozen, and inspectable (snapshot-ready).
3. `stop-on-first` (default) and `record-and-continue` policies; deterministic ordering of several outcomes in one step; one entry per violation episode; `maxViolations` bound; checker exceptions contained.
4. Violation records are explainable: invariant id/version/name, nodes, expected, observed, evidence, cited references, trigger, step range, node state provenance, active faults (facts only), and the event number for replay.
5. An in-flight message index stays consistent with the scheduler and the trace through sends, deliveries, loss, partitions, crashed receivers, fault transitions and termination (property-tested).
6. Naive leader election converges to one stable leader in healthy runs with no false positives during startup; `single-leader` also holds under crash/recover-only plans; a partition after convergence produces a deterministic split-brain violation. *(Outcome: property testing also showed that per-epoch uniqueness can fail under crashes alone, a quorum problem that persistence cannot fix. Documented as a protocol weakness for CP4, not hidden.)*
7. Exploration finds violations from random fault plans, shrinks them to valid, 1-minimal counterexamples, stores them as fixtures (seed, minimized config, invariant, fingerprint), and they replay exactly.
8. With invariants disabled, traces project exactly onto the CP1 and CP0 golden fingerprints; old-version fixtures fail loudly instead of silently.
9. Overhead with 0, 1 and 5 invariants is measured (median and spread).
10. ADRs, docs, and a Dutch ENGINEERLOG entry for CP2.

## CP2.5 — First reality check: a browser trace viewer (inserted; CP3 paused)

A temporary prototype in `apps/demo`: Vite + plain TypeScript + SVG, the real engine **unchanged**, small bounded experiments executed on the main thread, then replayed. Presets: healthy network, crash/recovery/partition, partition after convergence; plus both stored counterexamples loaded from `packages/engine/test/counterexamples/`.

- `src/derive.ts`: framework-independent, pure derivation of everything displayed from the trace alone; reusable when the React app arrives (CP5). Cross-checked against the live engine's own view after every step (all experiments + 40 random fault plans).
- Playwright e2e (local Chrome): healthy leader, crash/recovery/partition, split-brain violation with explanation and fixture fingerprint, determinism across reloads, playback controls.
- Manual verification (2026-10-08): crash of n2 at t=150, dropped messages, recovery at t=300 with incarnation 2 and updated storage, partition at t=400, heal at t=520, all visually confirmed.
- UX findings **UX-001** (confusing initial state) and **UX-002** (controls below the viewport) are recorded in [UI_REQUIREMENTS.md](UI_REQUIREMENTS.md) for CP5/CP6; the prototype is intentionally not redesigned.
- Integration findings are recorded in ENGINEERLOG (CP2.5). Main ones for CP5: export named trace-entry types from the engine; move shared experiments/fixtures out of the engine's `test/`; step-level vs entry-level cursor; indexed (not O(n)-per-frame) state derivation for large traces, which overlaps with CP3's state index.

## CP3 — Snapshots, replay, time travel ✅

Delivered: engine snapshots (ADR-0015), keyframes / seeking / trace regeneration (ADR-0016), `@faultlab/trace` TraceIndex (ADR-0017), demo switched to TraceIndex. Results in [TEST_STRATEGY](TEST_STRATEGY.md#cp3-results).

*Original plan:*

- A snapshot captures **all** execution-relevant state: clock, scheduler heap and `nextSeq`, PRNG states, node runtimes (status, incarnation, state, storage, counters, timers), network conditions and partition, trace length.
- Time travel = restore the nearest snapshot ≤ target, then re-execute.
- **Acceptance:** metamorphic property `run(N) ≡ restore(snap@k) + run(N−k)` for random k, random experiments and random fault plans.

## CP4 — Raft leader election (implemented; awaiting review)

Design: [ADR-0018](adr/0018-raft-election-model.md) (Raft election, invariants, broken variants), [ADR-0019](adr/0019-bounded-liveness.md) (bounded liveness), [ADR-0020](adr/0020-comparison-and-counterexamples.md) (comparison, counterexample format 2). Rule-by-rule mapping: [RAFT.md](RAFT.md). Semantics: [SEMANTICS §17–18](SEMANTICS.md). Results: [TEST_STRATEGY](TEST_STRATEGY.md#cp4-results).

**Scope:** leader election only. Log replication, commitment and state-machine safety stay in CP8 and are not claimed.

**Acceptance criteria and status:**

1. Raft election per Figure 2 (§5.1, 5.2, 5.4.1): follower / candidate / leader, monotonic durable `currentTerm` and `votedFor` persisted before dependent replies, one vote per term, majorities of ⌊n/2⌋+1, randomized timeouts from `ctx.random`, RequestVote, empty-AppendEntries heartbeats, correct timer resets, step-down on any higher term, crash recovery from storage. Explicit transition tests per rule. ✅
2. Historical safety invariants from real events: Election Safety (per term, whole history), term monotonicity, one vote per term, leader-has-quorum (delivered grants + durable self-vote, conflict check, protocol counter not trusted), term adoption. "One leader at any moment" deliberately **not** enforced. ✅
3. Bounded liveness as a separate engine feature: assumptions, configured test bound D, real deadline events, no false results under permanent minority partitions, never reported as safety. ✅
4. ≥ 10 000 generated experiments (3/4/5 nodes, default and tight timeouts, partitions, heals, crashes/recoveries, lost and delayed messages) with zero safety violations; deterministic CI subset; `npm run test:explore` for random seeds. ✅
5. Six broken variants (five planned; the planned "no step-down" was split into `no-step-down` and `ignore-higher-term` because the first version never reached the step-down path), each found by exploration, minimised (1-minimal), stored (format 2), replayed deterministically (also from a mid-run snapshot), and contrasted with the correct protocol under the same experiment. ✅
6. Naive-vs-Raft comparison A–F (plus B2) under identical external conditions; pinned, reproducible results; the CP2 crash-only counterexample stored as a fixture. ✅
7. Engine `0.4.0-cp4`, snapshot format `/2`; CP0–CP3 fingerprints reproduced through `projectTrace`; no historical fixture modified. ✅
8. Measurements (cluster sizes, timer cancellation/compaction, heartbeat trace volume, invariant and liveness overhead, history growth). ✅ New finding **PERF-5**.
9. Mutation pass on Raft rules, invariants and liveness: 32 / 33 killed, 1 equivalent. ✅
10. ADRs, docs, Dutch ENGINEERLOG entry, UI data requirements for Raft. ✅

## CP5 — Worker boundary and minimal UI shell

**Must satisfy [UI_REQUIREMENTS.md](UI_REQUIREMENTS.md): UX-001 (configuration vs. current state, explicit run lifecycle, honest initial position) and UX-002 (docked, always-visible playback controls and timeline with clickable event markers).**


- `apps/web`: React + Vite. Simulation in a Web Worker; versioned, validated message protocol; trace streamed in chunks; wall-clock watchdog for runaway handlers; `Math.random`/`Date` stubbed inside the worker.
- Unstyled but complete: configure, run, step, scrub, trace table, node inspector.
- Playwright (introduced in CP2.5 against local Chrome): smoke tests and cross-browser determinism (identical golden fingerprints in Chromium, Firefox, WebKit).

## CP6 — Visual system and network visualisation

Applies [DESIGN_DIRECTION.md](DESIGN_DIRECTION.md) phases V0–V3: tokens, primitives, graph renderer prototype (measured), timeline and space-time diagram, causal highlighting, fault visualisation. Carries forward UX-001 and UX-002 and the timeline requirements in [UI_REQUIREMENTS.md](UI_REQUIREMENTS.md).

## CP7 — Experiments: save, load, share

IndexedDB persistence; JSON export/import validated at the boundary; share links encode *inputs* (config + fault plan), never traces; on load, re-run and compare fingerprints to detect engine/protocol drift.

## CP8 — Raft log replication and safety

Log Matching, Leader Completeness and State Machine Safety invariants; a client workload generator; optionally a linearizability checker.

## CP9 — Performance engineering

Profile before optimising. Targets: 100+ nodes, 10⁶+ events. Candidates: trace chunking/diff encoding, render LOD, typed-array event storage. Rust/WASM only if profiling proves the engine is the bottleneck.

**Open investigation PERF-3 — TraceIndex memory. Must be investigated BEFORE the performance-sensitive frontend integration (CP5/CP6), not deferred to CP9.** CP3 measurement (100 000 steps, 287 533 entries, 78 MB trace): the index retains a further **64–83 MB** (checkpoint interval 4 096 → 64), roughly doubling memory. That is significant for a browser application. Checkpoints explain the interval-dependent part (~18 MB at 64); the fixed ~64 MB is, unverified, per-entry child arrays for causal navigation and per-message records. Candidates: compressed sparse-row (Int32Array) adjacency for `cause`/`conditionIndex`, lazily built message records. Decide after a heap profile; frames must stay identical.

**Open investigation PERF-4 — seek latency outliers.** In the CP3 benchmark, median seeks were 0.27–9.2 ms, but some single seeks took **114–146 ms** (K = 256, 1 024, 4 096; 40 targets each). Unexplained; garbage collection is a hypothesis, not a finding. Relevant for scrubbing.

**Performance gate before the final interactive timeline (CP5/CP6).** Measure and profile first, with no algorithm changes before evidence, and preserving correctness, determinism and immutability. The following must be understood:
1. TraceIndex memory retention (PERF-3);
2. keyframe memory requirements for realistic run sizes;
3. seeking latency and its outliers (PERF-4);
4. browser responsiveness during large simulations (main thread vs. Worker);
5. garbage-collection behaviour (allocation per step and per frame);
6. performance while scrubbing repeatedly (sustained `frameAt` / `seek` calls);
7. invariant history growth and per-step history copying (PERF-5), measured on long Raft runs with leader churn;
8. Worker responsiveness: message latency and backpressure while a large simulation runs off the main thread;
9. main-thread rendering performance (frame time while scrubbing and animating real traces);
10. large Raft traces with many heartbeats (≈ 0.11–0.14 entries per tick per node; e.g. 25 nodes ≈ 3.4 entries per tick) through the whole pipeline: engine → transfer → TraceIndex → rendering.

Profile first; optimise only when a measurement justifies it. Correctness and determinism remain mandatory: every optimisation must keep the golden fingerprints, the snapshot equivalence and the immutability tests passing unchanged.

PERF-1 (CP1 benchmark outliers), PERF-2 (invariant view construction) and PERF-5 (history copying) remain open as separate investigations.

**Open investigation PERF-5 — invariant history copied every step (found in CP4).** The engine passes every history an invariant returns through `toFrozenJson`, a full validating deep copy, after every step, even when the invariant returns the unchanged, already-frozen history. With Raft's historical invariants under leader churn (a new term every ~350 ticks), per-step cost grows with history size: 14 µs per step at 3 275 steps (20 000 ticks, ≈ 9 KB of history) to 36 µs per step at 25 978 steps (160 000 ticks, ≈ 72 KB), while runs without invariants stay at ≈ 5 µs per step. Total time therefore grows super-linearly with run length. Healthy runs (one term) do not grow. Candidate, after profiling: skip the copy when the returned history is the identical, already validated object (keeps every guarantee), and/or let historical invariants use structurally shared persistent maps. Must be understood before long interactive Raft runs (CP5/CP6).

**Open investigation PERF-2 — invariant view construction.** With invariants enabled, ≈ 5 µs per step is spent building the frozen `SimulationView`, independent of the checkers (CP2 measurement: 528 → 1 026 ms per 100 000 events for one no-op invariant). Measurements are preserved in [TEST_STRATEGY, CP2 results](TEST_STRATEGY.md#runtime-verification-overhead) (0 / 1 / 5 invariants, plus the no-op decomposition showing that building the frozen view is the main cost). Candidates, to be decided only after profiling: reuse `NodeView` objects for nodes whose state/status/storage did not change (immutability makes reuse safe), avoid per-step closures, let invariants declare which entry kinds can affect them, and avoid re-validating unchanged history. **Constraint:** any optimisation must keep the same correctness and isolation guarantees with less allocation and copying, never by weakening them. Determinism and runtime immutability take precedence over speed, and the existing graph-walk, mutation-attempt and golden-fingerprint tests must pass unchanged.

**Open investigation PERF-1 — CP1 latency outliers.** In the CP0-vs-CP1 A/B benchmark (200 000-event echo workload, 21 runs each), CP1 had a median of 477 ms but individual runs of 547–660 ms, which appeared more often than in CP0. It is *not* a correctness concern: traces are byte-identical across runs (determinism suite), so only wall-clock time varies. Hypotheses, none verified: (a) garbage collection pressure from larger trace entries (`incarnation` fields) and the per-handler storage object in `createNodeContext`; (b) JIT deoptimisation from the wider `TraceEntry` union; (c) machine noise. Plan: run with `--trace-gc` and `--cpu-prof`, compare allocation per event between CP0 and CP1, and repeat with more runs in a quieter environment. Decide on fixes only after profiling.

## CP10 — User-defined protocols

A security architecture ADR first: isolation, deterministic resource metering, API surface, threat model. Never remote execution.

## Future architecture review (not yet scheduled)

- **Version naming:** the engine version `0.3.0-cp2` denotes trace semantics, not a build; the trace format has no separate version (SEMANTICS §16). Consider separate `semanticsVersion` / `traceFormat` fields. Not to be changed casually: it alters every trace and golden fingerprint.

## Deferred network features (not yet scheduled)

Message duplication, opt-in FIFO links, per-link base latency, adaptive faults ("crash the current leader"), interactive fault injection during a run (to be recorded as inputs), and an explicit-`sync()` persistence mode.
