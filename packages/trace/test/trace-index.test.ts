import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runSimulation, Simulation, type FaultSpec, type SimulationConfig, type TraceEntry } from '@faultlab/engine';
import { createHeartbeatProtocol, createNaiveLeaderProtocol, createPingProtocol, naiveLeaderInvariants } from '@faultlab/engine/fixtures';
import { TraceIndex, type Frame } from '../src';

const NODES = ['n1', 'n2', 'n3', 'n4'];
const node = fc.constantFrom(...NODES);
const at = fc.integer({ min: 0, max: 400 });
const link = fc.tuple(node, node).filter(([a, b]) => a !== b);
const faultPlan: fc.Arbitrary<FaultSpec[]> = fc.array(
  fc.oneof(
    fc.record({ at, type: fc.constant('crash' as const), node }),
    fc.record({ at, type: fc.constant('recover' as const), node }),
    fc.record({ at, node, down: fc.integer({ min: 0, max: 80 }) }).map(({ at: t, node: n, down }) => ({ at: t + down, type: 'recover' as const, node: n })),
    fc.record({ at, type: fc.constant('partition' as const), groups: fc.subarray(NODES, { minLength: 1, maxLength: 3 }).map((g) => [g]) }),
    fc.record({ at, type: fc.constant('heal' as const) }),
    fc.record({ at, link, loss: fc.integer({ min: 0, max: 100 }) }).map(({ at: t, link: [from, to], loss }) => ({ at: t, type: 'link' as const, from, to, loss: loss / 100, delay: { min: 0, max: 15 } })),
    fc.record({ at, link }).map(({ at: t, link: [from, to] }) => ({ at: t, type: 'link-restore' as const, from, to })),
  ),
  { maxLength: 15 },
);

type Kind = 'heartbeat' | 'ping' | 'leader';
const configFor = (kind: Kind, seed: number, faults: FaultSpec[]): SimulationConfig => {
  const base = { seed, nodes: NODES, network: { latency: { min: 1, max: 12 } }, faults };
  if (kind === 'heartbeat') return { ...base, protocol: createHeartbeatProtocol({ interval: 20, timeout: 60 }) as never, limits: { maxTime: 450 } };
  if (kind === 'ping') return { ...base, protocol: createPingProtocol({ rounds: 3, interval: 30, jitter: 5 }) as never };
  return { ...base, protocol: createNaiveLeaderProtocol() as never, limits: { maxTime: 500 }, invariants: naiveLeaderInvariants, invariantPolicy: 'record-and-continue' };
};
const experiment = fc.record({ kind: fc.constantFrom<Kind>('heartbeat', 'ping', 'leader'), seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }), faults: faultPlan });

/** What the engine's authoritative snapshot says, in the TraceIndex's vocabulary. */
const engineView = (sim: Simulation) => {
  const snap = sim.snapshot();
  return {
    nodes: snap.nodes.map((n) => ({
      id: n.id,
      status: n.status,
      incarnation: n.incarnation,
      state: n.state === null ? undefined : n.state.value,
      stateEntry: n.stateEntry,
      storage: Object.fromEntries(n.storage),
      timers: n.timers.map(([id]) => id),
    })),
    inFlight: sim.inFlight().map((m) => m.id),
    partition: snap.network.partition?.groups ?? null,
    links: snap.network.links.map(({ from, to, loss, delay }) => ({ from, to, loss, delay })),
  };
};
const indexView = (frame: Frame) => ({
  nodes: frame.nodes.map((n) => ({ id: n.id, status: n.status, incarnation: n.incarnation, state: n.state, stateEntry: n.stateEntry, storage: n.storage, timers: n.pendingTimers.map((t) => t.timerId) })),
  inFlight: frame.inFlight.map((m) => m.record.id),
  partition: frame.partition,
  links: frame.links,
});

