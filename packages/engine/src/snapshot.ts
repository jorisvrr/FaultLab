import type { ResolvedConfig } from './config';
import { FaultLabError } from './errors';
import { fnv1a32, toHex32 } from './hash';
import { canonicalJson, toFrozenJson, type JsonValue } from './json';
import type { LatencyRange } from './network';
import type { NodeStatus } from './node';
import type { NodeId, TimerId } from './protocol';
import type { Xoshiro128State } from './random';
import type { EventSeq } from './scheduler';
import type { VirtualTime } from './time';
import type { EntryIndex, RunStartEntry, StopReason, TraceEntry } from './trace';
import { ENGINE_VERSION } from './version';
import { isIntIn, isRecord } from './validation';

/**
 * Engine snapshots (CP3, ADR-0015): the complete execution state of a simulation BETWEEN two
 * steps, as versioned, deeply frozen JSON. Restoring a snapshot and continuing produces exactly
 * the trace an uninterrupted run would have produced from that step on.
 *
 * A snapshot is taken "after N completed steps" (`StepCount`); there is no snapshot of a point
 * inside a step. See SEMANTICS §13–14.
 */

export const SNAPSHOT_FORMAT = 'faultlab-snapshot/1';

/** Number of completed simulation steps (= dispatched scheduled events). */
export type StepCount = number;

/** A scheduled event as stored in a snapshot. Faults are referenced by id, not copied. */
export type SnapshotEvent =
  | { readonly kind: 'node.start'; readonly node: NodeId; readonly cause: EntryIndex }
  | {
      readonly kind: 'message.deliver';
      readonly message: { readonly id: string; readonly from: NodeId; readonly to: NodeId; readonly payload: JsonValue; readonly sentAt: VirtualTime };
      readonly cause: EntryIndex;
    }
  | {
      readonly kind: 'timer.fire';
      readonly node: NodeId;
      readonly timer: { readonly id: TimerId; readonly tag: string; readonly setAt: VirtualTime };
      readonly incarnation: number;
      readonly cause: EntryIndex;
    }
  | { readonly kind: 'fault'; readonly faultId: string; readonly cause: EntryIndex };

export interface NodeSnapshot {
  readonly id: NodeId;
  readonly status: NodeStatus;
  readonly incarnation: number;
  readonly crashedAt: EntryIndex | null;
  readonly stateEntry: EntryIndex | null;
  /** Volatile state wrapped so that "no state" (null) differs from a state whose value is JSON null. */
  readonly state: { readonly value: JsonValue } | null;
  /** Persistent storage in insertion order. */
  readonly storage: readonly (readonly [string, JsonValue])[];
  readonly messagesSent: number;
  readonly timersSet: number;
  /** Pending timers of the current incarnation in insertion order (timer id → event seq). */
  readonly timers: readonly (readonly [TimerId, EventSeq])[];
  readonly random: Xoshiro128State;
}

export interface SimulationSnapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly engineVersion: string;
  /** The complete `run.start` entry: every input of the experiment. Compared exactly on restore. */
  readonly inputs: RunStartEntry;
  readonly position: {
    readonly stepsCompleted: StepCount;
    /** Absolute index the next trace entry will receive. */
    readonly traceLength: EntryIndex;
    readonly time: VirtualTime;
    /** Fingerprint of the last entry before this point; a consistency check, not a security measure. */
    readonly lastEntryFingerprint: string;
  };
  readonly stopReason: StopReason | null;
  readonly scheduler: {
    readonly nextSeq: EventSeq;
    /** Live events in dispatch order, with their original sequence numbers. */
    readonly events: readonly { readonly time: VirtualTime; readonly seq: EventSeq; readonly event: SnapshotEvent }[];
  };
  readonly network: {
    readonly random: Xoshiro128State;
    readonly partition: { readonly groups: readonly (readonly NodeId[])[]; readonly since: EntryIndex } | null;
    /** Active link conditions in insertion order. */
    readonly links: readonly { readonly from: NodeId; readonly to: NodeId; readonly loss: number; readonly delay: LatencyRange; readonly since: EntryIndex }[];
  };
  readonly nodes: readonly NodeSnapshot[];
  /** Invariant monitor state, or null when no invariants are configured. */
  readonly invariants: {
    readonly violations: number;
    readonly states: readonly { readonly id: string; readonly version: string; readonly history: JsonValue; readonly open: string | null }[];
  } | null;
}

