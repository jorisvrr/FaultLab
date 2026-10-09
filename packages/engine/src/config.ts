import { ConfigError } from './errors';
import { resolveFaults, type Fault, type FaultSpec } from './faults';
import { DEFAULT_MAX_VIOLATIONS, resolveInvariants, type Invariant, type InvariantPolicy, type ResolvedInvariant } from './invariants';
import { resolveLiveness, type LivenessCheck, type ResolvedLivenessCheck } from './liveness';
import type { JsonValue } from './json';
import type { NetworkConfig } from './network';
import type { NodeId, Protocol } from './protocol';
import { MAX_DELAY, type VirtualTime } from './time';
import { isIntIn, isRecord, rejectUnknownKeys } from './validation';

export interface Limits {
  /** Maximum number of events to dispatch. Guarantees termination of every run. */
  readonly maxEvents: number;
  /** Stop before dispatching any event later than this time. null = no time limit. */
  readonly maxTime: VirtualTime | null;
  /** Maximum number of queued events. Bounds memory when a protocol floods the network. */
  readonly maxPendingEvents: number;
  /** Under `record-and-continue`: stop after this many recorded violations (ADR-0013). */
  readonly maxViolations: number;
}

export interface SimulationConfig<S extends JsonValue = JsonValue, M extends JsonValue = JsonValue> {
  /** Root seed, integer in [0, 2^32). All randomness in the run derives from it. */
  readonly seed: number;
  /** Node ids, in a meaningful order: start order, `peers` order and broadcast order follow it. */
  readonly nodes: readonly NodeId[];
  readonly protocol: Protocol<S, M>;
  readonly network: NetworkConfig;
  readonly limits?: Partial<Limits>;
  /** Scheduled faults (ADR-0009). Part of the experiment's reproducible input. */
  readonly faults?: readonly FaultSpec[];
  /**
   * Safety invariants checked after every step, in this order (ADR-0012). `check` is declared
   * with method syntax, so invariants with specific history types fit in this one list.
   */
  readonly invariants?: readonly Invariant[];
  /** Default `stop-on-first` (ADR-0013). */
  readonly invariantPolicy?: InvariantPolicy;
  /** Bounded, conditional liveness checks (CP4, ADR-0019). Never stop the run. */
  readonly liveness?: readonly LivenessCheck[];
}

export type ResolvedConfig<S extends JsonValue, M extends JsonValue> = Omit<
  SimulationConfig<S, M>,
  'limits' | 'faults' | 'invariants' | 'invariantPolicy' | 'liveness'
> & {
  readonly limits: Limits;
  /** Validated, normalised fault plan with ids f1…fn. */
  readonly faults: readonly Fault[];
  readonly invariants: readonly ResolvedInvariant[];
  readonly invariantPolicy: InvariantPolicy;
  readonly liveness: readonly ResolvedLivenessCheck[];
};

export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxEvents: 100_000,
  maxTime: null,
  maxPendingEvents: 100_000,
  maxViolations: DEFAULT_MAX_VIOLATIONS,
});
const POLICIES: readonly InvariantPolicy[] = ['stop-on-first', 'record-and-continue'];
export const MAX_NODES = 1024;
/** Excludes ':' (used in message/timer ids) and '>' (used in link keys). */
const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/**
 * Validate a configuration at the trust boundary and fill in defaults.
 *
 * Configurations will eventually arrive from saved experiments and share links, i.e. from
 * untrusted JSON, so nothing is assumed from the static type alone. Every rejection names the
 * offending path. The returned object is frozen and owns copies of all arrays.
 */
