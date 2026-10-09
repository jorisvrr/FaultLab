import { runSimulation, type FaultSpec, type JsonValue, type SimulationView, type TraceEntry } from '@faultlab/engine';
import { describe, expect, it } from 'vitest';
import { raftLeaderLiveness, stableGroup, type RaftState } from '../src';
import { LIVENESS_DEADLINE, raftConfig } from './raft-experiments';

/**
 * Bounded, conditional liveness for Raft leader election (CP4). The check never reports a safety
 * violation; its results are `liveness.*` trace entries. A miss would mean "no acknowledged
 * leader within D ticks while its assumptions held": a failed TEST BOUND, not a Raft bug.
 */
const check = raftLeaderLiveness({ deadline: LIVENESS_DEADLINE });

const raft = (overrides: Partial<RaftState> = {}): JsonValue =>
  ({ role: 'follower', currentTerm: 2, votedFor: null, leaderId: 'n1', votesGranted: [], electionTimer: null, heartbeatTimer: null, ...overrides }) as unknown as JsonValue;

const view = (
  states: Record<string, JsonValue | 'crashed'>,
  network: SimulationView['network'] = { partition: null, links: [] },
): SimulationView => {
  const nodes = Object.entries(states).map(([id, state]) => ({ id, status: state === 'crashed' ? 'crashed' : 'running', incarnation: 1, state: state === 'crashed' ? undefined : state, storage: {}, stateEntry: null }));
  return { time: 0, eventNumber: 0, nodes, node: (id: string) => nodes.find((n) => n.id === id)!, inFlight: [], network } as never;
};
const link = (from: string, to: string) => ({ from, to, loss: 0.5, delay: { min: 0, max: 0 } });

describe('healthy group and progress (pure, hand-made views)', () => {
  const healthy = { n1: raft({ role: 'leader', leaderId: 'n1' }), n2: raft(), n3: raft(), n4: raft(), n5: raft() };

  it('progress: one leader, acknowledged in its term by every healthy node', () => {
    expect(check.assumptionsHold(view(healthy))).toBe(true);
    expect(check.progress(view(healthy))).toBe(true);
  });

  it('no progress while a healthy node is in another term, follows nobody, or is a candidate', () => {
    expect(check.progress(view({ ...healthy, n5: raft({ currentTerm: 3, leaderId: null }) }))).toBe(false);
    expect(check.progress(view({ ...healthy, n4: raft({ leaderId: null }) }))).toBe(false);
    expect(check.progress(view({ ...healthy, n3: raft({ role: 'candidate', leaderId: null }) }))).toBe(false);
  });

  it('no progress while two reachable nodes believe they lead (e.g. a stale leader not yet told)', () => {
    expect(check.progress(view({ ...healthy, n5: raft({ role: 'leader', currentTerm: 1, leaderId: 'n5' }) }))).toBe(false);
  });

  it('a stale leader cut off in a minority does not prevent progress of the majority', () => {
    const states = { n1: raft({ role: 'leader', currentTerm: 1, leaderId: 'n1' }), n2: raft({ role: 'leader', currentTerm: 3, leaderId: 'n2' }), n3: raft({ currentTerm: 3, leaderId: 'n2' }), n4: raft({ currentTerm: 3, leaderId: 'n2' }), n5: raft({ currentTerm: 3, leaderId: 'n2' }) };
    const partitioned = view(states, { partition: [['n1'], ['n2', 'n3', 'n4', 'n5']], links: [] });
    expect(stableGroup(partitioned).map((n) => n.id)).toEqual(['n2', 'n3', 'n4', 'n5']);
    expect(check.progress(partitioned)).toBe(true);
  });

  it('crashed nodes and both endpoints of a degraded link are not healthy', () => {
    const v = view({ ...healthy, n2: 'crashed' }, { partition: null, links: [link('n4', 'n5')] });
    expect(stableGroup(v).map((n) => n.id)).toEqual(['n1', 'n3']);
    expect(check.assumptionsHold(v)).toBe(false); // 2 healthy < 3
  });

  it('a leader on a degraded link still counts as THE leader the healthy majority follows', () => {
    const v = view(healthy, { partition: null, links: [link('n2', 'n1')] });
    expect(stableGroup(v).map((n) => n.id)).toEqual(['n3', 'n4', 'n5']);
    expect(check.progress(v)).toBe(true);
  });

  it('a minority partition never has the assumptions (4 nodes split 2|2; 5 nodes split 2|2|1)', () => {
    const four = { n1: raft(), n2: raft(), n3: raft(), n4: raft() };
    expect(check.assumptionsHold(view(four, { partition: [['n1', 'n2'], ['n3', 'n4']], links: [] }))).toBe(false);
    expect(check.assumptionsHold(view(healthy, { partition: [['n1', 'n2'], ['n3', 'n4'], ['n5']], links: [] }))).toBe(false);
  });
});

