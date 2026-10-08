import type { JsonValue, LatencyRange, NodeId, NodeStatus, TraceEntry } from '@faultlab/engine';

// The engine's public API exports the TraceEntry union but not its named members; narrow it here
// rather than changing the engine for the visualisation (CP2.5 integration finding).
type EntryOf<K extends TraceEntry['kind']> = Extract<TraceEntry, { kind: K }>;
export type InvariantViolationEntry = EntryOf<'invariant.violation'>;
type RunStartEntry = EntryOf<'run.start'>;
type RunEndEntry = EntryOf<'run.end'>;

/**
 * Everything the viewer shows is derived HERE, from the trace alone. Nothing is read from engine
 * internals and nothing is invented: if a value cannot be computed from trace entries, it is
 * not displayed. `test/derive.test.ts` cross-checks these derivations against the live engine
 * after every step.
 */

export interface MessageRecord {
  readonly id: string;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly sendIndex: number;
  readonly sentAt: number;
  /** null when dropped at send time. */
  readonly deliverAt: number | null;
  readonly payload: JsonValue;
  /** Index of the message.deliver / message.drop entry, or null if still in flight when the run stopped. */
  resolvedIndex: number | null;
  outcome: 'delivered' | 'dropped' | 'in-flight';
  dropReason: string | null;
}

export interface TraceModel {
  readonly trace: readonly TraceEntry[];
  readonly start: RunStartEntry;
  readonly end: RunEndEntry | null;
  readonly nodes: readonly NodeId[];
  readonly messages: readonly MessageRecord[];
  readonly violations: readonly InvariantViolationEntry[];
  /** Indices of fault entries (for timeline markers). */
  readonly faultIndices: readonly number[];
  readonly duration: number;
}

export function buildModel(trace: readonly TraceEntry[]): TraceModel {
  const start = trace[0];
  if (start?.kind !== 'run.start') throw new Error('trace must begin with run.start');
  const last = trace.at(-1);
  const byId = new Map<string, MessageRecord>();
  const messages: MessageRecord[] = [];
  const violations: InvariantViolationEntry[] = [];
  const faultIndices: number[] = [];
  for (const entry of trace) {
    if (entry.kind === 'message.send') {
      const record: MessageRecord = {
        id: entry.messageId,
        from: entry.node,
        to: entry.to,
        sendIndex: entry.index,
        sentAt: entry.time,
        deliverAt: entry.deliverAt,
        payload: entry.payload,
        resolvedIndex: null,
        outcome: 'in-flight',
        dropReason: null,
      };
      byId.set(entry.messageId, record);
      messages.push(record);
    } else if (entry.kind === 'message.deliver' || entry.kind === 'message.drop') {
      const record = byId.get(entry.messageId);
      if (record === undefined) throw new Error(`trace resolves unknown message ${entry.messageId}`);
      record.resolvedIndex = entry.index;
      record.outcome = entry.kind === 'message.deliver' ? 'delivered' : 'dropped';
      record.dropReason = entry.kind === 'message.drop' ? entry.reason : null;
    } else if (entry.kind === 'invariant.violation') {
      violations.push(entry);
    }
    if ('faultId' in entry) faultIndices.push(entry.index);
  }
  return {
    trace,
    start,
    end: last?.kind === 'run.end' ? last : null,
    nodes: start.nodes,
    messages,
    violations,
    faultIndices,
    duration: last?.time ?? 0,
  };
}

export interface NodeFrame {
  readonly id: NodeId;
  readonly status: NodeStatus;
  readonly incarnation: number;
  /** Volatile protocol state from the latest state.update; undefined before start and after a crash. */
  readonly state: JsonValue | undefined;
  /** Trace index of the entry that produced `state`. */
  readonly stateEntry: number | null;
  readonly storage: Readonly<Record<string, JsonValue>>;
}

export interface InFlightFrame {
  readonly record: MessageRecord;
  /** Position along the link in [0, 1], linear in virtual time (never eased: it represents latency). */
  readonly progress: number;
}

export interface DropFrame {
  readonly record: MessageRecord;
  readonly reason: string;
  /** Where along the link the message stopped: 0 = at the sender, 1 = at the receiver. */
  readonly at: 0 | 1;
  readonly age: number;
}

