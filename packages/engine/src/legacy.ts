import type { TraceEntry } from './trace';

/**
 * Trace-format compatibility (SEMANTICS §12, §16). Each engine version only ADDED information to
 * traces of runs that do not use its new features. `projectTrace` removes exactly those additions,
 * so a current trace can be compared with fingerprints recorded by an older engine. If a
 * projection reproduces an old golden fingerprint, behaviour (ordering, timing, randomness,
 * states) is unchanged; only the format grew.
 *
 * Only meaningful for runs that use no feature newer than `target` (e.g. no liveness checks for
 * 0.3.0-cp2, no invariants for 0.2.0-cp1, no faults for 0.1.0-cp0).
 */
export const LEGACY_TRACE_VERSIONS = ['0.1.0-cp0', '0.2.0-cp1', '0.3.0-cp2'] as const;
export type LegacyTraceVersion = (typeof LEGACY_TRACE_VERSIONS)[number];

export function projectTrace(trace: readonly TraceEntry[], target: LegacyTraceVersion): unknown[] {
  return trace.map((entry) => {
    let projected: Record<string, unknown> = { ...entry };
    if (entry.kind === 'run.start') {
      // CP4 added: liveness.
      const { liveness: _liveness, ...cp2Start } = entry;
      projected = { ...cp2Start, engineVersion: target };
      if (target !== '0.3.0-cp2') {
        // CP2 added: invariants, invariantPolicy, limits.maxViolations.
        const { invariants: _i, invariantPolicy: _p, limits, ...cp1Start } = projected as typeof cp2Start;
        const { maxViolations: _m, ...cp1Limits } = limits;
        projected = { ...cp1Start, limits: cp1Limits };
      }
      if (target === '0.1.0-cp0') {
        // CP1 added: persistence, faults.
        const { persistence: _persistence, faults: _faults, ...cp0Start } = projected;
        projected = cp0Start;
      }
    }
    if (target === '0.1.0-cp0') {
      // CP1 added: incarnation on node entries.
      const { incarnation: _incarnation, ...rest } = projected;
      projected = rest;
    }
    return projected;
  });
}