describe('reconstruction equals the engine’s authoritative state after every step', () => {
  it('for random protocols and fault plans, at several checkpoint intervals', () => {
    fc.assert(
      fc.property(experiment, fc.constantFrom(1, 5, 64, 256), ({ kind, seed, faults }, checkpointEntries) => {
        const sim = new Simulation(configFor(kind, seed, faults));
        const views: Array<{ index: number; view: ReturnType<typeof engineView> }> = [];
        while (sim.stopReason === null) {
          sim.step();
          views.push({ index: sim.traceLength - 1, view: engineView(sim) });
        }
        const index = TraceIndex.build(sim.trace, { checkpointEntries });
        for (const { index: i, view } of views) expect(indexView(index.frameAt(i))).toEqual(view);
      }),
      { numRuns: 60 },
    );
  });
});

describe('checkpoints (unit: trace entries)', () => {
  const trace = runSimulation(configFor('leader', 7, [{ at: 300, type: 'partition', groups: [['n4']] }])).trace;

  it('give identical frames for every interval, equal to a full scan from #0', () => {
    const fullScan = TraceIndex.build(trace, { checkpointEntries: trace.length + 1 });
    const indexes = [1, 3, 64, 256, 1000].map((k) => TraceIndex.build(trace, { checkpointEntries: k }));
    for (let i = 0; i < trace.length; i += 7) {
      const expected = JSON.stringify(fullScan.frameAt(i, trace[i]!.time + 2));
      for (const index of indexes) expect(JSON.stringify(index.frameAt(i, trace[i]!.time + 2))).toBe(expected);
    }
  });

  it('bound the work per query by the interval in ENTRIES, even when one step produces hundreds of entries', () => {
    const burst = {
      name: 'burst',
      version: '1',
      init: (ctx: { setTimer(d: number, t: string): unknown }) => (ctx.setTimer(10, 'burst'), {}),
      onMessage: (s: object) => s,
      onTimer: (s: object, _t: unknown, ctx: { broadcast(p: object): unknown; setTimer(d: number, t: string): unknown }) => {
        for (let i = 0; i < 100; i++) ctx.broadcast({ i });
        ctx.setTimer(10, 'burst');
        return s;
      },
    };
    const big = runSimulation({ seed: 1, nodes: NODES, protocol: burst as never, network: { latency: { min: 1, max: 5 } }, limits: { maxTime: 40 } }).trace;
    const index = TraceIndex.build(big, { checkpointEntries: 64 });
    expect(Math.max(...index.steps.map((s) => s.last - s.first + 1))).toBeGreaterThan(300); // one step, hundreds of entries
    let worst = 0;
    for (let i = 0; i < big.length; i++) {
      index.frameAt(i);
      worst = Math.max(worst, index.lastFrameCost);
    }
    expect(worst).toBe(63);
  });
});

describe('step boundaries (a step = one dispatched scheduled event)', () => {
  it('match the engine’s actual step() calls exactly', () => {
    fc.assert(
      fc.property(experiment, ({ kind, seed, faults }) => {
        const sim = new Simulation(configFor(kind, seed, faults));
        const truth: Array<{ first: number; last: number }> = [];
        while (sim.stopReason === null) {
          const before = sim.traceLength;
          if (sim.step()) truth.push({ first: before, last: sim.traceLength - 1 });
        }
        const index = TraceIndex.build(sim.trace);
        expect(index.steps.map(({ first, last }) => ({ first, last }))).toEqual(truth);
        expect(index.steps.length).toBe(sim.stepsCompleted);
        expect(index.stepOf(0)).toBe(0);
        // Every entry inside a step maps to that step.
        for (const s of index.steps) for (let i = s.first; i <= s.last; i++) expect(index.stepOf(i)).toBe(s.step);
      }),
      { numRuns: 60 },
    );
  });

  it('contain each violation’s own step range, and run.end only when the stop happened inside a step', () => {
    const config = configFor('leader', 7, [{ at: 300, type: 'partition', groups: [['n4']] }]);
    const stopped = TraceIndex.build(runSimulation({ ...config, invariantPolicy: 'stop-on-first' }).trace);
    const v = stopped.violations[0]!;
    const step = stopped.step(stopped.stepOf(v.index)!);
    expect([step.first, v.step.first]).toEqual([v.trigger, v.trigger]);
    expect(step.last).toBe(stopped.length - 1); // violation and run.end belong to the stopping step
    const timeLimited = TraceIndex.build(runSimulation(configFor('heartbeat', 1, [])).trace);
    expect(timeLimited.stepOf(timeLimited.length - 1)).toBeNull(); // run.end after a time limit: no step
  });
});

