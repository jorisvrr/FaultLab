# Simulation Semantics: Types, Event Contracts, Scheduler

This is the specification of what the engine does. Where the code and this document disagree, one of them has a bug. Tests live in `packages/engine/test/`; [TEST_STRATEGY.md](TEST_STRATEGY.md) maps rules to tests.

## 1. Core types

| Type | Definition | Why |
|---|---|---|
| `VirtualTime` | Non-negative safe integer number of **ticks** since run start. Convention: 1 tick = 1 ms. | Integer arithmetic is exact, so time can't drift and no comparison is ambiguous. [ADR-0002](adr/0002-integer-virtual-time.md) |
| `Duration` | Non-negative safe integer number of ticks; latencies and timer delays ≤ `MAX_DELAY` = 2³¹. | Keeps `now + delay` far from 2⁵³. |
| `NodeId` | String matching `[A-Za-z0-9][A-Za-z0-9_-]{0,31}`. | Readable, and leaves `:` free for namespaced ids. |
| `MessageId` | `"<sender>:m<k>"`, the k-th message that sender sent. | Per-node counters: adding a message on n1 does not renumber n2's messages, which keeps trace diffs local. |
| `TimerId` | `"<owner>:t<k>"`. | Same reasoning. |
| `EventSeq` | Integer assigned by the scheduler at scheduling time, strictly increasing. | Tie-breaker that makes ordering total. |
| `JsonValue` | `null | boolean | finite number | string | JsonValue[] | {[k]: JsonValue}` | Everything protocol-visible must be serialisable into traces and snapshots. [ADR-0006](adr/0006-json-payloads-validate-copy-freeze.md) |

### 1.1 Configuration (`SimulationConfig`, validated by `resolveConfig`)

```ts
{
  seed: number;                      // integer in [0, 2^32)
  nodes: NodeId[];                   // 1..1024 unique ids; order is meaningful
  protocol: Protocol<S, M>;          // name, version, init, onMessage, onTimer
  network: { latency: { min, max } } // 0 <= min <= max <= 2^31, integers
  limits?: { maxEvents?, maxTime?, maxPendingEvents? }
}
```

Defaults: `maxEvents = 100 000`, `maxTime = null` (none), `maxPendingEvents = 100 000`. Node order determines start order, `ctx.peers` order and `broadcast` order. Invalid input throws `ConfigError` with a path (`"network.latency.max"`) **before** anything runs.

### 1.2 Protocol API

```ts
interface Protocol<S extends JsonValue, M extends JsonValue> {
  name: string;
  version: string;                           // bump on behaviour change
  init(ctx): S;                              // on node start
  onMessage(state: S, message, ctx): S;      // message = { id, from, sentAt, payload: M }
  onTimer(state: S, timer, ctx): S;          // timer   = { id, tag, setAt }
}

interface NodeContext<M> {
  self: NodeId; now: VirtualTime; peers: readonly NodeId[];
  random: RandomSource;                      // this node's own stream
  send(to, payload: M): MessageId;
  broadcast(payload: M): MessageId[];
  setTimer(delay: Duration, tag: string): TimerId;
  cancelTimer(id: TimerId): void;
}
```

Contract for protocol authors:

1. **Handlers are synchronous and deterministic.** No `Math.random`, `Date`, real timers, I/O, `async`, or module-level mutable state.
2. **State is immutable.** The state passed in is deeply frozen; return a new object to change it, or the same object to leave it unchanged. Returned state is validated as JSON and frozen. Unchanged parts are reused without copying.
3. **Effects are buffered.** `send`/`setTimer`/`cancelTimer` take effect only after the handler returns successfully, in call order. A handler that throws has no effects.
4. **A context expires** when its handler returns. Any later use throws `ProtocolViolationError`.
5. **Self-sends are rejected.** A node's local logic should not cross the network. ([FAILURE_MODES §B4](FAILURE_MODES.md))
6. Declare `S` and `M` with `type` aliases, not `interface`s (TypeScript interfaces lack the index signature `JsonValue` requires).

## 2. Scheduler semantics

### 2.1 The ordering rule

> Events are dispatched in increasing order of **(time, seq)**, where `seq` is the order in which they were scheduled.

`seq` is unique, so this is a **strict total order**. Given the same sequence of `schedule` calls, there is exactly one dispatch order. That holds even though the binary heap underneath is not stable. ([ADR-0003](adr/0003-scheduler-total-order.md))

**"Simultaneous" events** (same `time`) run in FIFO order of scheduling. The scheduling order is itself deterministic because it is produced by earlier deterministic dispatches. Concretely:

- All `node.start` events are scheduled first (in config order) at t=0, so every node starts before any message is delivered, even with zero latency.
- Messages sent in one handler are scheduled in call order; with equal latency they arrive in that order.
- An event scheduled at the *current* time (zero-latency send, `setTimer(0)`) runs after all events already queued for that time.

