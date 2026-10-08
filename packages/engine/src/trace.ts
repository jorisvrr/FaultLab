import type { Fault, FaultId, FaultType } from './faults';
import { fnv1a32, toHex32 } from './hash';
import { canonicalJson, type JsonValue } from './json';
import type { DropReason, LatencyRange } from './network';
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
   * Index of the entry that directly caused this one, or null for `run.start` and `run.end`.
   * Following `cause` links reconstructs the happens-before relation of the run. Fault entries
   * point at `run.start`, where the fault plan is recorded.
   */
  readonly cause: number | null;
}

/** Entries produced by or about one node carry the incarnation they belong to. */
interface NodeEntryBase extends EntryBase {
  readonly node: NodeId;
  readonly incarnation: number;
}

export interface RunStartEntry extends EntryBase {
  readonly kind: 'run.start';
  readonly engineVersion: string;
  readonly protocol: { readonly name: string; readonly version: string };
  readonly seed: number;
  readonly nodes: readonly NodeId[];
  readonly latency: { readonly min: Duration; readonly max: Duration };
  readonly limits: { readonly maxEvents: number; readonly maxTime: VirtualTime | null; readonly maxPendingEvents: number };
  /** Persistence model in force (ADR-0008). */
  readonly persistence: 'sync-on-commit';
  /** The complete, normalised fault plan. */
  readonly faults: readonly Fault[];
}

export interface NodeStartEntry extends NodeEntryBase {
  readonly kind: 'node.start';
}

export interface MessageSendEntry extends NodeEntryBase {
  readonly kind: 'message.send';
  readonly to: NodeId;
  readonly messageId: MessageId;
  readonly payload: JsonValue;
  /** null when the network dropped the message at send time (a `message.drop` follows). */
  readonly deliverAt: VirtualTime | null;
}

export interface MessageDeliverEntry extends NodeEntryBase {
  readonly kind: 'message.deliver';
  readonly from: NodeId;
  readonly messageId: MessageId;
  readonly payload: JsonValue;
}

/** A message that will never be delivered. `cause` is its `message.send`. */
export interface MessageDropEntry extends EntryBase {
  readonly kind: 'message.drop';
  /** The intended receiver. */
  readonly node: NodeId;
  readonly from: NodeId;
  readonly messageId: MessageId;
  readonly reason: DropReason;
  /** Trace index of the fault entry that explains the drop (partition, link fault or crash). */
  readonly conditionIndex: number;
}

export interface TimerSetEntry extends NodeEntryBase {
  readonly kind: 'timer.set';
  readonly timerId: TimerId;
  readonly tag: string;
  readonly fireAt: VirtualTime;
}

export interface TimerFireEntry extends NodeEntryBase {
  readonly kind: 'timer.fire';
  readonly timerId: TimerId;
  readonly tag: string;
}

export interface TimerCancelEntry extends NodeEntryBase {
  readonly kind: 'timer.cancel';
  readonly timerId: TimerId;
}

export interface StateUpdateEntry extends NodeEntryBase {
  readonly kind: 'state.update';
  /** The node's complete volatile state after the step (deeply frozen, structurally shared). */
  readonly state: JsonValue;
}

/** Durable writes committed by one step, recorded before that step's messages (persist-before-send). */
export interface StorageWriteEntry extends NodeEntryBase {
  readonly kind: 'storage.write';
  /** Keys written in this step, with their new values. */
  readonly set: { readonly [key: string]: JsonValue };
  /** Keys deleted in this step, sorted. */
  readonly deleted: readonly string[];
}

export interface ProtocolErrorEntry extends NodeEntryBase {
  readonly kind: 'protocol.error';
  /** `${error.name}: ${error.message}`. Stack traces are excluded: they contain machine-specific paths. */
  readonly error: string;
}

interface FaultEntryBase extends EntryBase {
  readonly faultId: FaultId;
}

/** The node lost its volatile state and these pending timers; it now handles nothing. */
export interface NodeCrashEntry extends FaultEntryBase {
  readonly kind: 'node.crash';
  readonly node: NodeId;
  /** The incarnation that ended. */
  readonly incarnation: number;
  readonly cancelledTimers: readonly TimerId[];
}

/** The node restarts as a new incarnation; `init` runs next with its persistent storage. */
export interface NodeRecoverEntry extends FaultEntryBase {
  readonly kind: 'node.recover';
  readonly node: NodeId;
  /** The new incarnation. */
  readonly incarnation: number;
}

export interface NetworkPartitionEntry extends FaultEntryBase {
  readonly kind: 'network.partition';
  readonly groups: readonly (readonly NodeId[])[];
}

export interface NetworkHealEntry extends FaultEntryBase {
  readonly kind: 'network.heal';
}

export interface LinkFaultEntry extends FaultEntryBase {
  readonly kind: 'link.fault';
  readonly from: NodeId;
  readonly to: NodeId;
  readonly loss: number;
  readonly delay: LatencyRange;
}

export interface LinkRestoreEntry extends FaultEntryBase {
  readonly kind: 'link.restore';
  readonly from: NodeId;
  readonly to: NodeId;
}

/** A crash of an already-crashed node, or a recovery of a running node: recorded, no effect. */
export interface FaultSkippedEntry extends FaultEntryBase {
  readonly kind: 'fault.skipped';
  readonly faultType: FaultType;
  readonly node: NodeId;
  readonly reason: 'already-crashed' | 'not-crashed';
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
  | MessageDropEntry
  | TimerSetEntry
  | TimerFireEntry
  | TimerCancelEntry
  | StateUpdateEntry
  | StorageWriteEntry
  | ProtocolErrorEntry
  | NodeCrashEntry
  | NodeRecoverEntry
  | NetworkPartitionEntry
  | NetworkHealEntry
  | LinkFaultEntry
  | LinkRestoreEntry
  | FaultSkippedEntry
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
