import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FaultSpec } from '../src/faults';
import { createHeartbeatProtocol, createPingProtocol } from '../src/fixtures';
import { runSimulation, Simulation } from '../src/simulation';
import { fingerprintTrace, serializeTrace } from '../src/trace';
import { ENGINE_VERSION } from '../src/version';
import { config, ofKind } from './helpers';
import { checkTraceInvariants, storageFromTrace } from './invariants';

const NODES = ['n1', 'n2', 'n3', 'n4'];

/** Random fault plans. Crash/recover are weighted up so nodes actually flap. */
const faultArb = (maxAt: number): fc.Arbitrary<FaultSpec> => {
  const at = fc.integer({ min: 0, max: maxAt });
  const node = fc.constantFrom(...NODES);
  const link = fc.tuple(node, node).filter(([from, to]) => from !== to);
  return fc.oneof(
    { weight: 3, arbitrary: fc.record({ at, type: fc.constant('crash' as const), node }) },
    { weight: 3, arbitrary: fc.record({ at, type: fc.constant('recover' as const), node }) },
    {
      weight: 2,
      arbitrary: fc.record({
        at,
        type: fc.constant('partition' as const),
        groups: fc.subarray(NODES, { minLength: 1, maxLength: NODES.length - 1 }).map((group) => [group]),
      }),
    },
    { weight: 1, arbitrary: fc.record({ at, type: fc.constant('heal' as const) }) },
    {
      weight: 2,
      arbitrary: fc
        .record({
          at,
          link,
          loss: fc.integer({ min: 0, max: 100 }).map((p) => p / 100),
          delay: fc.tuple(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 30 })).map(([min, extra]) => ({ min, max: min + extra })),
        })
        .map(({ at, link: [from, to], loss, delay }) => ({ at, type: 'link' as const, from, to, loss, delay })),
    },
    { weight: 1, arbitrary: fc.record({ at, link }).map(({ at, link: [from, to] }) => ({ at, type: 'link-restore' as const, from, to })) },
  );
};

/**
 * A crash followed by a recovery of the same node, possibly at the same tick (downFor = 0).
 * Without this, independently generated recoveries mostly hit running nodes and get skipped,
 * so incarnation edge cases would be under-tested.
 */
const outageArb = (maxAt: number): fc.Arbitrary<FaultSpec[]> =>
  fc
    .record({ at: fc.integer({ min: 0, max: maxAt }), node: fc.constantFrom(...NODES), downFor: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 120 })) })
    .map(({ at, node, downFor }) => [
      { at, type: 'crash', node },
      { at: at + downFor, type: 'recover', node },
    ]);

export const faultPlanArb = (maxAt: number): fc.Arbitrary<FaultSpec[]> =>
  fc
    .array(fc.oneof({ weight: 3, arbitrary: faultArb(maxAt).map((f) => [f]) }, { weight: 2, arbitrary: outageArb(maxAt) }), { maxLength: 20 })
    .map((groups) => groups.flat());

export const experiment = fc.record({
  seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
  faults: faultPlanArb(400),
  latencyMax: fc.integer({ min: 1, max: 25 }),
});

export const heartbeatConfig = ({ seed, faults, latencyMax }: { seed: number; faults: FaultSpec[]; latencyMax: number }) =>
  config(createHeartbeatProtocol({ interval: 20, jitter: 5, timeout: 60 }), {
    seed,
    nodes: NODES,
    faults,
    network: { latency: { min: 1, max: latencyMax } },
    limits: { maxTime: 500 },
  });

