# Simulation Semantics: Types, Event Contracts, Scheduler

This is the specification of what the engine does. Where the code and this document disagree, one of them has a bug. Tests live in `packages/engine/test/`; [TEST_STRATEGY.md](TEST_STRATEGY.md) maps rules to tests.

## 1. Core types

| Type | Definition | Why |
|---|---|---|
| `VirtualTime` | Non-negative safe integer number of **ticks** since run start. Convention: 1 tick = 1 ms. | Integer arithmetic is exact, so time can't drift and no comparison is ambiguous. [ADR-0002](adr/0002-integer-virtual-time.md) |
| `Duration` | Non-negative safe integer number of ticks; latencies and timer delays ≤ `MAX_DELAY` = 2³¹. | Keeps `now + delay` far from 2⁵³. |
| `NodeId` | String matching `[A-Za-z0-9][A-Za-z0-9_-]{0,31}`. | Readable, and leaves `:` (namespaced ids) and `>` (link keys) free. |
| `MessageId` | `"<sender>:m<k>"`, the k-th message that sender sent. | Per-node counters: adding a message on n1 does not renumber n2's messages, which keeps trace diffs local. |
| `TimerId` | `"<owner>:t<k>"`. | Same reasoning. |
| `EventSeq` | Integer assigned by the scheduler at scheduling time, strictly increasing. | Tie-breaker that makes ordering total. |
| `Incarnation` | Integer per node: 0 before start, 1 after the first start, +1 per recovery. | Distinguishes the "lives" of a node; stale timers can never cross it. [ADR-0008](adr/0008-node-lifecycle-persistence-incarnations.md) |
| `FaultId` | `"f<k>"`, the k-th fault in the plan. | Links every fault entry back to its plan item. |
| `JsonValue` | `null | boolean | finite number | string | JsonValue[] | {[k]: JsonValue}` | Everything protocol-visible must be serialisable into traces and snapshots. [ADR-0006](adr/0006-json-payloads-validate-copy-freeze.md) |

### 1.1 Configuration (`SimulationConfig`, validated by `resolveConfig`)

```ts
{
  seed: number;                      // integer in [0, 2^32)
  nodes: NodeId[];                   // 1..1024 unique ids; order is meaningful
  protocol: Protocol<S, M>;          // name, version, init, onMessage, onTimer
  network: { latency: { min, max } } // 0 <= min <= max <= 2^31, integers
  limits?: { maxEvents?, maxTime?, maxPendingEvents? }
  faults?: FaultSpec[]               // the fault plan (§8), up to 10 000 entries
  invariants?: Invariant[]           // safety checkers (§10), up to 64, evaluated in this order
  invariantPolicy?: 'stop-on-first' | 'record-and-continue'   // default 'stop-on-first'
}
```

Defaults: `maxEvents = 100 000`, `maxTime = null` (none), `maxPendingEvents = 100 000`, `maxViolations = 100`, `faults = []`, `invariants = []`. Node order determines start order, `ctx.peers` order and `broadcast` order. Invalid input throws `ConfigError` with a path (`"network.latency.max"`, `"faults[3].groups[0][1]"`) **before** anything runs. Unknown fields are rejected at every level, so a typo can't be silently ignored. Node starts plus plan faults must fit in `maxPendingEvents`.

### 1.2 Protocol API

```ts
interface Protocol<S extends JsonValue, M extends JsonValue> {
  name: string;
  version: string;                           // bump on behaviour change
  init(ctx): S;                              // on node start AND on recovery
  onMessage(state: S, message, ctx): S;      // message = { id, from, sentAt, payload: M }
  onTimer(state: S, timer, ctx): S;          // timer   = { id, tag, setAt }
}

interface NodeContext<M> {
  self: NodeId; now: VirtualTime; peers: readonly NodeId[];
  random: RandomSource;                      // this node's own stream
  storage: NodeStorage;                      // get / set / delete / keys: survives crashes (§7)
  send(to, payload: M): MessageId;
  broadcast(payload: M): MessageId[];
  setTimer(delay: Duration, tag: string): TimerId;
  cancelTimer(id: TimerId): void;
}
```

Contract for protocol authors:

1. **Handlers are synchronous and deterministic.** No `Math.random`, `Date`, real timers, I/O, `async`, or module-level mutable state.
2. **State is immutable.** The state passed in is deeply frozen; return a new object to change it, or the same object to leave it unchanged. Returned state is validated as JSON and frozen. Unchanged parts are reused without copying.
3. **Effects are buffered.** `send`/`setTimer`/`cancelTimer` and storage writes take effect only after the handler returns successfully. A handler that throws has no effects. Each handler may buffer at most `maxPendingEvents` effects.
4. **A context expires** when its handler returns. Any later use throws `ProtocolViolationError`.
5. **Self-sends are rejected.** A node's local logic should not cross the network. ([FAILURE_MODES §B4](FAILURE_MODES.md))
6. Declare `S` and `M` with `type` aliases, not `interface`s (TypeScript interfaces lack the index signature `JsonValue` requires).

