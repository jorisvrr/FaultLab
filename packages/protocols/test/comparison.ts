import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprintTrace, runSimulation, type FaultSpec, type Invariant, type LivenessCheck, type NodeId, type SimulationConfig, type TraceEntry } from '@faultlab/engine';
import { createNaiveLeaderProtocol, singleLeader, uniqueLeaderPerEpoch, type NaiveLeaderState } from '@faultlab/engine/fixtures';
import { createBrokenRaftElection, createRaftElection, majorityOf, raftInvariants, raftLeaderLiveness, stableGroup, type RaftBug, type RaftState } from '../src';
import { LIVENESS_DEADLINE } from './raft-experiments';

/**
 * Naive leader election vs Raft (CP4, ADR-0020).
 *
 * Both protocols run under IDENTICAL external conditions: cluster, seed, base latency, fault plan
 * and run length. Their internal behaviour is NOT forced to match (different timers, messages,
 * leaders). Every metric is derived from the trace alone, through one tiny adapter per protocol:
 * "does this node believe it is leader, and in which term/epoch?".
 */

export type Contender = 'naive' | 'raft' | `raft/bug:${RaftBug}`;

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly nodes: readonly NodeId[];
  readonly seed: number;
  readonly latency: { readonly min: number; readonly max: number };
  readonly maxTime: number;
  readonly faults: readonly FaultSpec[];
  /** [from, to) during which a partition separates the cluster (for availability), if any. */
  readonly partitionWindow?: readonly [number, number];
  readonly healAt?: number;
  readonly contenders: readonly Contender[];
  /** Where the scenario comes from (e.g. a stored counterexample fixture). */
  readonly source: string;
}

/** Naive-leader options used by every CP2 fixture and test. */
export const NAIVE_OPTIONS = { interval: 20, jitter: 5, timeout: 60 };

const ENGINE_FIXTURES = join(import.meta.dirname, '..', '..', 'engine', 'test', 'counterexamples');
const RAFT_FIXTURES = join(import.meta.dirname, 'counterexamples');
const fixture = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as { config: { seed: number; nodes: string[]; latency: { min: number; max: number }; maxTime: number; faults: FaultSpec[] } };
const FIVE = ['n1', 'n2', 'n3', 'n4', 'n5'];
const FOUR = ['n1', 'n2', 'n3', 'n4'];

const fromFixture = (dir: string, name: string) => {
  const { config } = fixture(dir, name);
  return { nodes: config.nodes, seed: config.seed, latency: config.latency, maxTime: config.maxTime, faults: config.faults };
};

