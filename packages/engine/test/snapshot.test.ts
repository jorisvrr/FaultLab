import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SimulationConfig } from '../src/config';
import type { FaultSpec } from '../src/faults';
import { createHeartbeatProtocol, createNaiveLeaderProtocol, createPingProtocol, naiveLeaderInvariants } from '../src/fixtures';
import type { JsonValue } from '../src/json';
import { Simulation } from '../src/simulation';
import { SNAPSHOT_LIMITS, SnapshotError, type SimulationSnapshot } from '../src/snapshot';
import { fingerprintTrace, serializeTrace } from '../src/trace';
import { faultPlanArb } from './arbitraries';
import { configFor, type CounterexampleFixture } from './counterexample-format';
import { mutabilityProblems, protocol } from './helpers';

const NODES = ['n1', 'n2', 'n3', 'n4'];
type Kind = 'heartbeat' | 'ping' | 'leader-stop' | 'leader-record';

const experimentConfig = (kind: Kind, seed: number, faults: FaultSpec[]): SimulationConfig => {
  const base = { seed, nodes: NODES, network: { latency: { min: 1, max: 12 } }, faults } as const;
  switch (kind) {
    case 'heartbeat':
      return { ...base, protocol: createHeartbeatProtocol({ interval: 20, timeout: 60 }) as never, limits: { maxTime: 500 } };
    case 'ping':
      return { ...base, protocol: createPingProtocol({ rounds: 4, interval: 30, jitter: 10 }) as never };
    case 'leader-stop':
      return { ...base, protocol: createNaiveLeaderProtocol() as never, limits: { maxTime: 700 }, invariants: naiveLeaderInvariants };
    case 'leader-record':
      return { ...base, protocol: createNaiveLeaderProtocol() as never, limits: { maxTime: 700 }, invariants: naiveLeaderInvariants, invariantPolicy: 'record-and-continue' };
  }
};

/** Run to `steps` completed steps (or until the run stops). */
const runTo = (config: SimulationConfig, steps: number): Simulation => {
  const sim = new Simulation(config);
  while (sim.stepsCompleted < steps && sim.stopReason === null) sim.step();
  return sim;
};

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('snapshot/restore equivalence (metamorphic: run(N) ≡ restore(snap@k) + run(N−k))', () => {
  const arbitrary = fc.record({
    kind: fc.constantFrom<Kind>('heartbeat', 'ping', 'leader-stop', 'leader-record'),
    seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    faults: faultPlanArb(400),
    k: fc.integer({ min: 0, max: 600 }),
  });

  it('continues byte-identically, with and without the trace prefix, through JSON', () => {
    fc.assert(
      fc.property(arbitrary, ({ kind, seed, faults, k }) => {
        const config = experimentConfig(kind, seed, faults);
        const uninterrupted = new Simulation(config);
        const result = uninterrupted.run();
        const at = runTo(config, k);
        const snap = at.snapshot();
        const prefix = at.trace;

        const withPrefix = Simulation.restore(config, roundTrip(snap), { tracePrefix: prefix });
        const fromPrefix = withPrefix.run();
        expect(serializeTrace(fromPrefix.trace)).toBe(serializeTrace(result.trace));
        expect([fromPrefix.reason, fromPrefix.eventsProcessed, fromPrefix.finalTime]).toEqual([result.reason, result.eventsProcessed, result.finalTime]);

        // Segment mode: no prefix; new entries keep their absolute indices.
        const segment = Simulation.restore(config, snap).run();
        expect(segment.traceStart).toBe(prefix.length);
        expect(segment.trace.every((e, i) => e.index === segment.traceStart + i)).toBe(true);
        expect(serializeTrace([...prefix, ...segment.trace])).toBe(serializeTrace(result.trace));

        // Final engine state and invariant histories are identical too.
        for (const id of NODES) {
          expect(withPrefix.nodeState(id)).toEqual(uninterrupted.nodeState(id));
          expect(withPrefix.nodeStorage(id)).toEqual(uninterrupted.nodeStorage(id));
          expect(withPrefix.nodeInfo(id)).toEqual(uninterrupted.nodeInfo(id));
        }
        for (const invariant of config.invariants ?? []) {
          expect(withPrefix.invariantHistory(invariant.id)).toEqual(uninterrupted.invariantHistory(invariant.id));
        }
      }),
      { numRuns: 120 },
    );
  });

  it('a snapshot of a restored run is identical to the original snapshot (idempotent)', () => {
    fc.assert(
      fc.property(arbitrary, ({ kind, seed, faults, k }) => {
        const config = experimentConfig(kind, seed, faults);
        const at = runTo(config, k);
        const snap = at.snapshot();
        expect(serializeTrace([Simulation.restore(config, roundTrip(snap), { tracePrefix: at.trace }).snapshot()] as never)).toBe(
          serializeTrace([snap] as never),
        );
        expect(serializeTrace([Simulation.restore(config, snap).snapshot()] as never)).toBe(serializeTrace([snap] as never));
      }),
      { numRuns: 80 },
    );
  });

  it('taking a snapshot after every step never changes the trace', () => {
    fc.assert(
      fc.property(arbitrary, ({ kind, seed, faults }) => {
        const config = experimentConfig(kind, seed, faults);
        const plain = new Simulation(config).run();
        const observed = new Simulation(config);
        while (observed.stopReason === null) {
          observed.snapshot();
          observed.step();
        }
        expect(serializeTrace(observed.trace)).toBe(serializeTrace(plain.trace));
      }),
      { numRuns: 30 },
    );
  });
});