export interface Frame {
  readonly index: number;
  readonly time: number;
  readonly nodes: readonly NodeFrame[];
  readonly partition: readonly (readonly NodeId[])[] | null;
  readonly links: readonly { readonly from: NodeId; readonly to: NodeId; readonly loss: number; readonly delay: LatencyRange }[];
  readonly inFlight: readonly InFlightFrame[];
  readonly recentDrops: readonly DropFrame[];
  /** Violations recorded at or before the cursor whose episode is still open. */
  readonly openViolations: readonly InvariantViolationEntry[];
  readonly stopped: boolean;
}

/** How long (in virtual ticks) a dropped message stays visible as a marker. */
export const DROP_MARKER_TICKS = 12;

/**
 * The world as the trace describes it after entry `index`. `displayTime` (≥ the entry's time)
 * only moves messages along their links between two entries; it never changes which events
 * have happened.
 */
export function frameAt(model: TraceModel, index: number, displayTime?: number): Frame {
  const { trace } = model;
  const cursor = Math.max(0, Math.min(index, trace.length - 1));
  const time = Math.max(displayTime ?? 0, trace[cursor]?.time ?? 0);

  const nodes = new Map<NodeId, { status: NodeStatus; incarnation: number; state: JsonValue | undefined; stateEntry: number | null; storage: Record<string, JsonValue> }>();
  for (const id of model.nodes) nodes.set(id, { status: 'idle', incarnation: 0, state: undefined, stateEntry: null, storage: {} });
  let partition: readonly (readonly NodeId[])[] | null = null;
  const links = new Map<string, { from: NodeId; to: NodeId; loss: number; delay: LatencyRange }>();
  const open = new Map<string, InvariantViolationEntry>();
  let stopped = false;

  for (let i = 0; i <= cursor; i++) {
    const e = trace[i]!;
    switch (e.kind) {
      case 'node.start':
      case 'node.recover':
        Object.assign(nodes.get(e.node)!, { status: 'running', incarnation: e.incarnation, state: undefined, stateEntry: null });
        break;
      case 'node.crash':
        Object.assign(nodes.get(e.node)!, { status: 'crashed', state: undefined, stateEntry: null });
        break;
      case 'state.update':
        Object.assign(nodes.get(e.node)!, { state: e.state, stateEntry: e.index });
        break;
      case 'storage.write': {
        const n = nodes.get(e.node)!;
        n.storage = { ...n.storage, ...e.set };
        for (const key of e.deleted) delete n.storage[key];
        break;
      }
      case 'network.partition':
        partition = e.groups;
        break;
      case 'network.heal':
        partition = null;
        break;
      case 'link.fault':
        links.delete(`${e.from}>${e.to}`); // re-insert to keep "order set", as the engine does
        links.set(`${e.from}>${e.to}`, { from: e.from, to: e.to, loss: e.loss, delay: e.delay });
        break;
      case 'link.restore':
        links.delete(`${e.from}>${e.to}`);
        break;
      case 'invariant.violation':
        open.set(e.invariant.id, e);
        break;
      case 'invariant.cleared':
        open.delete(e.invariant.id);
        break;
      case 'run.end':
        stopped = true;
        break;
    }
  }

  const inFlight: InFlightFrame[] = [];
  const recentDrops: DropFrame[] = [];
  for (const record of model.messages) {
    if (record.sendIndex > cursor) break; // messages are in send order
    const resolved = record.resolvedIndex !== null && record.resolvedIndex <= cursor;
    if (!resolved) {
      if (record.deliverAt === null) continue; // cannot happen: send-time drops resolve immediately
      const span = record.deliverAt - record.sentAt;
      inFlight.push({ record, progress: span <= 0 ? 1 : Math.min(1, Math.max(0, (time - record.sentAt) / span)) });
    } else if (record.outcome === 'dropped') {
      const dropTime = trace[record.resolvedIndex!]!.time;
      const age = time - dropTime;
      if (age <= DROP_MARKER_TICKS) {
        recentDrops.push({ record, reason: record.dropReason ?? 'dropped', at: record.deliverAt === null ? 0 : 1, age });
      }
    }
  }

  return {
    index: cursor,
    time,
    nodes: model.nodes.map((id) => ({ id, ...nodes.get(id)! })),
    partition,
    links: [...links.values()],
    inFlight,
    recentDrops,
    openViolations: [...open.values()],
    stopped,
  };
}

/** Index of the last entry whose time is ≤ t (used while playing by virtual time). */
export function lastIndexAtOrBefore(model: TraceModel, t: number): number {
  const { trace } = model;
  let lo = 0;
  let hi = trace.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (trace[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
