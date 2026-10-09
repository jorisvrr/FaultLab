import { resolveConfig, type ResolvedConfig, type SimulationConfig } from './config';
import { entryFingerprint, SNAPSHOT_FORMAT, SnapshotError, validateSnapshot, type SimulationSnapshot, type SnapshotEvent, type StepCount } from './snapshot';
import { createNodeContext, type Effect, type StorageWrites } from './context';
import { EngineInvariantError } from './errors';
import type { Fault } from './faults';
import { InvariantMonitor, type InFlightMessage, type NodeView, type SimulationView, type StepInfo } from './invariants';
import type { LivenessPhase } from './liveness';
import { toFrozenJson, type JsonValue } from './json';
import { VirtualNetwork, type DropReason } from './network';
import { NodeRuntime, type NodeStatus } from './node';
import type { FiredTimer, IncomingMessage, MessageId, NodeContext, NodeId } from './protocol';
import { deriveStream, Xoshiro128 } from './random';
import { EventScheduler } from './scheduler';
import type { VirtualTime } from './time';
import { EventTrace, type EntryIndex, type RunStartEntry, type StopReason, type TraceEntry } from './trace';
import { ENGINE_VERSION } from './version';

/** Events that can sit in the scheduler queue. `cause` is the trace index that scheduled them. */
type SimEvent =
  | { readonly kind: 'node.start'; readonly node: NodeId; readonly cause: number }
  | { readonly kind: 'message.deliver'; readonly message: Envelope; readonly cause: number }
  | {
      readonly kind: 'timer.fire';
      readonly node: NodeId;
      readonly timer: FiredTimer;
      /** Incarnation that set the timer. Must equal the node's incarnation when it fires. */
      readonly incarnation: number;
      readonly cause: number;
    }
  | { readonly kind: 'fault'; readonly fault: Fault; readonly cause: number }
  /** Deadline of a bounded liveness check (CP4). `cause` is its `liveness.armed` entry. */
  | { readonly kind: 'liveness.deadline'; readonly check: number; readonly cause: number };

/** Mutable per-check liveness state (snapshotted). */
interface LivenessState {
  phase: LivenessPhase;
  since: VirtualTime | null;
  armedEntry: EntryIndex | null;
  deadlineSeq: number | null;
}

interface Envelope {
  readonly id: MessageId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly payload: JsonValue;
  readonly sentAt: VirtualTime;
}

export interface RunResult {
  /** Absolute index of `trace[0]`: 0 for a full trace, > 0 for a run restored without its prefix. */
  readonly traceStart: EntryIndex;
  readonly reason: StopReason;
  readonly eventsProcessed: number;
  readonly pendingEvents: number;
  readonly finalTime: VirtualTime;
  readonly trace: readonly TraceEntry[];
}

export interface NodeInfo {
  readonly status: NodeStatus;
  readonly incarnation: number;
}

/**
 * One deterministic simulation run.
 *
 * The main loop is: take the earliest live event from the scheduler, advance the virtual clock
 * to its time, and dispatch it — a protocol handler on a running node, a drop, or a fault from
 * the fault plan. A handler's buffered effects (which schedule new events) are applied only if
 * it succeeds, and everything is recorded in the trace. Nothing in this loop reads wall-clock
 * time, global randomness, or UI state.
 */
export class Simulation<S extends JsonValue = JsonValue, M extends JsonValue = JsonValue> {
  readonly config: ResolvedConfig<S, M>;
  #scheduler = new EventScheduler<SimEvent>();
  #trace = new EventTrace();
  #network: VirtualNetwork;
  /** The run.start entry: every input of the experiment (kept even when the trace is a segment). */
  readonly #inputs: RunStartEntry;
  /** Fingerprint of the entry before `firstIndex` when restored without a prefix. */
  #lastEntryBeforeSegment = '';
  readonly #nodes = new Map<NodeId, NodeRuntime>();
  /**
   * In-flight message index (CP2): exactly the messages with a pending `message.deliver` event,
   * in send order. Added when a delivery is scheduled; removed when that delivery event is
   * dispatched (delivered or dropped). Nothing else ever schedules or cancels deliveries.
   */
  readonly #inFlight = new Map<MessageId, InFlightMessage>();
  readonly #monitor: InvariantMonitor | null;
  readonly #liveness: LivenessState[];
  #eventsProcessed = 0;
  #stopReason: StopReason | null = null;

