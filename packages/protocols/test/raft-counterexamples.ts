import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprintTrace, resolveFaults, runSimulation, type FaultSpec, type Invariant, type RunResult, type SimulationConfig, type TraceEntry } from '@faultlab/engine';
import fc from 'fast-check';
import { createBrokenRaftElection, createRaftElection, raftInvariants, type RaftBug, type RaftOptions } from '../src';
import { MAX_TIME, nodesOf, TIMINGS, type RaftExperiment } from './raft-experiments';

/**
 * Stored counterexample fixture, format `faultlab-counterexample/2` (CP4).
 *
 * Differences from `/1` (naive-leader fixtures in packages/engine, still read as they are):
 * - `protocol` names a protocol from a registry plus a `variant` (a deliberate bug, or null for
 *   the correct protocol) and its options, instead of one hard-wired protocol;
 * - `correctProtocol` records what the CORRECT protocol does under exactly the same experiment
 *   (seed, nodes, latency, timing, faults), checked against all Raft invariants on replay.
 */
export interface RaftCounterexampleFixture {
  readonly format: 'faultlab-counterexample/2';
  readonly description: string;
  readonly engineVersion: string;
  readonly protocol: { readonly name: string; readonly version: string; readonly variant: RaftBug | null; readonly options: RaftOptions };
  readonly invariant: { readonly id: string; readonly version: string };
  readonly config: {
    readonly seed: number;
    readonly nodes: string[];
    readonly latency: { readonly min: number; readonly max: number };
    readonly maxTime: number;
    readonly faults: FaultSpec[];
  };
  readonly discovery: {
    readonly fastCheckSeed: number;
    readonly runsUntilFailure: number;
    readonly originalFaultCount: number;
    readonly shrinkSteps: number;
    readonly removedByMinimiser: number;
    readonly minimisedFaultCount: number;
  };
  readonly expected: {
    readonly reason: 'invariant-violation';
    readonly violationTime: number;
    readonly nodes: string[];
    readonly observed: string;
    readonly eventNumber: number;
    readonly fingerprint: string;
  };
  readonly correctProtocol: { readonly reason: string; readonly violations: number; readonly fingerprint: string };
}

export const DIR = join(import.meta.dirname, 'counterexamples');

type FixtureInput = Pick<RaftCounterexampleFixture, 'protocol' | 'invariant' | 'config'>;

/** Rebuild a fixture's experiment, checking only its own invariant (or, for `variant: null`, all of them). */
export function configFor(fixture: FixtureInput, faults = fixture.config.faults, variant = fixture.protocol.variant): SimulationConfig {
  const invariant = raftInvariants.find((i) => i.id === fixture.invariant.id);
  if (invariant === undefined) throw new Error(`unknown invariant ${fixture.invariant.id}`);
  return {
    seed: fixture.config.seed,
    nodes: fixture.config.nodes,
    protocol: (variant === null ? createRaftElection(fixture.protocol.options) : createBrokenRaftElection(variant, fixture.protocol.options)) as never,
    network: { latency: fixture.config.latency },
    limits: { maxTime: fixture.config.maxTime },
    faults,
    invariants: variant === null ? raftInvariants : [invariant as Invariant],
  };
}

export type Violation = Extract<TraceEntry, { kind: 'invariant.violation' }>;

export function violationOf(config: SimulationConfig, invariantId: string): { violation: Violation; result: RunResult } | null {
  const result = runSimulation(config);
  const violation = result.trace.find((e): e is Violation => e.kind === 'invariant.violation' && e.invariant.id === invariantId);
  return violation === undefined ? null : { violation, result };
}

/** 1-minimal: removing any single fault makes the violation disappear (not "smallest possible"). */
export function isOneMinimal(fixture: FixtureInput, faults: FaultSpec[]): boolean {
  return faults.every((_, i) => violationOf(configFor(fixture, faults.filter((__, j) => j !== i)), fixture.invariant.id) === null);
}

const fixtureInput = (experiment: RaftExperiment, bug: RaftBug, invariantId: string): FixtureInput => {
  const protocol = createBrokenRaftElection(bug, TIMINGS[experiment.timing]);
  const invariant = raftInvariants.find((i) => i.id === invariantId)!;
  return {
    protocol: { name: protocol.name, version: protocol.version, variant: bug, options: TIMINGS[experiment.timing] },
    invariant: { id: invariant.id, version: invariant.version },
    config: { seed: experiment.seed, nodes: nodesOf(experiment.size), latency: { min: 1, max: experiment.latencyMax }, maxTime: MAX_TIME, faults: experiment.faults },
  };
};

export interface Found {
  readonly fixture: RaftCounterexampleFixture;
  readonly result: RunResult;
}

/**
 * Explore experiments against ONE invariant of ONE broken variant; shrink (fast-check), then drop
 * single faults greedily until 1-minimal; then run the CORRECT protocol on the same experiment.
 * Returns null if nothing was found within `numRuns`: absence is reported, never invented.
 */
export function exploreVariant(options: {
  readonly bug: RaftBug;
  readonly invariantId: string;
  readonly experiments: fc.Arbitrary<RaftExperiment>;
  readonly numRuns: number;
  readonly seed: number;
  readonly engineVersion: string;
  readonly description: string;
}): Found | null {
  const { bug, invariantId, numRuns, seed } = options;
  const details = fc.check(
    fc.property(options.experiments, (experiment) => violationOf(configFor(fixtureInput(experiment, bug, invariantId)), invariantId) === null),
    { numRuns, seed },
  );
  if (!details.failed || details.counterexample === null) return null;
  const [experiment] = details.counterexample;
  const input = fixtureInput(experiment, bug, invariantId);
  let faults = experiment.faults;
  const shrunkCount = faults.length;
  for (let i = 0; i < faults.length; ) {
    const candidate = faults.filter((_, j) => j !== i);
    if (violationOf(configFor(input, candidate), invariantId) !== null) faults = candidate;
    else i++;
  }
  resolveFaults(faults, input.config.nodes); // throws if minimising ever produced an invalid plan
  const minimal = { ...input, config: { ...input.config, faults } };
  const { violation, result } = violationOf(configFor(minimal), invariantId)!;
  const correct = runSimulation(configFor(minimal, faults, null));
  return {
    result,
    fixture: {
      format: 'faultlab-counterexample/2',
      description: options.description,
      engineVersion: options.engineVersion,
      ...minimal,
      discovery: {
        fastCheckSeed: seed,
        runsUntilFailure: details.numRuns,
        // fast-check reports the shrunk counterexample; its original size is not exposed, so this
        // is the size after fast-check's shrinking, before the greedy pass.
        originalFaultCount: shrunkCount,
        shrinkSteps: details.numShrinks,
        removedByMinimiser: shrunkCount - faults.length,
        minimisedFaultCount: faults.length,
      },
      expected: {
        reason: 'invariant-violation',
        violationTime: violation.time,
        nodes: [...violation.nodes],
        observed: violation.observed,
        eventNumber: violation.eventNumber,
        fingerprint: fingerprintTrace(result.trace),
      },
      correctProtocol: {
        reason: correct.reason,
        violations: correct.trace.filter((e) => e.kind === 'invariant.violation').length,
        fingerprint: fingerprintTrace(correct.trace),
      },
    },
  };
}

/** Write a fixture only if it does not exist: stored counterexamples are never silently overwritten. */
export function writeNewFixture(name: string, fixture: RaftCounterexampleFixture): boolean {
  const path = join(DIR, name);
  if (existsSync(path)) return false;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  return true;
}
