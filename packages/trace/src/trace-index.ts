import type { EntryIndex, JsonValue, LatencyRange, NodeId, NodeStatus, TraceEntry } from '@faultlab/engine';

/**
 * TraceIndex: fast, exact, READ-ONLY reconstruction of what a trace says at any entry
 * (ADR-0017). It never executes or modifies a simulation, and it shows only what the trace
 * records. Not observable in a trace, and therefore never reconstructed here: PRNG states,
 * scheduler sequence numbers and queue layout, invariant histories, and id counters. Use an
 * engine snapshot (@faultlab/engine) when those are needed.
 *
 * Units (SEMANTICS §13): `checkpointEntries` counts TRACE ENTRIES. `frameAt(i)` starts from the
 * nearest checkpoint ≤ i and applies at most `checkpointEntries − 1` entries, however many
 * simulation steps they span.
 */

type EntryOf<K extends TraceEntry['kind']> = Extract<TraceEntry, { kind: K }>;
export type InvariantViolationEntry = EntryOf<'invariant.violation'>;
export type RunStartEntry = EntryOf<'run.start'>;
export type RunEndEntry = EntryOf<'run.end'>;

/** 1-based number of a simulation step; step 0 is the initial state recorded by run.start. */
export type StepNumber = number;

export interface MessageRecord {
  readonly id: string;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly sendIndex: EntryIndex;
  readonly sentAt: number;
  /** null when the network dropped it at send time. */
  readonly deliverAt: number | null;
  readonly payload: JsonValue;
  /** Index of its message.deliver / message.drop entry; null if still in flight when the trace ends. */
  readonly resolvedIndex: EntryIndex | null;
  readonly outcome: 'delivered' | 'dropped' | 'in-flight';
  readonly dropReason: string | null;
}

export interface PendingTimer {
  readonly timerId: string;
  readonly tag: string;
  readonly fireAt: number;
  readonly setIndex: EntryIndex;
}

export interface NodeFrame {
  readonly id: NodeId;
  readonly status: NodeStatus;
  readonly incarnation: number;
  /** Volatile state from the latest state.update; undefined before start, after a crash, and between a (re)start and its first state.update. */
  readonly state: JsonValue | undefined;
  /** Entry that produced `state`. */
  readonly stateEntry: EntryIndex | null;
  readonly storage: Readonly<Record<string, JsonValue>>;
  /** Timers set and neither fired nor cancelled (a crash cancels all), in the order they were set. */
  readonly pendingTimers: readonly PendingTimer[];
}

export interface InFlightFrame {
  readonly record: MessageRecord;
  /** Position along the link in [0, 1], linear in virtual time (display only). */
  readonly progress: number;
}

export interface DropFrame {
  readonly record: MessageRecord;
  readonly reason: string;
  /** 0 = stopped at the sender (send-time drop), 1 = at the receiver (delivery-time drop). */
  readonly at: 0 | 1;
  readonly age: number;
}

/** Phase of a bounded-liveness check at a trace position (CP4). */
export interface LivenessFrame {
  readonly id: string;
  readonly phase: 'idle' | 'waiting' | 'met' | 'missed';
  /** When the current period's assumptions started to hold. */
  readonly since: number | null;
  /** The configured test bound for the current period. */
  readonly deadlineAt: number | null;
}

export interface Frame {
  readonly index: EntryIndex;
  readonly entry: TraceEntry;
  /** The step this entry belongs to (0 = run.start; null = a run.end that belongs to no step). */
  readonly step: StepNumber | null;
  readonly time: number;
  readonly nodes: readonly NodeFrame[];
  readonly partition: readonly (readonly NodeId[])[] | null;
  readonly links: readonly { readonly from: NodeId; readonly to: NodeId; readonly loss: number; readonly delay: LatencyRange }[];
  readonly inFlight: readonly InFlightFrame[];
  readonly recentDrops: readonly DropFrame[];
  /** Violations recorded at or before this entry whose episode is still open. */
  readonly openViolations: readonly InvariantViolationEntry[];
  /** Bounded-liveness phases, one per configured check (empty if none). Never safety results. */
  readonly liveness: readonly LivenessFrame[];
  readonly stopped: boolean;
}

