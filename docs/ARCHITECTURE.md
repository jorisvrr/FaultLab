# Architecture

> Status: CP3. This document describes what exists **and** the planned shape, and marks which is which.

## 1. Goals that shape the architecture

1. **Determinism.** Same inputs + same engine version + same protocol version ⇒ byte-identical trace. Everything else (replay, time travel, shareable experiments, bug reproduction) is built on this.
2. **Engine independence.** The simulation engine is a plain TypeScript library with zero runtime dependencies. It knows nothing about React, the DOM, Workers, or rendering.
3. **Observability by construction.** Every observable thing that happens is an entry in an append-only trace. The UI is a *view of the trace*, never a second source of truth.
4. **No backend.** Everything runs in the browser. Persistence (later) is IndexedDB; sharing (later) is "share the inputs, re-run deterministically".

## 2. System layers

```
┌───────────────────────────────────────────────────────────────────────────┐
│ apps/web  (CP5 ✅ foundation; visuals CP6)   React 19 + Vite, MAIN THREAD │
│   features: Configure │ Simulate │ Investigate · docked PlaybackBar       │
│   Session (framework-free): RuntimeClient + TraceStore + cursor/follow    │
│   TraceStore: incremental TraceIndex (@faultlab/trace) · frames per cursor│
│   React reads Session via useSyncExternalStore, ≤ 1 render per frame      │
│        ▲ chunk(seq, from, to) · status · finished(fingerprint)            │
│        │                       │ load(spec) · run · pause · step · stop · │
│        │  faultlab-worker/1    ▼ credit · snapshot   (runId on every msg) │
│ ┌──────┴──────────────────────────────────────────────────────────────┐  │
│ │ Web Worker, one per run (@faultlab/runtime WorkerCore):             │  │
│ │   resolveExperiment(spec) via @faultlab/experiments registry        │  │
│ │   time-sliced Simulation (whole steps; 8 ms budget) · keyframes     │  │
│ │   determinism guard per slice · releases sent entries · fingerprint │  │
│ └──────┬──────────────────────────────────────────────────────────────┘  │
│        │ main thread: watchdog terminates a silent Worker (→ aborted)    │
└────────┼──────────────────────────────────────────────────────────────────┘
         │ plain function calls
┌────────▼──────────────────────────────────────────────────────────────────┐
│ packages/engine  (CP4 ✅)   @faultlab/engine — no DOM, no Node, no deps   │
│                                                                           │
│   Simulation ──► EventScheduler ──► BinaryHeap        VirtualClock        │
│      │   │       (time, seq) order; compaction                            │
│      │   └──► VirtualNetwork: latency, partitions, directed link faults   │
│      │              └──► RandomSource (stream "network")                  │
│      ├──► NodeRuntime × N: lifecycle, incarnation, timers, storage        │
│      │      └──► NodeContext (buffered effects + storage) ──► Protocol    │
│      ├──► Fault plan (data, scheduled up front) ──► fault dispatch        │
│      ├──► EventTrace (append-only, deep-frozen entries, causal links)     │
│      ├──► InvariantMonitor ◄── frozen SimulationView + StepInfo (per step)│
│      │      └──► invariant.violation / .cleared / .error entries          │
│      ├──► in-flight message index (send order)                            │
│      └──► resolveConfig / resolveFaults / resolveInvariants / toFrozenJson│
│                                                                           │
│      ├──► snapshot() / restore() (step boundaries, validated JSON)        │
│      └──► TimeTravel: keyframes every K steps, seek, regenerate segments  │
│      └──► bounded liveness (CP4): checks after invariants, real deadline  │
│            events in the scheduler, liveness.* entries (never safety)     │
├───────────────────────────────────────────────────────────────────────────┤
│ packages/protocols (CP4 ✅) @faultlab/protocols — engine TYPES only       │
│   Raft election (Figure 2) + 6 broken variants · 5 historical Raft        │
│   invariants · raftLeaderLiveness (healthy-group assumption, D = test     │
│   bound) — plain Protocol / Invariant / LivenessCheck values              │
├───────────────────────────────────────────────────────────────────────────┤
│ packages/trace   (CP3 ✅)   @faultlab/trace — engine TYPES only, no deps  │
│   TraceIndex: checkpoints every C entries, frames, steps, markers, causes │
└───────────────────────────────────────────────────────────────────────────┘
```