### 2.2 Clock

The clock is owned by the scheduler and advances only when an event is dispatched, to exactly that event's time. Scheduling before `now` is an engine invariant violation (`EngineInvariantError`), which can only be reached through an engine bug because protocol-facing APIs reject negative delays.

### 2.3 Cancellation

Lazy: a cancelled event stays in the heap but is removed from the live set and skipped when it surfaces. `pendingCount` counts only live events. Cancelling an event that already ran or was already cancelled returns `false` and does nothing.

### 2.4 Complexity

`schedule`: O(log n). `next`: O(log n) amortised (plus skipped cancelled entries). `cancel`: O(1). `peek`: O(1) amortised.

## 3. Event contracts

Queue events (internal) and trace entries (observable) are distinct. Queue events say what *will* happen; trace entries record what *did* happen.

### 3.1 Queue events

| Kind | Scheduled by | At time | On dispatch |
|---|---|---|---|
| `node.start` | constructor, for each node in order | 0 | node becomes `running`; `init(ctx)` |
| `message.deliver` | a committed `send` | `sentAt + latency` | `onMessage(state, msg, ctx)` |
| `timer.fire` | a committed `setTimer` | `setAt + delay` | timer removed from node's pending set; `onTimer(state, timer, ctx)` |

### 3.2 Trace entries

Every entry has `index` (dense, 0-based, never changes), `time`, `cause`, and `kind`. `cause` is the index of the entry that directly caused it. Following `cause` links reconstructs **happens-before**.

| Kind | Extra fields | `cause` points to |
|---|---|---|
| `run.start` | `engineVersion, protocol{name,version}, seed, nodes, latency, limits` | `null` |
| `node.start` | `node` | `run.start` |
| `message.send` | `node` (sender), `to, messageId, payload, deliverAt` | handler's triggering entry |
| `message.deliver` | `node` (receiver), `from, messageId, payload` | its `message.send` |
| `timer.set` | `node, timerId, tag, fireAt` | handler's triggering entry |
| `timer.fire` | `node, timerId, tag` | its `timer.set` |
| `timer.cancel` | `node, timerId` (only if it was pending) | handler's triggering entry |
| `state.update` | `node, state` (full, frozen) | handler's triggering entry |
| `protocol.error` | `node, error` (`"Name: message"`, no stack) | handler's triggering entry |
| `run.end` | `reason, eventsProcessed, pendingEvents` | `null` |

**Within one step** the order is: triggering entry → effect entries in call order → `state.update` (if the state changed). A failed step produces the triggering entry → `protocol.error`, and nothing else.

**Guarantees** (all tested in `test/simulation.test.ts`):

- `trace[i].index === i`; times are non-decreasing; `cause < index` for all entries but `run.start`/`run.end`.
- Every `message.deliver` happens at its send's `deliverAt` and matches its send's sender, receiver, and payload.
- In a `quiescent` run, every sent message is delivered exactly once (CP0 has no loss).
- Entries and everything reachable from them are deeply frozen and JSON-serialisable.

## 4. Termination and limits

`step()` checks, **in this order**, before dispatching:

1. Queue has no live events → stop `quiescent`.
2. `eventsProcessed >= maxEvents` → stop `event-limit`.
3. `maxTime !== null` and next event's time `> maxTime` → stop `time-limit` (events exactly at `maxTime` run; the clock is *not* moved to `maxTime`).

After dispatching:

4. Handler failed → stop `protocol-error`.
5. Live events `> maxPendingEvents` → stop `pending-limit`.

Additionally, one handler may not buffer more than `maxPendingEvents` effects (a `ProtocolViolationError`), so a single runaway loop of `send` calls is bounded too.

Because (1)–(2) are checked before every dispatch and `maxEvents` is finite, **every run terminates** after at most `maxEvents` dispatches, as long as each individual handler call returns. A handler that never returns (`while (true) {}`) cannot be stopped from inside the same thread. That is the job of the Worker watchdog in CP6 ([FAILURE_MODES §C3](FAILURE_MODES.md)).

The check order makes the boundary cases unambiguous: a run whose last allowed event empties the queue is `quiescent`, not `event-limit`.

After a stop, the simulation is terminal: `step()` returns `false` and appends nothing.

## 5. Network model (CP0)

Fully connected. Each message draws its latency uniformly from `[min, max]` using the network's own random stream, at the moment the sending handler's effects are applied. Links are **not FIFO**: messages on the same link can overtake each other when latencies differ. Delivery is exactly-once in CP0. Loss, duplication, per-link latency, and partitions arrive in CP2 as additional `RoutingDecision` variants.
