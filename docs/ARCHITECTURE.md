# Architecture

> Status: CP0. This document describes what exists **and** the planned shape, and marks which is which.

## 1. Goals that shape the architecture

1. **Determinism.** Same inputs + same engine version + same protocol version ⇒ byte-identical trace. Everything else (replay, time travel, shareable experiments, bug reproduction) is built on this.
2. **Engine independence.** The simulation engine is a plain TypeScript library with zero runtime dependencies. It knows nothing about React, the DOM, Workers, or rendering.
3. **Observability by construction.** Every observable thing that happens is an entry in an append-only trace. The UI is a *view of the trace*, never a second source of truth.
4. **No backend.** Everything runs in the browser. Persistence (later) is IndexedDB; sharing (later) is "share the inputs, re-run deterministically".

## 2. System layers

```
┌───────────────────────────────────────────────────────────────────────────┐
│ apps/web  (CP6+)   React + Vite                                           │
│   UI state: selection, panels, playback position, theme, layout          │
│   Renderers: graph, timeline, trace table, inspector                      │
│        ▲ trace chunks, run status            │ commands (run, step, …)    │
│        │ (structured-clone messages,         ▼  validated at boundary)    │
│ ┌──────┴──────────────────────────────────────────────────────────────┐  │
│ │ Web Worker (CP6+): owns one Simulation; streams trace entries      │  │
│ └──────┬──────────────────────────────────────────────────────────────┘  │
└────────┼──────────────────────────────────────────────────────────────────┘
         │ plain function calls
┌────────▼──────────────────────────────────────────────────────────────────┐
│ packages/engine  (CP0 ✅)   @faultlab/engine — no DOM, no Node, no deps   │
│                                                                           │
│   Simulation ──► EventScheduler ──► BinaryHeap        VirtualClock        │
│      │   │            (time, seq) total order                             │
│      │   └──► VirtualNetwork ──► RandomSource (stream "network")          │
│      ├──► NodeRuntime × N ──► Protocol handlers (RandomSource "node:<id>")│
│      ├──► EventTrace (append-only, frozen entries, causal links)          │
│      └──► resolveConfig (trust boundary)   toFrozenJson (trust boundary)  │
│                                                                           │
│   later: FaultPlan (CP1–2) · InvariantChecker (CP3) · Snapshot (CP4)      │
└───────────────────────────────────────────────────────────────────────────┘
```

**Simulation state** (lives only in the engine, determines outcomes): scheduler queue and sequence counter, virtual clock, PRNG states, node states/timers/counters, trace.

**UI state** (lives only in the app, never influences outcomes): selection, panel layout, playback position and speed, theme, animation progress, camera.

The only way UI influences a simulation is by **constructing a new configuration** (seed, nodes, protocol, network, faults, limits) or **issuing commands** (`step`, `run`). Both are inputs recorded in `run.start` (CP0) or in the fault plan (CP1+). Playback speed, frame rate, and rendering never reach the engine.

## 3. Module map (`packages/engine/src`)

The brief proposed eleven candidate modules. They are **files with clear responsibilities inside one package**, not eleven packages: the package boundary that matters (engine vs. UI) is enforced; finer boundaries would add build ceremony without catching real bugs. See [ADR-0001](adr/0001-repository-layout.md).

| Candidate module | Where it lives | Status |
|---|---|---|
| simulation-core | `simulation.ts` — main loop, dispatch, handler contexts, effect application | CP0 ✅ |
| event-scheduler | `scheduler.ts` (ordering, cancellation) on `priority-queue.ts` (binary heap) | CP0 ✅ |
| virtual-clock | `time.ts` — `VirtualTime`, `VirtualClock` (owned by the scheduler) | CP0 ✅ |
| seeded-random | `random.ts` — xoshiro128\*\*, SplitMix32 seeding, named streams | CP0 ✅ |
| virtual-network | `network.ts` — latency model; drops/partitions in CP2 | CP0 (latency only) |
| node-runtime | `NodeRuntime` inside `simulation.ts`; extracted when crash/recovery lands | CP0 (start only), CP1 |
| protocol-api | `protocol.ts` — `Protocol`, `NodeContext`, message/timer types | CP0 ✅ |
| fault-injection | `faults.ts` — scheduled `FaultPlan` as data | CP1–CP2 |
| event-trace | `trace.ts` — entry types, append-only `EventTrace`, canonical serialisation | CP0 ✅ |
| invariant-checker | `invariants.ts` — predicates over global state after each step | CP3 |
| test-fixtures | `fixtures/` — `createPingProtocol`, `echoForever` (exported as `@faultlab/engine/fixtures`) | CP0 ✅ |
| *(added)* trust boundaries | `config.ts` (config validation), `json.ts` (payload/state validation + freezing) | CP0 ✅ |

## 4. Data flow of one step

```
step():
  1. peek next live event          ── quiescent? event limit? time limit? → stop
  2. pop it; clock := event.time   ── clock is monotonic by construction
  3. append trace entry for the event (node.start | message.deliver | timer.fire)
  4. run the protocol handler with a fresh NodeContext
       handler calls ctx.send / setTimer / cancelTimer → effects are BUFFERED
       handler returns new state → validated + deep-frozen
       handler throws → protocol.error entry, nothing applied, run stops
  5. apply buffered effects in call order:
       send       → network.route() draws latency → message.send entry → schedule deliver
       setTimer   → timer.set entry → schedule fire
       cancelTimer→ cancel in scheduler → timer.cancel entry (only if it was pending)
  6. if state changed (reference inequality) → state.update entry
  7. pending events > maxPendingEvents? → stop
```

## 5. Planned boundaries (not built yet)

- **Worker protocol (CP6).** Versioned discriminated-union messages in both directions, validated on receipt. The worker streams trace entries in chunks; the UI keeps an index of them. The worker never receives UI state.
- **Experiment format (CP8).** `{ formatVersion, engineVersion, protocol: {name, version}, config, faultPlan }`. Traces are *not* the shared artefact; inputs are. A trace is re-derived and its fingerprint compared with the stored one to detect engine/protocol drift.
- **Protocol view adapters (CP5+).** A protocol may export a pure `describe(state) → { role, term, label }` used only by the UI, keeping visual concerns out of the engine and out of protocol logic.
- **User-supplied protocols (CP11).** Requires its own security architecture ADR (sandboxing, resource limits, determinism guards). Not before.

## 6. Architecture decision records

See [docs/adr/](adr/README.md). Every significant decision records problem, decision, alternatives, trade-off, invariant, and how it is tested.
