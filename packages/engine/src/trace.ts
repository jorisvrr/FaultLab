import { fnv1a32, toHex32 } from './hash';
import { canonicalJson, type JsonValue } from './json';
import type { MessageId, NodeId, TimerId } from './protocol';
import type { Duration, VirtualTime } from './time';

export type StopReason =
  /** No live events remain: the system has gone quiet. */
  | 'quiescent'
  /** `limits.maxEvents` events were dispatched and more were pending. */
  | 'event-limit'
  /** The next event is later than `limits.maxTime`. */
  | 'time-limit'
  /** More than `limits.maxPendingEvents` events were queued at once. */
  | 'pending-limit'
  /** A protocol handler threw or misused the node API. */
  | 'protocol-error';

interface EntryBase {
  /** Position in the trace. Entries are append-only, so this never changes. */
  readonly index: number;
  readonly time: VirtualTime;
  /**
   * Index of the entry that directly caused this one, or null for `run.start`.
   * Following `cause` links reconstructs the happens-before relation of the run.
   */
  readonly cause: number | null;
}

export interface RunStartEntry extends EntryBase {
  readonly kind: 'run.start';
  readonly engineVersion: string;
  readonly protocol: { readonly name: string; readonly version: string };
  readonly seed: number;
  readonly nodes: readonly NodeId[];
  readonly latency: { readonly min: Duration; readonly max: Duration };
  readonly limits: { readonly maxEvents: number; readonly maxTime: VirtualTime | null; readonly maxPendingEvents: number };
}

export interface NodeStartEntry extends EntryBase {
  readonly kind: 'node.start';
  readonly node: NodeId;
}

export interface MessageSendEntry extends EntryBase {
  readonly kind: 'message.send';
  readonly node: NodeId;
  readonly to: NodeId;
  readonly messageId: MessageId;
  readonly payload: JsonValue;
  readonly deliverAt: VirtualTime;
}

export interface MessageDeliverEntry extends EntryBase {
  readonly kind: 'message.deliver';
  readonly node: NodeId;
  readonly from: NodeId;
  readonly messageId: MessageId;
  readonly payload: JsonValue;
}

export interface TimerSetEntry extends EntryBase {
  readonly kind: 'timer.set';
  readonly node: NodeId;
  readonly timerId: TimerId;
  readonly tag: string;
  readonly fireAt: VirtualTime;
}

export interface TimerFireEntry extends EntryBase {
  readonly kind: 'timer.fire';
  readonly node: NodeId;
  readonly timerId: TimerId;
  readonly tag: string;
}

export interface TimerCancelEntry extends EntryBase {
  readonly kind: 'timer.cancel';
  readonly node: NodeId;
  readonly timerId: TimerId;
}

export interface StateUpdateEntry extends EntryBase {
  readonly kind: 'state.update';
  readonly node: NodeId;
  /** The node's complete volatile state after the step (deeply frozen, structurally shared). */
  readonly state: JsonValue;
}

export interface ProtocolErrorEntry extends EntryBase {
  readonly kind: 'protocol.error';
  readonly node: NodeId;
  /** `${error.name}: ${error.message}`. Stack traces are excluded: they contain machine-specific paths. */
  readonly error: string;
}

export interface RunEndEntry extends EntryBase {
  readonly kind: 'run.end';
  readonly reason: StopReason;
  readonly eventsProcessed: number;
  readonly pendingEvents: number;
}

export type TraceEntry =
  | RunStartEntry
  | NodeStartEntry
  | MessageSendEntry
  | MessageDeliverEntry
  | TimerSetEntry
  | TimerFireEntry
  | TimerCancelEntry
  | StateUpdateEntry
  | ProtocolErrorEntry
  | RunEndEntry;

export type TraceEntryKind = TraceEntry['kind'];

/** Distributes Omit over a union, so each variant keeps its own fields. */
export type NewTraceEntry = TraceEntry extends infer T ? (T extends TraceEntry ? Omit<T, 'index'> : never) : never;

/**
 * Append-only execution trace. Entries are frozen when appended and are never modified or
 * removed, so an index handed out once (e.g. as a `cause`) stays valid forever.
 */
export class EventTrace {
  readonly #entries: TraceEntry[] = [];

  get length(): number {
    return this.#entries.length;
  }

  append(entry: NewTraceEntry): number {
    const index = this.#entries.length;
    this.#entries.push(Object.freeze({ index, ...entry }) as TraceEntry);
    return index;
  }

  at(index: number): TraceEntry | undefined {
    return this.#entries[index];
  }

  /** A frozen copy of the entries; later appends do not affect it. */
  snapshot(): readonly TraceEntry[] {
    return Object.freeze(this.#entries.slice());
  }
}

/** Canonical serialisation of a trace. Two runs are identical iff these strings are equal. */
export function serializeTrace(entries: readonly TraceEntry[]): string {
  return canonicalJson(entries as unknown as JsonValue);
}

/** Short display fingerprint (FNV-1a 32). Use `serializeTrace` for actual equality checks. */
export function fingerprintTrace(entries: readonly TraceEntry[]): string {
  return toHex32(fnv1a32(serializeTrace(entries)));
}
