# Checkpoint Roadmap

Each checkpoint ends with passing tests, updated docs, an updated [ENGINEERLOG.md](../ENGINEERLOG.md), and an ADR for every significant decision. A checkpoint is *done* when its acceptance criteria are demonstrably met, not when its code exists. Order matters: each one relies on guarantees proven by the previous ones.

> **Renumbering note (CP1).** CP1 was widened to cover all fault injection, including network faults (previously a separate CP2). Every later checkpoint moved down by one number; all documents use the new numbers.

## CP0 — Deterministic core ✅

Three independently modelled nodes · virtual clock · deterministic priority queue · seeded PRNG · messages delivered at scheduled virtual times · reproducible trace · defined ordering of simultaneous events · `maxEvents` · unit + property tests · identical traces for identical inputs · determinism documentation.

## CP1 — Fault injection and node lifecycle

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

## CP2 — Invariant checking

- `Invariant = { name, check(view) → ok | violation(detail) }`, evaluated after every step over a read-only global view (node states, storage, in-flight messages, time). The trace-level lifecycle checker written for CP1 tests is the seed of this.
- Violations are trace entries; the policy can be stop or continue.
- Bounded-liveness helpers (e.g. "a leader exists by t=…") are kept separate from safety invariants.
- **Acceptance:** a deliberately buggy fixture protocol is caught; checkers cannot mutate state (frozen views); the cost per step is measured and documented.

## CP3 — Snapshots, replay, time travel

- A snapshot captures **all** execution-relevant state: clock, scheduler heap and `nextSeq`, PRNG states, node runtimes (status, incarnation, state, storage, counters, timers), network conditions and partition, trace length.
- Time travel = restore the nearest snapshot ≤ target, then re-execute.
- **Acceptance:** metamorphic property `run(N) ≡ restore(snap@k) + run(N−k)` for random k, random experiments and random fault plans.

## CP4 — Raft leader election

- RequestVote/AppendEntries heartbeats; randomized election timeouts from `ctx.random`; `currentTerm` and `votedFor` in persistent storage.
- Invariants: **Election Safety** (≤ 1 leader per term); terms monotonic per node; a node votes at most once per term.
- Thousands of seeds with random crash and partition plans. Failures are shrunk by fast-check to minimal fault plans.
- **Acceptance:** zero safety violations across ≥ 10 000 randomized experiments; a known-bad variant (vote not persisted) is caught and shrunk.

## CP5 — Worker boundary and minimal UI shell

- `apps/web`: React + Vite. Simulation in a Web Worker; versioned, validated message protocol; trace streamed in chunks; wall-clock watchdog for runaway handlers; `Math.random`/`Date` stubbed inside the worker.
- Unstyled but complete: configure, run, step, scrub, trace table, node inspector.
- Playwright: smoke tests and cross-browser determinism (identical golden fingerprints in Chromium, Firefox, WebKit).

## CP6 — Visual system and network visualisation

Applies [DESIGN_DIRECTION.md](DESIGN_DIRECTION.md) phases V0–V3: tokens, primitives, graph renderer prototype (measured), timeline and space-time diagram, causal highlighting, fault visualisation.

## CP7 — Experiments: save, load, share

IndexedDB persistence; JSON export/import validated at the boundary; share links encode *inputs* (config + fault plan), never traces; on load, re-run and compare fingerprints to detect engine/protocol drift.

## CP8 — Raft log replication and safety

Log Matching, Leader Completeness and State Machine Safety invariants; a client workload generator; optionally a linearizability checker.

## CP9 — Performance engineering

Profile before optimising. Targets: 100+ nodes, 10⁶+ events. Candidates: trace chunking/diff encoding, render LOD, typed-array event storage. Rust/WASM only if profiling proves the engine is the bottleneck.

**Open investigation PERF-1 — CP1 latency outliers.** In the CP0-vs-CP1 A/B benchmark (200 000-event echo workload, 21 runs each), CP1 had a median of 477 ms but individual runs of 547–660 ms, which appeared more often than in CP0. It is *not* a correctness concern: traces are byte-identical across runs (determinism suite), so only wall-clock time varies. Hypotheses, none verified: (a) garbage collection pressure from larger trace entries (`incarnation` fields) and the per-handler storage object in `createNodeContext`; (b) JIT deoptimisation from the wider `TraceEntry` union; (c) machine noise. Plan: run with `--trace-gc` and `--cpu-prof`, compare allocation per event between CP0 and CP1, and repeat with more runs in a quieter environment. Decide on fixes only after profiling.

## CP10 — User-defined protocols

A security architecture ADR first: isolation, deterministic resource metering, API surface, threat model. Never remote execution.

## Deferred network features (not yet scheduled)

Message duplication, opt-in FIFO links, per-link base latency, adaptive faults ("crash the current leader"), interactive fault injection during a run (to be recorded as inputs), and an explicit-`sync()` persistence mode.
