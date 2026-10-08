import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SimulationConfig } from '../src/config';
import type { FaultSpec } from '../src/faults';
import {
  createNaiveLeaderProtocol,
  epochMonotonic,
  leaderEpochConsistent,
  naiveLeaderInvariants,
  noOverdueMessages,
  singleLeader,
  uniqueLeaderPerEpoch,
  type NaiveLeaderState,
} from '../src/fixtures';
import type { Invariant, InvariantPolicy } from '../src/invariants';
import { runSimulation, Simulation } from '../src/simulation';
import { fingerprintTrace, serializeTrace, type TraceEntry } from '../src/trace';
import { ofKind } from './helpers';
import { checkTraceInvariants } from './invariants';

const NODES = ['n1', 'n2', 'n3', 'n4'];

const leaderConfig = (
  seed: number,
  faults: FaultSpec[] = [],
  invariants: readonly Invariant[] = naiveLeaderInvariants,
  invariantPolicy: InvariantPolicy = 'stop-on-first',
  nodes: string[] = NODES,
): SimulationConfig =>
  ({
    seed,
    nodes,
    protocol: createNaiveLeaderProtocol({ interval: 20, jitter: 5, timeout: 60 }),
    network: { latency: { min: 1, max: 10 } },
    limits: { maxTime: 1000 },
    faults,
    invariants,
    invariantPolicy,
  }) as SimulationConfig;

const leadersAt = (trace: readonly TraceEntry[], time: number): string[] => {
  const role = new Map<string, string>();
  for (const e of trace) {
    if (e.time > time) break;
    if (e.kind === 'state.update') role.set(e.node, (e.state as NaiveLeaderState).role);
    if (e.kind === 'node.crash') role.set(e.node, 'crashed');
  }
  return [...role].filter(([, r]) => r === 'leader').map(([n]) => n);
};

describe('naive leader election on a healthy network', () => {
  it('converges to the highest node without ever having two leaders, including during startup', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const nodes of [NODES, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']]) {
        const result = runSimulation(leaderConfig(seed, [], naiveLeaderInvariants, 'stop-on-first', nodes));
        expect(result.reason).toBe('time-limit'); // no invariant ever failed
        const claims = ofKind(result.trace, 'state.update').filter((e) => (e.state as NaiveLeaderState).role === 'leader');
        // Startup: nobody claims before `timeout`, and the only claimant is the highest node.
        expect(Math.min(...claims.map((c) => c.time))).toBeGreaterThanOrEqual(60);
        expect(new Set(claims.map((c) => c.node))).toEqual(new Set([nodes.at(-1)]));
        expect(leadersAt(result.trace, 1000)).toEqual([nodes.at(-1)]);
      }
    }
  });

  it('keeps a single leader under any crash/recover plan (property: no partitions, no loss)', () => {
    const outage = fc
      .record({ at: fc.integer({ min: 0, max: 800 }), node: fc.constantFrom(...NODES), down: fc.integer({ min: 0, max: 200 }) })
      .map(({ at, node, down }): FaultSpec[] => [
        { at, type: 'crash', node },
        { at: at + down, type: 'recover', node },
      ]);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.array(outage, { maxLength: 8 }), (seed, outages) => {
        // Per-epoch uniqueness is deliberately NOT claimed here: see the "crashes alone" test below.
        const result = runSimulation(leaderConfig(seed, outages.flat(), [singleLeader, epochMonotonic, leaderEpochConsistent, noOverdueMessages]));
        expect(ofKind(result.trace, 'invariant.violation')).toEqual([]);
        expect(result.reason).toBe('time-limit');
        expect(checkTraceInvariants(result.trace)).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });
});