export interface StepRange {
  readonly step: StepNumber;
  /** The trigger entry: the dispatched event. */
  readonly first: EntryIndex;
  readonly last: EntryIndex;
}

export type MarkerKind =
  | 'crash'
  | 'recover'
  | 'partition'
  | 'heal'
  | 'link-fault'
  | 'link-restore'
  | 'fault-skipped'
  | 'violation'
  | 'violation-cleared'
  | 'invariant-error'
  | 'protocol-error'
  | 'liveness-met'
  | 'liveness-missed'
  | 'run-end';

export interface Marker {
  readonly kind: MarkerKind;
  readonly index: EntryIndex;
  readonly time: number;
  readonly nodes: readonly NodeId[];
  readonly label: string;
}

export interface Consequences {
  /** Entries whose `cause` is this entry. */
  readonly direct: readonly EntryIndex[];
  /** Drops whose `conditionIndex` names this (fault) entry as the reason. */
  readonly explained: readonly EntryIndex[];
}

/** How long (virtual ticks) a dropped message stays visible as a marker in frames. */
export const DROP_MARKER_TICKS = 12;
export const DEFAULT_CHECKPOINT_ENTRIES = 256;

/** Entry kinds that start a simulation step (the dispatched event). */
const TRIGGER_KINDS: ReadonlySet<TraceEntry['kind']> = new Set([
  'node.start',
  'message.deliver',
  'timer.fire',
  'node.crash',
  'node.recover',
  'network.partition',
  'network.heal',
  'link.fault',
  'link.restore',
  'fault.skipped',
  'liveness.missed', // the deadline event of a bounded-liveness check (CP4)
] as const);

export function isStepTrigger(entry: TraceEntry): boolean {
  if (entry.kind === 'message.drop') return entry.reason === 'partitioned-in-flight' || entry.reason === 'node-down';
  return TRIGGER_KINDS.has(entry.kind);
}

// ── mutable working state (never exposed) ──────────────────────────────────────────────────

interface WorkingNode {
  status: NodeStatus;
  incarnation: number;
  state: JsonValue | undefined;
  stateEntry: EntryIndex | null;
  storage: Record<string, JsonValue>;
  timers: Map<string, PendingTimer>;
}

interface Working {
  nodes: Map<NodeId, WorkingNode>;
  partition: readonly (readonly NodeId[])[] | null;
  links: Map<string, { from: NodeId; to: NodeId; loss: number; delay: LatencyRange }>;
  inFlight: Map<string, MessageRecord>;
  open: Map<string, InvariantViolationEntry>;
  liveness: Map<string, LivenessFrame>;
  stopped: boolean;
}

function cloneWorking(w: Working): Working {
  return {
    nodes: new Map([...w.nodes].map(([id, n]) => [id, { ...n, storage: { ...n.storage }, timers: new Map(n.timers) }])),
    partition: w.partition,
    links: new Map(w.links),
    inFlight: new Map(w.inFlight),
    open: new Map(w.open),
    liveness: new Map(w.liveness),
    stopped: w.stopped,
  };
}

/**
 * Apply one entry to the working state. MUST stay idempotent per entry
 * (apply(apply(W, e), e) = apply(W, e)): checkpoint correctness does not depend on it today,
 * but the CP3 mutation analysis (S22) does, and a non-idempotent update would need a test.
 */
