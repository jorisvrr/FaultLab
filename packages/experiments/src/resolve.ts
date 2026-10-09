import { ConfigError, fingerprintTrace, resolveConfig, type Invariant, type LivenessCheck, type SimulationConfig } from '@faultlab/engine';
import { findInvariant, findLiveness, findProtocol, type ProtocolEntry } from './registry';
import { parseSpec, SpecError, type ExperimentSpec } from './spec';

export interface ResolvedExperiment {
  readonly spec: ExperimentSpec;
  readonly config: SimulationConfig;
  readonly protocol: ProtocolEntry;
}

/**
 * Turn an untrusted spec into a SimulationConfig (inside the Worker; functions never cross the
 * boundary). Every named part must be registered at exactly the requested version. The config is
 * then validated by the engine's `resolveConfig`; its errors are reported with spec paths.
 */
export function resolveExperiment(input: unknown): ResolvedExperiment {
  const spec = parseSpec(input);
  const protocol = findProtocol(spec.protocol.name, spec.protocol.version);
  if (protocol === undefined) throw new SpecError('spec.protocol', `no registered protocol ${spec.protocol.name}@${spec.protocol.version}`);
  const options = protocol.parseOptions(spec.protocol.options, 'spec.protocol.options');
  const invariants: Invariant[] = (spec.invariants ?? []).map((ref, i) => {
    const invariant = findInvariant(ref.id, ref.version);
    if (invariant === undefined) throw new SpecError(`spec.invariants[${i}]`, `no registered invariant ${ref.id}@${ref.version}`);
    return invariant;
  });
  const liveness: LivenessCheck[] = (spec.liveness ?? []).map((ref, i) => {
    const entry = findLiveness(ref.id, ref.version);
    if (entry === undefined) throw new SpecError(`spec.liveness[${i}]`, `no registered liveness check ${ref.id}@${ref.version}`);
    return entry.create(entry.parseParams(ref.params, `spec.liveness[${i}].params`));
  });
  const config: SimulationConfig = {
    seed: spec.seed,
    nodes: [...spec.nodes],
    protocol: protocol.create(options),
    network: { latency: { ...spec.network.latency } },
    ...(spec.limits === undefined ? {} : { limits: { ...spec.limits } }),
    ...(spec.faults === undefined ? {} : { faults: spec.faults as never }),
    ...(invariants.length === 0 ? {} : { invariants }),
    ...(spec.invariantPolicy === undefined ? {} : { invariantPolicy: spec.invariantPolicy }),
    ...(liveness.length === 0 ? {} : { liveness }),
  };
  try {
    resolveConfig(config);
  } catch (error) {
    if (error instanceof ConfigError) throw new SpecError(`spec.${error.path}`, error.message.slice(error.path.length + 2));
    throw error;
  }
  return { spec, config, protocol };
}

/**
 * Stable identity of a spec's content: the engine's FNV-1a fingerprint of the canonical JSON of
 * `[spec]` (key order does not matter). A label for humans and caches, not a security property.
 */
export function specFingerprint(spec: ExperimentSpec): string {
  return fingerprintTrace([spec] as never);
}
