import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SimulationConfig } from '../src/config';
import type { FaultSpec } from '../src/faults';
import { createHeartbeatProtocol, createNaiveLeaderProtocol, naiveLeaderInvariants } from '../src/fixtures';
import { Simulation } from '../src/simulation';
import { TimeTravel } from '../src/time-travel';
import { serializeTrace } from '../src/trace';
import { faultPlanArb } from './arbitraries';
import { protocol } from './helpers';

const NODES = ['n1', 'n2', 'n3', 'n4'];
const leader = (seed: number, faults: FaultSpec[]): SimulationConfig => ({
  seed,
  nodes: NODES,
  protocol: createNaiveLeaderProtocol() as never,
  network: { latency: { min: 1, max: 10 } },
  limits: { maxTime: 600 },
  faults,
  invariants: naiveLeaderInvariants,
  invariantPolicy: 'record-and-continue',
});
const heartbeat = (seed: number, faults: FaultSpec[]): SimulationConfig => ({
  seed,
  nodes: NODES,
  protocol: createHeartbeatProtocol({ interval: 20, timeout: 60 }) as never,
  network: { latency: { min: 1, max: 12 } },
  limits: { maxTime: 500 },
  faults,
});

const snapshotAfter = (config: SimulationConfig, steps: number) => {
  const sim = new Simulation(config);
  while (sim.stepsCompleted < steps && sim.stopReason === null) sim.step();
  return serializeTrace([sim.snapshot()] as never);
};

