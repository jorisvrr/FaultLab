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
| A7 | **Start order vs. zero-latency messages.** Could n1's zero-latency message reach n2 before n2 has started? | Depends on scheduling order details. | ✅ All starts are scheduled first; FIFO ties guarantee starts precede deliveries. CP0 asserts this as an invariant. |
| A8 | **Cancelled events counted as pending** (or as processed). | Breaks limits and quiescence detection. | ✅ Live set separate from heap; tests check `pendingCount`. |
| A9 | **Unbounded dead entries in the heap** from lazy cancellation. | Memory grows with cancel-heavy protocols (Raft resets election timers constantly). | 🔜 CP5: compact the heap when dead > live. Measure first. |

## B. Messages, state, aliasing

| # | Failure mode | Status / handling |
|---|---|---|
| B1 | **Sender mutates a payload after `send()`**, so the receiver sees a different message than the one traced. | ✅ Payload copied and frozen at `send()` time. |
| B2 | **Receiver mutates a received payload or its own state in place**, corrupting history and making "state at time t" unrecoverable. | ✅ Deep freeze; mutation throws `TypeError` (recorded as `protocol.error`). |
| B3 | **Non-serialisable data** (Map, Date, class instance, `undefined`, NaN, cycles, getters, sparse arrays, `-0`). Traces and snapshots silently lose or change it. | ✅ Rejected with a path, except `-0`, which is normalised to `0`. |
| B4 | **Self-send semantics.** Should it be instantaneous, go through the network, or be forbidden? | ✅ Forbidden in CP0 (`ProtocolViolationError`). Revisit if a protocol needs it. |
| B5 | **Prototype pollution via `"__proto__"` keys** in payloads. | ✅ Copied with `defineProperty`; tested. |
| B6 | **Message to a crashed node.** | 🔜 CP1: traced `message.drop { reason: 'node-down' }`. CP0 asserts it cannot happen. |
| B7 | **Stale timers after recovery.** A timer set before a crash fires after the node restarts and confuses the new incarnation. | 🔜 CP1: crash cancels all pending timers; incarnation numbers on timers and nodes. |
| B8 | **Messages from a previous incarnation** arriving after recovery. | 🔜 CP1: they are legitimately delivered (the network doesn't know about crashes). Protocols must tolerate them. Document per protocol. |
| B9 | **FIFO assumptions.** A protocol silently relies on in-order delivery, which CP0's random latency doesn't provide. | 🟡 Documented: links are not FIFO. CP2 may add an opt-in FIFO link model. |

## C. Protocol execution

| # | Failure mode | Status / handling |
|---|---|---|
| C1 | **Handler throws halfway**, after sending some messages. A partially applied step is a state that never existed. | ✅ Effects buffered; a failed handler applies nothing. |
| C2 | **Context escapes its handler** (stored in a closure, used later): effects at the wrong time. | ✅ Context expires; use throws `ProtocolViolationError`. |
| C3 | **Handler never returns** (`while(true)`). | 🟡 Cannot be interrupted in-thread. CP6: the Worker has a wall-clock watchdog; the result is "aborted", explicitly *not* a reproducible outcome. |
| C4 | **Async handler.** A Promise returned as state. | ✅ Rejected (not a plain object). |
| C5 | **Protocol uses ambient nondeterminism** (`Math.random`, `Date`, module globals). | 🟡 Contract + documentation in CP0. CP6: stub `Math.random`/`Date` inside the worker to throw. CP11: real sandbox. |
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
| E2 | **Snapshot misses execution-relevant state.** Restoring from it diverges. Classic misses: scheduler `nextSeq`, PRNG states, per-node counters, cancelled-but-in-heap events, pending timer map. | 🔜 CP4: snapshot = all of those. Metamorphic test: `run(N) ≡ restore(snapshot@k) + run(N−k)` for random k. |
| E3 | **Trace size.** Full-state `state.update` entries grow with state size × steps. | 🟡 Structural sharing makes in-memory cost proportional to *changes*. Serialised size is larger. CP10: chunking/diff encoding. |
| E4 | **Golden hash updated without a version bump.** | 🟡 Process rule in the golden test and [TEST_STRATEGY](TEST_STRATEGY.md). |
| E5 | **Cross-engine divergence** (V8 vs SpiderMonkey vs JavaScriptCore). | 🔜 CP6: Playwright runs the golden experiment in Chromium, Firefox and WebKit and compares fingerprints. |

## F. Future UI-specific hazards (recorded now so the design respects them)

- **Animation driving simulation**: e.g. the next event fires "when the message animation arrives". Forbidden. The renderer reads the trace at a playback position. It never feeds back.
- **Interpolated positions mistaken for state**: a message drawn 60% along a link is a *visual* interpolation between `message.send.time` and `deliverAt`, not engine state.
- **Frame-rate-dependent playback**: playback position advances by `wallDelta × speed`; skipped frames skip pixels, never events.
- **Live-blur cost**: `backdrop-filter` over a continuously repainting canvas re-blurs every frame. See [DESIGN_DIRECTION §10](DESIGN_DIRECTION.md).
