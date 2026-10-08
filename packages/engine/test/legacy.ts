import type { TraceEntry } from '../src/trace';

/**
 * Project a current trace onto an older trace format, by removing exactly the information each
 * later engine version ADDED (see SEMANTICS §10, trace format history). If a projected trace
 * reproduces the old golden fingerprint, the run's behaviour (ordering, timing, randomness,
 * states) is unchanged; only the trace format grew.
 *
 * Only meaningful for runs that use no features newer than the target version.
 */
export function projectTrace(trace: readonly TraceEntry[], target: '0.1.0-cp0' | '0.2.0-cp1'): unknown[] {
  return trace.map((entry) => {
    let projected: Record<string, unknown> = { ...entry };
    if (entry.kind === 'run.start') {
      // CP2 added: invariants, invariantPolicy, limits.maxViolations.
      const { invariants: _i, invariantPolicy: _p, limits, ...start } = entry;
      const { maxViolations: _m, ...cp1Limits } = limits;
      projected = { ...start, limits: cp1Limits, engineVersion: target };
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
