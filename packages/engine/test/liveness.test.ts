import { describe, expect, it } from 'vitest';
import type { SimulationConfig } from '../src/config';
import { ConfigError } from '../src/errors';
import type { FaultSpec } from '../src/faults';
import type { JsonValue } from '../src/json';
import type { LivenessCheck } from '../src/liveness';
import { Simulation, runSimulation } from '../src/simulation';
import { SnapshotError } from '../src/snapshot';
import { serializeTrace, type TraceEntry } from '../src/trace';
import { config, ofKind, protocol } from './helpers';

/**
 * Bounded-liveness framework (CP4, ADR-0019), tested with a toy protocol whose progress time is
 * fully controlled: n1 becomes `done` when its 'work' timer fires, `workAt` ticks after start.
 * Nothing else ever happens, so the scheduler is quiet apart from that one timer.
 */
const worker = (workAt: number | null, n2TickAt: number | null = null) =>
  protocol({
    init: (ctx) => {
      if (ctx.self === 'n1' && workAt !== null) ctx.setTimer(workAt, 'work');
      if (ctx.self === 'n2' && n2TickAt !== null) ctx.setTimer(n2TickAt, 'tick'); // an unrelated event
      return { done: false };
    },
    onTimer: () => ({ done: true }),
  });

const n1Done = (view: Parameters<LivenessCheck['progress']>[0]): boolean => (view.node('n1').state as { done?: boolean } | undefined)?.done === true;

const check = (overrides: Partial<LivenessCheck> = {}): LivenessCheck => ({
  id: 'n1-done',
  version: '1',
  name: 'n1 finishes its work',
  deadline: 100,
  assumptions: ['n1 is running'],
  assumptionsHold: (view) => view.node('n1').status === 'running',
  progress: n1Done,
  ...overrides,
});

const run = (workAt: number | null, overrides: Partial<SimulationConfig> = {}, c: LivenessCheck = check()) =>
  runSimulation(config(worker(workAt), { limits: { maxTime: 1000 }, liveness: [c], ...overrides }));

const livenessKinds = (trace: readonly TraceEntry[]) =>
  trace.filter((e) => e.kind.startsWith('liveness.')).map((e) => `${e.kind}@${e.time}`);

describe('liveness configuration (trust boundary)', () => {
  const bad: [string, unknown, string][] = [
    ['not an array', {}, 'liveness'],
    ['bad id', [check({ id: 'Bad Id' })], 'liveness[0].id'],
    ['duplicate id', [check(), check()], 'liveness[1].id'],
    ['empty version', [check({ version: '' })], 'liveness[0].version'],
    ['zero deadline', [check({ deadline: 0 })], 'liveness[0].deadline'],
    ['fractional deadline', [check({ deadline: 1.5 })], 'liveness[0].deadline'],
    ['no assumptions', [check({ assumptions: [] })], 'liveness[0].assumptions'],
    ['non-string assumption', [check({ assumptions: [42 as never] })], 'liveness[0].assumptions'],
    ['missing progress', [{ ...check(), progress: undefined }], 'liveness[0].progress'],
    ['missing assumptionsHold', [{ ...check(), assumptionsHold: undefined }], 'liveness[0].assumptionsHold'],
    ['a non-object check', [42], 'liveness[0]'],
    ['an empty name', [check({ name: '' })], 'liveness[0].name'],
    ['too many checks', Array.from({ length: 17 }, (_, i) => check({ id: `c${i}` })), 'liveness'],
  ];
  it.each(bad)('rejects %s', (_label, liveness, path) => {
    expect(() => new Simulation(config(worker(10), { liveness: liveness as never }))).toThrow(ConfigError);
    try {
      new Simulation(config(worker(10), { liveness: liveness as never }));
    } catch (error) {
      expect((error as ConfigError).path).toBe(path);
    }
  });

  it('records the configured checks and their assumptions in run.start', () => {
    const start = run(10).trace[0] as Extract<TraceEntry, { kind: 'run.start' }>;
    expect(start.liveness).toEqual([{ id: 'n1-done', version: '1', name: 'n1 finishes its work', deadline: 100, assumptions: ['n1 is running'] }]);
  });
});