function apply(w: Working, e: TraceEntry, messages: ReadonlyMap<string, MessageRecord>): void {
  switch (e.kind) {
    case 'node.start':
    case 'node.recover':
      Object.assign(w.nodes.get(e.node)!, { status: 'running', incarnation: e.incarnation, state: undefined, stateEntry: null });
      break;
    case 'node.crash': {
      const node = w.nodes.get(e.node)!;
      Object.assign(node, { status: 'crashed', state: undefined, stateEntry: null });
      node.timers.clear();
      break;
    }
    case 'state.update':
      Object.assign(w.nodes.get(e.node)!, { state: e.state, stateEntry: e.index });
      break;
    case 'storage.write': {
      const node = w.nodes.get(e.node)!;
      node.storage = { ...node.storage, ...e.set };
      for (const key of e.deleted) delete node.storage[key];
      break;
    }
    case 'timer.set':
      w.nodes.get(e.node)!.timers.set(e.timerId, Object.freeze({ timerId: e.timerId, tag: e.tag, fireAt: e.fireAt, setIndex: e.index }));
      break;
    case 'timer.fire':
    case 'timer.cancel':
      w.nodes.get(e.node)!.timers.delete(e.timerId);
      break;
    case 'message.send':
      if (e.deliverAt !== null) w.inFlight.set(e.messageId, messages.get(e.messageId)!);
      break;
    case 'message.deliver':
    case 'message.drop':
      w.inFlight.delete(e.messageId);
      break;
    case 'network.partition':
      w.partition = e.groups;
      break;
    case 'network.heal':
      w.partition = null;
      break;
    case 'link.fault':
      w.links.delete(`${e.from}>${e.to}`); // re-insert: same "order set" as the engine
      w.links.set(`${e.from}>${e.to}`, { from: e.from, to: e.to, loss: e.loss, delay: e.delay });
      break;
    case 'link.restore':
      w.links.delete(`${e.from}>${e.to}`);
      break;
    case 'invariant.violation':
      w.open.set(e.invariant.id, e);
      break;
    case 'invariant.cleared':
      w.open.delete(e.invariant.id);
      break;
    case 'liveness.armed':
      w.liveness.set(e.check.id, Object.freeze({ id: e.check.id, phase: 'waiting', since: e.since, deadlineAt: e.deadlineAt }));
      break;
    case 'liveness.met':
    case 'liveness.missed': {
      const previous = w.liveness.get(e.check.id);
      w.liveness.set(e.check.id, Object.freeze({ id: e.check.id, phase: e.kind === 'liveness.met' ? 'met' : 'missed', since: e.since, deadlineAt: previous?.deadlineAt ?? null }));
      break;
    }
    case 'liveness.disarmed':
      w.liveness.set(e.check.id, Object.freeze({ id: e.check.id, phase: 'idle', since: null, deadlineAt: null }));
      break;
    case 'run.end':
      w.stopped = true;
      break;
  }
}

export class TraceIndex {
  readonly trace: readonly TraceEntry[];
  readonly start: RunStartEntry;
  readonly end: RunEndEntry | null;
  readonly checkpointEntries: number;
  readonly messages: readonly MessageRecord[];
  readonly violations: readonly InvariantViolationEntry[];
  readonly steps: readonly StepRange[];
  readonly markers: readonly Marker[];
  /** Entries applied by the most recent `frameAt` call (for verifying the documented bound). */
  lastFrameCost = 0;

  readonly #messagesById: ReadonlyMap<string, MessageRecord>;
  readonly #checkpoints: readonly Working[];
  readonly #stepOfEntry: Int32Array;
  readonly #children: readonly (readonly EntryIndex[])[];
  readonly #explained: ReadonlyMap<EntryIndex, readonly EntryIndex[]>;
  readonly #dropIndices: readonly EntryIndex[];

