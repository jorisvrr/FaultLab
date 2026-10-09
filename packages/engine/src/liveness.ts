import { ConfigError } from './errors';
import type { SimulationView } from './invariants';
import { MAX_DELAY, type Duration, type VirtualTime } from './time';
import type { EntryIndex } from './trace';
import { isIntIn, isRecord } from './validation';

/**
 * Bounded liveness checks (CP4, ADR-0019).
 *
 * Safety ("nothing bad ever happens") can be checked after every step. Liveness ("something
 * good eventually happens") cannot be decided in a finite run. FaultLab therefore checks a
 * BOUNDED, CONDITIONAL expectation:
 *
 *   whenever `assumptionsHold` is true and `progress` is false, `progress` must (again) become
 *   true within `deadline` ticks.
 *
 * So losing progress while the assumptions still hold (e.g. the leader is cut off but a healthy
 * majority remains) starts a new waiting period with a new deadline.
 *
 * `deadline` is a configured TEST BOUND under the recorded assumptions, not a guarantee of the
 * protocol: e.g. Raft's randomized timeouts make long elections unlikely, never impossible.
 * Liveness results are separate trace entries (`liveness.*`) and are never reported as safety
 * (invariant) violations. They never stop a run.
 *
 * When the assumptions start to hold, the engine schedules a real `liveness.deadline` event at
 * now + deadline, so the deadline is evaluated at exactly that virtual time even if nothing else
 * happens in between (a quiet scheduler cannot skip it). Progress or broken assumptions cancel it.
 */
export interface LivenessCheck {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  /** Test bound D in ticks (1 ≤ D ≤ MAX_DELAY). */
  readonly deadline: Duration;
  /** Plain-language assumptions under which the bound is expected; recorded in the trace. */
  readonly assumptions: readonly string[];
  /** Are the assumptions satisfied right now? Pure and deterministic. */
  assumptionsHold(view: SimulationView): boolean;
  /** Has the expected progress happened? Pure and deterministic. */
  progress(view: SimulationView): boolean;
}

export interface LivenessRef {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly deadline: Duration;
  readonly assumptions: readonly string[];
}

/**
 * idle    — assumptions do not hold; nothing is expected.
 * waiting — assumptions hold since `since`; a deadline event is pending.
 * met     — progress holds (re-arms to `waiting` as soon as it is lost while assumptions hold).
 * missed  — the deadline passed without progress (may still become `met` later, marked late).
 */
export type LivenessPhase = 'idle' | 'waiting' | 'met' | 'missed';

export interface LivenessCheckState {
  readonly id: string;
  readonly version: string;
  readonly phase: LivenessPhase;
  /** Start of the current waiting period (null while idle). */
  readonly since: VirtualTime | null;
  /** The `liveness.armed` entry that started the current period (null while idle). */
  readonly armedEntry: EntryIndex | null;
  /** Scheduler sequence number of the pending deadline event (waiting only). */
  readonly deadlineSeq: number | null;
}

export interface ResolvedLivenessCheck {
  readonly ref: LivenessRef;
  readonly assumptionsHold: LivenessCheck['assumptionsHold'];
  readonly progress: LivenessCheck['progress'];
}

export const MAX_LIVENESS_CHECKS = 16;
const CHECK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Validate configured liveness checks at the trust boundary. */
export function resolveLiveness(input: unknown): readonly ResolvedLivenessCheck[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) throw new ConfigError('liveness', 'must be an array');
  if (input.length > MAX_LIVENESS_CHECKS) throw new ConfigError('liveness', `must contain at most ${MAX_LIVENESS_CHECKS} checks`);
  const seen = new Set<string>();
  return Object.freeze(
    input.map((candidate: unknown, i): ResolvedLivenessCheck => {
      const path = `liveness[${i}]`;
      if (!isRecord(candidate)) throw new ConfigError(path, 'must be an object');
      const { id, version, name, deadline, assumptions, assumptionsHold, progress } = candidate;
      if (typeof id !== 'string' || !CHECK_ID.test(id)) throw new ConfigError(`${path}.id`, 'must match [a-z0-9][a-z0-9-]{0,63}');
      if (seen.has(id)) throw new ConfigError(`${path}.id`, `duplicate liveness check id "${id}"`);
      seen.add(id);
      if (typeof version !== 'string' || version === '') throw new ConfigError(`${path}.version`, 'must be a non-empty string');
      if (typeof name !== 'string' || name === '') throw new ConfigError(`${path}.name`, 'must be a non-empty string');
      if (!isIntIn(deadline, 1, MAX_DELAY)) throw new ConfigError(`${path}.deadline`, `must be an integer in [1, ${MAX_DELAY}]`);
      if (!Array.isArray(assumptions) || assumptions.length === 0 || !assumptions.every((a) => typeof a === 'string' && a !== '' && a.length <= 300)) {
        throw new ConfigError(`${path}.assumptions`, 'must be a non-empty list of plain-language assumptions');
      }
      if (typeof assumptionsHold !== 'function') throw new ConfigError(`${path}.assumptionsHold`, 'must be a function');
      if (typeof progress !== 'function') throw new ConfigError(`${path}.progress`, 'must be a function');
      return Object.freeze({
        ref: Object.freeze({ id, version, name, deadline, assumptions: Object.freeze([...(assumptions as string[])]) }),
        assumptionsHold: (assumptionsHold as LivenessCheck['assumptionsHold']).bind(candidate),
        progress: (progress as LivenessCheck['progress']).bind(candidate),
      });
    }),
  );
}