describe('snapshot properties', () => {
  const config = experimentConfig('leader-record', 7, [
    { at: 100, type: 'crash', node: 'n2' },
    { at: 300, type: 'partition', groups: [['n4']] },
    { at: 320, type: 'link', from: 'n1', to: 'n3', loss: 0.4, delay: { min: 1, max: 5 } },
  ]);
  // Snapshot a few steps after the first violation, so monitor state is non-trivial.
  const K = (new Simulation(config).run().trace.find((e) => e.kind === 'invariant.violation') as { eventNumber: number }).eventNumber + 5;
  const at = runTo(config, K);
  const snap = at.snapshot();

  it('is deeply frozen plain JSON that survives a round trip unchanged', () => {
    expect(mutabilityProblems(snap)).toEqual([]);
    expect(roundTrip(snap)).toEqual(snap);
  });

  it('records its position as a step boundary, and every part of the execution state', () => {
    expect(snap.position).toMatchObject({ stepsCompleted: K, traceLength: at.traceLength, time: at.now });
    expect(snap.scheduler.events.length).toBe(at.pendingEvents);
    expect(snap.network.partition?.groups).toEqual([['n4'], ['n1', 'n2', 'n3']]);
    expect(snap.network.links).toHaveLength(1);
    expect(snap.nodes.map((n) => n.id)).toEqual(NODES);
    expect(snap.invariants?.states.map((s) => s.id)).toEqual(naiveLeaderInvariants.map((i) => i.id));
    expect(snap.invariants?.violations).toBeGreaterThan(0); // the partition already caused split brain
  });

  it('shares unchanged volatile states with the live run (structural sharing, not copies)', () => {
    for (const node of snap.nodes) {
      if (node.state !== null) expect(node.state.value).toBe(at.nodeState(node.id));
    }
  });

  it('leaves the original and the restored run independent', () => {
    const original = runTo(config, K);
    const restored = Simulation.restore(config, original.snapshot(), { tracePrefix: original.trace });
    for (let i = 0; i < 50; i++) restored.step();
    // The original has not moved…
    expect(original.stepsCompleted).toBe(K);
    expect(serializeTrace([original.snapshot()] as never)).toBe(serializeTrace([snap] as never));
    // …and still reaches the same end as the restored copy.
    expect(serializeTrace(original.run().trace)).toBe(serializeTrace(restored.run().trace));
  });

  it('preserves storage insertion order with several keys (regression: mutant S13)', () => {
    const multi = protocol({
      init: (ctx) => {
        for (const key of ['zeta', 'alpha', 'mid']) ctx.storage.set(key, ctx.self);
        ctx.setTimer(5, 'later');
        return {};
      },
      onTimer: (state, _t, ctx) => (ctx.storage.set('beta', 1), state),
    });
    const cfg: SimulationConfig = { seed: 1, nodes: NODES, protocol: multi, network: { latency: { min: 1, max: 3 } }, limits: { maxTime: 20 } };
    const mid = runTo(cfg, 6);
    const snapshotJson = serializeTrace([mid.snapshot()] as never);
    // Writes of one step commit in sorted key order; across steps, in commit order. So the
    // insertion order is NOT simply sorted, and a restore must preserve it exactly.
    expect(mid.snapshot().nodes[0]!.storage.map(([k]) => k)).toEqual(['alpha', 'mid', 'zeta', 'beta']);
    expect(serializeTrace([Simulation.restore(cfg, mid.snapshot(), { tracePrefix: mid.trace }).snapshot()] as never)).toBe(snapshotJson);
  });

  it('keeps a correct last-entry fingerprint after releasing trace entries (regression: mutant S23)', () => {
    const sim = runTo(config, 120);
    const expected = sim.snapshot();
    const fullTrace = sim.trace;
    sim.releaseTraceBefore(sim.traceLength);
    expect(sim.trace).toHaveLength(1); // the newest entry is always retained
    expect(serializeTrace([sim.snapshot()] as never)).toBe(serializeTrace([expected] as never));
    expect(() => Simulation.restore(config, sim.snapshot(), { tracePrefix: fullTrace })).not.toThrow();
  });

  it('works before the first step and after the run stopped', () => {
    const initial = new Simulation(config).snapshot();
    expect(initial.position).toMatchObject({ stepsCompleted: 0, traceLength: 1 });
    expect(serializeTrace(Simulation.restore(config, initial).run().trace)).not.toBe('');
    const finished = new Simulation(config);
    finished.run();
    const done = Simulation.restore(config, finished.snapshot(), { tracePrefix: finished.trace });
    expect(done.stopReason).toBe(finished.stopReason);
    expect(done.step()).toBe(false);
  });

  it('reproduces every stored counterexample when replayed from a mid-run snapshot', () => {
    const dir = join(import.meta.dirname, 'counterexamples');
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const fixture = JSON.parse(readFileSync(join(dir, name), 'utf8')) as CounterexampleFixture;
      const cfg = configFor(fixture);
      const half = runTo(cfg, Math.floor(fixture.expected.eventNumber / 2));
      const result = Simulation.restore(cfg, roundTrip(half.snapshot()), { tracePrefix: half.trace }).run();
      expect(fingerprintTrace(result.trace)).toBe(fixture.expected.fingerprint);
    }
  });
});

