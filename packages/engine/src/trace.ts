import type { Fault, FaultId, FaultType } from './faults';
import { fnv1a32, FNV1A32_OFFSET, fnv1a32Update, toHex32 } from './hash';
import { canonicalJson, type JsonValue } from './json';
import type { DropReason, LatencyRange } from './network';
import type { InvariantPolicy, InvariantRef } from './invariants';
import type { LivenessPhase, LivenessRef } from './liveness';
import type { NodeStatus } from './node';
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
  | 'protocol-error'
  /** An invariant failed under the `stop-on-first` policy (ADR-0013). */
  | 'invariant-violation'
  /** An invariant checker threw or returned a malformed verdict. */
  | 'invariant-error'
  /** `limits.maxViolations` violations were recorded under `record-and-continue`. */
  | 'violation-limit'
  /** A liveness check threw or returned a non-boolean. */
  | 'liveness-error';

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
  readonly limits: {
    readonly maxEvents: number;
    readonly maxTime: VirtualTime | null;
    readonly maxPendingEvents: number;
    readonly maxViolations: number;
  };
  /** Persistence model in force (ADR-0008). */
  readonly persistence: 'sync-on-commit';
  /** The complete, normalised fault plan. */
  readonly faults: readonly Fault[];
  /** Invariants checked after every step, in evaluation order (ADR-0012). */
  readonly invariants: readonly InvariantRef[];
  readonly invariantPolicy: InvariantPolicy;
  /** Bounded liveness checks with their deadlines and assumptions (CP4). */
  readonly liveness: readonly LivenessRef[];
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

/**
 * An invariant started failing (ADR-0013). `cause` = `trigger` = the first entry of the step after
 * which the failure was detected. Fields under "engine facts" are observations recorded by the
 * engine; the rest is asserted by the invariant. No field states an inferred cause.
 */
export interface InvariantViolationEntry extends EntryBase {
  readonly kind: 'invariant.violation';
  /** "v1", "v2", … in order of detection. */
  readonly violationId: string;
  readonly invariant: InvariantRef;
  /** Nodes the invariant names as involved (validated against the configured nodes). */
  readonly nodes: readonly NodeId[];
  readonly expected: string;
  readonly observed: string;
  /** Structured evidence supplied by the invariant. */
  readonly evidence: JsonValue;
  /** Earlier trace entries the invariant cites as evidence (validated indices). */
  readonly references: readonly number[];
  // ── engine facts ──
  readonly trigger: number;
  /** Trace range [first, last] of the step after which the failure was detected. */
  readonly step: { readonly first: number; readonly last: number };
  /** For each cited node: its lifecycle position and the entry that produced its current state. */
  readonly nodeStates: readonly {
    readonly node: NodeId;
    readonly status: NodeStatus;
    readonly incarnation: number;
    readonly stateEntry: number | null;
  }[];
  /** Fault entries whose effects were active at that moment (partition, link faults, crashes). */
  readonly activeFaults: { readonly partition: number | null; readonly links: readonly number[]; readonly crashed: readonly number[] };
  /** Number of dispatched events at detection: replaying `run.start`'s inputs this far reproduces it. */
  readonly eventNumber: number;
}

/** Under `record-and-continue`: the invariant holds again; its violation episode is closed. */
export interface InvariantClearedEntry extends EntryBase {
  readonly kind: 'invariant.cleared';
  readonly violationId: string;
  readonly invariant: InvariantRef;
}

/** The checker itself failed (threw or returned a malformed verdict). Always stops the run. */
export interface InvariantErrorEntry extends EntryBase {
  readonly kind: 'invariant.error';
  readonly invariant: InvariantRef;
  readonly error: string;
}

/** Identity of a liveness check in liveness entries (deadline and assumptions are in run.start). */
export interface LivenessCheckRef {
  readonly id: string;
  readonly version: string;
  readonly name: string;
}

/** The check's assumptions started to hold: progress is now expected by `deadlineAt`. */
export interface LivenessArmedEntry extends EntryBase {
  readonly kind: 'liveness.armed';
  readonly check: LivenessCheckRef;
  readonly since: VirtualTime;
  readonly deadlineAt: VirtualTime;
}

/** Progress was observed while the assumptions held. `late` if after the deadline. */
export interface LivenessMetEntry extends EntryBase {
  readonly kind: 'liveness.met';
  readonly check: LivenessCheckRef;
  readonly since: VirtualTime;
  readonly duration: Duration;
  readonly late: boolean;
}

/**
 * The deadline passed without progress while the assumptions held. A real scheduled event at
 * exactly `deadlineAt`; this entry is the TRIGGER of that step. `cause` is the armed entry.
 * This is a bounded-liveness result under stated assumptions, never a safety violation.
 */
export interface LivenessMissedEntry extends EntryBase {
  readonly kind: 'liveness.missed';
  readonly check: LivenessCheckRef;
  readonly since: VirtualTime;
  readonly deadlineAt: VirtualTime;
  readonly assumptions: readonly string[];
}

/** The assumptions stopped holding; the period ends (no expectation while they do not hold). */
export interface LivenessDisarmedEntry extends EntryBase {
  readonly kind: 'liveness.disarmed';
  readonly check: LivenessCheckRef;
  readonly since: VirtualTime;
  readonly previous: LivenessPhase;
}

