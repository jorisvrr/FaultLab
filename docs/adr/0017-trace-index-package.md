# ADR-0017: TraceIndex as a separate, read-only observer package (`@faultlab/trace`)

**Status:** Accepted (CP3)

**Problem.** A UI must show the state at any trace entry, navigate steps, markers and causal links, and do so fast on long traces. CP2.5's prototype rescanned from entry #0 on every frame.

**Decision.** A new package `@faultlab/trace` containing `TraceIndex`. It imports only engine **types**, has no runtime dependencies and no DOM/Node libs, and never executes or modifies a simulation.

- **Checkpointed reconstruction:** while indexing, the observable state *before* every `checkpointEntries`-th entry is stored (unit: **trace entries**). `frameAt(i)` clones the nearest checkpoint ≤ i and applies at most `checkpointEntries − 1` further entries (verified via `lastFrameCost`, including traces whose steps contain hundreds of entries). Frames are deeply frozen and share states/payloads with the trace.
- **Frame contents:** per node status, incarnation, volatile state and its source entry, storage, pending timers; messages in flight (with display-only linear progress); recent drops; partition; link conditions; open violations; the entry's step.
- **Steps:** derived from trigger entry kinds (SEMANTICS §13); verified against the engine's actual `step()` calls.
- **Markers:** crash, recover, partition, heal, link fault/restore, skipped fault, violation, cleared, invariant error, protocol error, run end; each points at its exact entry.
- **Causality:** `causeOf`, `ancestors` (back to `run.start`), `consequences` (direct children by `cause`, and drops explained by `conditionIndex`), `descendants`.

**Not reconstructed (not in the trace):** PRNG states, scheduler sequence numbers and queue layout, invariant histories, and node id counters as such. Those require an engine snapshot. The index rejects incomplete traces (segments or gaps) rather than guessing.

**Alternatives.**
- *Inside the engine package:* convenient, but mixes observing with executing, and would let a UI depend on engine internals.
- *Event-sourced persistent maps (HAMT) instead of checkpoints:* O(log n) per change and no re-application, but a dependency or a large amount of code. Checkpoints measured sufficient.
- *Snapshots for UI scrubbing:* a re-execution per scrub; unnecessary for completed traces.

**Invariant.** `frameAt(i)` equals the engine's authoritative state after the step that produced entry i (tested after every step), independent of `checkpointEntries`, and equal to a full scan.

**Tested by.** `packages/trace/test/trace-index.test.ts` (engine cross-check after every step over random experiments × intervals; interval independence; cost bound under burst steps; step boundaries vs. real `step()` calls; markers; inverse causality; frozen frames; rejection of incomplete traces; counterexamples) and `architecture.test.ts`. The CP2.5 demo now uses it (unchanged UI; its unit and Playwright tests pass).