/** A snapshot was rejected. `path` points at the offending part of the snapshot. */
export class SnapshotError extends FaultLabError {
  override name = 'SnapshotError';

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`snapshot ${path}: ${reason}`);
  }
}

export const entryFingerprint = (entry: TraceEntry | undefined): string =>
  entry === undefined ? '' : toHex32(fnv1a32(canonicalJson(entry as unknown as JsonValue)));

/** Bounds applied to untrusted snapshot input before anything else looks at it. */
export const SNAPSHOT_LIMITS = Object.freeze({ maxDepth: 200, maxValues: 5_000_000, maxStringLength: 1_000_000 });

/**
 * Iteratively measure an untrusted value BEFORE recursive processing, so hostile nesting depth
 * or size cannot overflow the stack or exhaust memory in the validator itself.
 */
function checkBounds(input: unknown): void {
  const stack: Array<[unknown, number]> = [[input, 1]];
  let values = 0;
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    if (++values > SNAPSHOT_LIMITS.maxValues) throw new SnapshotError('$', `more than ${SNAPSHOT_LIMITS.maxValues} values`);
    if (depth > SNAPSHOT_LIMITS.maxDepth) throw new SnapshotError('$', `nested deeper than ${SNAPSHOT_LIMITS.maxDepth} levels`);
    if (typeof value === 'string' && value.length > SNAPSHOT_LIMITS.maxStringLength) throw new SnapshotError('$', 'string too long');
    if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value)) stack.push([child, depth + 1]);
    }
  }
}

/** Throwing assertion helper: every failure names the path and the rule. */
function check(condition: boolean, path: string, reason: string): asserts condition {
  if (!condition) throw new SnapshotError(path, reason);
}

const isState = (v: unknown): v is Xoshiro128State =>
  Array.isArray(v) && v.length === 4 && v.every((w) => isIntIn(w, 0, 2 ** 32 - 1)) && v.some((w) => w !== 0);

const NODE_STATUSES: readonly string[] = ['idle', 'running', 'crashed'];
const STOP_REASONS: readonly string[] = ['quiescent', 'event-limit', 'time-limit', 'pending-limit', 'protocol-error', 'invariant-violation', 'invariant-error', 'violation-limit'];

/**
 * Validate an UNTRUSTED snapshot against the configuration it is being restored into.
 *
 * Checks, in order: bounds (depth/size), JSON-ness, format and engine version, exact equality of
 * the experiment inputs (not just a fingerprint), position, node/network/scheduler/monitor shape
 * and internal consistency (timers ↔ events, counters ↔ ids, ordering, references within the
 * trace prefix). With `prefix`, also that referenced entries exist and have the expected kind.
 *
 * Fingerprints are consistency checks against accidents and mix-ups, not protection against a
 * deliberately forged snapshot: a forger who controls the snapshot can also make it consistent.
 */