  private constructor(trace: readonly TraceEntry[], checkpointEntries: number) {
    const start = trace[0];
    if (start?.kind !== 'run.start') throw new Error('TraceIndex needs a complete trace starting with run.start');
    if (trace.some((e, i) => e.index !== i)) throw new Error('TraceIndex needs a complete trace with entries #0…#n in order');
    if (!Number.isSafeInteger(checkpointEntries) || checkpointEntries < 1) throw new RangeError('checkpointEntries must be a positive integer');
    this.trace = trace;
    this.start = start;
    const last = trace.at(-1)!;
    this.end = last.kind === 'run.end' ? last : null;
    this.checkpointEntries = checkpointEntries;

    // Messages: final outcomes are known from the whole trace.
    const messages: MessageRecord[] = [];
    const byId = new Map<string, MessageRecord>();
    const outcome = new Map<string, EntryOf<'message.deliver'> | EntryOf<'message.drop'>>();
    for (const e of trace) if (e.kind === 'message.deliver' || e.kind === 'message.drop') outcome.set(e.messageId, e);
    for (const e of trace) {
      if (e.kind !== 'message.send') continue;
      const resolved = outcome.get(e.messageId);
      const record: MessageRecord = Object.freeze({
        id: e.messageId,
        from: e.node,
        to: e.to,
        sendIndex: e.index,
        sentAt: e.time,
        deliverAt: e.deliverAt,
        payload: e.payload,
        resolvedIndex: resolved?.index ?? null,
        outcome: resolved === undefined ? 'in-flight' : resolved.kind === 'message.deliver' ? 'delivered' : 'dropped',
        dropReason: resolved?.kind === 'message.drop' ? resolved.reason : null,
      });
      messages.push(record);
      byId.set(record.id, record);
    }
    this.messages = Object.freeze(messages);
    this.#messagesById = byId;

    // Steps, causal links, markers, checkpoints in one pass.
    const stepOf = new Int32Array(trace.length).fill(-1);
    const steps: StepRange[] = [];
    const children: EntryIndex[][] = trace.map(() => []);
    const explained = new Map<EntryIndex, EntryIndex[]>();
    const markers: Marker[] = [];
    const violations: InvariantViolationEntry[] = [];
    const drops: EntryIndex[] = [];
    const checkpoints: Working[] = [];
    const w: Working = {
      nodes: new Map(start.nodes.map((id) => [id, { status: 'idle', incarnation: 0, state: undefined, stateEntry: null, storage: {}, timers: new Map() }])),
      partition: null,
      links: new Map(),
      inFlight: new Map(),
      open: new Map(),
      liveness: new Map(start.liveness.map((c) => [c.id, Object.freeze({ id: c.id, phase: 'idle' as const, since: null, deadlineAt: null })])),
      stopped: false,
    };
    let step = 0;
    stepOf[0] = 0;
    for (const e of trace) {
      if (e.index > 0) {
        const standaloneEnd = e.kind === 'run.end' && ['quiescent', 'event-limit', 'time-limit'].includes(e.reason);
        if (isStepTrigger(e)) {
          step++;
          steps.push({ step, first: e.index, last: e.index });
        }
        if (!standaloneEnd && step > 0) {
          stepOf[e.index] = step;
          (steps[step - 1] as { last: number }).last = e.index;
        }
      }
      if (e.cause !== null) children[e.cause]!.push(e.index);
      if (e.kind === 'message.drop') {
        drops.push(e.index);
        const list = explained.get(e.conditionIndex) ?? [];
        list.push(e.index);
        explained.set(e.conditionIndex, list);
      }
      if (e.kind === 'invariant.violation') violations.push(e);
      const marker = markerFor(e);
      if (marker !== null) markers.push(marker);
      if (e.index % checkpointEntries === 0) checkpoints.push(cloneWorking(w)); // state BEFORE applying entry e
      apply(w, e, byId);
    }
    this.steps = Object.freeze(steps.map((s) => Object.freeze(s)));
    this.#stepOfEntry = stepOf;
    this.#children = children;
    this.#explained = explained;
    this.markers = Object.freeze(markers);
    this.violations = Object.freeze(violations);
    this.#dropIndices = drops;
    this.#checkpoints = checkpoints;
  }

