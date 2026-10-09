# Subtle Failure Modes and Edge Cases

A catalogue of the ways a deterministic simulator goes wrong quietly. Status: ✅ handled and tested · 🟡 handled, documented limitation · 🔜 belongs to a later checkpoint.

## A. Ordering and time

| # | Failure mode | Why it is subtle | Status / handling |
|---|---|---|---|
| A1 | **Heap instability.** Two events at the same time pop in arbitrary order. | Binary heaps are not stable. A comparator on `time` alone *appears* to work in small tests. | ✅ (time, seq) strict total order. Property test against a stable sort. |
| A2 | **Floating-point time.** `0.1 + 0.2 !== 0.3`; accumulated latencies drift; equal-looking times compare unequal. | Only shows up after many additions. | ✅ Integer ticks everywhere; validated at every boundary. |
| A3 | **Scheduling into the past.** | Would make the clock non-monotonic or reorder history. | ✅ Scheduler throws `EngineInvariantError`; protocol API rejects negative delays. |
| A4 | **Zero-delay livelock.** `setTimer(0)` or zero latency in a loop: time never advances. | `maxTime` doesn't help because time is stuck. | ✅ `maxEvents` still bounds it. |
| A5 | **Time overflow.** `now + delay` beyond 2⁵³ loses integer precision. | Unreachable in normal use. | 🟡 Delays capped at 2³¹; with default limits, max reachable time ≈ 2⁴⁷·⁶. The scheduler rejects unsafe integers as an invariant error. |
| A6 | **Off-by-one limits.** Is an event *at* `maxTime` processed? Is a run that ends exactly on `maxEvents` "quiescent"? | Ambiguity leads to different traces across versions. | ✅ Specified in [SEMANTICS §4](SEMANTICS.md) and tested at both edges. |
| A7 | **Start order vs. zero-latency messages.** Could n1's zero-latency message reach n2 before n2 has started? | Depends on scheduling order details. | ✅ All starts are scheduled first; FIFO ties guarantee starts precede deliveries. The engine asserts this as an invariant. |
| A8 | **Cancelled events counted as pending** (or as processed). | Breaks limits and quiescence detection. | ✅ Live set separate from heap; tests check `pendingCount`. |
| A9 | **Unbounded dead entries in the heap** from lazy cancellation. | Dead entries leave only at their scheduled time, so long timers that are reset often pile up (measured: 2 live events, 200 002 heap entries). | ✅ CP1: compaction when dead ≥ 1024 and dead > live ([ADR-0011](adr/0011-scheduler-heap-compaction.md)). Model-based property + regression tests. |
| A10 | **Faults and protocol events at the same tick.** Does a crash at t=10 beat a timer due at t=10? | Implicit answers differ between implementations. | ✅ Plan faults are scheduled before the run, so they precede runtime events at equal time; plan order among faults ([ADR-0009](adr/0009-fault-plan-as-input.md)). Tested for crash+timer, crash+recover+timer, crash+delivery, recover+delivery. |

## B. Messages, state, aliasing