export function validateSnapshot(
  input: unknown,
  config: ResolvedConfig<JsonValue, JsonValue>,
  expectedInputs: RunStartEntry,
  prefix: readonly TraceEntry[] | null,
): SimulationSnapshot {
  checkBounds(input);
  let snap: Record<string, unknown>;
  try {
    const frozen = toFrozenJson(input, 'snapshot');
    check(isRecord(frozen), '$', 'must be an object');
    snap = frozen as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw new SnapshotError('$', `not plain JSON data (${error instanceof Error ? error.message : String(error)})`);
  }

  check(snap['format'] === SNAPSHOT_FORMAT, 'format', `expected "${SNAPSHOT_FORMAT}", got ${JSON.stringify(snap['format'])}`);
  check(snap['engineVersion'] === ENGINE_VERSION, 'engineVersion', `snapshot is from engine ${String(snap['engineVersion'])}; this is ${ENGINE_VERSION}`);
  check(
    canonicalJson(snap['inputs'] as JsonValue) === canonicalJson(expectedInputs as unknown as JsonValue),
    'inputs',
    'the experiment inputs (seed, nodes, protocol, latency, limits, faults, invariants, policy) differ from the configuration being restored',
  );

  // ── position ──
  const position = snap['position'];
  check(isRecord(position), 'position', 'must be an object');
  const { stepsCompleted, traceLength, time, lastEntryFingerprint } = position;
  check(isIntIn(stepsCompleted, 0, config.limits.maxEvents), 'position.stepsCompleted', 'must be an integer within limits.maxEvents');
  check(isIntIn(traceLength, 1, Number.MAX_SAFE_INTEGER), 'position.traceLength', 'must be a positive integer');
  check(isIntIn(time, 0, Number.MAX_SAFE_INTEGER), 'position.time', 'must be a non-negative integer');
  check(typeof lastEntryFingerprint === 'string', 'position.lastEntryFingerprint', 'must be a string');
  const ref = (value: unknown, path: string): EntryIndex => {
    check(isIntIn(value, 0, traceLength - 1), path, `must be an index of an entry before ${traceLength}`);
    return value;
  };
  if (prefix !== null) {
    check(prefix.length === traceLength, 'position.traceLength', `the provided trace prefix has ${prefix.length} entries, the snapshot expects ${traceLength}`);
    check(entryFingerprint(prefix.at(-1)) === lastEntryFingerprint, 'position.lastEntryFingerprint', 'does not match the last entry of the provided trace prefix');
  }
  const entryAt = (index: EntryIndex): TraceEntry | undefined => prefix?.[index];
  const expectKind = (index: EntryIndex, path: string, kind: TraceEntry['kind'], detail?: (e: TraceEntry) => boolean): void => {
    if (prefix === null) return;
    const entry = entryAt(index);
    check(entry?.kind === kind && (detail === undefined || detail(entry)), path, `must reference a matching ${kind} entry`);
  };

  const stopReason = snap['stopReason'];
  check(stopReason === null || STOP_REASONS.includes(stopReason as string), 'stopReason', 'must be null or a stop reason');

  // ── nodes ──
  const nodesIn = snap['nodes'];
  check(Array.isArray(nodesIn) && nodesIn.length === config.nodes.length, 'nodes', `must list all ${config.nodes.length} configured nodes`);
  const timerSeqs = new Map<EventSeq, { node: NodeId; timerId: TimerId }>();
  const nodes = nodesIn.map((raw: unknown, i): NodeSnapshot => {
    const path = `nodes[${i}]`;
    check(isRecord(raw), path, 'must be an object');
    const id = config.nodes[i]!;
    check(raw['id'] === id, `${path}.id`, `must be "${id}" (configuration order)`);
    const status = raw['status'];
    check(NODE_STATUSES.includes(status as string), `${path}.status`, 'must be idle, running or crashed');
    const incarnation = raw['incarnation'];
    check(isIntIn(incarnation, 0, Number.MAX_SAFE_INTEGER), `${path}.incarnation`, 'must be a non-negative integer');
    check((status === 'idle') === (incarnation === 0), `${path}.incarnation`, 'is 0 exactly while the node has not started');
    const crashedAt = raw['crashedAt'];
    if (status === 'crashed') expectKind(ref(crashedAt, `${path}.crashedAt`), `${path}.crashedAt`, 'node.crash', (e) => e.kind === 'node.crash' && e.node === id);
    else check(crashedAt === null, `${path}.crashedAt`, 'must be null unless crashed');
    const stateEntry = raw['stateEntry'];
    const state = raw['state'];
    check(state === null || (isRecord(state) && 'value' in state && Object.keys(state).length === 1), `${path}.state`, 'must be null or { value }');
    if (status !== 'running') check(state === null && stateEntry === null, `${path}.state`, 'a node that is not running has no volatile state');
    if (stateEntry !== null) {
      expectKind(ref(stateEntry, `${path}.stateEntry`), `${path}.stateEntry`, 'state.update', (e) =>
        e.kind === 'state.update' && e.node === id && canonicalJson(e.state) === canonicalJson((state as { value: JsonValue }).value),
      );
    } else check(state === null, `${path}.stateEntry`, 'a volatile state must have a source entry');
    const storage = raw['storage'];
    check(Array.isArray(storage), `${path}.storage`, 'must be an array of [key, value] pairs');
    const keys = new Set<string>();
    storage.forEach((pair: unknown, k) => {
      check(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && pair[0].length > 0 && pair[0].length <= 128, `${path}.storage[${k}]`, 'must be [key, value] with a 1–128 character key');
      check(!keys.has(pair[0] as string), `${path}.storage[${k}]`, 'duplicate key');
      keys.add(pair[0] as string);
    });
    const messagesSent = raw['messagesSent'];
    const timersSet = raw['timersSet'];
    check(isIntIn(messagesSent, 0, Number.MAX_SAFE_INTEGER), `${path}.messagesSent`, 'must be a non-negative integer');
    check(isIntIn(timersSet, 0, Number.MAX_SAFE_INTEGER), `${path}.timersSet`, 'must be a non-negative integer');
    const timers = raw['timers'];
    check(Array.isArray(timers), `${path}.timers`, 'must be an array of [timerId, seq] pairs');
    if (status !== 'running') check(timers.length === 0, `${path}.timers`, 'only a running node has pending timers');
    timers.forEach((pair: unknown, k) => {
      const tpath = `${path}.timers[${k}]`;
      check(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && isIntIn(pair[1], 0, Number.MAX_SAFE_INTEGER), tpath, 'must be [timerId, seq]');
      const number = Number((pair[0] as string).slice(`${id}:t`.length));
      check((pair[0] as string).startsWith(`${id}:t`) && Number.isSafeInteger(number) && number >= 1 && number <= timersSet, tpath, `timer id must be ${id}:t<k> with k ≤ timersSet`);
      check(!timerSeqs.has(pair[1] as number), tpath, 'two timers share one event');
      timerSeqs.set(pair[1] as number, { node: id, timerId: pair[0] as string });
    });
    check(isState(raw['random']), `${path}.random`, 'must be four uint32 words, not all zero');
    return raw as unknown as NodeSnapshot;
  });

  // ── network ──
  const network = snap['network'];
  check(isRecord(network), 'network', 'must be an object');
  check(isState(network['random']), 'network.random', 'must be four uint32 words, not all zero');
  const partition = network['partition'];
  if (partition !== null) {
    check(isRecord(partition) && Array.isArray(partition['groups']), 'network.partition', 'must be null or { groups, since }');
    const seen = new Set<string>();
    (partition['groups'] as unknown[]).forEach((group, g) => {
      check(Array.isArray(group) && group.length > 0, `network.partition.groups[${g}]`, 'must be a non-empty array');
      for (const id of group as unknown[]) {
        check(config.nodes.includes(id as string) && !seen.has(id as string), `network.partition.groups[${g}]`, 'groups must contain each configured node exactly once');
        seen.add(id as string);
      }
    });
    check(seen.size === config.nodes.length && (partition['groups'] as unknown[]).length >= 2, 'network.partition.groups', 'must cover every node in at least two groups');
    expectKind(ref(partition['since'], 'network.partition.since'), 'network.partition.since', 'network.partition');
  }
  const links = network['links'];
  check(Array.isArray(links), 'network.links', 'must be an array');
  links.forEach((link: unknown, l) => {
    const path = `network.links[${l}]`;
    check(isRecord(link), path, 'must be an object');
    const { from, to, loss, delay } = link;
    check(config.nodes.includes(from as string) && config.nodes.includes(to as string) && from !== to, path, 'must connect two different configured nodes');
    check(typeof loss === 'number' && loss >= 0 && loss <= 1, `${path}.loss`, 'must be a probability');
    check(isRecord(delay) && isIntIn(delay['min'], 0, 2 ** 31) && isIntIn(delay['max'], delay['min'] as number, 2 ** 31), `${path}.delay`, 'must be { min, max } with 0 ≤ min ≤ max');
    expectKind(ref(link['since'], `${path}.since`), `${path}.since`, 'link.fault');
  });

  // ── scheduler ──
  const scheduler = snap['scheduler'];
  check(isRecord(scheduler), 'scheduler', 'must be an object');
  const { nextSeq, events } = scheduler;
  check(isIntIn(nextSeq, 0, Number.MAX_SAFE_INTEGER), 'scheduler.nextSeq', 'must be a non-negative integer');
  check(Array.isArray(events) && events.length <= config.limits.maxPendingEvents + config.limits.maxPendingEvents, 'scheduler.events', 'must be an array within the pending-event limit');
  const seqs = new Set<EventSeq>();
  const firedTimers = new Set<EventSeq>();
  const faultIds = new Map(config.faults.map((fault) => [fault.id, fault]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let previous: { time: number; seq: number } | null = null;
  events.forEach((item: unknown, k) => {
    const path = `scheduler.events[${k}]`;
    check(isRecord(item) && isIntIn(item['time'], time, Number.MAX_SAFE_INTEGER) && isIntIn(item['seq'], 0, nextSeq - 1), path, 'needs time ≥ position.time and seq < nextSeq');
    const t = item['time'] as number;
    const seq = item['seq'] as number;
    check(!seqs.has(seq), `${path}.seq`, 'duplicate sequence number');
    seqs.add(seq);
    check(previous === null || previous.time < t || (previous.time === t && previous.seq < seq), path, 'events must be in dispatch order (time, seq)');
    previous = { time: t, seq };
    const event = item['event'];
    check(isRecord(event), `${path}.event`, 'must be an object');
    const cause = ref(event['cause'], `${path}.event.cause`);
    switch (event['kind']) {
      case 'node.start': {
        const node = nodeById.get(event['node'] as string);
        check(node?.status === 'idle' && t === 0, `${path}.event`, 'a node.start is pending only for a node that has not started, at t=0');
        expectKind(cause, `${path}.event.cause`, 'run.start');
        break;
      }
      case 'fault': {
        const fault = faultIds.get(event['faultId'] as string);
        check(fault !== undefined && fault.at === t, `${path}.event.faultId`, 'must reference a configured fault scheduled at this time');
        expectKind(cause, `${path}.event.cause`, 'run.start');
        break;
      }
      case 'message.deliver': {
        const message = event['message'];
        check(isRecord(message), `${path}.event.message`, 'must be an object');
        const sender = nodeById.get(message['from'] as string);
        check(sender !== undefined && nodeById.has(message['to'] as string) && message['from'] !== message['to'], `${path}.event.message`, 'must connect two different configured nodes');
        const number = Number(String(message['id']).slice(`${sender.id}:m`.length));
        check(String(message['id']).startsWith(`${sender.id}:m`) && Number.isSafeInteger(number) && number >= 1 && number <= sender.messagesSent, `${path}.event.message.id`, 'must be <from>:m<k> with k ≤ the sender’s messagesSent');
        check(isIntIn(message['sentAt'], 0, t), `${path}.event.message.sentAt`, 'must not be after the delivery time');
        expectKind(cause, `${path}.event.cause`, 'message.send', (e) => e.kind === 'message.send' && e.messageId === message['id'] && e.deliverAt === t);
        break;
      }
      case 'timer.fire': {
        const timer = event['timer'];
        const owner = timerSeqs.get(seq);
        check(isRecord(timer) && owner !== undefined && owner.node === event['node'] && owner.timerId === timer['id'], `${path}.event`, 'must be a pending timer listed by its node');
        const node = nodeById.get(owner.node)!;
        check(event['incarnation'] === node.incarnation && node.status === 'running', `${path}.event.incarnation`, 'must be the node’s current incarnation');
        expectKind(cause, `${path}.event.cause`, 'timer.set', (e) => e.kind === 'timer.set' && e.timerId === timer['id'] && e.fireAt === t);
        firedTimers.add(seq);
        break;
      }
      default:
        throw new SnapshotError(`${path}.event.kind`, 'unknown event kind');
    }
  });
  check(firedTimers.size === timerSeqs.size, 'nodes[].timers', 'every pending timer must have exactly one scheduled timer.fire event');

  // ── invariant monitor ──
  const monitor = snap['invariants'];
  if (config.invariants.length === 0) check(monitor === null, 'invariants', 'must be null: no invariants are configured');
  else {
    check(isRecord(monitor) && isIntIn(monitor['violations'], 0, config.limits.maxViolations), 'invariants', 'must be { violations, states }');
    const states = monitor['states'];
    check(Array.isArray(states) && states.length === config.invariants.length, 'invariants.states', 'must match the configured invariants');
    states.forEach((state: unknown, i) => {
      const expected = config.invariants[i]!.ref;
      check(isRecord(state) && state['id'] === expected.id && state['version'] === expected.version, `invariants.states[${i}]`, `must be ${expected.id}@${expected.version}`);
      check('history' in state, `invariants.states[${i}].history`, 'is required');
      check(state['open'] === null || /^v[1-9][0-9]*$/.test(String(state['open'])), `invariants.states[${i}].open`, 'must be null or a violation id');
    });
  }

  return snap as unknown as SimulationSnapshot;
}