  static build(trace: readonly TraceEntry[], options: { readonly checkpointEntries?: number } = {}): TraceIndex {
    return new TraceIndex(trace, options.checkpointEntries ?? DEFAULT_CHECKPOINT_ENTRIES);
  }

  get length(): number {
    return this.trace.length;
  }

  get duration(): number {
    return this.trace.at(-1)!.time;
  }

  entry(index: EntryIndex): TraceEntry {
    const entry = this.trace[index];
    if (entry === undefined) throw new RangeError(`no entry #${index}`);
    return entry;
  }

  /** The step an entry belongs to: 0 for run.start, null for a run.end that belongs to no step. */
  stepOf(index: EntryIndex): StepNumber | null {
    this.entry(index);
    const step = this.#stepOfEntry[index]!;
    return step < 0 ? null : step;
  }

  /** Entry range of a step (1-based). */
  step(step: StepNumber): StepRange {
    const range = this.steps[step - 1];
    if (range === undefined) throw new RangeError(`no step ${step}`);
    return range;
  }

  /**
   * The world as the trace describes it after entry `index` (inclusive). `displayTime` only
   * positions messages along their links between entries; it never changes what has happened.
   */
  frameAt(index: EntryIndex, displayTime?: number): Frame {
    const cursor = Math.max(0, Math.min(index, this.trace.length - 1));
    const checkpoint = Math.floor(cursor / this.checkpointEntries);
    const w = cloneWorking(this.#checkpoints[checkpoint]!);
    let applied = 0;
    for (let i = checkpoint * this.checkpointEntries; i <= cursor; i++) {
      apply(w, this.trace[i]!, this.#messagesById);
      applied++;
    }
    this.lastFrameCost = applied - 1; // the entry at `cursor` itself is always applied
    const entry = this.trace[cursor]!;
    const time = Math.max(displayTime ?? 0, entry.time);

    const inFlight: InFlightFrame[] = [];
    for (const record of w.inFlight.values()) {
      const span = (record.deliverAt as number) - record.sentAt;
      inFlight.push(Object.freeze({ record, progress: span <= 0 ? 1 : Math.min(1, Math.max(0, (time - record.sentAt) / span)) }));
    }
    return Object.freeze({
      index: cursor,
      entry,
      step: this.stepOf(cursor),
      time,
      nodes: Object.freeze(
        this.start.nodes.map((id) => {
          const n = w.nodes.get(id)!;
          return Object.freeze({
            id,
            status: n.status,
            incarnation: n.incarnation,
            state: n.state,
            stateEntry: n.stateEntry,
            storage: Object.freeze({ ...n.storage }),
            pendingTimers: Object.freeze([...n.timers.values()]),
          });
        }),
      ),
      partition: w.partition,
      links: Object.freeze([...w.links.values()].map((l) => Object.freeze({ ...l }))),
      inFlight: Object.freeze(inFlight),
      recentDrops: Object.freeze(this.#recentDrops(cursor, time)),
      openViolations: Object.freeze([...w.open.values()]),
      liveness: Object.freeze([...w.liveness.values()]),
      stopped: w.stopped,
    });
  }

  #recentDrops(cursor: EntryIndex, time: number): DropFrame[] {
    const out: DropFrame[] = [];
    // Drops are in entry order; walk back from the last drop at or before the cursor.
    let i = upperBound(this.#dropIndices, cursor) - 1;
    for (; i >= 0; i--) {
      const drop = this.trace[this.#dropIndices[i]!] as EntryOf<'message.drop'>;
      const age = time - drop.time;
      if (age > DROP_MARKER_TICKS) break;
      const record = this.#messagesById.get(drop.messageId)!;
      out.push(Object.freeze({ record, reason: drop.reason, at: record.deliverAt === null ? 0 : 1, age }));
    }
    return out.reverse();
  }

  /** Index of the last entry whose virtual time is ≤ t. */
  lastIndexAtOrBefore(t: number): EntryIndex {
    let lo = 0;
    let hi = this.trace.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.trace[mid]!.time <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // ── causality ────────────────────────────────────────────────────────────────────────────

  causeOf(index: EntryIndex): EntryIndex | null {
    return this.entry(index).cause;
  }

  /** The chain of causes back to run.start: [cause, cause of cause, …]. */
  ancestors(index: EntryIndex): EntryIndex[] {
    const chain: EntryIndex[] = [];
    for (let c = this.causeOf(index); c !== null; c = this.trace[c]!.cause) chain.push(c);
    return chain;
  }

  consequences(index: EntryIndex): Consequences {
    this.entry(index);
    return Object.freeze({
      direct: Object.freeze([...this.#children[index]!]),
      explained: Object.freeze([...(this.#explained.get(index) ?? [])]),
    });
  }

  /** Every entry transitively caused by `index` (via `cause`), in index order, up to `limit`. */
  descendants(index: EntryIndex, limit = 10_000): EntryIndex[] {
    const out: EntryIndex[] = [];
    const queue = [...this.#children[index]!];
    while (queue.length > 0 && out.length < limit) {
      const next = queue.shift()!;
      out.push(next);
      queue.push(...this.#children[next]!);
    }
    return out.sort((a, b) => a - b);
  }

  // ── navigation ───────────────────────────────────────────────────────────────────────────

  nextMarker(after: EntryIndex, kinds?: readonly MarkerKind[]): Marker | null {
    return this.markers.find((m) => m.index > after && (kinds === undefined || kinds.includes(m.kind))) ?? null;
  }

  previousMarker(before: EntryIndex, kinds?: readonly MarkerKind[]): Marker | null {
    return [...this.markers].reverse().find((m) => m.index < before && (kinds === undefined || kinds.includes(m.kind))) ?? null;
  }
}

function upperBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function markerFor(e: TraceEntry): Marker | null {
  const m = (kind: MarkerKind, nodes: readonly NodeId[], label: string): Marker => Object.freeze({ kind, index: e.index, time: e.time, nodes, label });
  switch (e.kind) {
    case 'node.crash':
      return m('crash', [e.node], `${e.node} crashes (incarnation ${e.incarnation})`);
    case 'node.recover':
      return m('recover', [e.node], `${e.node} recovers (incarnation ${e.incarnation})`);
    case 'network.partition':
      return m('partition', e.groups.flat(), `partition ${e.groups.map((g) => `[${g.join(' ')}]`).join(' | ')}`);
    case 'network.heal':
      return m('heal', [], 'partition healed');
    case 'link.fault':
      return m('link-fault', [e.from, e.to], `link ${e.from}→${e.to} loss ${e.loss} delay ${e.delay.min}–${e.delay.max}`);
    case 'link.restore':
      return m('link-restore', [e.from, e.to], `link ${e.from}→${e.to} restored`);
    case 'fault.skipped':
      return m('fault-skipped', [e.node], `${e.faultType} ${e.node} skipped (${e.reason})`);
    case 'invariant.violation':
      return m('violation', e.nodes, `${e.invariant.id}: ${e.observed}`);
    case 'invariant.cleared':
      return m('violation-cleared', [], `${e.invariant.id} holds again`);
    case 'invariant.error':
      return m('invariant-error', [], `${e.invariant.id}: ${e.error}`);
    case 'protocol.error':
      return m('protocol-error', [e.node], `${e.node}: ${e.error}`);
    case 'liveness.met':
      return m('liveness-met', [], `${e.check.id}: progress after ${e.duration} ticks${e.late ? ' (late)' : ''}`);
    case 'liveness.missed':
      return m('liveness-missed', [], `${e.check.id}: no progress by t=${e.deadlineAt} (bounded check under stated assumptions)`);
    case 'run.end':
      return m('run-end', [], `run ended: ${e.reason}`);
    default:
      return null;
  }
}