describe('seek (positions are step boundaries)', () => {
  it('reconstructs exactly the state of an uninterrupted run, re-executing fewer than keyframeSteps steps', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        faultPlanArb(400),
        fc.constantFrom(1, 2, 7, 64),
        fc.array(fc.integer({ min: 0, max: 800 }), { minLength: 1, maxLength: 4 }),
        (useLeader, seed, faults, keyframeSteps, targets) => {
          const config = (useLeader ? leader : heartbeat)(seed, faults);
          const travel = TimeTravel.record(config, { keyframeSteps });
          for (const target of targets) {
            const { simulation, reexecutedSteps, keyframe } = travel.seek(target);
            const clamped = Math.min(target, travel.totalSteps);
            expect(simulation.stepsCompleted).toBe(clamped);
            expect(reexecutedSteps).toBeLessThan(keyframeSteps);
            expect(keyframe.step).toBeLessThanOrEqual(clamped);
            expect(serializeTrace([simulation.snapshot()] as never)).toBe(snapshotAfter(config, clamped));
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('keeps one keyframe per keyframeSteps steps, starting at step 0', () => {
    const travel = TimeTravel.record(leader(7, []), { keyframeSteps: 25 });
    expect(travel.keyframes.map((k) => k.step)).toEqual(Array.from({ length: travel.keyframes.length }, (_, i) => i * 25));
    expect(travel.keyframes.at(-1)!.step).toBeGreaterThan(travel.totalSteps - 25);
  });

  it('gives the same answer for every keyframe interval', () => {
    const config = leader(11, [{ at: 250, type: 'partition', groups: [['n4']] }]);
    const answers = [1, 3, 16, 100, 10_000].map((k) => {
      const travel = TimeTravel.record(config, { keyframeSteps: k });
      return [0, 1, 50, 137, travel.totalSteps].map((s) => serializeTrace([travel.seek(s).simulation.snapshot()] as never)).join('|');
    });
    expect(new Set(answers).size).toBe(1);
  });

  it('bounds re-execution in STEPS even when one step produces hundreds of trace entries', () => {
    // Every timer step broadcasts 100 messages to each of 3 peers: ≥ 600 entries per step.
    const burst = protocol({
      init: (ctx) => (ctx.setTimer(10, 'burst'), {}),
      onTimer: (state, _timer, ctx) => {
        for (let i = 0; i < 100; i++) ctx.broadcast({ i });
        ctx.setTimer(10, 'burst');
        return state;
      },
    });
    // Deliveries (latency 50) fall after maxTime, so every step is a start or a burst: 4 + 8 steps.
    const config: SimulationConfig = { seed: 1, nodes: NODES, protocol: burst, network: { latency: { min: 50, max: 50 } }, limits: { maxTime: 25 } };
    const travel = TimeTravel.record(config, { keyframeSteps: 4 });
    const trace = travel.trace!;
    expect(travel.totalSteps).toBe(12);
    let maxEntriesInWindow = 0;
    for (let s = 0; s <= travel.totalSteps; s++) {
      const { reexecutedSteps, keyframe, simulation } = travel.seek(s);
      expect(reexecutedSteps).toBeLessThanOrEqual(3);
      maxEntriesInWindow = Math.max(maxEntriesInWindow, simulation.traceLength - keyframe.traceLength);
    }
    // The bound is about steps: the entries re-generated between keyframe and target can be large.
    expect(maxEntriesInWindow).toBeGreaterThanOrEqual(900); // 3 burst steps × ≥ 300 entries
    expect(trace.length).toBeGreaterThan(2400);
  });
});

describe('trace regeneration (trace as a recomputable cache)', () => {
  it('regenerates any step range byte-identically, with original absolute indices', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), faultPlanArb(400), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }), (seed, faults, a, b) => {
        const config = leader(seed, faults);
        const travel = TimeTravel.record(config, { keyframeSteps: 16 });
        const [from, to] = [Math.min(a, b), Math.max(a, b)];
        const { firstIndex, entries } = travel.regenerate(from, to);
        const full = travel.trace!;
        expect(entries.every((e, i) => e.index === firstIndex + i)).toBe(true);
        expect(serializeTrace(entries)).toBe(serializeTrace(full.slice(firstIndex, firstIndex + entries.length)));
        // The range ends exactly at the step boundary after `to` (or at the end of the run).
        const endIndex = firstIndex + entries.length;
        expect(endIndex === full.length || endIndex === travel.stepBoundary(Math.min(to, travel.totalSteps))).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it('reproduces the whole trace from keyframes alone when the trace was not retained', () => {
    const config = leader(7, [{ at: 300, type: 'partition', groups: [['n4']] }]);
    const retained = TimeTravel.record(config, { keyframeSteps: 32 });
    const lean = TimeTravel.record(config, { keyframeSteps: 32, retainTrace: false });
    expect(lean.trace).toBeNull();
    const rebuilt = lean.regenerate(0, lean.totalSteps);
    expect(rebuilt.firstIndex).toBe(1);
    expect(serializeTrace([retained.trace![0]!, ...rebuilt.entries])).toBe(serializeTrace(retained.trace!));
    // Keyframes are identical whether or not the trace was retained.
    expect(lean.keyframes.map((k) => serializeTrace([k.snapshot] as never))).toEqual(retained.keyframes.map((k) => serializeTrace([k.snapshot] as never)));
  });

  it('preserves causal references across regenerated segments', () => {
    const config = leader(3, [{ at: 200, type: 'crash', node: 'n4' }]);
    const travel = TimeTravel.record(config, { keyframeSteps: 10 });
    const { entries } = travel.regenerate(100, 140);
    for (const entry of entries) {
      if (entry.cause !== null) expect(travel.trace![entry.cause]).toBeDefined(); // points into the same absolute trace
      expect(travel.trace![entry.index]).toEqual(entry);
    }
  });
});

describe('argument validation', () => {
  it('rejects invalid intervals and ranges, and clamps seeks to the run', () => {
    const config = leader(1, []);
    for (const keyframeSteps of [0, -1, 1.5, Number.NaN]) expect(() => TimeTravel.record(config, { keyframeSteps })).toThrow(RangeError);
    const travel = TimeTravel.record(config, { keyframeSteps: 50 });
    expect(() => travel.regenerate(10, 5)).toThrow(RangeError);
    expect(travel.seek(-5).simulation.stepsCompleted).toBe(0);
    expect(travel.seek(10 ** 9).simulation.stepsCompleted).toBe(travel.totalSteps);
    expect(travel.stopReason).toBe('time-limit');
    expect(travel.traceLength).toBe(travel.trace!.length);
  });
});