## 2. Scheduler semantics

### 2.1 The ordering rule

> Events are dispatched in increasing order of **(time, seq)**, where `seq` is the order in which they were scheduled.

`seq` is unique, so this is a **strict total order**. Given the same sequence of `schedule` calls, there is exactly one dispatch order. That holds even though the binary heap underneath is not stable. ([ADR-0003](adr/0003-scheduler-total-order.md))

**"Simultaneous" events** (same `time`) run in FIFO order of scheduling. The scheduling order is itself deterministic because it is produced by earlier deterministic dispatches. Concretely:

- All `node.start` events are scheduled first (in config order) at t=0, so every node starts before anything else happens, even a zero-latency message or a fault at t=0.
- Plan faults are scheduled next, in plan order. **At equal time, faults precede every event scheduled during the run** (deliveries, timers), because those always get higher sequence numbers ([ADR-0009](adr/0009-fault-plan-as-input.md)).
- Messages sent in one handler are scheduled in call order; with equal latency they arrive in that order.
- An event scheduled at the *current* time (zero-latency send, `setTimer(0)`) runs after all events already queued for that time.

### 2.2 Clock

The clock is owned by the scheduler and advances only when an event is dispatched, to exactly that event's time. Scheduling before `now` is an engine invariant violation (`EngineInvariantError`), which can only be reached through an engine bug because protocol-facing APIs reject negative delays.

### 2.3 Cancellation

Lazy: a cancelled event stays in the heap but is removed from the live set and skipped when it surfaces. `pendingCount` counts only live events. Cancelling an event that already ran or was already cancelled returns `false` and does nothing.

**Compaction** ([ADR-0011](adr/0011-scheduler-heap-compaction.md)): when dead entries reach 1024 *and* outnumber live ones, the heap is filtered down to live entries and rebuilt with Floyd's heapify. Afterwards `heapEntries ≤ 2·live + 1024`. Dispatch order is unaffected.

### 2.4 Complexity

`schedule`: O(log n). `next`: O(log n) amortised (plus skipped cancelled entries). `cancel`: O(1) amortised (an occasional O(n) compaction that removes at least half the heap). `peek`: O(1) amortised.

## 3. Event contracts

Queue events (internal) and trace entries (observable) are distinct. Queue events say what *will* happen; trace entries record what *did* happen.

### 3.1 Queue events

| Kind | Scheduled by | At time | On dispatch |
|---|---|---|---|
| `node.start` | constructor, for each node in order | 0 | incarnation 1, node becomes `running`; `init(ctx)` |
| `fault` | constructor, for each plan fault in order | `fault.at` | §8 |
| `message.deliver` | a committed `send` the network did not drop | `sentAt + latency (+ link delay)` | partition check → crashed check → `onMessage(state, msg, ctx)` (§9) |
| `timer.fire` | a committed `setTimer` | `setAt + delay` | asserts node running in the setting incarnation; `onTimer(state, timer, ctx)` |
| `liveness.deadline` (CP4) | the liveness evaluation that starts a waiting period (§17) | `since + deadline` | appends `liveness.missed`; cancelled earlier if progress happens or the assumptions break |

### 3.2 Trace entries

Every entry has `index` (dense, 0-based, never changes), `time`, `cause`, and `kind`. `cause` is the index of the entry that directly caused it. Following `cause` links reconstructs **happens-before**.

| Kind | Extra fields | `cause` points to |
|---|---|---|
| `run.start` | `engineVersion, protocol{name,version}, seed, nodes, latency, limits, persistence, faults, invariants[{id,version,name}], invariantPolicy, liveness[{id,version,name,deadline,assumptions}]` | `null` |
| `node.start` | `node, incarnation` (=1) | `run.start` |
| `message.send` | `node` (sender), `incarnation, to, messageId, payload, deliverAt` (`null` if dropped at send) | handler's triggering entry |
| `message.deliver` | `node` (receiver), `incarnation, from, messageId, payload` | its `message.send` |
| `message.drop` | `node` (intended receiver), `from, messageId, reason, conditionIndex` | its `message.send` |
| `timer.set` | `node, incarnation, timerId, tag, fireAt` | handler's triggering entry |
| `timer.fire` | `node, incarnation, timerId, tag` | its `timer.set` |
| `timer.cancel` | `node, incarnation, timerId` (only if it was pending) | handler's triggering entry |
| `storage.write` | `node, incarnation, set{key: value}, deleted[]` | handler's triggering entry |
| `state.update` | `node, incarnation, state` (full, frozen) | handler's triggering entry |
| `protocol.error` | `node, incarnation, error` (`"Name: message"`, no stack) | handler's triggering entry |
| `node.crash` | `faultId, node, incarnation` (ending), `cancelledTimers` | `run.start` |
| `node.recover` | `faultId, node, incarnation` (new) | `run.start` |
| `network.partition` | `faultId, groups` (normalised) | `run.start` |
| `network.heal` | `faultId` | `run.start` |
| `link.fault` | `faultId, from, to, loss, delay` | `run.start` |
| `link.restore` | `faultId, from, to` | `run.start` |
| `fault.skipped` | `faultId, faultType, node, reason` (`already-crashed` / `not-crashed`) | `run.start` |
| `invariant.violation` | `violationId, invariant{id,version,name}, nodes, expected, observed, evidence, references, trigger, step{first,last}, nodeStates, activeFaults, eventNumber` (§10.4) | the step's trigger |
| `invariant.cleared` | `violationId, invariant` (record-and-continue only) | the step's trigger |
| `invariant.error` | `invariant, error` | the step's trigger |
| `liveness.armed` (CP4) | `check{id,version,name}, since, deadlineAt` | the step's trigger |
| `liveness.met` (CP4) | `check, since, duration, late` | the step's trigger |
| `liveness.missed` (CP4) | `check, since, deadlineAt, assumptions` — the **trigger** of its own step | its `liveness.armed` |
| `liveness.disarmed` (CP4) | `check, since, previous` (phase before disarming) | the step's trigger |
| `liveness.error` (CP4) | `check, error` | the step's trigger |
| `run.end` | `reason, eventsProcessed, pendingEvents` | `null` |