**Simulation state** (lives only in the engine, determines outcomes): scheduler queue and sequence counter, virtual clock, PRNG states, network conditions (partition, link faults), node runtimes (status, incarnation, timers, volatile state, persistent storage, id counters), trace.

**UI state** (lives only in the app, never influences outcomes): selection, panel layout, playback position and speed, theme, animation progress, camera.

The only way UI influences a simulation is by **constructing a new configuration** (seed, nodes, protocol, network, faults, limits) or **issuing commands** (`step`, `run`). Both are inputs recorded in `run.start` (CP0) or in the fault plan (CP1+). Playback speed, frame rate, and rendering never reach the engine.

## 3. Module map (`packages/engine/src`)

The brief proposed eleven candidate modules. They are **files with clear responsibilities inside one package**, not eleven packages: the package boundary that matters (engine vs. UI) is enforced; finer boundaries would add build ceremony without catching real bugs. See [ADR-0001](adr/0001-repository-layout.md).

| Candidate module | Where it lives | Status |
|---|---|---|
| simulation-core | `simulation.ts` — main loop, event and fault dispatch, commit of storage and effects | CP0 ✅, CP1 ✅ |
| event-scheduler | `scheduler.ts` (ordering, cancellation, compaction) on `priority-queue.ts` (binary heap, Floyd heapify) | CP0 ✅, CP1 ✅ |
| virtual-clock | `time.ts` — `VirtualTime`, `VirtualClock` (owned by the scheduler) | CP0 ✅ |
| seeded-random | `random.ts` — xoshiro128\*\*, SplitMix32 seeding, named streams | CP0 ✅ |
| virtual-network | `network.ts` — base latency, partitions (checked at send and delivery), directed link loss/delay | CP0 ✅, CP1 ✅ |
| node-runtime | `node.ts` — `NodeRuntime`: lifecycle, incarnation, timers, volatile state, persistent storage | CP1 ✅ |
| protocol-api | `protocol.ts` (types incl. `NodeStorage`) and `context.ts` (per-handler context, effect buffer, storage overlay) | CP0 ✅, CP1 ✅ |
| fault-injection | `faults.ts` — fault plan types, validation and normalisation; applied by `simulation.ts` | CP1 ✅ |
| event-trace | `trace.ts` — entry types, append-only `EventTrace`, canonical serialisation | CP0 ✅ |
| invariant-checker | `invariants.ts` — `Invariant` contract, validation, `InvariantMonitor` (history, episodes, policies); the frozen view is built in `simulation.ts` | CP2 ✅ |
| test-fixtures | `fixtures/` — `createPingProtocol`, `echoForever`, `createHeartbeatProtocol`, `createNaiveLeaderProtocol` + its five invariants (exported as `@faultlab/engine/fixtures`) | CP0 ✅, CP1 ✅, CP2 ✅ |
| *(added)* trust boundaries | `config.ts`, `faults.ts`, `validation.ts` (config/fault validation), `json.ts` (payload/state validation + freezing) | CP0 ✅, CP1 ✅ |

**Separation of concerns in CP2.** Invariants observe; they cannot act. They receive a deeply frozen view and the step's frozen entries, and their only outputs are a verdict and their own JSON history, both validated by the engine. Fault exploration and shrinking live in test code (`test/explore.ts`), so the engine gains no dependency.

**Separation of concerns in CP1.** Protocols cannot inject faults: there is no API for it. Faults enter only through the configuration. The network knows partitions and link conditions but not node lifecycles. `NodeRuntime` knows lifecycles but not the network. The trace records both, and the future UI reads only the trace.

## 4. Data flow of one step