describe('waiting periods and deadlines', () => {
  it('arms when the assumptions start to hold and is met by progress before the deadline', () => {
    const { trace } = run(40);
    expect(livenessKinds(trace)).toEqual(['liveness.armed@0', 'liveness.met@40']);
    const [armed] = ofKind(trace, 'liveness.armed');
    expect(armed).toMatchObject({ since: 0, deadlineAt: 100 });
    expect(ofKind(trace, 'liveness.met')[0]).toMatchObject({ since: 0, duration: 40, late: false });
  });

  it('cancels the deadline event on progress: nothing liveness-related is left pending', () => {
    const sim = new Simulation(config(worker(40), { liveness: [check()] }));
    const result = sim.run();
    expect(result.reason).toBe('quiescent');
    expect(result.finalTime).toBe(40); // the cancelled deadline at t=100 did not keep the run alive
  });

  it('reports a miss at EXACTLY the deadline, as the trigger of its own step, caused by the armed entry', () => {
    const { trace } = run(250);
    expect(livenessKinds(trace)).toEqual(['liveness.armed@0', 'liveness.missed@100', 'liveness.met@250']);
    const missed = ofKind(trace, 'liveness.missed')[0]!;
    const armed = ofKind(trace, 'liveness.armed')[0]!;
    expect(missed).toMatchObject({ since: 0, deadlineAt: 100, assumptions: ['n1 is running'], cause: armed.index });
    // A trigger: the entry before it belongs to an earlier step (nothing else happens at t=100).
    expect(trace[missed.index - 1]!.time).toBeLessThan(100);
    // Late progress is still recorded, and marked late.
    expect(ofKind(trace, 'liveness.met')[0]).toMatchObject({ duration: 250, late: true });
  });

  it('is evaluated even when the scheduler is otherwise quiet (no progress ever)', () => {
    const result = run(null);
    expect(livenessKinds(result.trace)).toEqual(['liveness.armed@0', 'liveness.missed@100']);
    expect(result.reason).toBe('quiescent');
    expect(result.finalTime).toBe(100); // only the deadline event existed after startup
  });

  it('never stops the run and is never reported as a safety violation', () => {
    const result = run(null, { invariantPolicy: 'stop-on-first' });
    expect(ofKind(result.trace, 'invariant.violation')).toEqual([]);
    expect(result.reason).not.toBe('invariant-violation');
  });

  it('a deadline of 1 tick still works (smallest bound)', () => {
    expect(livenessKinds(run(5, {}, check({ deadline: 1 })).trace)).toEqual(['liveness.armed@0', 'liveness.missed@1', 'liveness.met@5']);
  });

  it('is met immediately (duration 0) when progress already holds as the assumptions start', () => {
    const { trace } = run(10, {}, check({ assumptionsHold: n1Done }));
    expect(livenessKinds(trace)).toEqual(['liveness.armed@10', 'liveness.met@10']);
    expect(ofKind(trace, 'liveness.met')[0]).toMatchObject({ duration: 0, late: false });
  });

  it('evaluates checks after STEPS only: a purely time-based change is seen at the next event', () => {
    // The assumption becomes true at t=20, but nothing happens until n2's tick at t=60.
    const c = check({ assumptionsHold: (view) => view.time >= 20 });
    const result = runSimulation(config(worker(300, 60), { limits: { maxTime: 1000 }, liveness: [c] }));
    expect(livenessKinds(result.trace)).toEqual(['liveness.armed@60', 'liveness.missed@160', 'liveness.met@300']);
  });
});

describe('assumptions: no expectation while they do not hold', () => {
  const crashN1: FaultSpec[] = [{ at: 30, type: 'crash', node: 'n1' }];

  it('disarms (cancelling the deadline) when the assumptions break: no false miss', () => {
    const result = run(250, { faults: crashN1 });
    expect(livenessKinds(result.trace)).toEqual(['liveness.armed@0', 'liveness.disarmed@30']);
    expect(ofKind(result.trace, 'liveness.disarmed')[0]).toMatchObject({ since: 0, previous: 'waiting' });
    expect(result.finalTime).toBe(30);
  });

  it('starts a NEW period with a new deadline once they hold again', () => {
    const result = run(250, { faults: [...crashN1, { at: 500, type: 'recover', node: 'n1' }] });
    // n1 restarts at 500, its work timer fires at 750: 250 ticks after the period began at 500.
    expect(livenessKinds(result.trace)).toEqual(['liveness.armed@0', 'liveness.disarmed@30', 'liveness.armed@500', 'liveness.missed@600', 'liveness.met@750']);
    expect(ofKind(result.trace, 'liveness.armed')[1]).toMatchObject({ since: 500, deadlineAt: 600 });
  });

  it('never arms while the assumptions never hold', () => {
    expect(livenessKinds(run(null, {}, check({ assumptionsHold: () => false })).trace)).toEqual([]);
  });

  it('re-arms when progress is LOST while the assumptions keep holding', () => {
    // progress = "n1 is done" XOR "after t=300"; it holds in [40, 300) and is lost at the next step after 300.
    let flips = 0;
    const toggling = protocol({
      init: (ctx) => {
        if (ctx.self === 'n1') ctx.setTimer(40, 'work');
        return { done: false };
      },
      onTimer: (_state, _timer, ctx) => {
        flips++;
        if (flips < 2) ctx.setTimer(300, 'undo');
        return { done: flips < 2 };
      },
    });
    const result = runSimulation(config(toggling, { limits: { maxTime: 1000 }, liveness: [check()] }));
    expect(livenessKinds(result.trace)).toEqual(['liveness.armed@0', 'liveness.met@40', 'liveness.armed@340', 'liveness.missed@440']);
  });
});

