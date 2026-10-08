import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPingProtocol } from '../src/fixtures';
import { runSimulation, Simulation } from '../src/simulation';
import { fingerprintTrace, serializeTrace } from '../src/trace';
import { ENGINE_VERSION } from '../src/version';
import { config, ofKind, protocol } from './helpers';

/** The reference CP0 experiment: randomized latency AND randomized protocol timers. */
const reference = (seed = 42) =>
  config(createPingProtocol({ rounds: 3, interval: 40, jitter: 25 }), { seed, network: { latency: { min: 1, max: 30 } } });

describe('determinism', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('two runs with identical inputs produce identical traces', () => {
    const a = runSimulation(reference());
    const b = runSimulation(reference());
    expect(a.trace.length).toBeGreaterThan(100);
    expect(serializeTrace(a.trace)).toBe(serializeTrace(b.trace));
    expect(a.trace).toEqual(b.trace);
  });

  it('holds for arbitrary seeds, latencies and node counts (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 6 }),
        (seed, min, spread, nodeCount) => {
          const cfg = config(createPingProtocol({ rounds: 2, jitter: 5 }), {
            seed,
            nodes: Array.from({ length: nodeCount }, (_, i) => `n${i + 1}`),
            network: { latency: { min, max: min + spread } },
          });
          expect(serializeTrace(runSimulation(cfg).trace)).toBe(serializeTrace(runSimulation(cfg).trace));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('different seeds produce different executions', () => {
    expect(fingerprintTrace(runSimulation(reference(1)).trace)).not.toBe(fingerprintTrace(runSimulation(reference(2)).trace));
  });

  it('step-by-step execution produces the same trace as run()', () => {
    const stepped = new Simulation(reference());
    while (stepped.stopReason === null) stepped.step();
    expect(serializeTrace(stepped.trace)).toBe(serializeTrace(runSimulation(reference()).trace));
  });

  it('never consults wall-clock time or ambient randomness', () => {
    const forbidden = () => {
      throw new Error('ambient nondeterminism used by the engine');
    };
    vi.spyOn(Math, 'random').mockImplementation(forbidden);
    vi.spyOn(Date, 'now').mockImplementation(forbidden);
    vi.spyOn(performance, 'now').mockImplementation(forbidden);
    expect(runSimulation(reference()).reason).toBe('quiescent');
  });

  it('isolates random streams: extra draws on one node do not change another node’s draws', () => {
    const drawing = (extraDrawsOnN1: number) =>
      protocol({
        init: (ctx) => {
          if (ctx.self === 'n1') for (let i = 0; i < extraDrawsOnN1; i++) ctx.random.nextUint32();
          return { draws: [ctx.random.nextUint32(), ctx.random.nextUint32()] };
        },
      });
    const quiet = new Simulation(config(drawing(0)));
    const noisy = new Simulation(config(drawing(17)));
    quiet.run();
    noisy.run();
    expect(noisy.nodeState('n1')).not.toEqual(quiet.nodeState('n1'));
    expect(noisy.nodeState('n2')).toEqual(quiet.nodeState('n2'));
    expect(noisy.nodeState('n3')).toEqual(quiet.nodeState('n3'));
  });

  it('records the inputs needed to reproduce the run in run.start', () => {
    const [start] = ofKind(runSimulation(reference()).trace, 'run.start');
    expect(start).toMatchObject({
      engineVersion: ENGINE_VERSION,
      protocol: { name: 'ping', version: '1' },
      seed: 42,
      nodes: ['n1', 'n2', 'n3'],
      latency: { min: 1, max: 30 },
    });
  });

  it('produces a JSON-serialisable trace that round-trips losslessly', () => {
    const { trace } = runSimulation(reference());
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
  });

  /**
   * GOLDEN TRACE. If this fails, the engine's observable behaviour changed. If the change is
   * intentional: bump ENGINE_VERSION, explain the change in the commit, and update the value.
   * If it is not intentional, you have found a determinism regression.
   */
  it('matches the golden fingerprint for the reference experiment', () => {
    const { trace, eventsProcessed, finalTime } = runSimulation(reference());
    expect({ engine: ENGINE_VERSION, eventsProcessed, finalTime, fingerprint: fingerprintTrace(trace) }).toEqual({
      engine: '0.1.0-cp0',
      eventsProcessed: 45,
      finalTime: 150,
      fingerprint: '62159051',
    });
  });
});