export const SCENARIOS: readonly Scenario[] = [
  { id: 'A', title: 'Healthy cluster, 5 nodes', nodes: FIVE, seed: 1, latency: { min: 1, max: 10 }, maxTime: 2000, faults: [], contenders: ['naive', 'raft'], source: 'defined in CP4' },
  {
    id: 'B',
    title: 'Isolate the established leader n5 at t=400, heal at t=900 (5 nodes)',
    nodes: FIVE,
    // With seed 1, Raft's established leader at t=400 is ALSO n5 (checked by a test), so the
    // identical fault plan isolates the established leader of both protocols.
    seed: 1,
    latency: { min: 1, max: 10 },
    maxTime: 2000,
    faults: [{ at: 400, type: 'partition', groups: [['n5'], ['n1', 'n2', 'n3', 'n4']] }, { at: 900, type: 'heal' }],
    partitionWindow: [400, 900],
    healAt: 900,
    contenders: ['naive', 'raft'],
    source: 'defined in CP4',
  },
  {
    id: 'B2',
    title: 'Same plan with seed 3: Raft\'s leader is n3, so the isolated n5 is a FOLLOWER (5 nodes)',
    nodes: FIVE,
    // Shows a known Raft behaviour without PreVote: the isolated follower keeps timing out and
    // raising its term; after the heal its higher term deposes the healthy leader ("disruptive server").
    seed: 3,
    latency: { min: 1, max: 10 },
    maxTime: 2000,
    faults: [{ at: 400, type: 'partition', groups: [['n5'], ['n1', 'n2', 'n3', 'n4']] }, { at: 900, type: 'heal' }],
    partitionWindow: [400, 900],
    healAt: 900,
    contenders: ['naive', 'raft'],
    source: 'defined in CP4',
  },
  {
    id: 'C',
    title: 'Stored CP2 counterexample: two partitions ([n3] at 150, [n3 n4] at 196), 4 nodes',
    ...fromFixture(ENGINE_FIXTURES, 'naive-leader.unique-leader-per-epoch.json'),
    contenders: ['naive', 'raft'],
    source: 'packages/engine/test/counterexamples/naive-leader.unique-leader-per-epoch.json',
  },
  {
    id: 'D',
    title: 'Stored CP2 crash-only counterexample (no network faults), 4 nodes',
    ...fromFixture(ENGINE_FIXTURES, 'naive-leader.crash-only.unique-leader-per-epoch.json'),
    contenders: ['naive', 'raft'],
    source: 'packages/engine/test/counterexamples/naive-leader.crash-only.unique-leader-per-epoch.json',
  },
  {
    id: 'E5',
    title: 'Symmetric split 2|3 at t=400, heal at t=1200 (5 nodes)',
    nodes: FIVE,
    seed: 1,
    latency: { min: 1, max: 10 },
    maxTime: 2000,
    faults: [{ at: 400, type: 'partition', groups: [['n1', 'n2'], ['n3', 'n4', 'n5']] }, { at: 1200, type: 'heal' }],
    partitionWindow: [400, 1200],
    healAt: 1200,
    contenders: ['naive', 'raft'],
    source: 'defined in CP4',
  },
  {
    id: 'E4',
    title: 'Symmetric split 2|2 at t=400, heal at t=1200 (4 nodes): no majority anywhere',
    nodes: FOUR,
    seed: 1,
    latency: { min: 1, max: 10 },
    maxTime: 2000,
    faults: [{ at: 400, type: 'partition', groups: [['n1', 'n2'], ['n3', 'n4']] }, { at: 1200, type: 'heal' }],
    partitionWindow: [400, 1200],
    healAt: 1200,
    contenders: ['naive', 'raft'],
    source: 'defined in CP4',
  },
  {
    id: 'F',
    title: 'Raft with votedFor NOT stored: crash/recovery during elections (3 nodes)',
    ...fromFixture(RAFT_FIXTURES, 'raft.volatile-voted-for.raft-election-safety.json'),
    contenders: ['naive', 'raft', 'raft/bug:volatile-voted-for'],
    source: 'packages/protocols/test/counterexamples/raft.volatile-voted-for.raft-election-safety.json',
  },
];

type LeaderOf = (state: unknown) => number | null;
const naiveLeaderOf: LeaderOf = (s) => ((s as NaiveLeaderState | undefined)?.role === 'leader' ? (s as NaiveLeaderState).leaderEpoch : null);
const raftLeaderOf: LeaderOf = (s) => ((s as RaftState | undefined)?.role === 'leader' ? (s as RaftState).currentTerm : null);

/**
 * Protocol-agnostic bounded liveness used for BOTH protocols: while a majority is healthy, exactly
 * one node reachable from the healthy group believes it leads, within D. (Raft additionally runs
 * its stricter `raft-leader-elected` check, which also requires acknowledgement in its term.)
 */
const oneLeaderLiveness = (leaderOf: LeaderOf): LivenessCheck => ({
  id: 'one-leader-believed',
  version: '1',
  name: 'Exactly one reachable node believes it leads while a majority is healthy',
  deadline: LIVENESS_DEADLINE,
  assumptions: [
    'A majority (⌊n/2⌋+1) of the configured cluster is healthy: running, in one partition group, and not an endpoint of any lossy or delayed link.',
    `The deadline (${LIVENESS_DEADLINE} ticks) is a test bound, not a guarantee.`,
  ],
  assumptionsHold: (view) => stableGroup(view).length >= majorityOf(view.nodes.length),
  progress: (view) => {
    const group = stableGroup(view);
    if (group.length === 0) return false;
    const reachable = view.network.partition?.find((g) => g.includes(group[0]!.id)) ?? view.nodes.map((n) => n.id);
    return view.nodes.filter((n) => n.status === 'running' && reachable.includes(n.id) && leaderOf(n.state) !== null).length === 1;
  },
});