const livenessOf = (faults: FaultSpec[], size: 3 | 4 | 5 = 5, seed = 1) => {
  const result = runSimulation(raftConfig({ size, seed, timing: 'default', latencyMax: 10 }, faults));
  return { result, entries: result.trace.filter((e) => e.kind.startsWith('liveness.')) as Extract<TraceEntry, { kind: `liveness.${string}` }>[] };
};
const summary = (entries: readonly TraceEntry[]) => entries.map((e) => `${e.kind.slice('liveness.'.length)}@${e.time}`);

describe('Raft runs under the bounded liveness check', () => {
  it('healthy start: armed at t=0, met within the bound, nothing else', () => {
    for (const size of [3, 4, 5] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const { entries } = livenessOf([], size, seed);
        expect(entries.map((e) => e.kind)).toEqual(['liveness.armed', 'liveness.met']);
        expect((entries[1] as Extract<TraceEntry, { kind: 'liveness.met' }>).duration).toBeLessThan(LIVENESS_DEADLINE);
      }
    }
  });

  it('isolating the leader starts a new waiting period (progress lost while a majority stays healthy), met by a re-election', () => {
    for (let seed = 1; seed <= 10; seed++) {
      // Find who leads at t=400 in the fault-free run, then isolate exactly that node.
      const healthy = livenessOf([], 5, seed).result.trace;
      const leader = healthy.findLast((e): e is Extract<TraceEntry, { kind: 'state.update' }> => e.kind === 'state.update' && e.time < 400 && (e.state as unknown as RaftState).role === 'leader')!.node;
      const others = ['n1', 'n2', 'n3', 'n4', 'n5'].filter((n) => n !== leader);
      const { entries } = livenessOf([{ at: 400, type: 'partition', groups: [[leader], others] }, { at: 900, type: 'heal' }], 5, seed);
      expect(summary(entries).slice(2, 3)).toEqual(['armed@400']);
      const met = entries.find((e): e is Extract<TraceEntry, { kind: 'liveness.met' }> => e.kind === 'liveness.met' && e.since === 400);
      expect(met?.late).toBe(false);
      expect(entries.some((e) => e.kind === 'liveness.missed')).toBe(false);
    }
  });

  it('a permanent minority split (2|2|1) disarms: no expectation, so no false liveness result', () => {
    const { entries, result } = livenessOf([{ at: 400, type: 'partition', groups: [['n1', 'n2'], ['n3', 'n4']] }]);
    expect(summary(entries)).toEqual(['armed@0', 'met@212', 'disarmed@400']);
    expect(result.reason).toBe('time-limit');
    // Raft is still SAFE there; it just cannot make progress.
    expect(result.trace.some((e) => e.kind === 'invariant.violation')).toBe(false);
  });

  it('losing the majority by crashes disarms; recovering a majority re-arms and is met', () => {
    const { entries } = livenessOf([
      { at: 400, type: 'crash', node: 'n3' },
      { at: 400, type: 'crash', node: 'n4' },
      { at: 400, type: 'crash', node: 'n5' },
      { at: 800, type: 'recover', node: 'n4' },
    ]);
    expect(summary(entries).slice(0, 3)).toEqual(['armed@0', 'met@212', 'disarmed@400']);
    expect(entries[3]).toMatchObject({ kind: 'liveness.armed', time: 800 });
    expect(entries[4]?.kind).toBe('liveness.met');
  });

  it('a 4-node cluster split 2|2 never elects a leader and never reports a liveness miss', () => {
    const { entries, result } = livenessOf([{ at: 0, type: 'partition', groups: [['n1', 'n2'], ['n3', 'n4']] }], 4);
    // The nodes start at t=0 before the partition (also at t=0, scheduled later) is applied.
    expect(summary(entries)).toEqual(['armed@0', 'disarmed@0']);
    expect(result.trace.some((e) => e.kind === 'state.update' && (e.state as unknown as RaftState).role === 'leader')).toBe(false);
    expect(result.trace.some((e) => e.kind === 'invariant.violation')).toBe(false);
  });

  it('reports a missed deadline on a real Raft run (D deliberately below the first election), then a late met', () => {
    const result = runSimulation({ ...raftConfig({ size: 5, seed: 1, timing: 'default', latencyMax: 10 }, [], { liveness: false }), liveness: [raftLeaderLiveness({ deadline: 100 })] });
    const entries = result.trace.filter((e) => e.kind.startsWith('liveness.'));
    expect(summary(entries)).toEqual(['armed@0', 'missed@100', 'met@212']);
    expect(entries[1]).toMatchObject({ kind: 'liveness.missed', deadlineAt: 100, cause: entries[0]!.index });
    expect(entries[1]).toMatchObject({ assumptions: expect.arrayContaining([expect.stringContaining('not a guarantee')]) });
    expect(entries[2]).toMatchObject({ late: true, duration: 212 });
    expect(result.trace.some((e) => e.kind === 'invariant.violation')).toBe(false); // never a safety result
  });

  it('re-arms when the leader CRASHES (a healthy majority remains) and is met by the re-election', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const leader = livenessOf([], 5, seed).result.trace.findLast((e): e is Extract<TraceEntry, { kind: 'state.update' }> => e.kind === 'state.update' && e.time < 400 && (e.state as unknown as RaftState).role === 'leader')!.node;
      const { entries } = livenessOf([{ at: 400, type: 'crash', node: leader }], 5, seed);
      expect(summary(entries).slice(2, 3)).toEqual(['armed@400']);
      expect(entries.find((e): e is Extract<TraceEntry, { kind: 'liveness.met' }> => e.kind === 'liveness.met' && e.since === 400)?.late).toBe(false);
    }
  });

  it('conservative health filtering: one degraded link between two followers keeps a 5-node check eligible and met', () => {
    const { entries } = livenessOf([{ at: 400, type: 'link', from: 'n1', to: 'n2', loss: 0.5 }]);
    expect(summary(entries)).toEqual(['armed@0', 'met@212']); // never disarmed: 3 healthy nodes remain
  });

  it('documented limitation: in a 3-node cluster, a single degraded link disarms the check (both endpoints excluded)', () => {
    const { entries } = livenessOf([{ at: 400, type: 'link', from: 'n1', to: 'n2', loss: 0.5 }], 3);
    expect(summary(entries).slice(-1)).toEqual(['disarmed@400']);
  });

  it('records its assumptions in run.start and (only on a miss) in liveness.missed', () => {
    const start = livenessOf([]).result.trace[0] as Extract<TraceEntry, { kind: 'run.start' }>;
    expect(start.liveness[0]).toMatchObject({ id: 'raft-leader-elected', deadline: LIVENESS_DEADLINE });
    expect(start.liveness[0]!.assumptions).toHaveLength(3);
    expect(start.liveness[0]!.assumptions[2]).toContain('not a guarantee');
  });
});