export interface LivenessErrorEntry extends EntryBase {
  readonly kind: 'liveness.error';
  readonly check: LivenessCheckRef;
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
  | InvariantViolationEntry
  | InvariantClearedEntry
  | InvariantErrorEntry
  | LivenessArmedEntry
  | LivenessMetEntry
  | LivenessMissedEntry
  | LivenessDisarmedEntry
  | LivenessErrorEntry
  | RunEndEntry;

export type TraceEntryKind = TraceEntry['kind'];

/** Distributes Omit over a union, so each variant keeps its own fields. */
export type NewTraceEntry = TraceEntry extends infer T ? (T extends TraceEntry ? Omit<T, 'index'> : never) : never;

/** Position of an entry in the trace (absolute, 0-based). */
export type EntryIndex = number;

/**
 * Append-only execution trace. Entries are frozen when appended and are never modified or
 * removed, so an index handed out once (e.g. as a `cause`) stays valid forever.
 *
 * A trace may hold only a SEGMENT: after restoring a snapshot without its trace prefix, the
 * trace starts at `firstIndex` > 0 and new entries keep their ABSOLUTE indices, so causal
 * references stay identical to an uninterrupted run (CP3, ADR-0016).
 */
export class EventTrace {
  #entries: TraceEntry[];
  #first: EntryIndex;

  /** @param first absolute index of the first entry this trace will hold (0 for a full trace). */
  constructor(first: EntryIndex = 0, prefix: readonly TraceEntry[] = []) {
    this.#first = first;
    this.#entries = [...prefix];
  }

  /** Absolute index of the first retained entry. */
  get firstIndex(): EntryIndex {
    return this.#first;
  }

  /** Absolute length: the index the next appended entry will get. */
  get length(): number {
    return this.#first + this.#entries.length;
  }

  append(entry: NewTraceEntry): EntryIndex {
    const index = this.length;
    this.#entries.push(deepFreeze({ index, ...entry }) as TraceEntry);
    return index;
  }

  /** Entry at an absolute index, or undefined if it is not retained in this trace. */
  at(index: EntryIndex): TraceEntry | undefined {
    return index < this.#first ? undefined : this.#entries[index - this.#first];
  }

  /**
   * Stop retaining entries before absolute index `index` (memory-bounded runs, ADR-0016). The
   * entries can be regenerated exactly from a keyframe. The newest entry is always kept.
   */
  releaseBefore(index: EntryIndex): void {
    const drop = Math.min(Math.max(0, index - this.#first), this.#entries.length - 1);
    if (drop <= 0) return;
    this.#entries = this.#entries.slice(drop);
    this.#first += drop;
  }

  /** Frozen copy of the retained entries from absolute index `start` to the end. */
  slice(start: EntryIndex): readonly TraceEntry[] {
    return Object.freeze(this.#entries.slice(Math.max(0, start - this.#first)));
  }

  /** Frozen copy of the retained entries in [from, to) (absolute indices; both must be retained). */
  range(from: EntryIndex, to: EntryIndex): readonly TraceEntry[] {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < this.#first || to > this.length || from > to) {
      throw new RangeError(`entries [${from}, ${to}) are not retained (retained: [${this.#first}, ${this.length}))`);
    }
    return Object.freeze(this.#entries.slice(from - this.#first, to - this.#first));
  }

  /** A frozen copy of the retained entries; later appends do not affect it. */
  snapshot(): readonly TraceEntry[] {
    return Object.freeze(this.#entries.slice());
  }
}

/**
 * Freeze an entry and everything it contains. Objects that are already frozen are not visited
 * again: every frozen object the engine produces (payloads, states, config parts, fault plans)
 * is frozen bottom-up, so it is already deep. This keeps the cost proportional to the new
 * containers an entry adds (found in CP2: `cancelledTimers` and `run.start.protocol` used to be
 * left mutable by a shallow freeze).
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Canonical serialisation of a trace. Two runs are identical iff these strings are equal. */
export function serializeTrace(entries: readonly TraceEntry[]): string {
  return canonicalJson(entries as unknown as JsonValue);
}

/**
 * Incremental trace fingerprint (CP5): feed entries in order, in any chunking, and `digest()`
 * equals `fingerprintTrace` of all entries fed so far. It hashes the same canonical
 * serialisation ("[" e0 "," e1 … "]") without keeping the entries, so a Worker can fingerprint a
 * run it has already streamed away and released. Feeding must start at entry #0.
 */
export class TraceFingerprint {
  #state = fnv1a32Update(FNV1A32_OFFSET, '[');
  #count = 0;

  /** Number of entries fed so far (= the absolute index the next entry must have). */
  get count(): number {
    return this.#count;
  }

  update(entries: readonly TraceEntry[]): void {
    for (const entry of entries) {
      if (entry.index !== this.#count) throw new RangeError(`fingerprint expected entry #${this.#count}, got #${entry.index}`);
      this.#state = fnv1a32Update(this.#state, (this.#count === 0 ? '' : ',') + canonicalJson(entry as unknown as JsonValue));
      this.#count++;
    }
  }

  digest(): string {
    return toHex32(fnv1a32Update(this.#state, ']'));
  }
}

/** Short display fingerprint (FNV-1a 32). Use `serializeTrace` for actual equality checks. */
export function fingerprintTrace(entries: readonly TraceEntry[]): string {
  return toHex32(fnv1a32(serializeTrace(entries)));
}
