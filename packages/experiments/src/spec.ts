import { toFrozenJson, type FaultSpec, type InvariantPolicy, type JsonObject, type JsonValue } from '@faultlab/engine';

/**
 * ExperimentSpec: a complete experiment as plain JSON (CP5, ADR-0021).
 *
 * A `SimulationConfig` contains functions (the protocol, invariants and liveness checks), so it
 * cannot cross a Worker boundary or be stored or shared. A spec names those parts by registry id
 * and version instead; `resolveExperiment` turns it back into a config INSIDE the Worker. A spec
 * never contains executable code.
 */
export const EXPERIMENT_SPEC_FORMAT = 'faultlab-experiment/1';

export interface ProtocolRef {
  readonly name: string;
  readonly version: string;
  /** Protocol options, validated by the registry entry (unknown keys are rejected). */
  readonly options: JsonObject;
}

export interface CheckRef {
  readonly id: string;
  readonly version: string;
}

export interface LivenessRef extends CheckRef {
  /** Parameters of the liveness check (e.g. its deadline), validated by the registry entry. */
  readonly params: JsonObject;
}

export interface ExperimentSpec {
  readonly format: typeof EXPERIMENT_SPEC_FORMAT;
  readonly seed: number;
  readonly nodes: readonly string[];
  readonly protocol: ProtocolRef;
  readonly network: { readonly latency: { readonly min: number; readonly max: number } };
  readonly limits?: { readonly maxTime?: number | null; readonly maxEvents?: number; readonly maxPendingEvents?: number; readonly maxViolations?: number };
  readonly faults?: readonly FaultSpec[];
  readonly invariants?: readonly CheckRef[];
  readonly invariantPolicy?: InvariantPolicy;
  readonly liveness?: readonly LivenessRef[];
}

/** An invalid or unsupported spec. `path` names the offending field, like the engine's ConfigError. */
export class SpecError extends Error {
  override name = 'SpecError';
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${path}: ${reason}`);
  }
}

const SPEC_KEYS = ['format', 'seed', 'nodes', 'protocol', 'network', 'limits', 'faults', 'invariants', 'invariantPolicy', 'liveness'];

const isObject = (value: unknown): value is Readonly<Record<string, JsonValue>> => typeof value === 'object' && value !== null && !Array.isArray(value);

function onlyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SpecError(`${path}.${key}`, 'unknown field');
}

function ref(value: unknown, path: string, extra: readonly string[] = []): Readonly<Record<string, JsonValue>> {
  if (!isObject(value)) throw new SpecError(path, 'must be an object');
  onlyKeys(value, ['id', 'version', ...extra], path);
  for (const key of ['id', 'version']) if (typeof value[key] !== 'string' || value[key] === '') throw new SpecError(`${path}.${key}`, 'must be a non-empty string');
  return value;
}

/**
 * Validate the SHAPE of an untrusted spec and return a deeply frozen copy. Field values (node ids,
 * faults, limits, latency) are validated by the engine's own `resolveConfig` during
 * `resolveExperiment`, so the rules exist in one place only.
 */
export function parseSpec(input: unknown): ExperimentSpec {
  let json: JsonValue;
  try {
    json = toFrozenJson(input, 'spec');
  } catch (error) {
    throw new SpecError('spec', `not plain JSON (${(error as Error).message})`);
  }
  if (!isObject(json)) throw new SpecError('spec', 'must be an object');
  onlyKeys(json, SPEC_KEYS, 'spec');
  if (json['format'] !== EXPERIMENT_SPEC_FORMAT) throw new SpecError('spec.format', `must be "${EXPERIMENT_SPEC_FORMAT}"`);
  const protocol = json['protocol'];
  if (!isObject(protocol)) throw new SpecError('spec.protocol', 'must be an object');
  onlyKeys(protocol, ['name', 'version', 'options'], 'spec.protocol');
  for (const key of ['name', 'version']) if (typeof protocol[key] !== 'string' || protocol[key] === '') throw new SpecError(`spec.protocol.${key}`, 'must be a non-empty string');
  if (!isObject(protocol['options'])) throw new SpecError('spec.protocol.options', 'must be an object');
  const network = json['network'];
  if (!isObject(network)) throw new SpecError('spec.network', 'must be an object');
  onlyKeys(network, ['latency'], 'spec.network');
  if (json['invariants'] !== undefined) {
    if (!Array.isArray(json['invariants'])) throw new SpecError('spec.invariants', 'must be an array');
    json['invariants'].forEach((r, i) => ref(r, `spec.invariants[${i}]`));
  }
  if (json['liveness'] !== undefined) {
    if (!Array.isArray(json['liveness'])) throw new SpecError('spec.liveness', 'must be an array');
    json['liveness'].forEach((r, i) => {
      if (!isObject(ref(r, `spec.liveness[${i}]`, ['params'])['params'])) throw new SpecError(`spec.liveness[${i}].params`, 'must be an object');
    });
  }
  return json as unknown as ExperimentSpec;
}
