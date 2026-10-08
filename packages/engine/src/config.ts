import { ConfigError } from './errors';
import type { JsonValue } from './json';
import type { NetworkConfig } from './network';
import type { NodeId, Protocol } from './protocol';
import type { VirtualTime } from './time';

export interface Limits {
  /** Maximum number of events to dispatch. Guarantees termination of every run. */
  readonly maxEvents: number;
  /** Stop before dispatching any event later than this time. null = no time limit. */
  readonly maxTime: VirtualTime | null;
  /** Maximum number of queued events. Bounds memory when a protocol floods the network. */
  readonly maxPendingEvents: number;
}

export interface SimulationConfig<S extends JsonValue = JsonValue, M extends JsonValue = JsonValue> {
  /** Root seed, integer in [0, 2^32). All randomness in the run derives from it. */
  readonly seed: number;
  /** Node ids, in a meaningful order: start order, `peers` order and broadcast order follow it. */
  readonly nodes: readonly NodeId[];
  readonly protocol: Protocol<S, M>;
  readonly network: NetworkConfig;
  readonly limits?: Partial<Limits>;
}

export type ResolvedConfig<S extends JsonValue, M extends JsonValue> = Omit<SimulationConfig<S, M>, 'limits'> & {
  readonly limits: Limits;
};

export const DEFAULT_LIMITS: Limits = Object.freeze({ maxEvents: 100_000, maxTime: null, maxPendingEvents: 100_000 });
export const MAX_NODES = 1024;
/** Upper bound on any single latency or timer delay (~24.8 simulated days at 1 tick = 1 ms). */
export const MAX_DELAY = 2 ** 31;
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
  const latency = network['latency'];
  if (!isRecord(latency)) throw new ConfigError('network.latency', 'must be an object');
  const min = latency['min'];
  const max = latency['max'];
  if (!isIntIn(min, 0, MAX_DELAY)) throw new ConfigError('network.latency.min', `must be an integer in [0, ${MAX_DELAY}]`);
  if (!isIntIn(max, min, MAX_DELAY)) throw new ConfigError('network.latency.max', 'must be an integer >= min');

  const limitsInput = input['limits'] ?? {};
  if (!isRecord(limitsInput)) throw new ConfigError('limits', 'must be an object');
  const limits: Limits = { ...DEFAULT_LIMITS, ...stripUndefined(limitsInput) } as Limits;
  if (!isIntIn(limits.maxEvents, 1, Number.MAX_SAFE_INTEGER)) throw new ConfigError('limits.maxEvents', 'must be a positive integer');
  if (!isIntIn(limits.maxPendingEvents, 1, Number.MAX_SAFE_INTEGER)) {
    throw new ConfigError('limits.maxPendingEvents', 'must be a positive integer');
  }
  if (limits.maxTime !== null && !isIntIn(limits.maxTime, 0, Number.MAX_SAFE_INTEGER - MAX_DELAY)) {
    throw new ConfigError('limits.maxTime', 'must be null or a non-negative integer');
  }

  return Object.freeze({
    seed: seed as number,
    nodes: Object.freeze([...(nodes as NodeId[])]),
    protocol: config.protocol,
    network: Object.freeze({ latency: Object.freeze({ min, max }) }),
    limits: Object.freeze({ maxEvents: limits.maxEvents, maxTime: limits.maxTime, maxPendingEvents: limits.maxPendingEvents }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
