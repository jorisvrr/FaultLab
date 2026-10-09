import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runSimulation, type FaultSpec, type TraceEntry } from '@faultlab/engine';
import { createHeartbeatProtocol, createNaiveLeaderProtocol, naiveLeaderInvariants } from '@faultlab/engine/fixtures';
import { TraceIndex } from '../src';

/**
 * CP5: an index grown with `append` must answer every query exactly like `TraceIndex.build` over
 * the same entries, wherever the chunk boundaries fall (also inside a step), and after every
 * append it must equal the index of the prefix received so far.
 */
const NODES = ['n1', 'n2', 'n3', 'n4'];
const faults: FaultSpec[] = [
  { at: 60, type: 'link', from: 'n1', to: 'n2', loss: 0.5, delay: { min: 0, max: 15 } },
  { at: 90, type: 'crash', node: 'n3' },
  { at: 120, type: 'partition', groups: [['n4']] },
  { at: 150, type: 'recover', node: 'n3' },
  { at: 170, type: 'heal' },
];
const leader = (maxTime: number, seed = 7) =>
  runSimulation({ seed, nodes: NODES, protocol: createNaiveLeaderProtocol() as never, network: { latency: { min: 1, max: 12 } }, limits: { maxTime }, faults, invariants: naiveLeaderInvariants, invariantPolicy: 'record-and-continue' }).trace;
const heartbeat = (maxTime: number, seed = 3) =>
  runSimulation({ seed, nodes: NODES, protocol: createHeartbeatProtocol({ interval: 20, timeout: 60 }) as never, network: { latency: { min: 1, max: 12 } }, limits: { maxTime }, faults }).trace;

/** Everything observable through the public API, as plain data. */
function observe(index: TraceIndex): unknown {
  const n = index.length;
  return {
    length: n,
    duration: index.duration,
    end: index.end,
    messages: index.messages,
    markers: index.markers,
    violations: index.violations,
    steps: index.steps,
    perEntry: Array.from({ length: n }, (_, i) => ({
      frame: index.frameAt(i),
      cost: index.lastFrameCost,
      step: index.stepOf(i),
      consequences: index.consequences(i),
      ancestors: index.ancestors(i),
      descendants: index.descendants(i),
      next: index.nextMarker(i),
      previous: index.previousMarker(i),
      atTime: index.lastIndexAtOrBefore(index.entry(i).time),
    })),
  };
}

function incremental(trace: readonly TraceEntry[], cuts: readonly number[], checkpointEntries: number, check?: (index: TraceIndex, prefix: number) => void): TraceIndex {
  const bounds = [...new Set(cuts.filter((c) => c > 0 && c < trace.length))].sort((a, b) => a - b);
  const index = TraceIndex.build(trace.slice(0, bounds[0] ?? trace.length), { checkpointEntries });
  check?.(index, bounds[0] ?? trace.length);
  bounds.forEach((from, k) => {
    const to = bounds[k + 1] ?? trace.length;
    index.append(trace.slice(from, to));
    check?.(index, to);
  });
  return index;
}

describe('incremental TraceIndex', () => {
  it('equals build() for EVERY single split point of a small trace, and equals build(prefix) after the first chunk', () => {
    const trace = leader(140);
    expect(trace.length).toBeGreaterThan(150);
    const full = observe(TraceIndex.build(trace, { checkpointEntries: 16 }));
    for (let k = 1; k < trace.length; k++) {
      const index = TraceIndex.build(trace.slice(0, k), { checkpointEntries: 16 });
      if (k % 25 === 0) expect(observe(index)).toEqual(observe(TraceIndex.build(trace.slice(0, k), { checkpointEntries: 16 })));
      index.append(trace.slice(k));
      expect(observe(index)).toEqual(full);
    }
  });

  it('equals build() for random multi-chunk splits, checkpoint intervals and protocols (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('leader', 'heartbeat'),
        fc.integer({ min: 0, max: 50 }),
        fc.array(fc.integer({ min: 1, max: 2000 }), { maxLength: 40 }),
        fc.constantFrom(1, 7, 64, 256),
        (kind, seed, cuts, checkpointEntries) => {
          const trace = kind === 'leader' ? leader(260, seed) : heartbeat(260, seed);
          const built = TraceIndex.build(trace, { checkpointEntries });
          const grown = incremental(trace, cuts.map((c) => c % trace.length), checkpointEntries, (index, prefix) => {
            // After every append: what is known so far equals the index of that prefix.
            expect(index.length).toBe(prefix);
            expect(index.frameAt(prefix - 1)).toEqual(TraceIndex.build(trace.slice(0, prefix), { checkpointEntries }).frameAt(prefix - 1));
          });
          expect(observe(grown)).toEqual(observe(built));
        },
      ),
      { numRuns: 40 },
    );
  });

  it('resolves message records to their latest outcome in frames from checkpoints taken before the outcome was known', () => {
    const trace = leader(200);
    const send = trace.find((e) => e.kind === 'message.send' && e.deliverAt !== null && trace.some((d) => d.kind === 'message.deliver' && d.messageId === e.messageId && d.index > e.index + 8))!;
    const index = TraceIndex.build(trace.slice(0, send.index + 1), { checkpointEntries: 4 });
    const before = index.frameAt(send.index).inFlight.find((f) => f.record.sendIndex === send.index)!;
    expect(before.record.outcome).toBe('in-flight');
    index.append(trace.slice(send.index + 1));
    const after = index.frameAt(send.index).inFlight.find((f) => f.record.sendIndex === send.index)!;
    expect(after.record.outcome).toBe('delivered');
    expect(after).toEqual(TraceIndex.build(trace, { checkpointEntries: 4 }).frameAt(send.index).inFlight.find((f) => f.record.sendIndex === send.index));
    expect(before.record.outcome).toBe('in-flight'); // frames already handed out are immutable snapshots
  });

  it('rejects chunks that do not continue the trace exactly, and adds nothing', () => {
    const trace = leader(140);
    const index = TraceIndex.build(trace.slice(0, 50));
    expect(() => index.append(trace.slice(51, 60))).toThrow(/expected #50/); // gap
    expect(() => index.append(trace.slice(40, 60))).toThrow(/expected #50/); // duplicates
    expect(() => index.append([trace[60]!, trace[50]!])).toThrow(); // out of order
    expect(index.length).toBe(50);
    expect(() => TraceIndex.build(trace.slice(1))).toThrow(/run\.start/);
    index.append(trace.slice(50));
    expect(index.end?.kind).toBe('run.end');
    expect(() => index.append([{ ...trace.at(-1)!, index: trace.length }] as never)).toThrow(/already ended/);
  });

  it('keeps the frame cost bound of build() while growing', () => {
    const trace = leader(400);
    const index = incremental(trace, [17, 100, 101, 333, 900], 32);
    for (let i = 0; i < trace.length; i += 7) {
      index.frameAt(i);
      expect(index.lastFrameCost).toBeLessThan(32);
    }
  });
});
