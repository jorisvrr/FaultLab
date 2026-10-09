# ADR-0022: Time-sliced Worker runtime with a versioned, flow-controlled protocol

**Status:** Accepted (CP5)

**Problem.** Running the engine on the main thread blocks the UI (measured: a 124 000-entry Raft run blocks for 345–476 ms). The app needs live control (run, pause, step, stop), complete and ordered trace delivery, isolation between runs, protection against runaway handlers, and unchanged determinism.

**Decision.** Package `@faultlab/runtime` (framework-free), one **Web Worker per run**.

- **Contract** `faultlab-worker/1`: commands `load(spec, options)`, `run`, `pause`, `step(n)`, `stop`, `credit(n)`, `snapshot(requestId, atStep)`; events `loaded`, `chunk(seq, from, to, entries | data)`, `status`, `finished(fingerprint, metrics)`, `snapshot`, `error`. Every message carries the protocol id and a **runId**; both sides validate on receipt.
- **Time slicing**: a slice executes whole steps until its wall-clock budget (8 ms) or step limit is reached, then yields through a MessageChannel macrotask so commands can arrive. Slices end only at step boundaries, so traces are identical for every slice size, budget, encoding, pause pattern and credit setting (property-tested).
- **Flow control**: the Worker may have `initialCredits` (4) chunks unacknowledged; the client returns one credit after APPLYING each chunk. With no credit and a full chunk pending, execution pauses (throttled) and resumes on credit — without busy-waiting. Sent entries are released in the Worker (`releaseTraceBefore`), so it never holds the whole trace (PERF-4 mitigation).
- **Ordering**: the client accepts chunk `seq` = expected and `from` = entries received, checks every entry's index, and treats anything else as a protocol violation (run → `error`). Messages for another runId are ignored and counted; a new `load` detaches and terminates the previous Worker first and resets consumers before announcing the new run.
- **Lifecycle** (client): idle, loading, ready, running, paused, completed (engine stopped by itself; reproducible), stopped (user, cooperative; all produced entries delivered), aborted (Worker terminated; not reproducible), error.
- **Three ways to end**: cooperative **pause** (next step boundary), normal **stop** (next step boundary, tail delivered, `finished(stopped)`), forced **termination** (`abort()` or the watchdog: the Worker is killed immediately; state `aborted`).
- **Watchdog**: while the Worker should be working (loading, running, pending pause/stop) and says nothing for `watchdogMs` (3 s), the client terminates it.
- **Determinism guard**: during each execution slice, `Math.random`, `Date` (+ statics), `performance.now`, `setTimeout`, `setInterval`, `queueMicrotask`, `crypto.getRandomValues/randomUUID` throw `NondeterminismError` (recorded deterministically as a handler error). Installed per SLICE, not per handler call (per call cost 2.6× execution time, measured). The Worker's clock is captured at module load. Not a sandbox.
- **Integrity**: the Worker fingerprints the trace incrementally (`TraceFingerprint`) and reports it in `finished`; the main thread verifies the received trace after the run, in background batches (per-chunk hashing was ≈ 60 % of main-thread streaming work).
- **Encoding**: structured clone (default) or UTF-8 JSON in a transferred ArrayBuffer. Measured in Chromium, Firefox and WebKit: similar Worker cost; clone cheaper on the main thread in all three (61 vs 103, 136 vs 215, 74 vs 127 ms per 124 k entries). Clone is the default; JSON stays as a tested option.

**Alternatives.** *SharedArrayBuffer / Atomics*: needs cross-origin isolation (COOP/COEP) and a binary trace format; not justified by measurements. *One long-lived Worker for all runs*: saves ~ms per run but makes isolation depend on runId discipline alone. *Engine on the main thread with `scheduler.yield()`*: still competes with rendering, not available everywhere. *Comlink-style RPC*: hides message semantics we need to test.

**Invariant.** For any options and command interleaving, the received trace equals `runSimulation(resolveExperiment(spec).config).trace` up to where the run ended; a run's messages can never affect another run.

**Tested by.** `packages/runtime/test/` (in-memory Worker with clone/transfer semantics: equality, slice/chunk/credit/encoding property, pause/resume property, step, stop, flow-control bound, throttling without busy-wait, isolation, protocol violations, watchdog with injected clock, snapshots, guard, contract, architecture) and `apps/web/e2e/` in three browsers (determinism, lifecycle, isolation, watchdog with a real infinite loop, performance).
