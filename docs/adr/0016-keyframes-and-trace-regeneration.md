# ADR-0016: Keyframes, seeking, and the trace as a recomputable cache

**Status:** Accepted (CP3)

**Problem.** Reaching step n of a run should not require re-running from the start, and long runs should not have to keep their entire trace in memory.

**Decision.** `TimeTravel.record(config, { keyframeSteps: K, retainTrace })` executes the run and keeps a snapshot ("keyframe") at step 0 and after every K completed **simulation steps**.

- `seek(n)` binary-searches the last keyframe ≤ n, restores it, and re-executes the remaining steps: **at most K − 1 steps**. The bound is in steps, not entries: one step can produce hundreds of entries (tested with a burst protocol), so the work per seek is O(K × entries per step).
- `regenerate(a, b)` returns the entries produced by steps (a, b], byte-identical to the original, **with their original absolute indices**. This works because `EventTrace` can start at an absolute index (a *segment*) and because snapshots record `traceLength`.
- `retainTrace: false` releases trace entries as the run proceeds (`sim.releaseTraceBefore`, always keeping the newest entry); any part can be regenerated on demand.

Positions are step boundaries only. Nothing seeks to an entry inside a step; for that, the read-only TraceIndex (ADR-0017) answers questions about a completed trace.

**Alternatives.**
- *Store the full trace and replay from the start:* O(n) per seek.
- *Keyframes every K trace entries:* entries are not resumable positions; K must count steps.
- *Adaptive keyframe spacing* (by entry volume or time): possible later, once profiling shows uneven step sizes matter.

**Trade-off.** Memory ≈ (steps / K) × snapshot size; seek ≈ K steps. Measured in TEST_STRATEGY (CP3). Snapshots share frozen states with each other, but every keyframe carries its own scheduler queue and in-flight payload references.

**Invariant.** `seek(n)` yields exactly the state of an uninterrupted run after n steps, for every K; `regenerate` is byte-identical with absolute indices; keyframes do not depend on `retainTrace`.

**Tested by.** `test/time-travel.test.ts` (property-based exact seeking against uninterrupted runs for K ∈ {1, 2, 7, 64}; interval independence; burst bound; regeneration over random ranges; keyframes-only reconstruction; causal references).