export function configFor(scenario: Scenario, contender: Contender): SimulationConfig {
  const base = { seed: scenario.seed, nodes: [...scenario.nodes], network: { latency: scenario.latency }, limits: { maxTime: scenario.maxTime }, faults: [...scenario.faults], invariantPolicy: 'record-and-continue' as const };
  if (contender === 'naive') {
    return { ...base, protocol: createNaiveLeaderProtocol(NAIVE_OPTIONS) as never, invariants: [singleLeader, uniqueLeaderPerEpoch] as Invariant[], liveness: [oneLeaderLiveness(naiveLeaderOf)] };
  }
  const protocol = contender === 'raft' ? createRaftElection() : createBrokenRaftElection(contender.slice('raft/bug:'.length) as RaftBug);
  return { ...base, protocol: protocol as never, invariants: raftInvariants, liveness: [oneLeaderLiveness(raftLeaderOf), raftLeaderLiveness({ deadline: LIVENESS_DEADLINE })] };
}

export interface Metrics {
  /** "At most one leader per term/epoch over the whole run": unique-leader-per-epoch (naive) / raft-election-safety. */
  readonly electionSafetyViolations: number;
  readonly electionSafetyFirst: string | null;
  /** raft-one-vote-per-term; null for naive (no votes exist). */
  readonly votingViolations: number | null;
  /** raft-leader-has-quorum; null for naive (leadership is claimed from silence, not from votes). */
  readonly quorumViolations: number | null;
  /** Distinct (leader, term/epoch) leaderships. */
  readonly leaderships: number;
  readonly firstLeaderAt: number | null;
  /** Most nodes believing they lead at the same moment (informational: NOT Election Safety). */
  readonly maxConcurrentLeaderBeliefs: number;
  readonly ticksWithSeveralLeaderBeliefs: number;
  readonly longestLeaderlessStretch: number;
  /** Fraction of the partition window in which the MAJORITY side had exactly one leader (null: no partition or no majority side). */
  readonly majoritySideAvailability: number | null;
  /** Ticks after the heal until exactly one node believes it leads, and that stays true to the end (null: never). */
  readonly recoveryAfterHeal: number | null;
  /** Per liveness check: result counts, and the duration of each met waiting period (election duration). */
  readonly liveness: Readonly<Record<string, { armed: number; met: number; missed: number; disarmed: number; metDurations: number[] }>>;
  readonly fingerprint: string;
}

export function measure(scenario: Scenario, contender: Contender): Metrics & { readonly trace: readonly TraceEntry[] } {
  const { trace } = runSimulation(configFor(scenario, contender));
  return { ...metricsOf(scenario, trace, contender === 'naive' ? naiveLeaderOf : raftLeaderOf, contender === 'naive'), trace };
}

/** Leaderships (node, term/epoch, first time) in the order they began. */
export function leadershipsOf(trace: readonly TraceEntry[], contender: Contender): { node: NodeId; term: number; at: number }[] {
  const leaderOf = contender === 'naive' ? naiveLeaderOf : raftLeaderOf;
  const seen = new Map<string, { node: NodeId; term: number; at: number }>();
  for (const e of trace) {
    if (e.kind !== 'state.update') continue;
    const term = leaderOf(e.state);
    if (term !== null && !seen.has(`${e.node}|${term}`)) seen.set(`${e.node}|${term}`, { node: e.node, term, at: e.time });
  }
  return [...seen.values()];
}

