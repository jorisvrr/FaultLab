import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FaultSpec } from '../src/faults';
import { createHeartbeatProtocol, createPingProtocol } from '../src/fixtures';
import { runSimulation, Simulation } from '../src/simulation';
import { fingerprintTrace, serializeTrace } from '../src/trace';
import { ENGINE_VERSION } from '../src/version';
import { config, ofKind } from './helpers';
import { checkTraceInvariants, storageFromTrace } from './invariants';
import { projectTrace } from './legacy';

import { experiment, heartbeatConfig, NODES } from './arbitraries';

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
  const faultReference = () => {
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
    return runSimulation(heartbeatConfig({ seed: 2026, faults, latencyMax: 15 }));
  };

  it('reproduces the CP2/CP3 fingerprint when projected onto the 0.3.0-cp2 trace format', () => {
    expect(fingerprintTrace(projectTrace(faultReference().trace, '0.3.0-cp2') as never)).toBe('b10daf99');
  });

  it('reproduces the CP1 fingerprint when projected onto the CP1 trace format (invariants disabled)', () => {
    expect(fingerprintTrace(projectTrace(faultReference().trace, '0.2.0-cp1') as never)).toBe('17b2dde2');
  });

  it('matches the golden fingerprint for the fault reference experiment', () => {
    const result = faultReference();
    expect(checkTraceInvariants(result.trace)).toEqual([]);
    expect({
      engine: ENGINE_VERSION,
      eventsProcessed: result.eventsProcessed,
      drops: ofKind(result.trace, 'message.drop').length,
      fingerprint: fingerprintTrace(result.trace),
    }).toEqual({ engine: '0.4.0-cp4', eventsProcessed: 295, drops: 59, fingerprint: '6a1dfe65' });
  });
});
