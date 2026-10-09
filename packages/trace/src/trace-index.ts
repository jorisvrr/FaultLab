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
  /**
   * Ids of messages in flight, in send order. Ids, not records: a record's outcome becomes known
   * only when its delivery or drop is appended, possibly long after this state was checkpointed.
   * Frames resolve ids to the CURRENT records, so an incrementally built index answers exactly
   * like one built from the complete trace (CP5).
   */
  inFlight: Set<string>;
  open: Map<string, InvariantViolationEntry>;
  liveness: Map<string, LivenessFrame>;
  stopped: boolean;
}

function cloneWorking(w: Working): Working {
  return {
    nodes: new Map([...w.nodes].map(([id, n]) => [id, { ...n, storage: { ...n.storage }, timers: new Map(n.timers) }])),
    partition: w.partition,
    links: new Map(w.links),
    inFlight: new Set(w.inFlight),
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
function apply(w: Working, e: TraceEntry): void {
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
      if (e.deliverAt !== null) w.inFlight.add(e.messageId);
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

/** A growable Int32Array (amortised O(1) append, 4 bytes per element). */
class IntColumn {
  #data: Int32Array;
  #length = 0;
  constructor(capacity = 1024) {
    this.#data = new Int32Array(capacity);
  }
  get length(): number {
    return this.#length;
  }
  push(value: number): void {
    if (this.#length === this.#data.length) {
      const bigger = new Int32Array(this.#data.length * 2);
      bigger.set(this.#data);
      this.#data = bigger;
    }
    this.#data[this.#length++] = value;
  }
  get(i: number): number {
    return this.#data[i]!;
  }
  set(i: number, value: number): void {
    this.#data[i] = value;
  }
}

/** A frozen copy of a growing array, rebuilt only after it grew. */
class FrozenView<T> {
  #cache: readonly T[] = Object.freeze([]);
  #version = -1;
  get(source: readonly T[], version: number): readonly T[] {
    if (version !== this.#version) {
      this.#cache = Object.freeze(source.slice());
      this.#version = version;
    }
    return this.#cache;
  }
}

/**
 * TraceIndex over a growing trace (CP5): build it from a first chunk (which must start with
 * run.start) and `append` later chunks as they stream in. After any sequence of appends it answers
 * every query exactly like `TraceIndex.build` over the same entries; chunk boundaries may fall
 * anywhere, including inside a step.
 */
export class TraceIndex {
  readonly start: RunStartEntry;
  readonly checkpointEntries: number;
  /** Entries applied by the most recent `frameAt` call (for verifying the documented bound). */
  lastFrameCost = 0;

  readonly #trace: TraceEntry[] = [];
  #end: RunEndEntry | null = null;
  #version = 0;

  readonly #messages: MessageRecord[] = [];
  readonly #messagePosition = new Map<string, number>();
  readonly #messagesById = new Map<string, MessageRecord>();

  readonly #stepOfEntry = new IntColumn();
  readonly #stepFirst = new IntColumn();
  readonly #stepLast = new IntColumn();
  #step = 0;

  // Causal children as linked lists in typed arrays (PERF-3): 12 bytes per entry instead of an array per entry.
  readonly #firstChild = new IntColumn();
  readonly #lastChild = new IntColumn();
  readonly #nextSibling = new IntColumn();

  readonly #explained = new Map<EntryIndex, EntryIndex[]>();
  readonly #markers: Marker[] = [];
  readonly #violations: InvariantViolationEntry[] = [];
  readonly #dropIndices: EntryIndex[] = [];
  readonly #checkpoints: Working[] = [];
  readonly #working: Working;

  readonly #views = { messages: new FrozenView<MessageRecord>(), markers: new FrozenView<Marker>(), violations: new FrozenView<InvariantViolationEntry>(), steps: new FrozenView<StepRange>() };
  readonly #stepRanges: StepRange[] = [];

  private constructor(start: TraceEntry | undefined, checkpointEntries: number) {
    if (start?.kind !== 'run.start' || start.index !== 0) throw new Error('TraceIndex needs a complete trace starting with run.start');
    if (!Number.isSafeInteger(checkpointEntries) || checkpointEntries < 1) throw new RangeError('checkpointEntries must be a positive integer');
    this.start = start;
    this.checkpointEntries = checkpointEntries;
    this.#working = {
      nodes: new Map(start.nodes.map((id) => [id, { status: 'idle', incarnation: 0, state: undefined, stateEntry: null, storage: {}, timers: new Map() }])),
      partition: null,
      links: new Map(),
      inFlight: new Set(),
      open: new Map(),
      liveness: new Map(start.liveness.map((c) => [c.id, Object.freeze({ id: c.id, phase: 'idle' as const, since: null, deadlineAt: null })])),
      stopped: false,
    };
  }

  /** Index a trace (or the first part of a growing one). It must start with run.start (#0). */
  static build(trace: readonly TraceEntry[], options: { readonly checkpointEntries?: number } = {}): TraceIndex {
    const index = new TraceIndex(trace[0], options.checkpointEntries ?? DEFAULT_CHECKPOINT_ENTRIES);
    index.append(trace);
    return index;
  }

  /**
   * Add the next entries of the trace. They must continue it exactly (entry #length first, no
   * gaps, nothing after run.end); otherwise nothing is added and an Error is thrown.
   */
  append(entries: readonly TraceEntry[]): void {
    if (entries.length === 0) return;
    const expected = this.#trace.length;
    if (this.#end !== null) throw new Error(`TraceIndex: the trace already ended at #${this.#end.index}`);
    entries.forEach((e, i) => {
      if (e.index !== expected + i) throw new Error(`TraceIndex needs a complete trace with entries #0…#n in order: expected #${expected + i}, got #${e.index}`);
      if (e.kind === 'run.end' && i !== entries.length - 1) throw new Error('TraceIndex: entries after run.end');
    });
    for (const e of entries) this.#add(e);
    this.#version++;
  }

  #add(e: TraceEntry): void {
    const index = e.index;
    this.#trace.push(e);
    if (e.kind === 'run.end') this.#end = e;

    // Messages: a record is created at send time and replaced when its outcome arrives.
    if (e.kind === 'message.send') {
      const record: MessageRecord = Object.freeze({ id: e.messageId, from: e.node, to: e.to, sendIndex: e.index, sentAt: e.time, deliverAt: e.deliverAt, payload: e.payload, resolvedIndex: null, outcome: 'in-flight', dropReason: null });
      this.#messagePosition.set(record.id, this.#messages.length);
      this.#messages.push(record);
      this.#messagesById.set(record.id, record);
    } else if (e.kind === 'message.deliver' || e.kind === 'message.drop') {
      const position = this.#messagePosition.get(e.messageId);
      if (position !== undefined) {
        const resolved: MessageRecord = Object.freeze({ ...this.#messages[position]!, resolvedIndex: e.index, outcome: e.kind === 'message.deliver' ? 'delivered' : 'dropped', dropReason: e.kind === 'message.drop' ? e.reason : null });
        this.#messages[position] = resolved;
        this.#messagesById.set(e.messageId, resolved);
      }
    }

    // Steps.
    let step = -1;
    if (index === 0) step = 0;
    else {
      const standaloneEnd = e.kind === 'run.end' && ['quiescent', 'event-limit', 'time-limit'].includes(e.reason);
      if (isStepTrigger(e)) {
        this.#step++;
        this.#stepFirst.push(index);
        this.#stepLast.push(index);
      }
      if (!standaloneEnd && this.#step > 0) {
        step = this.#step;
        this.#stepLast.set(this.#step - 1, index);
      }
    }
    this.#stepOfEntry.push(step);

    // Causality.
    this.#firstChild.push(-1);
    this.#lastChild.push(-1);
    this.#nextSibling.push(-1);
    if (e.cause !== null) {
      if (this.#firstChild.get(e.cause) === -1) this.#firstChild.set(e.cause, index);
      else this.#nextSibling.set(this.#lastChild.get(e.cause), index);
      this.#lastChild.set(e.cause, index);
    }
    if (e.kind === 'message.drop') {
      this.#dropIndices.push(index);
      const list = this.#explained.get(e.conditionIndex) ?? [];
      list.push(index);
      this.#explained.set(e.conditionIndex, list);
    }
    if (e.kind === 'invariant.violation') this.#violations.push(e);
    const marker = markerFor(e);
    if (marker !== null) this.#markers.push(marker);

    if (index % this.checkpointEntries === 0) this.#checkpoints.push(cloneWorking(this.#working)); // state BEFORE applying e
    apply(this.#working, e);
  }

  /** The indexed entries (#0 … #length−1). Read-only; grows with `append`. */
  get trace(): readonly TraceEntry[] {
    return this.#trace;
  }

  get end(): RunEndEntry | null {
    return this.#end;
  }

  get messages(): readonly MessageRecord[] {
    return this.#views.messages.get(this.#messages, this.#version);
  }

  get violations(): readonly InvariantViolationEntry[] {
    return this.#views.violations.get(this.#violations, this.#version);
  }

  get markers(): readonly Marker[] {
    return this.#views.markers.get(this.#markers, this.#version);
  }

  get steps(): readonly StepRange[] {
    // Only the last known step can still grow, so earlier ranges are final once built.
    for (let k = Math.max(0, this.#stepRanges.length - 1); k < this.#step; k++) {
      this.#stepRanges[k] = Object.freeze({ step: k + 1, first: this.#stepFirst.get(k), last: this.#stepLast.get(k) });
    }
    return this.#views.steps.get(this.#stepRanges, this.#version);
  }

  get length(): number {
    return this.#trace.length;
  }

  get duration(): number {
    return this.#trace.at(-1)!.time;
  }

  entry(index: EntryIndex): TraceEntry {
    const entry = this.#trace[index];
    if (entry === undefined) throw new RangeError(`no entry #${index}`);
    return entry;
  }

  /** The step an entry belongs to: 0 for run.start, null for a run.end that belongs to no step. */
  stepOf(index: EntryIndex): StepNumber | null {
    this.entry(index);
    const step = this.#stepOfEntry.get(index);
    return step < 0 ? null : step;
  }

  /** Entry range of a step (1-based). */
  step(step: StepNumber): StepRange {
    if (!Number.isSafeInteger(step) || step < 1 || step > this.#step) throw new RangeError(`no step ${step}`);
    return Object.freeze({ step, first: this.#stepFirst.get(step - 1), last: this.#stepLast.get(step - 1) });
  }

  /**
   * The world as the trace describes it after entry `index` (inclusive). `displayTime` only
   * positions messages along their links between entries; it never changes what has happened.
   */
  frameAt(index: EntryIndex, displayTime?: number): Frame {
    const cursor = Math.max(0, Math.min(index, this.#trace.length - 1));
    const checkpoint = Math.floor(cursor / this.checkpointEntries);
    const w = cloneWorking(this.#checkpoints[checkpoint]!);
    let applied = 0;
    for (let i = checkpoint * this.checkpointEntries; i <= cursor; i++) {
      apply(w, this.#trace[i]!);
      applied++;
    }
    this.lastFrameCost = applied - 1; // the entry at `cursor` itself is always applied
    const entry = this.#trace[cursor]!;
    const time = Math.max(displayTime ?? 0, entry.time);

    const inFlight: InFlightFrame[] = [];
    for (const id of w.inFlight) {
      const record = this.#messagesById.get(id)!;
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
      const drop = this.#trace[this.#dropIndices[i]!] as EntryOf<'message.drop'>;
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
    let hi = this.#trace.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#trace[mid]!.time <= t) lo = mid;
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
    for (let c = this.causeOf(index); c !== null; c = this.#trace[c]!.cause) chain.push(c);
    return chain;
  }

  #children(index: EntryIndex): EntryIndex[] {
    const out: EntryIndex[] = [];
    for (let c = this.#firstChild.get(index); c !== -1; c = this.#nextSibling.get(c)) out.push(c);
    return out;
  }

  consequences(index: EntryIndex): Consequences {
    this.entry(index);
    return Object.freeze({
      direct: Object.freeze(this.#children(index)),
      explained: Object.freeze([...(this.#explained.get(index) ?? [])]),
    });
  }

  /** Every entry transitively caused by `index` (via `cause`), in index order, up to `limit`. */
  descendants(index: EntryIndex, limit = 10_000): EntryIndex[] {
    const out: EntryIndex[] = [];
    const queue = this.#children(index);
    for (let head = 0; head < queue.length && out.length < limit; head++) {
      const next = queue[head]!;
      out.push(next);
      queue.push(...this.#children(next));
    }
    return out.sort((a, b) => a - b);
  }

  // ── navigation ───────────────────────────────────────────────────────────────────────────

  nextMarker(after: EntryIndex, kinds?: readonly MarkerKind[]): Marker | null {
    return this.#markers.find((m) => m.index > after && (kinds === undefined || kinds.includes(m.kind))) ?? null;
  }

  previousMarker(before: EntryIndex, kinds?: readonly MarkerKind[]): Marker | null {
    for (let i = this.#markers.length - 1; i >= 0; i--) {
      const m = this.#markers[i]!;
      if (m.index < before && (kinds === undefined || kinds.includes(m.kind))) return m;
    }
    return null;
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