describe('markers and causality', () => {
  const trace = runSimulation(
    configFor('heartbeat', 3, [
      { at: 50, type: 'link', from: 'n1', to: 'n2', loss: 1, delay: { min: 0, max: 0 } },
      { at: 100, type: 'crash', node: 'n3' },
      { at: 150, type: 'partition', groups: [['n1']] },
      { at: 200, type: 'recover', node: 'n3' },
      { at: 250, type: 'heal' },
      { at: 260, type: 'link-restore', from: 'n1', to: 'n2' },
    ]),
  ).trace;
  const index = TraceIndex.build(trace);

  it('lists fault, violation and end markers pointing at the exact entries', () => {
    expect(index.markers.map((m) => m.kind)).toEqual(['link-fault', 'crash', 'partition', 'recover', 'heal', 'link-restore', 'run-end']);
    for (const m of index.markers) expect(trace[m.index]!.time).toBe(m.time);
    expect(index.nextMarker(0, ['crash'])?.label).toBe('n3 crashes (incarnation 1)');
    expect(index.previousMarker(trace.length, ['heal'])?.kind).toBe('heal');
  });

  it('inverts cause and conditionIndex exactly (forward and backward exploration)', () => {
    for (const e of trace) {
      for (const child of index.consequences(e.index).direct) expect(trace[child]!.cause).toBe(e.index);
      for (const drop of index.consequences(e.index).explained) expect((trace[drop] as Extract<TraceEntry, { kind: 'message.drop' }>).conditionIndex).toBe(e.index);
      if (e.cause !== null) expect(index.consequences(e.cause).direct).toContain(e.index);
      if (e.kind !== 'run.start' && e.kind !== 'run.end') expect(index.ancestors(e.index).at(-1)).toBe(0);
    }
    const crash = index.markers.find((m) => m.kind === 'crash')!.index;
    expect(index.consequences(crash).explained.length).toBeGreaterThan(0); // node-down drops explained by the crash
    const loss = index.markers.find((m) => m.kind === 'link-fault')!.index;
    expect(index.consequences(loss).explained.every((d) => (trace[d] as Extract<TraceEntry, { kind: 'message.drop' }>).reason === 'lost')).toBe(true);
  });

  it('returns deeply frozen frames and never changes the trace it reads', () => {
    const before = JSON.stringify(trace);
    const frame = index.frameAt(Math.floor(trace.length / 2));
    const stack: unknown[] = [frame];
    while (stack.length > 0) {
      const v = stack.pop();
      if (typeof v === 'object' && v !== null) {
        expect(Object.isFrozen(v)).toBe(true);
        stack.push(...Object.values(v));
      }
    }
    expect(JSON.stringify(trace)).toBe(before);
  });

  it('rejects incomplete traces instead of guessing (segments, gaps)', () => {
    expect(() => TraceIndex.build(trace.slice(5))).toThrow('starting with run.start');
    expect(() => TraceIndex.build([trace[0]!, trace[2]!])).toThrow('in order');
  });
});