```
step():
  1. peek next live event          ── quiescent? event limit? time limit? → stop
  2. pop it; clock := event.time   ── clock is monotonic by construction
  3. fault event?  → apply it (crash / recover / partition / heal / link / link-restore), one trace
                     entry; a recovery then continues with step 5 for `init`
     delivery?     → partition now separates the pair? → message.drop (in flight)
                     receiver crashed?                  → message.drop (node-down)
     timer?        → assert the node runs in the timer's incarnation
  4. append the trace entry for the event (node.start | message.deliver | timer.fire | node.recover)
  5. run the protocol handler with a fresh NodeContext
       ctx.send / setTimer / cancelTimer / storage.set|delete → BUFFERED
       handler returns new state → validated + deep-frozen
       handler throws → protocol.error entry, nothing applied, run stops
  6. commit: storage.write entry (durable first)
  7. apply buffered effects in call order:
       send       → network.route(): partition? loss? latency → message.send (+ message.drop) → schedule deliver
       setTimer   → timer.set entry → schedule fire (tagged with the incarnation)
       cancelTimer→ cancel in scheduler (may compact) → timer.cancel entry (only if it was pending)
  8. if state changed (reference inequality) → state.update entry
  9. invariants (if configured): build the frozen view, evaluate in config order,
     append violation / cleared / error entries → stop if required (ADR-0013)
 10. pending events > maxPendingEvents? → stop
```

## 4.0 CP3: four separate concerns

| Concern | Where | Knows about |
|---|---|---|
| Simulation execution | `Simulation.step()` | config, protocol, faults, invariants, liveness checks |
| Protocols and their checks (CP4) | `@faultlab/protocols` | engine **types** only; runs inside the engine's step |
| Engine snapshots and time travel | `snapshot.ts`, `time-travel.ts` | execution state at **step boundaries** |
| Trace reconstruction | `@faultlab/trace` (`TraceIndex`) | a completed trace only; any **entry** |
| Frontend rendering | `apps/demo` (later `apps/web`) | TraceIndex frames; never engine internals |

## 4.0.1 CP5: execution in a Worker, reconstruction on the main thread

| Concern | Where (CP5) | Thread |
|---|---|---|
| Experiment description | `@faultlab/experiments`: JSON `ExperimentSpec`, versioned registry, presets (ADR-0021) | both |
| Simulation execution | `@faultlab/runtime` `WorkerCore` → engine `Simulation` (ADR-0022) | Worker |
| Messaging, lifecycle, flow control, watchdog | `@faultlab/runtime` contract + `RuntimeClient` | both |
| Trace reconstruction | `@faultlab/trace` incremental `TraceIndex` (ADR-0023) | main |
| State inspection | `apps/web` `Session`, `useFrame` | main |
| Rendering and animation | `apps/web` components (minimal in CP5; CP6 visual system) | main |

Package dependencies (runtime): `engine` ← `protocols` ← `experiments` ← `runtime` ← `web`; `trace` uses engine types only. No package below `web` imports React (architecture test).

## 4.1 CP2.5 prototype viewer (`apps/demo`)

A throwaway check that the engine works outside tests. Since CP3 its `derive.ts` is a thin adapter over `@faultlab/trace`. It imports `@faultlab/engine` unchanged, **executes** a bounded experiment synchronously, and then **replays** the finished trace: the view is a pure function of (trace, cursor, display time) computed by `derive.ts`, which has no framework or DOM dependency. No engine internals are read; anything not derivable from the trace is not shown. The real UI (CP5/CP6) replaces everything here except, likely, `derive.ts`.

## 5. Planned boundaries (not built yet)

- **Worker protocol (CP5): built**, see ADR-0022 and SEMANTICS §19.
- **Experiment format (CP7).** `{ formatVersion, engineVersion, protocol: {name, version}, config }`, where the config already contains the fault plan. Traces are *not* the shared artefact; inputs are. A trace is re-derived and its fingerprint compared with the stored one to detect engine/protocol drift.
- **Protocol view adapters (CP5+).** A protocol may export a pure `describe(state) → { role, term, label }` used only by the UI, keeping visual concerns out of the engine and out of protocol logic. CP4's comparison harness already uses the minimal form of this ("is this node leader, in which term?") for both protocols; the Raft data a UI needs is listed in [UI_REQUIREMENTS](UI_REQUIREMENTS.md#raft-visualisation-data-cp4--cp5cp6).
- **User-supplied protocols (CP10).** Requires its own security architecture ADR (sandboxing, resource limits, determinism guards). Not before.

## 6. Architecture decision records

See [docs/adr/](adr/README.md). Every significant decision records problem, decision, alternatives, trade-off, invariant, and how it is tested.
