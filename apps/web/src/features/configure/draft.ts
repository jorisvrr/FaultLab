import {
  EXPERIMENT_SPEC_FORMAT,
  findProtocol,
  PROTOCOLS,
  invariantsFor,
  parseSpec,
  resolveExperiment,
  specFingerprint,
  SpecError,
  type CheckRef,
  type ExperimentSpec,
  type LivenessRef,
  type ProtocolEntry,
} from '@faultlab/experiments';
import { DEFAULT_LIMITS, type FaultSpec, type InvariantPolicy, type JsonObject } from '@faultlab/engine';

/**
 * The Configure form's state, and the one place that turns it into something the engine will run.
 *
 * Two things are deliberately kept apart:
 *
 * - the DRAFT: everything the user has configured, including a fault schedule that is currently
 *   switched off. Nothing here is thrown away behind the user's back.
 * - the EFFECTIVE spec: the `ExperimentSpec` that would actually be submitted. It is derived
 *   from the draft and omits whatever the draft has disabled.
 *
 * The experiment signature is computed from the EFFECTIVE spec, so switching fault injection off
 * changes the signature even though the draft schedule is still there. Anything that cannot
 * change the execution must not change the signature, and anything that can, must.
 */
export interface Draft {
  readonly protocol: string;
  readonly protocolVersion: string;
  /**
   * The protocol's own options (heartbeat interval, Raft election timeout, ...). Not editable in
   * the form yet, but carried through untouched: a preset's options are part of what it means,
   * and dropping them would make Configure run a different experiment than the one it named.
   */
  readonly protocolOptions: JsonObject;
  readonly nodeCount: number;
  readonly seed: number;
  readonly latency: { readonly min: number; readonly max: number };
  readonly maxTime: number;
  readonly maxEvents: number;
  /** The whole plan, kept whether or not it is currently applied. */
  readonly faults: readonly FaultSpec[];
  /** false: the draft keeps its faults, the effective spec has none. */
  readonly faultsEnabled: boolean;
  /** Invariant ids the user has switched on; only ids valid for the protocol are ever applied. */
  readonly invariants: readonly string[];
  readonly invariantPolicy: InvariantPolicy;
  readonly liveness: readonly LivenessRef[];
}

export const nodeIds = (count: number): string[] => Array.from({ length: count }, (_, i) => `n${i + 1}`);

/** Every protocol a user may configure. Broken variants and diagnostics exist for tests only. */
export const configurableProtocols = (): readonly ProtocolEntry[] => PROTOCOLS.filter((p) => p.category === 'protocol');

/** The draft a given spec corresponds to (used by the presets and by the reference scenario). */
export function draftFromSpec(spec: ExperimentSpec): Draft {
  return {
    protocol: spec.protocol.name,
    protocolVersion: spec.protocol.version,
    protocolOptions: spec.protocol.options ?? {},
    nodeCount: spec.nodes.length,
    seed: spec.seed,
    latency: { min: spec.network.latency.min, max: spec.network.latency.max },
    // A spec with no time limit is unbounded; the form needs a number, so a fresh draft gets one.
    maxTime: spec.limits?.maxTime ?? 1000,
    maxEvents: spec.limits?.maxEvents ?? DEFAULT_LIMITS.maxEvents,
    faults: spec.faults ?? [],
    faultsEnabled: (spec.faults ?? []).length > 0,
    invariants: (spec.invariants ?? []).map((i) => i.id),
    invariantPolicy: spec.invariantPolicy ?? 'stop-on-first',
    liveness: spec.liveness ?? [],
  };
}

/**
 * The spec that would actually be submitted.
 *
 * Built in a fixed key order and with fixed key order inside every nested object, so the
 * signature below depends on the configuration and not on the order in which the user happened
 * to touch the form. `specFingerprint` hashes the spec as JSON, so canonical ordering here is
 * what makes the signature stable and meaningful.
 */