describe('stored counterexamples', () => {
  it('index with their violation as a marker and its step intact', () => {
    const dir = join(import.meta.dirname, '..', '..', 'engine', 'test', 'counterexamples');
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const fixture = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { config: { seed: number; nodes: string[]; latency: { min: number; max: number }; maxTime: number; faults: FaultSpec[] }; invariant: { id: string }; protocol: { options: object }; expected: { violationTime: number } };
      const trace = runSimulation({
        seed: fixture.config.seed,
        nodes: fixture.config.nodes,
        protocol: createNaiveLeaderProtocol(fixture.protocol.options) as never,
        network: { latency: fixture.config.latency },
        limits: { maxTime: fixture.config.maxTime },
        faults: fixture.config.faults,
        invariants: naiveLeaderInvariants.filter((i) => i.id === fixture.invariant.id),
      }).trace;
      const index = TraceIndex.build(trace);
      const violation = index.markers.find((m) => m.kind === 'violation')!;
      expect(violation.time).toBe(fixture.expected.violationTime);
      expect(index.frameAt(violation.index).openViolations).toHaveLength(1);
    }
  });
});

describe('remaining API', () => {
  const trace = runSimulation(configFor('leader', 7, [{ at: 300, type: 'partition', groups: [['n4']] }])).trace;
  const index = TraceIndex.build(trace);

  it('descendants = the transitive closure of cause, in index order', () => {
    const closure = (root: number): number[] => {
      const out = new Set<number>();
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of trace) if (e.cause !== null && (e.cause === root || out.has(e.cause)) && !out.has(e.index)) (out.add(e.index), (grew = true));
      }
      return [...out].sort((a, b) => a - b);
    };
    for (const root of [0, 1, 40, Math.floor(trace.length / 2)]) expect(index.descendants(root)).toEqual(closure(root));
    expect(index.descendants(0, 5)).toHaveLength(5);
  });

  it('finds the last entry at or before a virtual time', () => {
    for (const t of [0, 1, 59, 60, 333, index.duration, index.duration + 10]) {
      const i = index.lastIndexAtOrBefore(t);
      expect(trace[i]!.time).toBeLessThanOrEqual(t);
      if (i + 1 < trace.length) expect(trace[i + 1]!.time).toBeGreaterThan(t);
    }
    expect(index.duration).toBe(trace.at(-1)!.time);
  });

  it('reconstructs storage deletions', () => {
    const deleting = {
      name: 'deleting',
      version: '1',
      init: (ctx: { storage: { set(k: string, v: number): void }; setTimer(d: number, t: string): unknown }) => (ctx.storage.set('a', 1), ctx.storage.set('b', 2), ctx.setTimer(5, 'drop'), {}),
      onMessage: (s: object) => s,
      onTimer: (s: object, _t: unknown, ctx: { storage: { delete(k: string): void } }) => (ctx.storage.delete('a'), s),
    };
    const sim = new Simulation({ seed: 1, nodes: ['n1', 'n2'], protocol: deleting as never, network: { latency: { min: 1, max: 1 } } });
    sim.run();
    const idx = TraceIndex.build(sim.trace);
    expect(idx.frameAt(idx.length - 1).nodes[0]!.storage).toEqual(sim.nodeStorage('n1'));
    expect(idx.frameAt(idx.length - 1).nodes[0]!.storage).toEqual({ b: 2 });
  });

  it('marks protocol and invariant errors, and rejects invalid arguments', () => {
    const broken = runSimulation({
      seed: 1,
      nodes: ['n1', 'n2'],
      protocol: { name: 'x', version: '1', init: () => { throw new Error('boom'); }, onMessage: (s: never) => s, onTimer: (s: never) => s } as never,
      network: { latency: { min: 1, max: 1 } },
    }).trace;
    expect(TraceIndex.build(broken).markers.map((m) => m.kind)).toEqual(['protocol-error', 'run-end']);
    const checkerError = runSimulation({
      ...configFor('heartbeat', 1, []),
      invariants: [{ id: 'bad', version: '1', name: 'Bad', initialHistory: null, check: () => { throw new Error('oops'); } }],
    }).trace;
    expect(TraceIndex.build(checkerError).markers.map((m) => m.kind)).toContain('invariant-error');
    expect(() => index.entry(10 ** 9)).toThrow(RangeError);
    expect(() => index.step(10 ** 9)).toThrow(RangeError);
    expect(() => TraceIndex.build(trace, { checkpointEntries: 0 })).toThrow(RangeError);
  });
});
