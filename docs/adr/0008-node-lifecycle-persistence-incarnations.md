# ADR-0008: Node lifecycle, persistence model and incarnations

**Status:** Accepted (CP1)

**Problem.** "Crash" is only a meaningful model of a real machine if we say exactly what survives it. If too much survives, protocols look correct while real ones would lose data. If too little survives, nothing can recover. Timers set before a crash must also never fire into the restarted node, even when a crash and a timer fall on the same tick.

**Decision.** Node data is split into four categories with explicit crash behaviour:

| Category | Contents | On crash | On recovery |
|---|---|---|---|
| Volatile protocol state | `state` returned by handlers | **Discarded** | Rebuilt by `init(ctx)` |
| Persistent protocol state | `ctx.storage` (string → JSON) | **Kept** | Readable from `init` onward |
| Node runtime state | status, incarnation, pending timers | Status → `crashed`; all pending timers cancelled | Status → `running`; incarnation + 1 |
| Simulation infrastructure | scheduler, clock, network, PRNG streams, id counters, trace | Unaffected | Unaffected |

**Persistence semantics: `sync-on-commit`.** Storage writes made during a handler are buffered with its other effects. They become durable atomically when the step commits, and are traced *before* that step's outgoing messages (persist-before-send). Crashes happen only *between* steps, so a node never loses a committed write and never persists a write from a failed step. Reads see the handler's own uncommitted writes.

**Incarnations.** A node's incarnation is 0 before it starts, 1 after its first start, and increases by 1 on every recovery. Every timer records the incarnation that set it. A crash cancels all the node's pending timers **eagerly**, and timer dispatch **asserts** that the timer's incarnation equals the node's current one (`EngineInvariantError` otherwise). The first mechanism is the guarantee; the second turns any future regression into a loud failure instead of a silent wrong trace.

**Alternatives.**
- *Explicit `sync()` / write-back persistence:* models lost un-synced writes (a real source of consensus bugs). Rejected for now because step-level atomicity already gives a clean model; recorded as a candidate `persistence` mode (the trace already records `persistence: 'sync-on-commit'` so a second mode can be added compatibly).
- *Incarnation check only at dispatch* (no eager cancel): correct, but leaves dead timers in the queue and makes `pendingEvents` lie.
- *Exposing the incarnation to protocols:* convenient, but real machines don't receive a boot counter from the universe. Protocols that need one persist it in storage (the heartbeat fixture does exactly that).
- *Resetting the node's PRNG stream on recovery:* the restarted node would replay its old "random" choices, an unrealistic correlation. The stream continues.

**Trade-off.** Crash granularity is a whole step: a crash can't interrupt a handler halfway. That matches the atomic-step model (ADR-0005), and it is the standard model in simulation testing.

**Invariant.** A crashed node executes no handler, fires no timer, sends no message, and changes no state or storage. No timer ever fires in an incarnation other than the one that set it. Committed storage survives every crash.

**Tested by.** `test/lifecycle.test.ts`, plus a trace-level lifecycle invariant checker (`test/invariants.ts`) applied to fast-check–generated fault plans in `test/faults.property.test.ts`.