| # | Failure mode | Status / handling |
|---|---|---|
| B1 | **Sender mutates a payload after `send()`**, so the receiver sees a different message than the one traced. | ✅ Payload copied and frozen at `send()` time. |
| B2 | **Receiver mutates a received payload or its own state in place**, corrupting history and making "state at time t" unrecoverable. | ✅ Deep freeze; mutation throws `TypeError` (recorded as `protocol.error`). |
| B3 | **Non-serialisable data** (Map, Date, class instance, `undefined`, NaN, cycles, getters, sparse arrays, `-0`). Traces and snapshots silently lose or change it. | ✅ Rejected with a path, except `-0`, which is normalised to `0`. |
| B4 | **Self-send semantics.** Should it be instantaneous, go through the network, or be forbidden? | ✅ Forbidden in CP0 (`ProtocolViolationError`). Revisit if a protocol needs it. |
| B5 | **Prototype pollution via `"__proto__"` keys** in payloads. | ✅ Copied with `defineProperty`; tested. |
| B6 | **Message to a crashed node.** | ✅ Traced `message.drop { reason: 'node-down', conditionIndex → node.crash }`. |
| B7 | **Stale timers after recovery.** A timer set before a crash fires after the node restarts and confuses the new incarnation. | ✅ A crash eagerly cancels all pending timers; dispatch asserts the incarnation as defence in depth. Property-tested with random crash/recover plans, including same-tick cases. |
| B8 | **Messages from a previous incarnation** arriving after recovery. | ✅ Delivered to the current incarnation by design (the network doesn't know about crashes). Protocols must tolerate them; documented in SEMANTICS §9. |
| B9 | **FIFO assumptions.** A protocol silently relies on in-order delivery, which random latency doesn't provide. | 🟡 Documented: links are not FIFO. An opt-in FIFO link model is a deferred feature. |
| B10 | **Partition semantics for messages in flight.** Do messages tunnel through a new partition? | ✅ Partitions are checked at send and at delivery; link conditions only at send ([ADR-0010](adr/0010-network-fault-semantics.md)). |
| B11 | **Lost durability.** Writes from a failed step persisted, or committed writes lost at a crash. | ✅ `sync-on-commit`: storage writes are part of the atomic step; crashes occur only between steps. Mutation-tested. |
| B12 | **Persist-after-send.** A node replies before its vote is durable; a crash right after would let it vote twice. | ✅ Commit order puts `storage.write` before the step's messages (persist-before-send). Since crashes are step-granular this is a modelling statement, made explicit in the trace. |
| B13 | **Silently ignored config typos** (`fault:` instead of `faults:`, `nodes` instead of `node`). | ✅ Unknown fields are rejected at every level of the config and fault plan. |

## C. Protocol execution

| # | Failure mode | Status / handling |
|---|---|---|
| C1 | **Handler throws halfway**, after sending some messages. A partially applied step is a state that never existed. | ✅ Effects buffered; a failed handler applies nothing. |
| C2 | **Context escapes its handler** (stored in a closure, used later): effects at the wrong time. | ✅ Context expires; use throws `ProtocolViolationError`. |
| C3 | **Handler never returns** (`while(true)`). | 🟡 Cannot be interrupted in-thread. CP5: the Worker has a wall-clock watchdog; the result is "aborted", explicitly *not* a reproducible outcome. |
| C4 | **Async handler.** A Promise returned as state. | ✅ Rejected (not a plain object). |
| C5 | **Protocol uses ambient nondeterminism** (`Math.random`, `Date`, module globals). | 🟡 Contract + documentation in CP0. CP5: stub `Math.random`/`Date` inside the worker to throw. CP10: real sandbox. |
| C6 | **Flood:** exponential message growth exhausts memory before `maxEvents` triggers. | ✅ `maxPendingEvents`, plus a per-handler effect cap. |
| C7 | **Error messages containing stack traces / paths**, making traces machine-specific. | ✅ Only `name: message` is recorded. |
| C8 | **Engine bugs swallowed as protocol errors.** | ✅ Only the handler call is wrapped in try/catch; `EngineInvariantError` from engine code propagates. |

## D. Randomness

| # | Failure mode | Status / handling |
|---|---|---|
| D1 | **Modulo bias** in `nextInt`. | ✅ Rejection sampling; exact-spec test and a large-range bias test (one that fails without rejection). |
| D2 | **All-zero xoshiro state** (generator outputs only zeros forever). | ✅ Impossible from `fromSeed` (proof in `random.ts`); `fromState` rejects it. |
| D3 | **Butterfly effect across consumers.** One extra draw by one node changes every later latency. | ✅ Independent streams per consumer. |
| D4 | **Stream label collision.** Two labels hash to the same 32-bit seed. | 🟡 Probability ≈ k²/2³³ for k streams (~10⁻⁴ for 1024 nodes). Acceptable; documented. Could move to a 64-bit derivation if it ever matters. |
| D5 | **`chance(p)` consuming a variable number of draws** depending on p, so changing a probability shifts the stream. | ✅ Always consumes exactly one draw. |

## E. Trace, replay and future snapshots

| # | Failure mode | Status / handling |
|---|---|---|
| E1 | **Trace entries mutated after the fact** (by UI code). | ✅ Entries frozen; `trace` getter returns a frozen copy. |
| E2 | **Snapshot misses execution-relevant state.** Restoring from it diverges. Classic misses: scheduler `nextSeq`, PRNG states, per-node counters, pending timer map, incarnations, storage, `crashedAt`, `stateEntry`, partition and link conditions, invariant history and open episodes. | ✅ CP3: all captured (ADR-0015); metamorphic property over random k, protocols and fault plans; 17 field-ablation mutants caught. |
| E7 | **Insertion order lost on restore.** Timer-map order decides `cancelledTimers`; link-map order decides `activeFaults.links`; storage order is visible in snapshots. | ✅ Stored as ordered arrays; mutants S2, S9, S13 caught (S13 needed a new multi-key test). |
| E8 | **Resuming "inside a step".** A UI cursor on entry #386 suggests execution could resume there. | ✅ Snapshots exist only at step boundaries (SEMANTICS §13); the TraceIndex inspects entries but never resumes. |
| E9 | **Keyframe bound measured in the wrong unit.** "Every K entries" is not resumable; "K steps" bounds steps, not entries. | ✅ Two named intervals (`keyframeSteps`, `checkpointEntries`) with separately tested bounds, including steps that emit hundreds of entries. |
| E10 | **Forged or corrupted snapshots.** | 🟡 Validated as untrusted (bounds, exact inputs, consistency, prefix kinds); 34 rejection tests. Not tamper-proof by design (documented). |
| E11 | **Snapshots silently retaining history.** | ✅ Measured: keyframes-only recording retains 2.1 MB at K = 1 024 vs. 78 MB for the trace. |
| E12 | **Index memory too large for the browser.** | 🟡 TraceIndex adds 64–83 MB to a 78 MB trace (PERF-3); seek outliers > 100 ms (PERF-4). Performance gate before CP5/CP6. |
| E3 | **Trace size.** Full-state `state.update` entries grow with state size × steps. | 🟡 Structural sharing makes in-memory cost proportional to *changes*. Serialised size is larger. CP9: chunking/diff encoding. |
| E6 | **Shallowly frozen trace entries.** Nested arrays (`cancelledTimers`) and objects (`run.start.protocol`) were mutable although the entry itself was frozen; the CP0/CP1 tests only checked `Object.isFrozen(entry)`. | ✅ Found in CP2 by a graph-walk test; `EventTrace.append` now deep-freezes. Regression test walks every entry of a fault-heavy run. |
| E4 | **Golden hash updated without a version bump.** | 🟡 Process rule in the golden test and [TEST_STRATEGY](TEST_STRATEGY.md). |
| E5 | **Cross-engine divergence** (V8 vs SpiderMonkey vs JavaScriptCore). | 🔜 CP5: Playwright runs the golden experiment in Chromium, Firefox and WebKit and compares fingerprints. |

## G. Invariant checking and exploration (CP2)

| # | Failure mode | Status / handling |
|---|---|---|
| G1 | **The checker changes what it checks** (mutating state, payloads, the trace, or its own inputs). | ✅ Deeply frozen view and step; history copied and frozen; a graph-walk test proves no mutable or engine object is reachable; 11 mutation attempts are each contained as `invariant.error` with an identical trace prefix. |
| G2 | **Startup false positives.** Before convergence every node may think it is leader, so "at most one leader" fails for a protocol that is fine. | ✅ Solved in the protocol, not by weakening the invariant: nodes may claim only after `timeout` ticks, by which time they have heard all live higher nodes. Tested over 200 seeds × 2 cluster sizes: first claim at t ≥ 60, only the highest node ever claims. |
| G3 | **Duplicate violations for one persistent failure.** | ✅ Episodes under `record-and-continue`; `maxViolations` bounds flapping. |
| G4 | **Ambiguous order when several invariants fail in one step.** | ✅ Configuration order, all recorded, errors outrank violations. |
| G5 | **Speculative explanations.** A record claiming "caused by the partition" when that is not provable from the trace. | ✅ The engine records facts only (trigger, step, state provenance, active faults). Inference is left to the UI, labelled as such. |
| G6 | **Volatile protocol knowledge that must be durable.** The first naive-leader draft kept its epoch in volatile state; after every node crashed, a later leader reused epoch 1. | ✅ Found by the crash/recover property test; the epoch is now persisted (like Raft's `currentTerm`); pinned as a regression test. |
| G7 | **Persistence without a quorum.** Even with persisted epochs, if the only node that knows the latest epoch is down, a new leader can reuse it. | 🟡 A genuine, documented weakness of the naive protocol (no network fault needed), demonstrated by a dedicated test. Raft's majority votes close it (CP4). |
| G8 | **Non-deterministic property tests.** fast-check picks a fresh random seed per run, so a suite can pass today and fail tomorrow. | ✅ Fixed global seed in `test/setup.ts`; random exploration is opt-in (`npm run test:explore`). |
| G9 | **Shrinking produces invalid or non-minimal plans.** | ✅ Arbitraries are valid by construction and shrinking stays inside them; every counterexample is re-validated with `resolveFaults`; a greedy pass guarantees 1-minimality, which tests verify independently. |
| G10 | **Stored counterexamples silently re-interpreted by a newer engine.** | ✅ The engine version is stored in each fixture; a mismatch fails the replay test with an explicit message. |
| G11 | **Runtime-verification overhead** large enough to discourage checking. | 🟡 Measured (TEST_STRATEGY, CP2). Optimisation candidates are recorded for CP9; nothing optimised yet. |

## F. Future UI-specific hazards (recorded now so the design respects them)

- **Animation driving simulation**: e.g. the next event fires "when the message animation arrives". Forbidden. The renderer reads the trace at a playback position. It never feeds back.
- **Interpolated positions mistaken for state**: a message drawn 60% along a link is a *visual* interpolation between `message.send.time` and `deliverAt`, not engine state.
- **Frame-rate-dependent playback**: playback position advances by `wallDelta × speed`; skipped frames skip pixels, never events.
- **Live-blur cost**: `backdrop-filter` over a continuously repainting canvas re-blurs every frame. See [DESIGN_DIRECTION §10](DESIGN_DIRECTION.md).
