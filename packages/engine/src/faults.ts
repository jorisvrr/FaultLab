import { ConfigError } from './errors';
import type { LatencyRange } from './network';
import type { NodeId } from './protocol';
import { MAX_DELAY, type VirtualTime } from './time';
import { isIntIn, isRecord, rejectUnknownKeys } from './validation';

/**
 * The fault plan: failures as scheduled, reproducible INPUT data (ADR-0009).
 *
 * Faults are part of the experiment's configuration, are recorded in `run.start`, and are
 * scheduled before the run begins. Nothing else can inject a fault, so the trace stays a pure
 * function of the configuration.
 */
export type FaultSpec =
  | { readonly at: VirtualTime; readonly type: 'crash'; readonly node: NodeId }
  | { readonly at: VirtualTime; readonly type: 'recover'; readonly node: NodeId }
  /** Listed groups, plus one implicit group of every unlisted node. Replaces any active partition. */
  | { readonly at: VirtualTime; readonly type: 'partition'; readonly groups: readonly (readonly NodeId[])[] }
  | { readonly at: VirtualTime; readonly type: 'heal' }
  /** Degrade the directed link from → to. Replaces any previous condition on that link. */
  | {
      readonly at: VirtualTime;
      readonly type: 'link';
      readonly from: NodeId;
      readonly to: NodeId;
      /** Probability in [0, 1] that a message sent on this link is lost. */
      readonly loss?: number;
      /** Extra latency, drawn per message and added to the base network latency. */
      readonly delay?: LatencyRange;
    }
  | { readonly at: VirtualTime; readonly type: 'link-restore'; readonly from: NodeId; readonly to: NodeId };

export type FaultType = FaultSpec['type'];

/** "f1", "f2", … in plan order. */
export type FaultId = string;

/** A validated, normalised fault. Plain JSON, so it can be recorded verbatim in the trace. */
export type Fault =
  | { readonly id: FaultId; readonly at: VirtualTime; readonly type: 'crash'; readonly node: NodeId }
  | { readonly id: FaultId; readonly at: VirtualTime; readonly type: 'recover'; readonly node: NodeId }
  /** `groups` covers every node exactly once, in configuration order, implicit group last. */
  | { readonly id: FaultId; readonly at: VirtualTime; readonly type: 'partition'; readonly groups: readonly (readonly NodeId[])[] }
  | { readonly id: FaultId; readonly at: VirtualTime; readonly type: 'heal' }
  | {
      readonly id: FaultId;
      readonly at: VirtualTime;
      readonly type: 'link';
      readonly from: NodeId;
      readonly to: NodeId;
      readonly loss: number;
      readonly delay: LatencyRange;
    }
  | { readonly id: FaultId; readonly at: VirtualTime; readonly type: 'link-restore'; readonly from: NodeId; readonly to: NodeId };

export const MAX_FAULTS = 10_000;
/** Faults may be scheduled up to here, leaving room for two maximal delays without leaving safe-integer range. */
export const MAX_FAULT_TIME = Number.MAX_SAFE_INTEGER - 2 * MAX_DELAY;

/** Validate and normalise a fault plan at the trust boundary. Throws ConfigError naming the path. */
export function resolveFaults(input: unknown, nodes: readonly NodeId[]): readonly Fault[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) throw new ConfigError('faults', 'must be an array');
  if (input.length > MAX_FAULTS) throw new ConfigError('faults', `must contain at most ${MAX_FAULTS} faults`);
  const known = new Set(nodes);
  return Object.freeze(input.map((spec: unknown, i) => Object.freeze(resolveFault(spec, `faults[${i}]`, `f${i + 1}`, nodes, known))));
}