describe('restore rejects malformed or incompatible snapshots (untrusted input)', () => {
  const config = experimentConfig('leader-record', 7, [
    { at: 100, type: 'crash', node: 'n2' },
    { at: 300, type: 'partition', groups: [['n4']] },
    { at: 320, type: 'link', from: 'n1', to: 'n3', loss: 0.4, delay: { min: 1, max: 5 } },
  ]);
  const at = runTo(config, 250);
  const prefix = at.trace;
  const good = at.snapshot();
  const tamper = (edit: (s: Record<string, any>) => void): unknown => {
    const copy = roundTrip(good) as unknown as Record<string, any>;
    edit(copy);
    return copy;
  };
  const rejection = (snapshot: unknown, options: { tracePrefix?: typeof prefix } = { tracePrefix: prefix }, cfg = config) => {
    try {
      Simulation.restore(cfg, snapshot, options);
    } catch (error) {
      if (error instanceof SnapshotError) return error.path;
      throw error;
    }
    return 'accepted';
  };

  it('accepts the untampered snapshot', () => {
    expect(rejection(good)).toBe('accepted');
  });

  it.each<[string, (s: Record<string, any>) => void, string | RegExp]>([
    ['a wrong format', (s) => (s['format'] = 'faultlab-snapshot/0'), 'format'],
    ['another engine version', (s) => (s['engineVersion'] = '0.2.0-cp1'), 'engineVersion'],
    ['different inputs (seed)', (s) => (s['inputs'].seed = 8), 'inputs'],
    ['different inputs (fault plan)', (s) => s['inputs'].faults.pop(), 'inputs'],
    ['a negative step count', (s) => (s['position'].stepsCompleted = -1), 'position.stepsCompleted'],
    ['a step count beyond maxEvents', (s) => (s['position'].stepsCompleted = 10 ** 9), 'position.stepsCompleted'],
    ['a wrong trace length', (s) => (s['position'].traceLength += 1), 'position.traceLength'],
    ['a wrong last-entry fingerprint', (s) => (s['position'].lastEntryFingerprint = 'deadbeef'), 'position.lastEntryFingerprint'],
    ['an unknown stop reason', (s) => (s['stopReason'] = 'tired'), 'stopReason'],
    ['a missing node', (s) => s['nodes'].pop(), 'nodes'],
    ['nodes out of order', (s) => s['nodes'].reverse(), 'nodes[0].id'],
    ['an unknown status', (s) => (s['nodes'][0].status = 'zombie'), 'nodes[0].status'],
    ['incarnation 0 for a started node', (s) => (s['nodes'][0].incarnation = 0), 'nodes[0].incarnation'],
    ['state for a crashed node', (s) => (s['nodes'][1].state = { value: 1 }), 'nodes[1].state'],
    ['a crash pointing at a non-crash entry', (s) => (s['nodes'][1].crashedAt = 0), 'nodes[1].crashedAt'],
    ['a state that does not match its source entry', (s) => (s['nodes'][0].state = { value: { forged: true } }), 'nodes[0].stateEntry'],
    ['a duplicate storage key', (s) => s['nodes'][0].storage.push([...s['nodes'][0].storage[0]]), 'nodes[0].storage[1]'],
    ['a timer id from another node', (s) => (s['nodes'][0].timers[0][0] = 'n2:t1'), 'nodes[0].timers[0]'],
    ['an all-zero random state', (s) => (s['nodes'][0].random = [0, 0, 0, 0]), 'nodes[0].random'],
    ['a non-integer random word', (s) => (s['network'].random = [1.5, 2, 3, 4]), 'network.random'],
    ['a partition that misses a node', (s) => (s['network'].partition.groups = [['n4'], ['n1', 'n2']]), 'network.partition.groups'],
    ['a link to an unknown node', (s) => (s['network'].links[0].to = 'zz'), 'network.links[0]'],
    ['events out of order', (s) => s['scheduler'].events.reverse(), 'scheduler.events[1]'],
    ['a duplicate sequence number', (s) => (s['scheduler'].events[1].seq = s['scheduler'].events[0].seq), /^scheduler\.events\[1\]/],
    ['an event before the clock', (s) => (s['scheduler'].events[0].time = 0), 'scheduler.events[0]'],
    ['a seq at or beyond nextSeq', (s) => (s['scheduler'].nextSeq = 0), 'scheduler.events[0]'],
    ['an unknown event kind', (s) => (s['scheduler'].events[0].event.kind = 'teleport'), 'scheduler.events[0].event.kind'],
    ['a cause beyond the trace', (s) => (s['scheduler'].events[0].event.cause = 10 ** 9), 'scheduler.events[0].event.cause'],
    ['a timer event without its node’s timer', (s) => s['nodes'][0].timers.pop(), /^scheduler\.events\[\d+\]\.event$/],
    ['invariant states that do not match', (s) => (s['invariants'].states[0].id = 'other'), 'invariants.states[0]'],
    ['a malformed open episode', (s) => (s['invariants'].states[0].open = 'x'), 'invariants.states[0].open'],
  ])('rejects %s', (_label, edit, path) => {
    const result = rejection(tamper(edit));
    if (path instanceof RegExp) expect(result).toMatch(path);
    else expect(result).toBe(path);
  });

  it('rejects a pending timer whose fire event is missing from the queue (regression: mutant S16)', () => {
    const missing = tamper((s) => {
      const i = s['scheduler'].events.findIndex((e: any) => e.event.kind === 'timer.fire');
      s['scheduler'].events.splice(i, 1);
    });
    expect(rejection(missing)).toBe('nodes[].timers');
  });

  it('rejects a message forged into the queue (id beyond the sender’s counter)', () => {
    const busy = runTo(config, 250);
    while (busy.inFlight().length === 0) busy.step(); // need a queued delivery to forge
    const forged = roundTrip(busy.snapshot()) as unknown as Record<string, any>;
    const deliver = forged['scheduler'].events.find((e: any) => e.event.kind === 'message.deliver');
    deliver.event.message.id = `${deliver.event.message.from}:m999999`;
    expect(rejection(forged, { tracePrefix: busy.trace })).toMatch(/^scheduler\.events\[\d+\]\.event\.message\.id$/);
  });

  it('rejects a prefix that belongs to another run, and a prefix of the wrong length', () => {
    const other = runTo(experimentConfig('leader-record', 8, []), 250);
    expect(rejection(good, { tracePrefix: other.trace })).toBe('tracePrefix');
    expect(rejection(good, { tracePrefix: prefix.slice(0, -1) })).toBe('position.traceLength');
  });

  it('rejects restoring into a different protocol or invariant set', () => {
    expect(rejection(good, { tracePrefix: prefix }, { ...config, protocol: createHeartbeatProtocol() as never })).toBe('tracePrefix');
    expect(rejection(good, {}, { ...config, invariants: naiveLeaderInvariants.slice(0, 2) })).toBe('inputs');
  });

  it('rejects non-JSON, oversized and absurdly nested input before processing it', () => {
    expect(rejection(null)).toBe('$');
    expect(rejection({ ...roundTrip(good), extra: new Map() } as unknown as JsonValue)).toBe('$');
    let deep: unknown = 0;
    for (let i = 0; i < SNAPSHOT_LIMITS.maxDepth + 5; i++) deep = [deep];
    expect(rejection(tamper((s) => (s['nodes'][0].storage = [['k', deep]])))).toBe('$');
    expect(rejection(tamper((s) => (s['nodes'][0].storage = [['k', 'x'.repeat(SNAPSHOT_LIMITS.maxStringLength + 1)]])))).toBe('$');
  });

  it('gives understandable messages', () => {
    try {
      Simulation.restore(config, tamper((s) => (s['engineVersion'] = '0.2.0-cp1')));
    } catch (error) {
      expect((error as Error).message).toBe('snapshot engineVersion: snapshot is from engine 0.2.0-cp1; this is 0.3.0-cp2');
    }
  });

  it('a structurally valid but forged snapshot WITHOUT a prefix is only checked for internal consistency (documented)', () => {
    // Without the prefix, entry references cannot be checked. Fingerprints are not a security measure.
    expect(rejection(tamper((s) => (s['nodes'][0].state = { value: { forged: true } })), {})).toBe('accepted');
  });
});

export type _Snap = SimulationSnapshot;