function metricsOf(scenario: Scenario, trace: readonly TraceEntry[], leaderOf: LeaderOf, naive: boolean): Metrics {
  const violations = (id: string) => trace.filter((e): e is Extract<TraceEntry, { kind: 'invariant.violation' }> => e.kind === 'invariant.violation' && e.invariant.id === id);
  const safety = violations(naive ? 'unique-leader-per-epoch' : 'raft-election-safety');

  // Leader beliefs over time, from state updates and crashes only.
  const belief = new Map<NodeId, number | null>();
  const leaderships = new Set<string>();
  let firstLeaderAt: number | null = null;
  const segments: { from: number; leaders: NodeId[] }[] = [];
  const record = (time: number) => {
    const leaders = [...belief].filter(([, t]) => t !== null).map(([n]) => n).sort();
    const last = segments.at(-1);
    if (last !== undefined && last.from === time) last.leaders = leaders;
    else if (last === undefined || last.leaders.join() !== leaders.join()) segments.push({ from: time, leaders });
  };
  for (const e of trace) {
    if (e.kind === 'state.update') {
      const term = leaderOf(e.state);
      belief.set(e.node, term);
      if (term !== null) {
        leaderships.add(`${e.node}|${term}`);
        firstLeaderAt ??= e.time;
      }
      record(e.time);
    } else if (e.kind === 'node.crash') {
      belief.set(e.node, null);
      record(e.time);
    }
  }
  const end = scenario.maxTime;
  const spans = segments.map((s, i) => ({ ...s, to: segments[i + 1]?.from ?? end }));
  const overlap = (s: { from: number; to: number }, from: number, to: number) => Math.max(0, Math.min(s.to, to) - Math.max(s.from, from));

  let longestLeaderless = 0;
  let current = 0;
  for (const s of [{ from: 0, to: spans[0]?.from ?? end, leaders: [] as NodeId[] }, ...spans]) {
    current = s.leaders.length === 0 ? current + (s.to - s.from) : 0;
    longestLeaderless = Math.max(longestLeaderless, current);
  }

  let majoritySideAvailability: number | null = null;
  if (scenario.partitionWindow !== undefined) {
    const [from, to] = scenario.partitionWindow;
    const partition = scenario.faults.find((f): f is Extract<FaultSpec, { type: 'partition' }> => f.type === 'partition' && f.at === from);
    const listed = partition?.groups.flat() ?? [];
    const groups = [...(partition?.groups ?? []), scenario.nodes.filter((n) => !listed.includes(n))].filter((g) => g.length > 0);
    const majority = groups.find((g) => g.length >= majorityOf(scenario.nodes.length));
    if (majority !== undefined) {
      const available = spans.reduce((sum, s) => sum + (s.leaders.filter((l) => majority.includes(l)).length === 1 ? overlap(s, from, to) : 0), 0);
      majoritySideAvailability = Math.round((available / (to - from)) * 1000) / 1000;
    }
  }

  let recoveryAfterHeal: number | null = null;
  if (scenario.healAt !== undefined) {
    const healAt = scenario.healAt;
    const last = spans.at(-1);
    if (last !== undefined && last.leaders.length === 1) {
      // Walk back while exactly one leader (the same one) holds.
      let i = spans.length - 1;
      while (i > 0 && spans[i - 1]!.leaders.length === 1 && spans[i - 1]!.leaders[0] === last.leaders[0]) i--;
      recoveryAfterHeal = Math.max(0, spans[i]!.from - healAt);
    }
  }

  const liveness: Record<string, { armed: number; met: number; missed: number; disarmed: number; metDurations: number[] }> = {};
  for (const e of trace) {
    if (e.kind !== 'liveness.armed' && e.kind !== 'liveness.met' && e.kind !== 'liveness.missed' && e.kind !== 'liveness.disarmed') continue;
    const row = (liveness[e.check.id] ??= { armed: 0, met: 0, missed: 0, disarmed: 0, metDurations: [] });
    row[e.kind.slice('liveness.'.length) as 'armed' | 'met' | 'missed' | 'disarmed']++;
    if (e.kind === 'liveness.met') row.metDurations.push(e.duration);
  }

  return {
    electionSafetyViolations: safety.length,
    electionSafetyFirst: safety[0]?.observed ?? null,
    votingViolations: naive ? null : violations('raft-one-vote-per-term').length,
    quorumViolations: naive ? null : violations('raft-leader-has-quorum').length,
    leaderships: leaderships.size,
    firstLeaderAt,
    maxConcurrentLeaderBeliefs: Math.max(0, ...spans.map((s) => s.leaders.length)),
    ticksWithSeveralLeaderBeliefs: spans.reduce((sum, s) => sum + (s.leaders.length > 1 ? s.to - s.from : 0), 0),
    longestLeaderlessStretch: longestLeaderless,
    majoritySideAvailability,
    recoveryAfterHeal,
    liveness,
    fingerprint: fingerprintTrace(trace),
  };
}