function resolveFault(spec: unknown, path: string, id: FaultId, nodes: readonly NodeId[], known: ReadonlySet<NodeId>): Fault {
  if (!isRecord(spec)) throw new ConfigError(path, 'must be an object');
  const at = spec['at'];
  if (!isIntIn(at, 0, MAX_FAULT_TIME)) throw new ConfigError(`${path}.at`, 'must be a non-negative integer virtual time');
  const node = (key: string): NodeId => {
    const value = spec[key];
    if (typeof value !== 'string' || !known.has(value)) throw new ConfigError(`${path}.${key}`, 'must be a known node id');
    return value;
  };

  const type = spec['type'];
  switch (type) {
    case 'crash':
    case 'recover': {
      rejectUnknownKeys(spec, ['at', 'type', 'node'], path);
      return { id, at, type, node: node('node') };
    }
    case 'heal': {
      rejectUnknownKeys(spec, ['at', 'type'], path);
      return { id, at, type: 'heal' };
    }
    case 'partition': {
      rejectUnknownKeys(spec, ['at', 'type', 'groups'], path);
      return { id, at, type: 'partition', groups: resolveGroups(spec['groups'], `${path}.groups`, nodes, known) };
    }
    case 'link': {
      rejectUnknownKeys(spec, ['at', 'type', 'from', 'to', 'loss', 'delay'], path);
      const from = node('from');
      const to = node('to');
      if (from === to) throw new ConfigError(`${path}.to`, 'a link connects two different nodes');
      const lossInput = spec['loss'];
      const delayInput = spec['delay'];
      if (lossInput === undefined && delayInput === undefined) {
        throw new ConfigError(path, 'a link fault needs `loss`, `delay`, or both');
      }
      let loss = 0;
      if (lossInput !== undefined) {
        if (typeof lossInput !== 'number' || !(lossInput >= 0 && lossInput <= 1)) {
          throw new ConfigError(`${path}.loss`, 'must be a probability in [0, 1]');
        }
        loss = lossInput;
      }
      let delay: LatencyRange = Object.freeze({ min: 0, max: 0 });
      if (delayInput !== undefined) {
        if (!isRecord(delayInput)) throw new ConfigError(`${path}.delay`, 'must be an object { min, max }');
        rejectUnknownKeys(delayInput, ['min', 'max'], `${path}.delay`);
        const { min, max } = delayInput;
        if (!isIntIn(min, 0, MAX_DELAY)) throw new ConfigError(`${path}.delay.min`, `must be an integer in [0, ${MAX_DELAY}]`);
        if (!isIntIn(max, min, MAX_DELAY)) throw new ConfigError(`${path}.delay.max`, 'must be an integer >= min');
        delay = Object.freeze({ min, max });
      }
      return { id, at, type: 'link', from, to, loss, delay };
    }
    case 'link-restore': {
      rejectUnknownKeys(spec, ['at', 'type', 'from', 'to'], path);
      const from = node('from');
      const to = node('to');
      if (from === to) throw new ConfigError(`${path}.to`, 'a link connects two different nodes');
      return { id, at, type: 'link-restore', from, to };
    }
    default:
      throw new ConfigError(`${path}.type`, 'must be one of crash, recover, partition, heal, link, link-restore');
  }
}

/** Normalise partition groups: configuration order inside each group, unlisted nodes as a final group. */
function resolveGroups(input: unknown, path: string, nodes: readonly NodeId[], known: ReadonlySet<NodeId>): readonly (readonly NodeId[])[] {
  if (!Array.isArray(input) || input.length === 0) throw new ConfigError(path, 'must be a non-empty array of node groups');
  const groupOf = new Map<NodeId, number>();
  input.forEach((group: unknown, g) => {
    if (!Array.isArray(group) || group.length === 0) throw new ConfigError(`${path}[${g}]`, 'must be a non-empty array of node ids');
    group.forEach((id: unknown, k) => {
      if (typeof id !== 'string' || !known.has(id)) throw new ConfigError(`${path}[${g}][${k}]`, 'must be a known node id');
      if (groupOf.has(id)) throw new ConfigError(`${path}[${g}][${k}]`, `node "${id}" appears in more than one group`);
      groupOf.set(id, g);
    });
  });
  const groups: NodeId[][] = input.map((_, g) => nodes.filter((id) => groupOf.get(id) === g));
  const rest = nodes.filter((id) => !groupOf.has(id));
  if (rest.length > 0) groups.push(rest);
  if (groups.length < 2) throw new ConfigError(path, 'a partition must separate the nodes into at least two groups');
  return Object.freeze(groups.map((group) => Object.freeze(group)));
}