describe('split brain: a stable leader, then a partition', () => {
  const faults: FaultSpec[] = [{ at: 300, type: 'partition', groups: [['n4']] }];
  const sim = new Simulation(leaderConfig(7, faults));
  const result = sim.run();
  const violation = ofKind(result.trace, 'invariant.violation')[0]!;
  const at = (i: number | null) => (i === null ? undefined : result.trace[i]);

  it('first establishes one stable leader (no violation before the fault)', () => {
    expect(leadersAt(result.trace, 299)).toEqual(['n4']);
    const firstFault = result.trace.find((e) => e.kind === 'network.partition')!;
    expect(result.trace.slice(0, firstFault.index).some((e) => e.kind.startsWith('invariant.'))).toBe(false);
  });

  it('then detects two simultaneous leaders and stops at the first violation', () => {
    expect(result.reason).toBe('invariant-violation');
    expect(violation).toMatchObject({
      time: 347,
      invariant: { id: 'single-leader', version: '1', name: 'At most one leader at a time' },
      nodes: ['n3', 'n4'],
      expected: 'At most one running node is leader',
      observed: '2 running nodes are leader: n3, n4',
      evidence: {
        leaders: [
          { node: 'n3', incarnation: 1, leaderEpoch: 2 },
          { node: 'n4', incarnation: 1, leaderEpoch: 1 },
        ],
      },
    });
  });

  it('explains it with facts: the trigger, the leaders’ state entries, and the active partition', () => {
    expect(at(violation.trigger)).toMatchObject({ kind: 'timer.fire', node: 'n3', tag: 'tick' });
    const [n3, n4] = violation.nodeStates;
    expect(at(n3!.stateEntry)).toMatchObject({ kind: 'state.update', node: 'n3', state: { role: 'leader', leaderEpoch: 2 } });
    expect(at(n4!.stateEntry)).toMatchObject({ kind: 'state.update', node: 'n4' });
    expect((at(n4!.stateEntry) as { time: number }).time).toBeLessThan(300); // n4 has led since before the fault
    expect(violation.references).toEqual([n3!.stateEntry, n4!.stateEntry]);
    expect(at(violation.activeFaults.partition)).toMatchObject({ kind: 'network.partition', faultId: 'f1', groups: [['n4'], ['n1', 'n2', 'n3']] });
    expect(violation.activeFaults.crashed).toEqual([]);
  });

  it('replays exactly: same trace, same violation, same fingerprint', () => {
    const again = runSimulation(leaderConfig(7, faults));
    expect(serializeTrace(again.trace)).toBe(serializeTrace(result.trace));
    expect({ eventNumber: violation.eventNumber, fingerprint: fingerprintTrace(result.trace) }).toEqual({
      eventNumber: violation.eventNumber,
      fingerprint: fingerprintTrace(again.trace),
    });
  });

  it('record-and-continue keeps one episode open until the partition heals', () => {
    const healed = runSimulation(
      leaderConfig(7, [...faults, { at: 500, type: 'heal' }], [singleLeader], 'record-and-continue'),
    );
    const events = healed.trace.filter((e) => e.kind === 'invariant.violation' || e.kind === 'invariant.cleared');
    expect(events.map((e) => e.kind)).toEqual(['invariant.violation', 'invariant.cleared']);
    expect(events[1]!.time).toBeGreaterThanOrEqual(500); // n3 steps down once it hears n4 again
    expect(healed.reason).toBe('time-limit');
  });
});

describe('historical invariant: same-epoch leaders that never overlap', () => {
  // n4 crashes; n3 is cut off before it can tell n1/n2 about epoch 2; n3 leads epoch 2, then
  // crashes; later n2, which never heard of epoch 2, also claims epoch 2.
  const faults: FaultSpec[] = [
    { at: 300, type: 'crash', node: 'n4' },
    { at: 340, type: 'partition', groups: [['n3']] },
    { at: 380, type: 'crash', node: 'n3' },
  ];
  const result = runSimulation(leaderConfig(0, faults, [singleLeader, uniqueLeaderPerEpoch], 'record-and-continue'));
  const violations = ofKind(result.trace, 'invariant.violation');

  it('is invisible to the state invariant but caught by the historical one', () => {
    expect(violations.map((v) => v.invariant.id)).toEqual(['unique-leader-per-epoch']);
    expect(violations[0]).toMatchObject({
      nodes: ['n3', 'n2'],
      observed: 'Epoch 2 was led by n3 and later also by n2',
      evidence: { epoch: 2, first: 'n3', second: 'n2' },
    });
    // The two leaderships really did not overlap in time.
    const n3Crash = ofKind(result.trace, 'node.crash').find((c) => c.node === 'n3')!;
    expect(violations[0]!.time).toBeGreaterThan(n3Crash.time);
    expect(violations[0]!.nodeStates.find((s) => s.node === 'n3')).toMatchObject({ status: 'crashed', stateEntry: null });
  });

  it('cites the first leadership of that epoch as evidence', () => {
    const [first] = violations[0]!.references;
    expect(result.trace[first!]).toMatchObject({ kind: 'state.update', node: 'n3', state: { role: 'leader', leaderEpoch: 2 } });
  });
});

