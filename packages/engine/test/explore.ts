import fc from 'fast-check';
import type { SimulationConfig } from '../src/config';
import { resolveFaults, type FaultSpec } from '../src/faults';
import { runSimulation, type RunResult } from '../src/simulation';
import { fingerprintTrace, type InvariantViolationEntry } from '../src/trace';

/**
 * Fault-space exploration (ADR-0014): generate fault plans → run → detect a violation of one
 * invariant → shrink → minimise further → verify → report. Test-only: fast-check stays a dev
 * dependency and the engine stays dependency-free.
 */
export interface ExploreOptions {
  /** Build the full experiment for a fault plan. The target invariant must be configured. */
  readonly build: (faults: FaultSpec[]) => SimulationConfig;
  readonly faults: fc.Arbitrary<FaultSpec[]>;
  readonly invariantId: string;
  readonly numRuns: number;
  /** fast-check seed: makes the exploration itself reproducible. */
  readonly seed: number;
}

export interface Counterexample {
  readonly faults: FaultSpec[];
  readonly violation: InvariantViolationEntry;
  readonly result: RunResult;
  readonly fingerprint: string;
  readonly discovery: {
    readonly fastCheckSeed: number;
    /** Runs fast-check needed before the first failure. */
    readonly runsUntilFailure: number;
    /** Faults in the first failing plan fast-check generated. */
    readonly originalFaultCount: number;
    /** Successful shrink steps taken by fast-check. */
    readonly shrinkSteps: number;
    /** Faults removed afterwards by the greedy one-at-a-time pass. */
    readonly removedByMinimiser: number;
  };
}

/** The first violation of `invariantId` in a run of `config`, or null. */
export function violationOf(config: SimulationConfig, invariantId: string): { violation: InvariantViolationEntry; result: RunResult } | null {
  const result = runSimulation(config);
  const violation = result.trace.find(
    (e): e is InvariantViolationEntry => e.kind === 'invariant.violation' && e.invariant.id === invariantId,
  );
  return violation === undefined ? null : { violation, result };
}

/**
 * 1-minimal: removing any single fault makes the violation disappear. This is the precise
 * meaning of "meaningfully minimised" here; it does NOT promise the smallest possible plan.
 */
export function isOneMinimal(build: ExploreOptions['build'], faults: FaultSpec[], invariantId: string): boolean {
  return faults.every((_, i) => violationOf(build(faults.filter((__, j) => j !== i)), invariantId) === null);
}

export function explore(options: ExploreOptions): Counterexample | null {
  const { build, invariantId, numRuns, seed } = options;
  const details = fc.check(
    fc.property(options.faults, (faults) => violationOf(build(faults), invariantId) === null),
    { numRuns, seed, verbose: fc.VerbosityLevel.Verbose },
  );
  if (!details.failed || details.counterexample === null) return null;

  // fast-check's shrinking: smaller arrays, earlier times, simpler values, all inside the
  // arbitrary's space, so the plan stays valid.
  let [faults] = details.counterexample;
  const shrunkCount = faults.length;

  // Greedy pass: drop single faults while the violation persists. Guarantees 1-minimality even
  // when the arbitrary couples faults (which fast-check can only shrink together).
  for (let i = 0; i < faults.length; ) {
    const candidate = faults.filter((_, j) => j !== i);
    if (violationOf(build(candidate), invariantId) !== null) faults = candidate;
    else i++;
  }

  const nodes = build(faults).nodes;
  resolveFaults(faults, nodes); // throws if shrinking ever produced an invalid plan
  const found = violationOf(build(faults), invariantId);
  if (found === null) throw new Error('minimised counterexample no longer violates the invariant');

  const firstFailure = details.failures[0] as [FaultSpec[]] | undefined;
  return {
    faults,
    violation: found.violation,
    result: found.result,
    fingerprint: fingerprintTrace(found.result.trace),
    discovery: {
      fastCheckSeed: seed,
      runsUntilFailure: details.numRuns,
      originalFaultCount: firstFailure?.[0].length ?? shrunkCount,
      shrinkSteps: details.numShrinks,
      removedByMinimiser: shrunkCount - faults.length,
    },
  };
}
