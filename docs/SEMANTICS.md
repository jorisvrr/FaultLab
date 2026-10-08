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

### 3.2 Trace entries

Every entry has `index` (dense, 0-based, never changes), `time`, `cause`, and `kind`. `cause` is the index of the entry that directly caused it. Following `cause` links reconstructs **happens-before**.

| Kind | Extra fields | `cause` points to |
|---|---|---|
| `run.start` | `engineVersion, protocol{name,version}, seed, nodes, latency, limits, persistence, faults, invariants[{id,version,name}], invariantPolicy` | `null` |
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

Not checked in CP2. Bounded liveness ("a leader exists by t=…") is planned for CP4 as a separate kind of check with deadlines, reported separately from safety violations.

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

Configurations from earlier versions remain valid; every new config field is optional.
