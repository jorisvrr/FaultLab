# ADR-0012: Invariant model — pure online checkers with explicit history

**Status:** Accepted (CP2)

**Problem.** FaultLab must detect when a protocol breaks a safety property, *while* the simulation runs. A run can then stop at the first violation and keep the exact history that led to it. Checking must never change the run it checks. Some properties are about the current state ("at most one leader now"); others are about history ("at most one leader per epoch, ever"), so the checker has to remember something. That memory must be explicit, so it can be serialised and snapshotted (CP3).

**Decision.** An invariant is trusted, synchronous, deterministic code:

```ts
interface Invariant<H extends JsonValue = null> {
  id: string;           // stable machine id, e.g. "single-leader"
  version: string;      // bump when the rule or its history format changes
  name: string;         // human-readable
  initialHistory: H;    // explicit, JSON, versioned with `version`
  check(input: { view, step, history: H }): { ok: true, history? } | { ok: false, history?, violation: report }
}
```

- **Online, after every successfully committed step** (handler steps, fault steps and drop-only steps alike), in **configuration order**. Steps that end in a protocol error are not checked, because the run stops there anyway.
- **Input:** a read-only `SimulationView` (time, event number, nodes with status, incarnation, state and storage, messages in flight, active network conditions) plus the step's own trace entries.
- **Runtime immutability, not just `readonly` types.** Everything reachable from the view is deeply frozen. Node states and payloads already are (ADR-0006). Storage and in-flight records are frozen copies built lazily per step, and the view exposes no engine objects (no `Map`, no `NodeRuntime`). A test walks the entire reachable object graph and asserts this.
- **History** is a JSON value owned by the engine, passed in and returned by `check`, validated and frozen with `toFrozenJson`. The engine stores one history per invariant; that store is part of the execution state that CP3 snapshots must capture.
- **Determinism rules** are the same as for protocols: no `Math.random`, no `Date`, no I/O, no module-level mutable state. Invariants are recorded in `run.start` by id, version and name.
- **Liveness is out of scope** (CP4). The model leaves room for it: a future `deadline` hook can be added without changing `check`.

**Alternatives.**
- *Offline checking over the finished trace:* zero runtime cost when unused, but it cannot stop a run at the first violation, which wastes time in exploration and gives the UI no "halt on violation". The trace oracle in tests remains an offline checker, and both co-exist.
- *Stateless predicates only:* simpler, but they cannot express historical properties such as per-epoch uniqueness without smuggling state into module variables, which breaks determinism and snapshots.
- *Invariants reading `Simulation` directly:* convenient, but they could mutate engine state.

**Trade-off.** Online checking costs time on every step (measured in TEST_STRATEGY). Building views lazily keeps unused parts free.

**Invariant (of the checker itself).** Evaluating invariants never changes the trace up to the evaluation point, never changes node state, storage, PRNG streams or the scheduler, and gives the same verdicts on every replay.

**Tested by.** `test/invariants-engine.test.ts`: deep-freeze graph walk, mutation attempts contained as `invariant.error`, identical traces with and without benign invariants (apart from `run.start` metadata), history round-trip and validation.