**Within one step** the order is: triggering entry → `storage.write` (if any; durable before anything leaves) → effect entries in call order (a send dropped at send time is followed immediately by its `message.drop`) → `state.update` (if the state changed). A failed step produces the triggering entry → `protocol.error`, and nothing else.

**Explaining a fault's consequences.** `cause` answers "what led to this?"; `conditionIndex` on a drop answers "which fault is responsible?"; `cancelledTimers` on a crash lists what the crash destroyed. Forward questions ("what followed from this crash?") are answered by inverting the `cause` and `conditionIndex` links.

**Guarantees** (tested in `test/simulation.test.ts`, and for random fault plans by the trace oracle in `test/invariants.ts`):

- `trace[i].index === i`; times are non-decreasing; `cause < index` for all entries but `run.start`/`run.end`.
- Every `message.deliver` happens at its send's `deliverAt` and matches its send's sender, receiver, and payload.
- Every sent message is delivered or dropped **exactly once**, or is still pending when the run stops.
- Every plan fault yields exactly one entry (applied or skipped).
- Entries and everything reachable from them are deeply frozen and JSON-serialisable. (Before CP2 entries were only *shallowly* frozen, so nested arrays such as `cancelledTimers` were mutable. Found by the CP2 graph-walk test and fixed in `EventTrace.append`.)

## 4. Termination and limits

`step()` checks, **in this order**, before dispatching:

1. Queue has no live events → stop `quiescent`.
2. `eventsProcessed >= maxEvents` → stop `event-limit`.
3. `maxTime !== null` and next event's time `> maxTime` → stop `time-limit` (events exactly at `maxTime` run; the clock is *not* moved to `maxTime`).

After dispatching:

4. Handler failed → stop `protocol-error` (invariants are not evaluated for a failed step).
5. Invariants evaluated (§10): checker error → `invariant-error`; new violation under `stop-on-first` → `invariant-violation`; `maxViolations` reached → `violation-limit`.
5b. Liveness checks evaluated (§17), after the invariants: a check that throws or returns a non-boolean → `liveness-error`. Liveness results themselves never stop a run.
6. Live events `> maxPendingEvents` → stop `pending-limit`.

Additionally, one handler may not buffer more than `maxPendingEvents` effects (a `ProtocolViolationError`), so a single runaway loop of `send` calls is bounded too.

Because (1)–(2) are checked before every dispatch and `maxEvents` is finite, **every run terminates** after at most `maxEvents` dispatches, as long as each individual handler call returns. A handler that never returns (`while (true) {}`) cannot be stopped from inside the same thread. That is the job of the Worker watchdog in CP5 ([FAILURE_MODES §C3](FAILURE_MODES.md)).

The check order makes the boundary cases unambiguous: a run whose last allowed event empties the queue is `quiescent`, not `event-limit`.

After a stop, the simulation is terminal: `step()` returns `false` and appends nothing.

## 5. Network model

Fully connected. Each message draws its base latency uniformly from `[min, max]` using the network's own random stream, at the moment the sending handler's effects are applied. Links are **not FIFO**: messages on the same link can overtake each other when latencies differ. Faults modify this model (§9). Without faults, exactly one random draw is made per message, the same as CP0.

## 6. Node lifecycle

```
           node.start (t=0)              crash fault
  idle ─────────────────────▶ running ─────────────▶ crashed
                              (inc 1)  ◀─────────────  │
                                      recover fault    │
                                      (inc + 1, init)  │
                               crash of crashed node ──┘ → fault.skipped
                               recover of running node   → fault.skipped
```