  constructor(config: SimulationConfig<S, M>) {
    this.config = resolveConfig(config);
    const { seed, nodes, protocol, network, limits, faults, invariants, invariantPolicy, liveness } = this.config;
    this.#network = new VirtualNetwork(network, deriveStream(seed, 'network'));
    this.#monitor = invariants.length === 0 ? null : new InvariantMonitor(invariants, invariantPolicy);
    this.#liveness = liveness.map(() => ({ phase: 'idle', since: null, armedEntry: null, deadlineSeq: null }));

    const runStart: EntryIndex = this.#trace.append({
      kind: 'run.start',
      time: 0,
      cause: null,
      engineVersion: ENGINE_VERSION,
      protocol: { name: protocol.name, version: protocol.version },
      seed,
      nodes,
      latency: network.latency,
      limits,
      persistence: 'sync-on-commit',
      faults,
      invariants: invariants.map((invariant) => invariant.ref),
      invariantPolicy,
      liveness: liveness.map((check) => check.ref),
    });

    this.#inputs = this.#trace.at(runStart) as RunStartEntry;
    for (const id of nodes) {
      const peers = Object.freeze(nodes.filter((other) => other !== id));
      this.#nodes.set(id, new NodeRuntime(id, peers, deriveStream(seed, `node:${id}`)));
      // All nodes start at t=0 in configuration order. These are the first events scheduled,
      // so they run before anything else at t=0, even a fault or a zero-latency message.
      this.#scheduler.schedule(0, { kind: 'node.start', node: id, cause: runStart });
    }
    // Plan faults are scheduled next, so at any given time they precede every event that is
    // scheduled during the run (ADR-0009). Among themselves they keep plan order.
    for (const fault of faults) {
      this.#scheduler.schedule(fault.at, { kind: 'fault', fault, cause: runStart });
    }
  }

  get now(): VirtualTime {
    return this.#scheduler.now;
  }

  get eventsProcessed(): number {
    return this.#eventsProcessed;
  }

  /** Completed simulation steps. Identical to `eventsProcessed`: one step dispatches one event. */
  get stepsCompleted(): StepCount {
    return this.#eventsProcessed;
  }

  /** Absolute index of the first retained trace entry (0 unless restored without a prefix). */
  get traceStart(): EntryIndex {
    return this.#trace.firstIndex;
  }

  /** Absolute index the next trace entry will receive. */
  get traceLength(): EntryIndex {
    return this.#trace.length;
  }

  /**
   * Release retained trace entries before `index` to bound memory in long runs. Absolute indices
   * of later entries are unaffected; released entries can be regenerated from keyframes. Has no
   * influence on execution (the engine never reads entries from earlier steps).
   */
  releaseTraceBefore(index: EntryIndex): void {
    this.#trace.releaseBefore(index);
  }

  get pendingEvents(): number {
    return this.#scheduler.pendingCount;
  }

  /** null while the run can continue; the reason it ended otherwise. */
  get stopReason(): StopReason | null {
    return this.#stopReason;
  }

  /** Frozen copy of the trace so far. */
  get trace(): readonly TraceEntry[] {
    return this.#trace.snapshot();
  }

  /** Scheduler diagnostics: live events, physical heap entries, compactions (ADR-0011). */
  get schedulerStats(): { readonly pending: number; readonly heapEntries: number; readonly compactions: number } {
    return this.#scheduler.stats;
  }

  /** Current volatile state of a node (deeply frozen), or undefined before it started or while crashed. */
  nodeState(id: NodeId): JsonValue | undefined {
    return this.#node(id).state;
  }

  /** Committed persistent storage of a node, as a frozen object with sorted keys. */
  nodeStorage(id: NodeId): Readonly<Record<string, JsonValue>> {
    const storage = this.#node(id).storage;
    return Object.freeze(Object.fromEntries([...storage.keys()].sort().map((key) => [key, storage.get(key) as JsonValue])));
  }

  /** Messages currently in flight, in send order (frozen). */
  inFlight(): readonly InFlightMessage[] {
    return Object.freeze([...this.#inFlight.values()]);
  }

  /** Ids of messages with a live delivery event in the scheduler (diagnostics; O(n log n)). */
  scheduledDeliveries(): readonly MessageId[] {
    return Object.freeze(
      this.#scheduler
        .liveEvents()
        .flatMap((scheduled) => (scheduled.event.kind === 'message.deliver' ? [scheduled.event.message.id] : [])),
    );
  }

  /** Current history of a historical invariant (deeply frozen), or undefined for an unknown id. */
  invariantHistory(id: string): JsonValue | undefined {
    return this.#monitor?.history(id);
  }

  nodeInfo(id: NodeId): NodeInfo {
    const node = this.#node(id);
    return Object.freeze({ status: node.status, incarnation: node.incarnation });
  }

  /**
   * Dispatch at most one event. Returns true if an event was dispatched.
   *
   * Limits are checked in a fixed order before each dispatch: quiescence first (so a run that
   * finishes on exactly its last allowed event is reported as quiescent), then maxEvents, then
   * maxTime. maxPendingEvents and protocol errors are checked after the dispatch that caused them.
   */
  step(): boolean {
    if (this.#stopReason !== null) return false;
    const { limits } = this.config;

    const upcoming = this.#scheduler.peek();
    if (upcoming === undefined) return this.#stop('quiescent');
    if (this.#eventsProcessed >= limits.maxEvents) return this.#stop('event-limit');
    if (limits.maxTime !== null && upcoming.time > limits.maxTime) return this.#stop('time-limit');

    const scheduled = this.#scheduler.next();
    if (scheduled === undefined) throw new EngineInvariantError('peeked event vanished');
    this.#eventsProcessed++;
    const stepStart = this.#trace.length;

    if (!this.#dispatch(scheduled.event)) {
      this.#stop('protocol-error');
      return true;
    }
    // One lazily built, frozen view per step, shared by invariants and liveness checks.
    let view: SimulationView | undefined;
    const getView = (): SimulationView => (view ??= this.#view());
    let reason: StopReason | null = null;
    if (this.#monitor !== null) reason = this.#checkInvariants(this.#monitor, stepStart, getView);
    if (this.#liveness.length > 0) {
      const livenessReason = this.#checkLiveness(stepStart, getView);
      reason ??= livenessReason;
    }
    if (reason !== null) {
      this.#stop(reason);
      return true;
    }
    if (this.#scheduler.pendingCount > limits.maxPendingEvents) this.#stop('pending-limit');
    return true;
  }

  /**
   * Evaluate every invariant after a committed step and record the outcomes in configuration
   * order (ADR-0013). Returns the stop reason, if the outcomes require stopping.
   */
  #checkInvariants(monitor: InvariantMonitor, stepStart: number, getView: () => SimulationView): StopReason | null {
    const trigger = this.#trace.at(stepStart);
    if (trigger === undefined) throw new EngineInvariantError('a committed step appended no trace entry');
    const step: StepInfo = Object.freeze({ trigger, entries: this.#trace.slice(stepStart) });
    const stepLast = this.#trace.length - 1;
    const outcomes = monitor.evaluate(getView(), step, (id) => typeof id === 'string' && this.#nodes.has(id), this.#trace.length);

    let error = false;
    let violation = false;
    const time = this.#scheduler.now;
    for (const outcome of outcomes) {
      switch (outcome.kind) {
        case 'violation': {
          violation = true;
          const { partition, links } = this.#network.conditions();
          this.#trace.append({
            kind: 'invariant.violation',
            time,
            cause: stepStart,
            violationId: outcome.violationId,
            invariant: outcome.invariant,
            nodes: outcome.nodes,
            expected: outcome.expected,
            observed: outcome.observed,
            evidence: outcome.evidence,
            references: outcome.references,
            trigger: stepStart,
            step: Object.freeze({ first: stepStart, last: stepLast }),
            nodeStates: Object.freeze(
              outcome.nodes.map((id) => {
                const node = this.#node(id);
                return Object.freeze({ node: id, status: node.status, incarnation: node.incarnation, stateEntry: node.stateEntry });
              }),
            ),
            activeFaults: Object.freeze({
              partition: partition?.since ?? null,
              links: Object.freeze(links.map((link) => link.since)),
              crashed: Object.freeze([...this.#nodes.values()].flatMap((node) => (node.crashedAt === null ? [] : [node.crashedAt]))),
            }),
            eventNumber: this.#eventsProcessed,
          });
          break;
        }
        case 'cleared':
          this.#trace.append({ kind: 'invariant.cleared', time, cause: stepStart, violationId: outcome.violationId, invariant: outcome.invariant });
          break;
        case 'error':
          error = true;
          this.#trace.append({ kind: 'invariant.error', time, cause: stepStart, invariant: outcome.invariant, error: outcome.error });
          break;
      }
    }
    if (error) return 'invariant-error';
    if (violation && this.config.invariantPolicy === 'stop-on-first') return 'invariant-violation';
    if (monitor.violations >= this.config.limits.maxViolations) return 'violation-limit';
    return null;
  }

  /**
   * Evaluate bounded liveness checks after a committed step (ADR-0019), in configuration order,
   * after the invariants. Liveness results never stop a run; only a failing check does.
   */
  #checkLiveness(stepStart: EntryIndex, getView: () => SimulationView): StopReason | null {
    const time = this.#scheduler.now;
    for (const [i, check] of this.config.liveness.entries()) {
      const state = this.#liveness[i]!;
      const ref = { id: check.ref.id, version: check.ref.version, name: check.ref.name };
      let assumptions: unknown;
      let progress: unknown;
      try {
        assumptions = check.assumptionsHold(getView());
        progress = check.progress(getView());
        if (typeof assumptions !== 'boolean' || typeof progress !== 'boolean') throw new TypeError('liveness checks must return booleans');
      } catch (error) {
        this.#trace.append({ kind: 'liveness.error', time, cause: stepStart, check: ref, error: describeError(error) });
        return 'liveness-error';
      }
      const since = state.since;
      if (!assumptions) {
        if (state.phase !== 'idle') {
          if (state.deadlineSeq !== null) this.#scheduler.cancel(state.deadlineSeq);
          this.#trace.append({ kind: 'liveness.disarmed', time, cause: stepStart, check: ref, since: since as number, previous: state.phase });
          Object.assign(state, { phase: 'idle', since: null, armedEntry: null, deadlineSeq: null });
        }
        continue;
      }
      // A new waiting period starts when the assumptions begin to hold, or when progress is lost
      // while they keep holding.
      if (state.phase === 'idle' || (state.phase === 'met' && !progress)) {
        const deadlineAt = time + check.ref.deadline;
        const armed = this.#trace.append({ kind: 'liveness.armed', time, cause: stepStart, check: ref, since: time, deadlineAt });
        Object.assign(state, { phase: 'waiting', since: time, armedEntry: armed, deadlineSeq: null });
        if (!progress) state.deadlineSeq = this.#scheduler.schedule(deadlineAt, { kind: 'liveness.deadline', check: i, cause: armed });
      }
      if (progress && (state.phase === 'waiting' || state.phase === 'missed')) {
        if (state.deadlineSeq !== null) this.#scheduler.cancel(state.deadlineSeq);
        const start = state.since as number;
        this.#trace.append({ kind: 'liveness.met', time, cause: stepStart, check: ref, since: start, duration: time - start, late: state.phase === 'missed' });
        Object.assign(state, { phase: 'met', deadlineSeq: null });
      }
    }
    return null;
  }

  /**
   * A deeply frozen, read-only view for invariants (ADR-0012). Storage snapshots, the in-flight
   * list and network conditions are built lazily on first access and cached for this step. No
   * engine object (Map, NodeRuntime, scheduler) is reachable from it.
   */
  #view(): SimulationView {
    const nodeViews = Object.freeze(
      [...this.#nodes.values()].map((node): NodeView => {
        let storage: Readonly<Record<string, JsonValue>> | undefined;
        const nodeStorage = (): Readonly<Record<string, JsonValue>> => (storage ??= this.nodeStorage(node.id));
        return Object.freeze({
          id: node.id,
          status: node.status,
          incarnation: node.incarnation,
          state: node.state,
          stateEntry: node.stateEntry,
          get storage() {
            return nodeStorage();
          },
        });
      }),
    );
    const byId = new Map(nodeViews.map((view) => [view.id, view]));
    let inFlight: readonly InFlightMessage[] | undefined;
    let network: SimulationView['network'] | undefined;
    const inFlightList = (): readonly InFlightMessage[] => (inFlight ??= Object.freeze([...this.#inFlight.values()]));
    const networkView = (): SimulationView['network'] => {
      if (network === undefined) {
        const { partition, links } = this.#network.conditions();
        network = Object.freeze({
          partition: partition?.groups ?? null,
          links: Object.freeze(links.map(({ from, to, loss, delay }) => Object.freeze({ from, to, loss, delay }))),
        });
      }
      return network;
    };
    const lookup = Object.freeze((id: NodeId): NodeView => {
      const view = byId.get(id);
      if (view === undefined) throw new RangeError(`unknown node ${String(id)}`);
      return view;
    });
    return Object.freeze({
      time: this.#scheduler.now,
      eventNumber: this.#eventsProcessed,
      nodes: nodeViews,
      node: lookup,
      get inFlight() {
        return inFlightList();
      },
      get network() {
        return networkView();
      },
    });
  }

  /** Step until a stop condition is reached. Always terminates because of `limits.maxEvents`. */
  run(): RunResult {
    while (this.#stopReason === null) this.step();
    return {
      traceStart: this.#trace.firstIndex,
      reason: this.#stopReason,
      eventsProcessed: this.#eventsProcessed,
      pendingEvents: this.#scheduler.pendingCount,
      finalTime: this.#scheduler.now,
      trace: this.#trace.snapshot(),
    };
  }

  /**
   * Capture the complete execution state at the current step boundary (ADR-0015). The API is
   * synchronous, so a snapshot can never observe a half-finished step. The result is deeply
   * frozen JSON that shares unchanged states and payloads with the live run (structural sharing).
   */
  snapshot(): SimulationSnapshot {
    const length = this.#trace.length;
    const last = this.#trace.at(length - 1);
    const { partition, links } = this.#network.conditions();
    const raw = {
      format: SNAPSHOT_FORMAT,
      engineVersion: ENGINE_VERSION,
      inputs: this.#inputs,
      position: {
        stepsCompleted: this.#eventsProcessed,
        traceLength: length,
        time: this.#scheduler.now,
        lastEntryFingerprint: last === undefined ? this.#lastEntryBeforeSegment : entryFingerprint(last),
      },
      stopReason: this.#stopReason,
      scheduler: {
        nextSeq: this.#scheduler.nextSeq,
        events: this.#scheduler.liveEvents().map(({ time, seq, event }) => ({ time, seq, event: toSnapshotEvent(event, this.config.liveness.map((c) => c.ref.id)) })),
      },
      network: { random: this.#network.randomState(), partition, links },
      nodes: [...this.#nodes.values()].map((node) => ({
        id: node.id,
        status: node.status,
        incarnation: node.incarnation,
        crashedAt: node.crashedAt,
        stateEntry: node.stateEntry,
        state: node.state === undefined ? null : { value: node.state },
        storage: [...node.storage],
        messagesSent: node.messagesSent,
        timersSet: node.timersSet,
        timers: [...node.timers],
        random: node.random.getState(),
      })),
      invariants: this.#monitor?.exportState() ?? null,
      liveness:
        this.#liveness.length === 0
          ? null
          : {
              checks: this.#liveness.map((state, i) => ({
                id: this.config.liveness[i]!.ref.id,
                version: this.config.liveness[i]!.ref.version,
                phase: state.phase,
                since: state.since,
                armedEntry: state.armedEntry,
                deadlineSeq: state.deadlineSeq,
              })),
            },
    };
    return toFrozenJson(raw, 'snapshot') as unknown as SimulationSnapshot;
  }

  /**
   * Rebuild a simulation from a snapshot (ADR-0015, ADR-0016). `snapshot` is treated as
   * UNTRUSTED and validated against `config` (see snapshot.ts); invalid input throws SnapshotError.
   *
   * - With `tracePrefix` (the trace up to the snapshot), the restored run holds the full trace.
   * - Without it, the run holds a trace SEGMENT starting at the snapshot's absolute position, so
   *   every new entry keeps the index (and causal references) of an uninterrupted run.
   */
  static restore<S extends JsonValue, M extends JsonValue>(
    config: SimulationConfig<S, M>,
    snapshot: unknown,
    options: { readonly tracePrefix?: readonly TraceEntry[] } = {},
  ): Simulation<S, M> {
    const sim = new Simulation(config);
    const prefix = options.tracePrefix ?? null;
    if (prefix !== null && (prefix[0]?.kind !== 'run.start' || entryFingerprint(prefix[0]) !== entryFingerprint(sim.#inputs))) {
      throw new SnapshotError('tracePrefix', 'does not start with the run.start of this configuration');
    }
    const valid = validateSnapshot(snapshot, sim.config as unknown as ResolvedConfig<JsonValue, JsonValue>, sim.#inputs, prefix);
    sim.#load(valid, prefix);
    return sim;
  }

  #load(snap: SimulationSnapshot, prefix: readonly TraceEntry[] | null): void {
    const { position } = snap;
    this.#trace = prefix === null ? new EventTrace(position.traceLength) : new EventTrace(0, prefix);
    this.#lastEntryBeforeSegment = position.lastEntryFingerprint;
    const faults = new Map(this.config.faults.map((fault) => [fault.id, fault]));
    const checkIndex = new Map(this.config.liveness.map((check, i) => [check.ref.id, i]));
    this.#scheduler = EventScheduler.restore<SimEvent>({
      now: position.time,
      nextSeq: snap.scheduler.nextSeq,
      events: snap.scheduler.events.map(({ time, seq, event }) => ({ time, seq, event: fromSnapshotEvent(event, faults, checkIndex) })),
    });
    snap.liveness?.checks.forEach((saved, i) => {
      Object.assign(this.#liveness[i]!, { phase: saved.phase, since: saved.since, armedEntry: saved.armedEntry, deadlineSeq: saved.deadlineSeq });
    });
    this.#network = new VirtualNetwork(this.config.network, Xoshiro128.fromState(snap.network.random));
    if (snap.network.partition !== null) this.#network.partition(snap.network.partition.groups, snap.network.partition.since);
    for (const link of snap.network.links) this.#network.setLink(link.from, link.to, link, link.since);

    this.#nodes.clear();
    for (const saved of snap.nodes) {
      const peers = Object.freeze(this.config.nodes.filter((other) => other !== saved.id));
      const node = new NodeRuntime(saved.id, peers, Xoshiro128.fromState(saved.random));
      node.status = saved.status;
      node.incarnation = saved.incarnation;
      node.crashedAt = saved.crashedAt;
      node.stateEntry = saved.stateEntry;
      node.state = saved.state === null ? undefined : saved.state.value;
      node.messagesSent = saved.messagesSent;
      node.timersSet = saved.timersSet;
      for (const [key, value] of saved.storage) node.storage.set(key, value);
      for (const [timerId, seq] of saved.timers) node.timers.set(timerId, seq);
      this.#nodes.set(saved.id, node);
    }

    // The in-flight index is derived, not stored: exactly the pending deliveries, in send order.
    this.#inFlight.clear();
    const deliveries = snap.scheduler.events
      .flatMap(({ time, event }) => (event.kind === 'message.deliver' ? [{ time, event }] : []))
      .sort((a, b) => a.event.cause - b.event.cause);
    for (const { time, event } of deliveries) {
      const { id, from, to, payload, sentAt } = event.message;
      this.#inFlight.set(id, Object.freeze({ id, from, to, payload, sentAt, deliverAt: time, sendIndex: event.cause }));
    }

    this.#eventsProcessed = position.stepsCompleted;
    this.#stopReason = snap.stopReason;
    if (this.#monitor !== null && snap.invariants !== null) this.#monitor.importState(snap.invariants);
  }

  #stop(reason: StopReason): false {
    this.#stopReason = reason;
    this.#trace.append({
      kind: 'run.end',
      time: this.#scheduler.now,
      cause: null,
      reason,
      eventsProcessed: this.#eventsProcessed,
      pendingEvents: this.#scheduler.pendingCount,
    });
    return false;
  }

  #node(id: NodeId): NodeRuntime {
    const node = this.#nodes.get(id);
    if (node === undefined) throw new EngineInvariantError(`unknown node ${id}`);
    return node;
  }

  /** Returns false if a protocol handler failed. */
  #dispatch(event: SimEvent): boolean {
    const { protocol } = this.config;
    const time = this.#scheduler.now;

    switch (event.kind) {
      case 'node.start': {
        const node = this.#node(event.node);
        node.boot();
        const entry = this.#trace.append({ kind: 'node.start', time, cause: event.cause, node: node.id, incarnation: node.incarnation });
        return this.#invoke(node, entry, (ctx) => protocol.init(ctx));
      }

      case 'message.deliver': {
        const { message } = event;
        const node = this.#node(message.to);
        // The delivery event is being dispatched: whatever happens next, it is no longer in flight.
        if (!this.#inFlight.delete(message.id)) throw new EngineInvariantError(`message ${message.id} missing from the in-flight index`);
        // Network first: a message cut off by a partition never reached the machine at all.
        const partitionIndex = this.#network.blockedAtDelivery(message.from, message.to);
        if (partitionIndex !== null) {
          this.#drop(message, 'partitioned-in-flight', partitionIndex, event.cause);
          return true;
        }
        if (node.status === 'crashed') {
          this.#drop(message, 'node-down', node.crashedAt as number, event.cause);
          return true;
        }
        if (node.status !== 'running') throw new EngineInvariantError(`delivery to ${node.id} before it started`);

        const entry = this.#trace.append({
          kind: 'message.deliver',
          time,
          cause: event.cause,
          node: node.id,
          incarnation: node.incarnation,
          from: message.from,
          messageId: message.id,
          payload: message.payload,
        });
        const incoming: IncomingMessage<M> = Object.freeze({
          id: message.id,
          from: message.from,
          sentAt: message.sentAt,
          payload: message.payload as M,
        });
        return this.#invoke(node, entry, (ctx) => protocol.onMessage(node.state as S, incoming, ctx));
      }

      case 'timer.fire': {
        const node = this.#node(event.node);
        // A crash cancels every pending timer eagerly, so this can only fail through an engine
        // bug. It is asserted anyway: a stale timer firing would silently corrupt the trace.
        if (node.status !== 'running' || event.incarnation !== node.incarnation) {
          throw new EngineInvariantError(
            `timer ${event.timer.id} of incarnation ${event.incarnation} reached ${node.id} ` +
              `(status ${node.status}, incarnation ${node.incarnation})`,
          );
        }
        node.timers.delete(event.timer.id);
        const entry = this.#trace.append({
          kind: 'timer.fire',
          time,
          cause: event.cause,
          node: node.id,
          incarnation: node.incarnation,
          timerId: event.timer.id,
          tag: event.timer.tag,
        });
        return this.#invoke(node, entry, (ctx) => protocol.onTimer(node.state as S, event.timer, ctx));
      }

      case 'fault':
        return this.#applyFault(event.fault, event.cause);

      case 'liveness.deadline': {
        // The deadline of a waiting period is reached: the expected progress did not happen.
        // Progress or broken assumptions would have cancelled this event, so it is always a miss.
        const state = this.#liveness[event.check];
        const check = this.config.liveness[event.check];
        if (state?.phase !== 'waiting' || check === undefined) throw new EngineInvariantError('stale liveness deadline dispatched');
        this.#trace.append({
          kind: 'liveness.missed',
          time,
          cause: event.cause,
          check: { id: check.ref.id, version: check.ref.version, name: check.ref.name },
          since: state.since as number,
          deadlineAt: time,
          assumptions: check.ref.assumptions,
        });
        Object.assign(state, { phase: 'missed', deadlineSeq: null });
        return true;
      }
    }
  }

  /** Apply one fault from the plan. Every fault yields exactly one trace entry (applied or skipped). */
  #applyFault(fault: Fault, cause: number): boolean {
    const time = this.#scheduler.now;
    const base = { time, cause, faultId: fault.id } as const;

    switch (fault.type) {
      case 'crash': {
        const node = this.#node(fault.node);
        if (node.status === 'idle') throw new EngineInvariantError(`crash of ${node.id} before it started`);
        if (node.status === 'crashed') {
          this.#trace.append({ ...base, kind: 'fault.skipped', faultType: 'crash', node: node.id, reason: 'already-crashed' });
          return true;
        }
        const cancelled = node.crash();
        for (const [, seq] of cancelled) this.#scheduler.cancel(seq);
        node.crashedAt = this.#trace.append({
          ...base,
          kind: 'node.crash',
          node: node.id,
          incarnation: node.incarnation,
          cancelledTimers: cancelled.map(([timerId]) => timerId),
        });
        return true;
      }

      case 'recover': {
        const node = this.#node(fault.node);
        if (node.status === 'idle') throw new EngineInvariantError(`recovery of ${node.id} before it started`);
        if (node.status === 'running') {
          this.#trace.append({ ...base, kind: 'fault.skipped', faultType: 'recover', node: node.id, reason: 'not-crashed' });
          return true;
        }
        node.boot();
        const entry = this.#trace.append({ ...base, kind: 'node.recover', node: node.id, incarnation: node.incarnation });
        return this.#invoke(node, entry, (ctx) => this.config.protocol.init(ctx));
      }

      case 'partition': {
        const entry = this.#trace.append({ ...base, kind: 'network.partition', groups: fault.groups });
        this.#network.partition(fault.groups, entry);
        return true;
      }

      case 'heal':
        this.#trace.append({ ...base, kind: 'network.heal' });
        this.#network.heal();
        return true;

      case 'link': {
        const entry = this.#trace.append({ ...base, kind: 'link.fault', from: fault.from, to: fault.to, loss: fault.loss, delay: fault.delay });
        this.#network.setLink(fault.from, fault.to, fault, entry);
        return true;
      }

      case 'link-restore':
        this.#trace.append({ ...base, kind: 'link.restore', from: fault.from, to: fault.to });
        this.#network.restoreLink(fault.from, fault.to);
        return true;
    }
  }

  #drop(message: Envelope, reason: DropReason, conditionIndex: number, sendIndex: number): void {
    this.#trace.append({
      kind: 'message.drop',
      time: this.#scheduler.now,
      cause: sendIndex,
      node: message.to,
      from: message.from,
      messageId: message.id,
      reason,
      conditionIndex,
    });
  }

  /**
   * Run one protocol handler as an atomic step. Exceptions thrown by protocol code (including
   * API misuse and invalid state) are recorded as `protocol.error`; engine bugs outside the
   * handler call are not caught and propagate to the caller.
   *
   * Commit order within a step: storage writes (durable first), then effects in call order,
   * then the state update.
   */
  #invoke(node: NodeRuntime, cause: number, handler: (ctx: NodeContext<M>) => S): boolean {
    const context = createNodeContext<M>(node, {
      now: this.#scheduler.now,
      isNode: (id) => this.#nodes.has(id),
      maxEffects: this.config.limits.maxPendingEvents,
    });
    let nextState: JsonValue;
    try {
      const result: unknown = handler(context.api);
      nextState = node.state !== undefined && result === node.state ? node.state : toFrozenJson(result, 'state');
    } catch (error) {
      this.#trace.append({
        kind: 'protocol.error',
        time: this.#scheduler.now,
        cause,
        node: node.id,
        incarnation: node.incarnation,
        error: describeError(error),
      });
      return false;
    } finally {
      context.expire();
    }

    const { effects, storageWrites } = context.commit();
    this.#commitStorage(node, storageWrites, cause);
    this.#applyEffects(node, effects, cause);
    if (nextState !== node.state) {
      node.state = nextState;
      node.stateEntry = this.#trace.append({
        kind: 'state.update',
        time: this.#scheduler.now,
        cause,
        node: node.id,
        incarnation: node.incarnation,
        state: nextState,
      });
    }
    return true;
  }

  #commitStorage(node: NodeRuntime, writes: StorageWrites, cause: number): void {
    if (writes.size === 0) return;
    const set: Record<string, JsonValue> = {};
    const deleted: string[] = [];
    for (const key of [...writes.keys()].sort()) {
      const value = writes.get(key);
      if (value === undefined) {
        node.storage.delete(key);
        deleted.push(key);
      } else {
        node.storage.set(key, value);
        Object.defineProperty(set, key, { value, enumerable: true });
      }
    }
    this.#trace.append({
      kind: 'storage.write',
      time: this.#scheduler.now,
      cause,
      node: node.id,
      incarnation: node.incarnation,
      set: Object.freeze(set),
      deleted: Object.freeze(deleted),
    });
  }

  #applyEffects(node: NodeRuntime, effects: readonly Effect[], cause: number): void {
    const now = this.#scheduler.now;
    for (const effect of effects) {
      switch (effect.kind) {
        case 'send': {
          const decision = this.#network.route(node.id, effect.to, now);
          const sendIndex = this.#trace.append({
            kind: 'message.send',
            time: now,
            cause,
            node: node.id,
            incarnation: node.incarnation,
            to: effect.to,
            messageId: effect.id,
            payload: effect.payload,
            deliverAt: decision.kind === 'deliver' ? decision.deliverAt : null,
          });
          const message: Envelope = { id: effect.id, from: node.id, to: effect.to, payload: effect.payload, sentAt: now };
          if (decision.kind === 'drop') {
            this.#drop(message, decision.reason, decision.conditionIndex, sendIndex);
          } else {
            this.#scheduler.schedule(decision.deliverAt, { kind: 'message.deliver', message, cause: sendIndex });
            this.#inFlight.set(
              effect.id,
              Object.freeze({ id: effect.id, from: node.id, to: effect.to, payload: effect.payload, sentAt: now, deliverAt: decision.deliverAt, sendIndex }),
            );
          }
          break;
        }
        case 'set-timer': {
          const fireAt = now + effect.delay;
          const setIndex = this.#trace.append({
            kind: 'timer.set',
            time: now,
            cause,
            node: node.id,
            incarnation: node.incarnation,
            timerId: effect.id,
            tag: effect.tag,
            fireAt,
          });
          const timer: FiredTimer = Object.freeze({ id: effect.id, tag: effect.tag, setAt: now });
          const seq = this.#scheduler.schedule(fireAt, {
            kind: 'timer.fire',
            node: node.id,
            timer,
            incarnation: node.incarnation,
            cause: setIndex,
          });
          node.timers.set(effect.id, seq);
          break;
        }
        case 'cancel-timer': {
          const seq = node.timers.get(effect.id);
          if (seq === undefined) break; // already fired, already cancelled, or never existed
          this.#scheduler.cancel(seq);
          node.timers.delete(effect.id);
          this.#trace.append({ kind: 'timer.cancel', time: now, cause, node: node.id, incarnation: node.incarnation, timerId: effect.id });
          break;
        }
      }
    }
  }
}