describe('faulty checks', () => {
  it.each([
    ['throws', () => { throw new Error('boom'); }, 'Error: boom'],
    ['returns a non-boolean', () => 'yes' as never, 'liveness checks must return booleans'],
  ])('a check that %s stops the run with liveness-error', (_label, progress, message) => {
    const result = run(10, {}, check({ progress: progress as never }));
    expect(result.reason).toBe('liveness-error');
    expect(ofKind(result.trace, 'liveness.error')[0]!.error).toContain(message);
  });
});

describe('snapshots with pending liveness deadlines (faultlab-snapshot/2)', () => {
  // n2's tick at t=50 gives a step inside the waiting period [0, 100).
  const cfg = () => config(worker(250, 50), { limits: { maxTime: 1000 }, liveness: [check()] });
  const until = (time: number) => {
    const sim = new Simulation(cfg());
    while (sim.stopReason === null && sim.now < time) sim.step();
    expect(sim.now).toBe(time);
    return sim;
  };

  it('restores a waiting period (deadline still pending) and continues byte-identically', () => {
    const reference = serializeTrace(runSimulation(cfg()).trace);
    for (const at of [50, 100, 250]) {
      const sim = until(at);
      const snap = JSON.parse(JSON.stringify(sim.snapshot())) as JsonValue;
      const withPrefix = Simulation.restore(cfg(), snap, { tracePrefix: sim.trace });
      withPrefix.run();
      expect(serializeTrace(withPrefix.trace)).toBe(reference);
    }
  });

  it('stores the phase and the pending deadline event explicitly', () => {
    const snap = until(50).snapshot();
    expect(snap.liveness).toMatchObject({ checks: [{ id: 'n1-done', version: '1', phase: 'waiting', since: 0 }] });
    expect(snap.scheduler.events.filter((e) => e.event.kind === 'liveness.deadline')).toMatchObject([{ time: 100, event: { checkId: 'n1-done' } }]);
  });

  const tamper = (mutate: (s: Record<string, any>) => void) => {
    const sim = until(50);
    const snap = JSON.parse(JSON.stringify(sim.snapshot())) as Record<string, any>;
    mutate(snap);
    return () => Simulation.restore(cfg(), snap, { tracePrefix: sim.trace });
  };

  it.each([
    ['the deadline event removed', (s: Record<string, any>) => { s['scheduler'].events = s['scheduler'].events.filter((e: any) => e.event.kind !== 'liveness.deadline'); }],
    ['the deadline moved', (s: Record<string, any>) => { s['scheduler'].events.find((e: any) => e.event.kind === 'liveness.deadline').time = 999; }],
    ['an unknown phase', (s: Record<string, any>) => { s['liveness'].checks[0].phase = 'asleep'; }],
    ['phase idle with a pending deadline', (s: Record<string, any>) => { Object.assign(s['liveness'].checks[0], { phase: 'idle', since: null, armedEntry: null }); }],
    ['a different check id', (s: Record<string, any>) => { s['liveness'].checks[0].id = 'other'; }],
    ['liveness state dropped', (s: Record<string, any>) => { s['liveness'] = null; }],
  ])('rejects a snapshot with %s', (_label, mutate) => {
    expect(tamper(mutate)).toThrow(SnapshotError);
  });

  it('rejects a liveness snapshot for a configuration without liveness checks', () => {
    const snap = until(50).snapshot();
    expect(() => Simulation.restore(config(worker(250, 50), { limits: { maxTime: 1000 } }), snap)).toThrow(SnapshotError);
  });
});