| State category | Contents | On crash | On recovery |
|---|---|---|---|
| Volatile protocol state | `state` | discarded | rebuilt by `init(ctx)` |
| Persistent protocol state | `storage` | **kept** | visible to `init` |
| Node runtime state | status, incarnation, pending timers | → `crashed`; every pending timer cancelled and listed in `node.crash` | → `running`; incarnation + 1 |
| Simulation infrastructure | scheduler, clock, network, PRNG streams (incl. the node's), id counters, trace | untouched | untouched |

A crashed node executes no handler, fires no timer, sends nothing, and changes neither state nor storage. Crashes take effect **between** steps; a handler is never interrupted halfway. Message and timer ids keep counting across incarnations, so they stay unique.

## 7. Persistence model: `sync-on-commit`

- `ctx.storage` is a per-node map from string keys (1–128 characters) to JSON values.
- Writes are buffered with the handler's other effects. Reads see the handler's own buffered writes (read-your-writes); `keys()` returns sorted keys.
- When the step commits, all its writes become durable at once and are traced in one `storage.write` entry, **before** the step's messages (persist-before-send). A failed step persists nothing.
- Because crashes happen only between steps, a committed write is never lost and an uncommitted write is never persisted.
- The model is recorded as `run.start.persistence`, so alternative models (e.g. explicit `sync()` with loss of un-synced writes) can be added later without ambiguity.

## 8. Fault plan

```ts
type FaultSpec =
  | { at, type: 'crash',        node }
  | { at, type: 'recover',      node }
  | { at, type: 'partition',    groups: NodeId[][] }   // unlisted nodes form one implicit group
  | { at, type: 'heal' }
  | { at, type: 'link',         from, to, loss?: number, delay?: { min, max } }  // directed
  | { at, type: 'link-restore', from, to }
```

- Validated and normalised at the boundary (ids `f1…`, partition groups in config order with the implicit group last, link defaults `loss: 0`, `delay: {0,0}`), then recorded verbatim in `run.start.faults`.
- Scheduled as ordinary events right after the node starts. Same-time ordering: plan faults before runtime events; plan order among faults.
- Each fault produces exactly one entry whose `cause` is `run.start`.
- Faults later than `maxTime`, or beyond the point where the run stopped, are never applied.
- Fault events count as dispatched events toward `maxEvents`.

## 9. Network faults and messages in flight

At **send** (the message's fate is decided once):

1. Partition separates sender and receiver → `message.drop { reason: 'partitioned' }`, `deliverAt: null`.
2. Link `from→to` has `loss > 0` and `chance(loss)` → `message.drop { reason: 'lost' }`.
3. Otherwise `deliverAt = now + base latency + (link delay drawn from [min, max], if set)`.

At **delivery**:

1. Partition now separates them → `message.drop { reason: 'partitioned-in-flight' }` (network before node).
2. Receiver crashed → `message.drop { reason: 'node-down' }`.
3. Otherwise delivered to the receiver's *current* incarnation.

Consequences: a new partition cuts messages already in flight, and a partition that heals before arrival does not. Link changes (`link`, `link-restore`) never affect messages in flight. A sender's crash doesn't recall what it already sent. Every drop records `conditionIndex`, the entry of the partition, link fault or crash that caused it.

## 10. Invariants (CP2)

Design: [ADR-0012](adr/0012-invariant-model.md), [ADR-0013](adr/0013-violation-policies.md).

### 10.1 Contract

```ts
interface Invariant<H extends JsonValue> {
  id: string; version: string; name: string;
  initialHistory: H;                         // null for state invariants
  check({ view, step, history }): { ok: true, history? } | { ok: false, history?, violation: ViolationReport }
}
```

Invariants are trusted, synchronous and deterministic (the same rules as protocols). A **state invariant** looks only at the current `view`. A **historical invariant** also carries `history`: explicit JSON owned by the engine, validated and frozen after every check, readable via `sim.invariantHistory(id)`, and part of the execution state future snapshots must capture. Bump `version` whenever the rule or the shape of its history changes.

### 10.2 What an invariant sees

- `view`: `time`, `eventNumber`, `nodes[]` (id, status, incarnation, `state`, `storage`, `stateEntry`) in configuration order, `node(id)`, `inFlight[]` (§11), `network` (partition groups, active directed link conditions).
- `step`: `trigger` (the first entry of the step) and `entries` (everything the step appended).
- Everything reachable is **deeply frozen at runtime**: payloads and states already were; storage maps, in-flight records and network conditions are frozen copies built lazily per step; no engine object is reachable. Writes throw `TypeError` (recorded as `invariant.error`); `Reflect.set` silently returns `false`. Either way the simulation is unaffected.

### 10.3 Evaluation order

After every committed step (handler steps, fault steps, drop-only steps): evaluate invariants **in configuration order**; append their outcomes in that order (violations, `invariant.cleared`, `invariant.error`); then apply the stop rules of §4 step 5. History is updated only by a well-formed verdict; a checker error leaves its history unchanged.

**Policies.** `stop-on-first` (default): the run stops after the first step with a violation, recording every violation of that step. `record-and-continue`: one `invariant.violation` per **episode** (holding → failing), closed by `invariant.cleared` (failing → holding); a failure that persists over many steps produces one entry. A checker error always stops the run.

### 10.4 Explainable violation record

The invariant asserts `nodes`, `expected`, `observed`, `evidence` (JSON) and `references` (earlier trace indices). The engine adds observed facts only: `trigger` (= `cause`), the `step` range, `nodeStates` (status, incarnation, and the entry that produced each cited node's state), `activeFaults` (trace indices of the active partition, link faults and crashes) and `eventNumber`. No field claims a cause. Inputs for an exact replay are all in `run.start`; replaying them for `eventNumber` events reproduces the state at detection.

### 10.5 Liveness

Invariants are safety checks only. Bounded liveness (CP4) is a separate kind of check with its own trace entries, never reported as an invariant violation: §17.

## 11. In-flight message index

`sim.inFlight()` and `view.inFlight` list every message that has been sent, was not dropped at send time, and has not yet been delivered or dropped at delivery, **in send order**. Each record: `id, from, to, payload, sentAt, deliverAt, sendIndex`.

| Event | Index update |
|---|---|
| send, routed for delivery | add (when the delivery event is scheduled) |
| send, dropped at send (`partitioned`, `lost`) | never added |
| delivery event dispatched (delivered, `partitioned-in-flight`, `node-down`) | removed |
| fault transitions (partition, heal, link changes, crash, recover) | no direct change; the effect shows at delivery |
| run stops | unchanged: it lists exactly the undelivered messages |

Index invariants (property-tested after every step over random fault plans): the index equals the set of live `message.deliver` events in the scheduler, equals the set derived from the trace, matches each message's `message.send` entry field for field, and never contains an overdue message (`deliverAt ≥ now`).

## 12. Trace format history

Engine versions change the trace format only by **adding** information. `test/legacy.ts` projects a current trace onto an older format; the CP0 and CP1 golden fingerprints are reproduced exactly when the newer features are unused.

| Engine version | Added |
|---|---|
| `0.1.0-cp0` | Initial format |
| `0.2.0-cp1` | `incarnation` on node entries; `run.start.persistence`, `run.start.faults`; `message.send.deliverAt` may be `null`; entries `message.drop`, `storage.write`, `node.crash`, `node.recover`, `network.partition`, `network.heal`, `link.fault`, `link.restore`, `fault.skipped` |
| `0.3.0-cp2` | `run.start.invariants`, `run.start.invariantPolicy`, `run.start.limits.maxViolations`; entries `invariant.violation`, `invariant.cleared`, `invariant.error`; stop reasons `invariant-violation`, `invariant-error`, `violation-limit`; all entries deeply frozen |
| `0.4.0-cp4` | `run.start.liveness`; entries `liveness.armed`, `liveness.met`, `liveness.missed`, `liveness.disarmed`, `liveness.error`; queue event `liveness.deadline`; stop reason `liveness-error`. Without liveness checks, the only difference is `run.start.liveness: []` |

Since CP4 the projection lives in the engine (`projectTrace`, `LEGACY_TRACE_VERSIONS`, exported from `@faultlab/engine`), because the demo also needs it to verify CP2 fixtures. The CP0–CP3 golden fingerprints are kept as projection assertions; the current goldens are pinned at `0.4.0-cp4`. Stored counterexamples recorded with an older engine are **never rewritten**: they are replayed with the current engine and compared through the projection.

Configurations from earlier versions remain valid; every new config field is optional.

## 13. Steps, scheduled events, trace entries, virtual time (CP3 terminology)

These four words mean different things and are never used interchangeably:

| Concept | Type / name | Definition | Example |
|---|---|---|---|
| **Scheduled event** | `ScheduledEvent` (internal) | An item in the scheduler queue: `node.start`, `message.deliver`, `timer.fire`, or a plan `fault`. | n3's `tick` timer, due at t=209 |
| **Simulation step** | counted by `StepCount` (`sim.stepsCompleted`, alias of `eventsProcessed`) | One call to `step()` that dispatches exactly **one** scheduled event, plus everything that follows from it: the handler, its committed effects, invariant evaluation and, if the run stops in that call, `run.end`. Steps are the **only** points where execution can be paused, snapshotted and resumed. | Step 129 in the split-brain fixture: n3's tick → claim leadership → 3 sends, 3 drops, state update → `invariant.violation` → `run.end` |
| **Trace entry** | `TraceEntry`, position `EntryIndex` | One immutable record appended to the trace. One step appends **one or more** entries (it can be thousands). Entries can be *inspected* individually; execution **cannot** be resumed from an entry inside a step. | `#386 storage.write` inside step 129 |
| **Virtual time** | `VirtualTime` | The clock value. Many steps, and many entries, can share one virtual time. | t=209 |

Consequences:

- `#0 run.start` precedes step 1 ("step 0" = the initial state). `run.end` belongs to the step whose call stopped the run; when the run stops *before* dispatching (quiescent, event limit, time limit), it is appended by a call that dispatches nothing and belongs to no step.
- A step's first entry is its **trigger**: the entry recording the dispatched event (`node.start`, `message.deliver`, `timer.fire`, a fault entry, `fault.skipped`, a delivery-time `message.drop` with reason `partitioned-in-flight` / `node-down`, or, since CP4, `liveness.missed`). Send-time drops (`partitioned`, `lost`) are not triggers; they are effects inside a step.
- **Engine snapshots** (§14) exist only at step boundaries: "after N completed steps". There is no snapshot "at entry #386".
- The **TraceIndex** (§15) answers questions about any entry, including entries inside a step, but it only *reads* the trace and never resumes execution.

**Units of the two intervals (never interchangeable):**

| Interval | Unit | Bound it guarantees |
|---|---|---|
| Engine keyframe interval `keyframeSteps` | simulation **steps** | `seek(n)` restores the nearest keyframe ≤ n and re-executes **at most `keyframeSteps − 1` steps** (however many entries those steps produce) |
| TraceIndex checkpoint interval `checkpointEntries` | trace **entries** | `frameAt(i)` starts from the nearest checkpoint ≤ i and applies **at most `checkpointEntries − 1` entries** (however many steps those entries span) |

## 14. Engine snapshots and time travel (CP3)

Design: [ADR-0015](adr/0015-engine-snapshots.md), [ADR-0016](adr/0016-keyframes-and-trace-regeneration.md).

- `sim.snapshot()` captures the complete execution state **after `stepsCompleted` steps** as `faultlab-snapshot/2` JSON (CP4; `/1` from CP3 is rejected with a clear error, because it cannot describe liveness state) (deeply frozen; states and payloads shared with the live run). Contents: the full `run.start` (all inputs), position (`stepsCompleted`, absolute `traceLength`, `time`, last-entry fingerprint), stop reason, scheduler (`nextSeq`; live events in dispatch order with original sequence numbers; faults by id), network (random state; partition and link conditions with their source entries, insertion order), nodes (lifecycle, `crashedAt`, `stateEntry`, volatile state, storage and timers in insertion order, id counters, random state), invariant monitor (counter, history, open episode per invariant), and liveness (`null` without checks; otherwise per check `id, version, phase, since, armedEntry, deadlineSeq`, with the pending `liveness.deadline` event in the scheduler, referenced by check id).
- `Simulation.restore(config, snapshot, { tracePrefix? })` validates the snapshot as untrusted input (§14.1) and rebuilds the run. With a prefix the trace is complete; without one it is a **segment** that starts at the snapshot's absolute `traceLength`, so new entries keep the indices (and causes) of an uninterrupted run.
- **Guarantee:** for every step boundary k, `restore(snapshot@k)` followed by running is byte-identical to the uninterrupted run from k on; `snapshot(restore(s))` equals `s`; taking snapshots never changes the trace.
- `TimeTravel.record(config, { keyframeSteps: K, retainTrace })` keeps a snapshot at step 0 and every K steps. `seek(n)` restores the last keyframe ≤ n and re-executes **< K steps**; `regenerate(a, b)` returns the entries of steps (a, b] with their absolute indices. `sim.releaseTraceBefore(i)` drops retained entries (never the newest) for memory-bounded runs.

### 14.1 Snapshot validation

Bounds (depth ≤ 200, ≤ 5 M values, strings ≤ 1 M chars) → plain JSON → format and engine version → **exact** equality of `inputs` with the configuration → structural and cross-field consistency (node order and lifecycle, counters vs. ids, timers ↔ queued `timer.fire` events, strict (time, seq) order, seqs < `nextSeq`, events ≥ clock, partition coverage, link validity, invariant states, liveness: present iff checks are configured, ids/versions match, phase is known, `since` is null exactly while idle, a `waiting` check owns exactly one deadline event at `since + deadline` caused by its `armedEntry`, and every deadline event is owned) → with a prefix, kind checks of every referenced entry.

**What validation guarantees, and what it does not:**

- ✅ Snapshots are validated for **internal consistency**.
- ✅ Snapshot **format** and **experiment compatibility** (engine version, exact inputs, protocol and invariant identity) are checked.
- ✅ Invalid or incompatible snapshots are **rejected** with a `SnapshotError` naming the path and the rule; nothing is partially restored.
- ❌ Validation provides **no authenticity** and **no protection against deliberately forged data**. Fingerprints detect accidents and mix-ups; whoever controls a snapshot can make it consistent. A snapshot is as trustworthy as its source. No cryptographic signing is planned until there is a real threat model (e.g. shared experiments in CP7).

## 15. TraceIndex (CP3, `@faultlab/trace`)

Design: [ADR-0017](adr/0017-trace-index-package.md). A read-only index over a **complete** trace (starting at `run.start`, no gaps):

- `frameAt(i, displayTime?)`: state after entry i (nodes with status, incarnation, state + source entry, storage, pending timers; in-flight messages; recent drops; partition; links; open violations; liveness phase per check (CP4); the entry's step). Work per query ≤ `checkpointEntries − 1` entries.
- `steps`, `stepOf(i)`, `step(k)`: step ranges derived from trigger kinds (§13), identical to the engine's `step()` calls.
- `markers`, `nextMarker`, `previousMarker`: fault, violation, liveness (`liveness-met`, `liveness-missed`) and end markers at exact entries.
- `causeOf`, `ancestors`, `consequences` (direct by `cause`, explained by `conditionIndex`), `descendants`.
- Not reconstructible from a trace: PRNG states, sequence numbers, queue layout, invariant histories. Use an engine snapshot for those.

## 16. Versions: engine, trace format, snapshot format

Three different things carry version information. They change for different reasons:

| Version | Where | What it identifies | Changes when |
|---|---|---|---|
| **Engine version** (`ENGINE_VERSION`, e.g. `0.3.0-cp2`) | `run.start.engineVersion`, snapshots, counterexample fixtures | The **observable behaviour** of the engine: which trace a given configuration produces | Anything could alter a trace from identical inputs: ordering, randomness, semantics, *or* the trace format. Guarded by the golden fingerprints |
| **Trace format** | implied by the engine version; history in §12 | The shape of trace entries | Entries or fields are added. Always together with an engine-version bump (today the two are not separated) |
| **Snapshot format** (`SNAPSHOT_FORMAT` = `faultlab-snapshot/2` since CP4) | `snapshot.format` | The shape of an engine snapshot | The snapshot schema changes. Independent of the engine version |
| **Counterexample format** (`faultlab-counterexample/1`, `/2`) | stored fixtures | The shape of a stored, replayable counterexample (§18) | The fixture schema changes |
| **Experiment spec format** (`faultlab-experiment/1`, CP5) | `ExperimentSpec.format` | The JSON shape that names protocol, invariants and liveness checks by registry (id, version) (§19) | The spec schema changes |
| **Worker protocol** (`faultlab-worker/1`, CP5) | every Worker message | The command/event contract between the main thread and the simulation Worker (§19) | Messages change; both sides reject other versions |
| **Protocol / invariant / liveness-check versions** | `protocol.version`, `invariant.version`, `check.version` | The rules of that protocol or check | Its rule or its history shape changes |
| *Package versions* (`package.json`, `0.0.0`) | npm workspaces | Nothing yet (private packages) | Not used |

**CP3 example.** CP3 added snapshots, keyframes and the TraceIndex but changed no trace from identical inputs. So the engine version intentionally stays `0.3.0-cp2` (all golden fingerprints unchanged), and the new artefact is versioned as `faultlab-snapshot/1`. The suffix `-cp2` therefore means "semantics last changed in CP2", not "built in CP2".

**CP4 example.** CP4 adds liveness entries and a `run.start` field, so the engine version becomes `0.4.0-cp4` (new goldens; the old ones are reproduced through `projectTrace`), the snapshot format becomes `/2`, and the new Raft fixtures use counterexample format `/2`. The naive-leader fixtures stay `/1` at `0.3.0-cp2` and still replay exactly.

**Known naming debt.** The `-cpN` suffix suggests a build or checkpoint number while it actually denotes trace semantics, and the trace format has no version of its own. A clearer scheme (e.g. separate `traceFormat` and `semanticsVersion`) is listed for a future architecture review ([ROADMAP](ROADMAP.md)); it is deliberately not changed now, because changing it would itself alter every trace and fingerprint.

## 17. Bounded liveness (CP4)

Design: [ADR-0019](adr/0019-bounded-liveness.md). Safety ("nothing bad happens") can be checked after every step. Liveness ("something good eventually happens") cannot be decided in a finite run, and Raft guarantees no time bound at all (randomized timeouts make long elections unlikely, not impossible). FaultLab therefore checks a **bounded, conditional test expectation**:

> Whenever the check's `assumptionsHold(view)` is true and its `progress(view)` is false, `progress` must (again) become true within `deadline` ticks.

| Term | Meaning |
|---|---|
| **Safety property** | Must hold in every reachable state/history (Raft: Election Safety). Checked by invariants (§10). |
| **Progress assumption** | A condition under which progress is *expected*, e.g. "a majority is healthy". Recorded as plain-language `assumptions` in `run.start` and in every `liveness.missed`. When it does not hold, nothing is expected. |
| **Bounded test expectation** | `deadline` (D): a configured **test bound**, chosen from measurements, not a protocol guarantee. A miss means "this bound was exceeded under these assumptions", not "the protocol is broken". |

**Phases** per check (in configuration order, evaluated after the invariants of every committed step, on the same frozen view):

| From | Condition | To | Entry |
|---|---|---|---|
| idle | assumptions start to hold | waiting (or met at once if progress already holds) | `liveness.armed` (+ `liveness.met`, duration 0) |
| met | progress lost while assumptions hold | waiting | `liveness.armed` (a new period) |
| waiting / missed | progress | met | `liveness.met` (`late` if after the deadline) |
| waiting | the `liveness.deadline` event is dispatched | missed | `liveness.missed` (trigger of its own step) |
| any but idle | assumptions stop holding | idle | `liveness.disarmed` |

**Deadline semantics.**

- Arming schedules a **real** `liveness.deadline` event at `since + D`. It is dispatched at exactly that virtual time even if nothing else happens (a quiet scheduler cannot skip it), and it is the only thing that produces `liveness.missed`. Progress and disarming cancel it, so a cancelled deadline never keeps a run alive.
- "Within D" means: progress is observed in a step dispatched **before** the deadline event in `(time, seq)` order. The deadline's sequence number is assigned when it is armed, so events at the same tick that were scheduled earlier still run first.
- Checks are evaluated **after steps only**. A condition that depends purely on time (no event) is seen at the next step.
- A permanent minority partition makes the assumptions false: the check is disarmed and **no liveness result** is produced, rather than a false miss.
- Liveness results never stop a run, are never `invariant.violation`s, and never count towards `maxViolations`. Only a faulty check (throws, non-boolean) stops the run with `liveness-error`.

**Raft's check** (`raftLeaderLiveness`, id `raft-leader-elected`, in `@faultlab/protocols`): assumptions hold when the **healthy group** (running nodes in one partition group that are not an endpoint of any lossy or delayed link) is a majority of the configured cluster; progress means exactly one running leader in that partition group, acknowledged in its own term (as follower with `leaderId`) by every healthy node. D = **1500** ticks in the tests, chosen from measured election durations ([TEST_STRATEGY](TEST_STRATEGY.md#cp4-results)).

## 18. Counterexample fixture formats

| Format | Used by | Contents |
|---|---|---|
| `faultlab-counterexample/1` (CP2) | naive-leader fixtures, `packages/engine/test/counterexamples/` | engine version; `protocol {name: 'naive-leader', version, options}`; one invariant; config (seed, nodes, latency, maxTime, faults); discovery data; expected violation (time, nodes, observed, eventNumber, trace fingerprint) |
| `faultlab-counterexample/2` (CP4) | Raft fixtures, `packages/protocols/test/counterexamples/` | as `/1`, plus `protocol.variant` (a deliberate bug, or `null`) from a protocol registry, protocol options, and `correctProtocol {reason, violations, fingerprint}`: what the correct protocol does under the identical experiment |

Both are replayed by tests that require the exact recorded violation and fingerprint, 1-minimality of the fault plan, and matching engine, protocol and invariant versions. A fixture is written only if it does not exist yet; it is never overwritten.

## 19. Browser execution: experiment specs and the Worker protocol (CP5)

Design: [ADR-0021](adr/0021-experiment-spec-and-registry.md), [ADR-0022](adr/0022-worker-runtime.md), [ADR-0023](adr/0023-incremental-trace-index.md).

**Experiment spec** (`faultlab-experiment/1`): `{ format, seed, nodes, protocol {name, version, options}, network {latency}, limits?, faults?, invariants? [{id, version}], invariantPolicy?, liveness? [{id, version, params}] }`, plain JSON. `resolveExperiment(spec)` looks every name up in the registry at exactly that version (else `SpecError` with a path), then validates the resulting config with the engine's `resolveConfig`. A spec never contains code.

**Worker protocol** (`faultlab-worker/1`), one Worker per run, every message `{ protocol, runId, type, … }`:

| Direction | Message | Meaning |
|---|---|---|
| → Worker | `load {spec, options}` | resolve and create the run (once per Worker) |
| → Worker | `run` / `step {steps}` / `pause` / `stop` | execution control; pause and stop take effect at the next step boundary |
| → Worker | `credit {chunks}` | flow control: the client applied chunks |
| → Worker | `snapshot {requestId, atStep}` | engine snapshot at a step boundary (current, or rebuilt from a keyframe) |
| ← main | `loaded {engineVersion, protocolName, protocolVersion}` | spec resolved |
| ← main | `chunk {seq, from, to, encoding, entries \| data}` | entries [from, to); `seq` counts from 0 without gaps |
| ← main | `status {state, stepsCompleted, now, traceLength, pendingEvents, stopReason, throttled}` | after load and every slice |
| ← main | `finished {state, stopReason, stepsCompleted, traceLength, fingerprint, metrics}` | all entries were sent before it |
| ← main | `snapshot` / `error {code, message}` | replies and failures |

**Execution guarantees.** Slices contain whole steps only; the trace does not depend on slice budget, slice size, chunk size, credit, encoding, or when the user pauses (property-tested; identical fingerprints in Node, Chromium, Firefox and WebKit). The client applies chunks only in order, without gaps or duplicates, and ignores messages of other runs. Lifecycle states and the difference between `completed`, `stopped` and `aborted` are defined in ADR-0022. Inside slices, ambient nondeterminism APIs throw (`NondeterminismError` → a deterministic handler error); this is an accident guard, not a sandbox.