describe('random fault plans (property-based)', () => {
  it('never violate the lifecycle and network invariants (heartbeat)', () => {
    fc.assert(
      fc.property(experiment, (e) => {
        expect(checkTraceInvariants(runSimulation(heartbeatConfig(e)).trace)).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it('never violate the invariants for a protocol that terminates (ping), and every message is accounted for', () => {
    fc.assert(
      fc.property(experiment, ({ seed, faults, latencyMax }) => {
        const result = runSimulation(
          config(createPingProtocol({ rounds: 4, interval: 30, jitter: 10 }), {
            seed,
            nodes: NODES,
            faults,
            network: { latency: { min: 0, max: latencyMax } },
          }),
        );
        expect(result.reason).toBe('quiescent');
        expect(checkTraceInvariants(result.trace)).toEqual([]);
        const sends = ofKind(result.trace, 'message.send').length;
        const resolved = ofKind(result.trace, 'message.deliver').length + ofKind(result.trace, 'message.drop').length;
        expect(resolved).toBe(sends);
      }),
      { numRuns: 150 },
    );
  });

  it('replay deterministically: same inputs and fault plan give the same trace', () => {
    fc.assert(
      fc.property(experiment, (e) => {
        expect(serializeTrace(runSimulation(heartbeatConfig(e)).trace)).toBe(serializeTrace(runSimulation(heartbeatConfig(e)).trace));
      }),
      { numRuns: 75 },
    );
  });

  it('step-by-step execution equals run() under faults', () => {
    fc.assert(
      fc.property(experiment, (e) => {
        const stepped = new Simulation(heartbeatConfig(e));
        while (stepped.stopReason === null) stepped.step();
        expect(serializeTrace(stepped.trace)).toBe(serializeTrace(runSimulation(heartbeatConfig(e)).trace));
      }),
      { numRuns: 30 },
    );
  });

  it('keep committed storage consistent with the trace, across every crash', () => {
    fc.assert(
      fc.property(experiment, (e) => {
        const sim = new Simulation(heartbeatConfig(e));
        const derived = storageFromTrace(sim.run().trace);
        for (const node of NODES) expect(sim.nodeStorage(node)).toEqual(derived.get(node) ?? {});
        // boots = 1 + number of recoveries actually applied to that node
        const recoveries = (node: string) => ofKind(sim.trace, 'node.recover').filter((r) => r.node === node).length;
        for (const node of NODES) expect(sim.nodeStorage(node)['boots']).toBe(1 + recoveries(node));
      }),
      { numRuns: 75 },
    );
  });
});

describe('fault-heavy runs respect resource limits', () => {
  /** Every node crashes and recovers every 10 ticks, out of phase, for 2000 ticks: 800 faults. */
  const flapping: FaultSpec[] = NODES.flatMap((node, i) =>
    Array.from({ length: 100 }, (_, k): FaultSpec[] => [
      { at: 20 * k + 3 * i + 1, type: 'crash', node },
      { at: 20 * k + 3 * i + 11, type: 'recover', node },
    ]).flat(),
  );

  it('maxEvents stops a flapping run, with invariants intact', () => {
    const result = runSimulation(
      config(createHeartbeatProtocol({ interval: 4, jitter: 2, timeout: 12 }), { nodes: NODES, faults: flapping, limits: { maxEvents: 3000 } }),
    );
    expect(result.reason).toBe('event-limit');
    expect(result.eventsProcessed).toBe(3000);
    expect(checkTraceInvariants(result.trace)).toEqual([]);
  });

  it('maxPendingEvents stops a flood even while faults are firing', () => {
    const flood = {
      name: 'flood',
      version: '1',
      init: (ctx: { broadcast(p: object): unknown }) => (ctx.broadcast({}), {}),
      onMessage: (state: object, _m: unknown, ctx: { broadcast(p: object): unknown }) => (ctx.broadcast({}), state),
      onTimer: (state: object) => state,
    };
    const result = runSimulation(config(flood as never, { nodes: NODES, faults: flapping, limits: { maxPendingEvents: 2000 } }));
    expect(result.reason).toBe('pending-limit');
    expect(checkTraceInvariants(result.trace)).toEqual([]);
  });

  it('crash-time bulk cancellation and timer resets keep the scheduler heap bounded (ADR-0011)', () => {
    // Long watchdog timeouts reset on every heartbeat: the worst case for lazy cancellation.
    const sim = new Simulation(
      config(createHeartbeatProtocol({ interval: 1, jitter: 0, timeout: 1_000_000 }), {
        nodes: NODES,
        faults: flapping.slice(0, 40),
        limits: { maxEvents: 60_000 },
      }),
    );
    let maxEntries = 0;
    while (sim.stopReason === null) {
      sim.step();
      const { pending, heapEntries } = sim.schedulerStats;
      maxEntries = Math.max(maxEntries, heapEntries);
      expect(heapEntries).toBeLessThanOrEqual(2 * pending + 1024);
    }
    expect(sim.schedulerStats.compactions).toBeGreaterThan(0);
    expect(maxEntries).toBeLessThan(1200);
  });
});

describe('CP1 golden trace', () => {
  /**
   * GOLDEN TRACE for a fault-heavy reference experiment. Same rule as the CP0 golden: if it
   * fails unintentionally you found a regression; if intentionally, bump ENGINE_VERSION.
   */
  it('matches the golden fingerprint for the fault reference experiment', () => {
    const faults: FaultSpec[] = [
      { at: 50, type: 'link', from: 'n3', to: 'n4', loss: 0.3, delay: { min: 10, max: 40 } },
      { at: 100, type: 'crash', node: 'n2' },
      { at: 150, type: 'partition', groups: [['n1']] },
      { at: 220, type: 'recover', node: 'n2' },
      { at: 300, type: 'heal' },
      { at: 350, type: 'link-restore', from: 'n3', to: 'n4' },
      { at: 400, type: 'crash', node: 'n2' },
      { at: 400, type: 'recover', node: 'n2' },
    ];
    const result = runSimulation(heartbeatConfig({ seed: 2026, faults, latencyMax: 15 }));
    expect(checkTraceInvariants(result.trace)).toEqual([]);
    expect({
      engine: ENGINE_VERSION,
      eventsProcessed: result.eventsProcessed,
      drops: ofKind(result.trace, 'message.drop').length,
      fingerprint: fingerprintTrace(result.trace),
    }).toEqual({ engine: '0.2.0-cp1', eventsProcessed: 295, drops: 59, fingerprint: '17b2dde2' });
  });
});