export function effectiveSpec(draft: Draft): ExperimentSpec {
  const available = new Set(invariantsFor(draft.protocol).map((e) => e.invariant.id));
  const invariants: CheckRef[] = invariantsFor(draft.protocol)
    .filter((e) => draft.invariants.includes(e.invariant.id) && available.has(e.invariant.id))
    .map((e) => ({ id: e.invariant.id, version: e.invariant.version }));
  const faults = draft.faultsEnabled ? [...draft.faults].sort((a, b) => a.at - b.at) : [];
  const liveness = draft.protocol === 'raft-election' ? draft.liveness : [];

  const spec: ExperimentSpec = {
    format: EXPERIMENT_SPEC_FORMAT,
    seed: draft.seed,
    nodes: nodeIds(draft.nodeCount),
    protocol: { name: draft.protocol, version: draft.protocolVersion, options: draft.protocolOptions },
    network: { latency: { min: draft.latency.min, max: draft.latency.max } },
    limits: { maxTime: draft.maxTime, maxEvents: draft.maxEvents },
    ...(faults.length > 0 ? { faults } : {}),
    ...(invariants.length > 0 ? { invariants } : {}),
    invariantPolicy: draft.invariantPolicy,
    ...(liveness.length > 0 ? { liveness } : {}),
  };
  return spec;
}

export interface Validation {
  readonly ok: boolean;
  /** Engine/spec errors, keyed by the `path` the engine itself reported (e.g. `spec.seed`). */
  readonly errors: readonly { readonly path: string; readonly message: string }[];
  /** Legal but probably unintended; never blocks a run. */
  readonly warnings: readonly string[];
}

/**
 * Validates through the engine, not through a copy of its rules: `parseSpec` checks the shape
 * and `resolveExperiment` runs the engine's own `resolveConfig`. A `SpecError` carries the
 * field path, so the message shown next to a control is the engine's.
 */
export function validate(draft: Draft): Validation {
  const errors: { path: string; message: string }[] = [];
  const spec = effectiveSpec(draft);
  try {
    resolveExperiment(parseSpec(spec));
  } catch (error) {
    if (error instanceof SpecError) errors.push({ path: error.path, message: error.message.slice(error.path.length + 2) });
    else errors.push({ path: 'spec', message: (error as Error).message });
  }
  // A protocol may need more nodes than the engine's own minimum: Raft needs a majority.
  if (draft.protocol === 'raft-election' && draft.nodeCount < 3) {
    errors.push({ path: 'spec.nodes', message: 'Raft needs at least 3 nodes, so a majority exists' });
  }
  return { ok: errors.length === 0, errors, warnings: faultWarnings(draft) };
}

/**
 * Plans that the engine accepts but that usually mean the user made a mistake. These are
 * warnings on purpose: the engine decides what is legal, and an unusual plan is often exactly
 * what an experiment is for.
 */
export function faultWarnings(draft: Draft): string[] {
  if (!draft.faultsEnabled) return [];
  const warnings: string[] = [];
  const faults = [...draft.faults].sort((a, b) => a.at - b.at);
  const crashed = new Set<string>();
  let partitioned = false;
  const degraded = new Set<string>();
  for (const fault of faults) {
    switch (fault.type) {
      case 'crash':
        if (crashed.has(fault.node)) warnings.push(`${fault.node} is already crashed at t=${fault.at}.`);
        crashed.add(fault.node);
        break;
      case 'recover':
        if (!crashed.has(fault.node)) warnings.push(`${fault.node} is not crashed at t=${fault.at}, so recovering it does nothing.`);
        crashed.delete(fault.node);
        break;
      case 'partition':
        if (partitioned) warnings.push(`The partition at t=${fault.at} replaces the previous one, rather than adding to it.`);
        partitioned = true;
        break;
      case 'heal':
        if (!partitioned) warnings.push(`No partition is active at t=${fault.at}, so healing does nothing.`);
        partitioned = false;
        break;
      case 'link': {
        const key = `${fault.from}→${fault.to}`;
        if (degraded.has(key)) warnings.push(`The link fault at t=${fault.at} replaces the previous condition on ${key}.`);
        degraded.add(key);
        break;
      }
      case 'link-restore': {
        const key = `${fault.from}→${fault.to}`;
        if (!degraded.has(key)) warnings.push(`${key} is not degraded at t=${fault.at}, so restoring it does nothing.`);
        degraded.delete(key);
        break;
      }
    }
    if (fault.at > draft.maxTime) warnings.push(`The ${fault.type} at t=${fault.at} is after the time limit of ${draft.maxTime} and will never happen.`);
  }
  for (const node of crashed) warnings.push(`${node} crashes and never recovers.`);
  return warnings;
}