/** Convenience: build a simulation and run it to completion. */
export function runSimulation<S extends JsonValue, M extends JsonValue>(config: SimulationConfig<S, M>): RunResult {
  return new Simulation(config).run();
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return `non-Error thrown: ${String(error)}`;
  } catch {
    return 'non-Error thrown';
  }
}

function toSnapshotEvent(event: SimEvent, livenessIds: readonly string[]): SnapshotEvent {
  switch (event.kind) {
    case 'fault':
      return { kind: 'fault', faultId: event.fault.id, cause: event.cause };
    case 'liveness.deadline':
      return { kind: 'liveness.deadline', checkId: livenessIds[event.check] as string, cause: event.cause };
    case 'message.deliver': {
      const { id, from, to, payload, sentAt } = event.message;
      return { kind: 'message.deliver', message: { id, from, to, payload, sentAt }, cause: event.cause };
    }
    default:
      return event;
  }
}

function fromSnapshotEvent(event: SnapshotEvent, faults: ReadonlyMap<string, Fault>, checks: ReadonlyMap<string, number>): SimEvent {
  switch (event.kind) {
    case 'fault':
      return { kind: 'fault', fault: faults.get(event.faultId) as Fault, cause: event.cause };
    case 'liveness.deadline':
      return { kind: 'liveness.deadline', check: checks.get(event.checkId) as number, cause: event.cause };
    case 'timer.fire':
      return { ...event, timer: Object.freeze({ ...event.timer }) };
    default:
      return event;
  }
}