export function resolveConfig<S extends JsonValue, M extends JsonValue>(
  config: SimulationConfig<S, M>,
): ResolvedConfig<S, M> {
  const input: unknown = config;
  if (!isRecord(input)) throw new ConfigError('config', 'must be an object');
  rejectUnknownKeys(input, ['seed', 'nodes', 'protocol', 'network', 'limits', 'faults', 'invariants', 'invariantPolicy', 'liveness'], 'config');

  const seed = input['seed'];
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) >= 2 ** 32) {
    throw new ConfigError('seed', 'must be an integer in [0, 2^32)');
  }

  const nodes = input['nodes'];
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_NODES) {
    throw new ConfigError('nodes', `must be an array of 1..${MAX_NODES} node ids`);
  }
  const seen = new Set<string>();
  nodes.forEach((id: unknown, i) => {
    if (typeof id !== 'string' || !NODE_ID.test(id)) {
      throw new ConfigError(`nodes[${i}]`, 'must match [A-Za-z0-9][A-Za-z0-9_-]{0,31}');
    }
    if (seen.has(id)) throw new ConfigError(`nodes[${i}]`, `duplicate node id "${id}"`);
    seen.add(id);
  });

  const protocol = input['protocol'];
  if (!isRecord(protocol)) throw new ConfigError('protocol', 'must be an object');
  for (const key of ['name', 'version'] as const) {
    if (typeof protocol[key] !== 'string' || protocol[key] === '') {
      throw new ConfigError(`protocol.${key}`, 'must be a non-empty string');
    }
  }
  for (const key of ['init', 'onMessage', 'onTimer'] as const) {
    if (typeof protocol[key] !== 'function') throw new ConfigError(`protocol.${key}`, 'must be a function');
  }

  const network = input['network'];
  if (!isRecord(network)) throw new ConfigError('network', 'must be an object');
  rejectUnknownKeys(network, ['latency'], 'network');
  const latency = network['latency'];
  if (!isRecord(latency)) throw new ConfigError('network.latency', 'must be an object');
  rejectUnknownKeys(latency, ['min', 'max'], 'network.latency');
  const min = latency['min'];
  const max = latency['max'];
  if (!isIntIn(min, 0, MAX_DELAY)) throw new ConfigError('network.latency.min', `must be an integer in [0, ${MAX_DELAY}]`);
  if (!isIntIn(max, min, MAX_DELAY)) throw new ConfigError('network.latency.max', 'must be an integer >= min');

  const limitsInput = input['limits'] ?? {};
  if (!isRecord(limitsInput)) throw new ConfigError('limits', 'must be an object');
  rejectUnknownKeys(limitsInput, ['maxEvents', 'maxTime', 'maxPendingEvents', 'maxViolations'], 'limits');
  const limits: Limits = { ...DEFAULT_LIMITS, ...stripUndefined(limitsInput) } as Limits;
  if (!isIntIn(limits.maxEvents, 1, Number.MAX_SAFE_INTEGER)) throw new ConfigError('limits.maxEvents', 'must be a positive integer');
  if (!isIntIn(limits.maxPendingEvents, 1, Number.MAX_SAFE_INTEGER)) {
    throw new ConfigError('limits.maxPendingEvents', 'must be a positive integer');
  }
  if (!isIntIn(limits.maxViolations, 1, Number.MAX_SAFE_INTEGER)) throw new ConfigError('limits.maxViolations', 'must be a positive integer');
  if (limits.maxTime !== null && !isIntIn(limits.maxTime, 0, Number.MAX_SAFE_INTEGER - MAX_DELAY)) {
    throw new ConfigError('limits.maxTime', 'must be null or a non-negative integer');
  }

  const faults = resolveFaults(input['faults'], nodes as NodeId[]);
  // Node starts and plan faults are all queued before the first step.
  if (nodes.length + faults.length > limits.maxPendingEvents) {
    throw new ConfigError('faults', 'nodes + faults exceed limits.maxPendingEvents before the run even starts');
  }

  const invariants = resolveInvariants(input['invariants']);
  const invariantPolicy = input['invariantPolicy'] ?? 'stop-on-first';
  if (!POLICIES.includes(invariantPolicy as InvariantPolicy)) {
    throw new ConfigError('invariantPolicy', `must be one of ${POLICIES.join(', ')}`);
  }
  const liveness = resolveLiveness(input['liveness']);

  return Object.freeze({
    seed: seed as number,
    nodes: Object.freeze([...(nodes as NodeId[])]),
    protocol: config.protocol,
    network: Object.freeze({ latency: Object.freeze({ min, max }) }),
    limits: Object.freeze({
      maxEvents: limits.maxEvents,
      maxTime: limits.maxTime,
      maxPendingEvents: limits.maxPendingEvents,
      maxViolations: limits.maxViolations,
    }),
    faults,
    invariants,
    invariantPolicy: invariantPolicy as InvariantPolicy,
    liveness,
  });
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