/** The experiment signature: four real properties of the EFFECTIVE spec. */
export interface Signature {
  readonly seed: number;
  /**
   * The fingerprint of the effective spec, or `null` when that spec does not validate.
   *
   * A fingerprint is an identity claim: it says "this is the experiment that will run". A draft
   * the engine would reject identifies no experiment at all, so there is nothing truthful to
   * show — and a stable-looking hash next to an error is worse than no hash, because it reads as
   * though the configuration is runnable. Nothing is substituted in its place; the card says the
   * configuration is invalid until it is not.
   */
  readonly fingerprint: string | null;
  readonly engineVersion: string;
  readonly protocol: string;
}

export function signature(draft: Draft, engineVersion: string): Signature {
  const spec = effectiveSpec(draft);
  return {
    seed: spec.seed,
    // Hashing stays deterministic for every spec that validates; only the decision to show it
    // depends on validity.
    fingerprint: validate(draft).ok ? specFingerprint(spec) : null,
    engineVersion,
    protocol: `${spec.protocol.name}@${spec.protocol.version}`,
  };
}

/** A node count the protocol accepts; used to clamp when switching protocols. */
export function clampNodeCount(protocol: string, count: number): number {
  const min = protocol === 'raft-election' ? 3 : 2;
  return Math.max(min, Math.min(12, Math.round(count)));
}

/**
 * Switching protocol: keep what still applies, drop what does not. Invariants belong to a
 * protocol, so the selection is replaced by that protocol's full set rather than silently
 * carrying ids the new protocol does not register.
 */
export function withProtocol(draft: Draft, name: string): Draft {
  const entry = findProtocol(name, '1');
  const version = entry?.version ?? '1';
  const nodeCount = clampNodeCount(name, draft.nodeCount);
  return {
    ...draft,
    protocol: name,
    protocolVersion: version,
    protocolOptions: {},
    nodeCount,
    invariants: invariantsFor(name).map((e) => e.invariant.id),
    liveness: name === 'raft-election' ? [{ id: 'raft-leader-elected', version: '1', params: { deadline: 1500 } }] : [],
    // A fault naming a node that no longer exists would be rejected by the engine.
    faults: draft.faults.filter((f) => faultNodes(f).every((n) => nodeIds(nodeCount).includes(n))),
  };
}

/** Every node id a fault refers to. */
export function faultNodes(fault: FaultSpec): string[] {
  switch (fault.type) {
    case 'crash':
    case 'recover':
      return [fault.node];
    case 'partition':
      return fault.groups.flat();
    case 'link':
    case 'link-restore':
      return [fault.from, fault.to];
    case 'heal':
      return [];
  }
}

/** Reducing the node count must not leave faults pointing at nodes that no longer exist. */
export function withNodeCount(draft: Draft, count: number): Draft {
  const nodeCount = clampNodeCount(draft.protocol, count);
  const ids = nodeIds(nodeCount);
  return { ...draft, nodeCount, faults: draft.faults.filter((f) => faultNodes(f).every((n) => ids.includes(n))) };
}