describe('crash-only weaknesses found by property testing', () => {
  it('persisting the epoch prevents reuse after every node crashed (regression for the first finding)', () => {
    // With volatile epochs, all nodes forgot epoch 1 and n3 later claimed epoch 1 again.
    const plan: FaultSpec[] = [
      { at: 165, type: 'crash', node: 'n3' },
      { at: 207, type: 'recover', node: 'n3' },
      { at: 204, type: 'crash', node: 'n2' },
      { at: 207, type: 'recover', node: 'n2' },
      { at: 208, type: 'crash', node: 'n1' },
      { at: 211, type: 'recover', node: 'n1' },
      { at: 194, type: 'crash', node: 'n4' },
      { at: 249, type: 'recover', node: 'n4' },
    ];
    expect(runSimulation(leaderConfig(0, plan, [uniqueLeaderPerEpoch])).reason).toBe('time-limit');
  });

  it('crashes alone can still reuse an epoch: persistence is not enough without a quorum', () => {
    // n3 is the only node that ever learns epoch 1 (everyone else is down when it claims), then it
    // crashes. n4 recovers, cannot hear n3, and claims epoch 1 again. No network fault involved.
    const plan: FaultSpec[] = [
      { at: 0, type: 'crash', node: 'n1' },
      { at: 9, type: 'crash', node: 'n2' },
      { at: 22, type: 'crash', node: 'n4' },
      { at: 91, type: 'crash', node: 'n3' },
      { at: 95, type: 'recover', node: 'n2' },
      { at: 95, type: 'recover', node: 'n4' },
      { at: 97, type: 'recover', node: 'n1' },
      { at: 133, type: 'recover', node: 'n3' },
    ];
    const result = runSimulation(leaderConfig(0, plan, [singleLeader, uniqueLeaderPerEpoch], 'record-and-continue'));
    const violations = ofKind(result.trace, 'invariant.violation');
    expect(violations.map((v) => [v.invariant.id, v.observed])).toEqual([['unique-leader-per-epoch', 'Epoch 1 was led by n3 and later also by n4']]);
    expect(ofKind(result.trace, 'network.partition')).toEqual([]);
  });
});

describe('invariants are pure functions: unit-testable with hand-made views', () => {
  const node = (id: string, state: Partial<NaiveLeaderState> | undefined, incarnation = 1) =>
    ({ id, status: 'running', incarnation, state: state && { role: 'follower', epoch: 0, leaderEpoch: null, bootAt: 0, lastHeard: {}, ...state }, storage: {}, stateEntry: null }) as never;
  const view = (nodes: unknown[], extra: Record<string, unknown> = {}) =>
    ({ time: 100, eventNumber: 1, nodes, node: () => nodes[0], inFlight: [], network: { partition: null, links: [] }, ...extra }) as never;
  const step = { trigger: {}, entries: [] } as never;

  it('epoch-monotonic flags an epoch that goes backwards within one incarnation, not across incarnations', () => {
    const first = epochMonotonic.check({ view: view([node('n1', { epoch: 3 })]), step, history: {} });
    expect(first.ok).toBe(true);
    const history = first.history!;
    expect(epochMonotonic.check({ view: view([node('n1', { epoch: 2 })]), step, history })).toMatchObject({
      ok: false,
      violation: { nodes: ['n1'], observed: 'epoch went from 3 to 2' },
    });
    expect(epochMonotonic.check({ view: view([node('n1', { epoch: 0 }, 2)]), step, history }).ok).toBe(true);
  });

  it('leader-epoch-consistent flags a leader without a valid epoch', () => {
    expect(leaderEpochConsistent.check({ view: view([node('n1', { role: 'leader', epoch: 1, leaderEpoch: 1 })]), step, history: null }).ok).toBe(true);
    expect(leaderEpochConsistent.check({ view: view([node('n1', { role: 'leader', epoch: 1, leaderEpoch: 2 })]), step, history: null })).toMatchObject({
      ok: false,
      violation: { nodes: ['n1'], observed: 'leaderEpoch 2, epoch 1' },
    });
  });

  it('no-overdue-messages flags an in-flight message whose delivery time has passed', () => {
    const overdue = { id: 'n1:m1', from: 'n1', to: 'n2', payload: null, sentAt: 10, deliverAt: 50, sendIndex: 7 };
    expect(noOverdueMessages.check({ view: view([], { inFlight: [overdue] }), step, history: null })).toMatchObject({
      ok: false,
      violation: { nodes: ['n1', 'n2'], references: [7], evidence: { messages: ['n1:m1'] } },
    });
  });
});
