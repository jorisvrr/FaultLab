import { runSimulation, serializeTrace, Simulation, TimeTravel, type SimulationConfig, type TraceEntry } from '@faultlab/engine';
import { TraceIndex, type Frame } from '@faultlab/trace';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { raftConfig, raftExperimentArb, type RaftExperiment } from './raft-experiments';

/**
 * Raft (with invariants and the bounded-liveness check) through CP3's snapshot, time-travel and
 * TraceIndex machinery: nothing in CP4 may break replay. Shorter runs keep the properties fast.
 */
const MAX_TIME = 1200;
const configOf = (e: RaftExperiment): SimulationConfig => raftConfig(e, e.faults, { maxTime: MAX_TIME });

const runTo = (config: SimulationConfig, steps: number): Simulation => {
  const sim = new Simulation(config);
  while (sim.stepsCompleted < steps && sim.stopReason === null) sim.step();
  return sim;
};

describe('snapshot/restore equivalence with Raft and liveness (run(N) ≡ restore(snap@k) + run)', () => {
  it('continues byte-identically, with and without the trace prefix, through JSON', () => {
    fc.assert(
      fc.property(raftExperimentArb, fc.integer({ min: 0, max: 2000 }), (experiment, k) => {
        const config = configOf(experiment);
        const reference = runSimulation(config);
        const at = runTo(config, k);
        const snap = JSON.parse(JSON.stringify(at.snapshot())) as unknown;

        const withPrefix = Simulation.restore(config, snap, { tracePrefix: at.trace });
        withPrefix.run();
        expect(serializeTrace(withPrefix.trace)).toBe(serializeTrace(reference.trace));

        const segment = Simulation.restore(config, snap);
        segment.run();
        expect(segment.trace).toEqual(reference.trace.slice(segment.traceStart));
      }),
      { numRuns: 40 },
    );
  });

  it('time travel lands on exactly the state of an uninterrupted run, liveness phase included', () => {
    fc.assert(
      fc.property(raftExperimentArb, fc.constantFrom(1, 16, 128), fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: 1, maxLength: 3 }), (experiment, keyframeSteps, targets) => {
        const config = configOf(experiment);
        const travel = TimeTravel.record(config, { keyframeSteps });
        for (const target of targets) {
          const { simulation } = travel.seek(target);
          const fresh = runTo(config, Math.min(target, travel.totalSteps));
          expect(serializeTrace([simulation.snapshot()] as never)).toBe(serializeTrace([fresh.snapshot()] as never));
        }
      }),
      { numRuns: 25 },
    );
  });
});

describe('TraceIndex reconstruction of Raft runs equals the engine’s state after every step', () => {
  const engineView = (sim: Simulation) => {
    const snap = sim.snapshot();
    return {
      nodes: snap.nodes.map((n) => ({ id: n.id, status: n.status, state: n.state === null ? undefined : n.state.value, storage: Object.fromEntries(n.storage), timers: n.timers.map(([id]) => id) })),
      partition: snap.network.partition?.groups ?? null,
      liveness: (snap.liveness?.checks ?? []).map((c) => ({ id: c.id, phase: c.phase, since: c.since })),
    };
  };
  const indexView = (frame: Frame) => ({
    nodes: frame.nodes.map((n) => ({ id: n.id, status: n.status, state: n.state, storage: n.storage, timers: n.pendingTimers.map((t) => t.timerId) })),
    partition: frame.partition,
    liveness: frame.liveness.map((l) => ({ id: l.id, phase: l.phase, since: l.since })),
  });

  it('roles, terms, durable votes, timers, partitions and liveness phases', () => {
    fc.assert(
      fc.property(raftExperimentArb, fc.constantFrom(16, 256), (experiment, checkpointEntries) => {
        const sim = new Simulation(configOf(experiment));
        const views: { index: number; view: ReturnType<typeof engineView> }[] = [];
        while (sim.stopReason === null) {
          sim.step();
          views.push({ index: sim.traceLength - 1, view: engineView(sim) });
        }
        const index = TraceIndex.build(sim.trace, { checkpointEntries });
        for (const { index: i, view } of views) expect(indexView(index.frameAt(i))).toEqual(view);
      }),
      { numRuns: 20 },
    );
  });

  it('explains a Raft election through cause chains: RequestVote send → delivery → granted response → leader', () => {
    const config = configOf({ size: 5, seed: 1, timing: 'default', latencyMax: 10, faults: [] });
    const { trace } = runSimulation(config);
    const index = TraceIndex.build(trace);
    const elected = trace.find((e): e is Extract<TraceEntry, { kind: 'state.update' }> => e.kind === 'state.update' && (e.state as { role: string }).role === 'leader')!;
    const chain = index.ancestors(elected.index).map((i) => trace[i]!);
    // The leader's state update was caused by the delivery of the deciding vote ...
    const delivery = chain.find((e) => e.kind === 'message.deliver')!;
    expect(delivery).toMatchObject({ node: elected.node, payload: { type: 'RequestVoteResponse', voteGranted: true } });
    // ... which was sent in response to the candidate's RequestVote delivery.
    expect(chain.some((e) => e.kind === 'message.deliver' && (e.payload as { type: string }).type === 'RequestVote')).toBe(true);
    expect(chain.at(-1)?.kind).toBe('run.start');
  });
});
