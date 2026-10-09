import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createNaiveLeaderProtocol, naiveLeaderInvariants } from '../src/fixtures';
import { Simulation, runSimulation } from '../src/simulation';
import { fingerprintTrace, TraceFingerprint } from '../src/trace';
import { faultPlanArb } from './arbitraries';

/** CP5 trace-access APIs for streaming: entriesSince and the incremental fingerprint. */
const config = (seed: number, faults = faultPlanArb(400)) => ({ seed, nodes: ['n1', 'n2', 'n3', 'n4'], protocol: createNaiveLeaderProtocol() as never, network: { latency: { min: 1, max: 10 } }, limits: { maxTime: 600 }, faults: fc.sample(faults, { numRuns: 1, seed })[0]!, invariants: naiveLeaderInvariants, invariantPolicy: 'record-and-continue' as const });

describe('entriesSince', () => {
  it('streams exactly the trace, in batches of any size, with releases in between', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 50 }), (seed, batch) => {
        const reference = runSimulation(config(seed)).trace;
        const sim = new Simulation(config(seed));
        const streamed = [...sim.entriesSince(0)];
        while (sim.stopReason === null) {
          for (let i = 0; i < batch && sim.step(); i++);
          streamed.push(...sim.entriesSince(streamed.length));
          sim.releaseTraceBefore(streamed.length); // like a Worker after sending a chunk
        }
        expect(streamed).toEqual(reference);
      }),
      { numRuns: 40 },
    );
  });

  it('returns a frozen array and rejects released or future positions', () => {
    const sim = new Simulation(config(1));
    for (let i = 0; i < 50; i++) sim.step();
    const chunk = sim.entriesSince(10);
    expect(Object.isFrozen(chunk)).toBe(true);
    expect(chunk[0]!.index).toBe(10);
    expect(sim.entriesSince(sim.traceLength)).toEqual([]);
    expect(() => sim.entriesSince(sim.traceLength + 1)).toThrow(RangeError);
    sim.releaseTraceBefore(20);
    expect(() => sim.entriesSince(10)).toThrow(RangeError);
    expect(sim.entriesSince(20)[0]!.index).toBe(20);
  });
});

describe('TraceFingerprint (incremental)', () => {
  it('equals fingerprintTrace for every chunking', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 30 }), (seed, sizes) => {
        const trace = runSimulation(config(seed)).trace;
        const hasher = new TraceFingerprint();
        expect(hasher.digest()).toBe(fingerprintTrace([]));
        let at = 0;
        for (let k = 0; at < trace.length; k++) {
          const next = Math.min(trace.length, at + sizes[k % sizes.length]!);
          hasher.update(trace.slice(at, next));
          at = next;
          expect(hasher.digest()).toBe(fingerprintTrace(trace.slice(0, at))); // digest does not consume
        }
        expect(hasher.count).toBe(trace.length);
      }),
      { numRuns: 40 },
    );
  });

  it('rejects gaps, duplicates and out-of-order entries', () => {
    const trace = runSimulation(config(3)).trace;
    const hasher = new TraceFingerprint();
    hasher.update(trace.slice(0, 5));
    expect(() => hasher.update(trace.slice(6, 8))).toThrow(RangeError);
    expect(() => hasher.update(trace.slice(4, 6))).toThrow(RangeError);
  });
});
