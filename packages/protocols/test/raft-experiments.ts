import { runSimulation, type FaultSpec, type Invariant, type RunResult, type SimulationConfig, type TraceEntry } from '@faultlab/engine';
import fc from 'fast-check';
import { createBrokenRaftElection, createRaftElection, raftInvariants, raftLeaderLiveness, type RaftBug, type RaftOptions, type RaftState } from '../src';

/**
 * Raft fault-space experiments (CP4). A plain module, not a *.test.ts file, so several test files
 * can share it without registering tests twice.
 */

/**
 * Bounded-liveness test bound D, in ticks. Chosen from measured election durations (6,000 runs:
 * 3/4/5/7 nodes × 500 seeds × {healthy start, leader crash, leader isolation}; worst case 885,
 * p99 ≤ 656; see docs/TEST_STRATEGY.md): 5 × the maximum election timeout, ≈ 1.7 × the worst
 * observed case. A test bound under documented assumptions, NOT a guarantee of Raft.
 */
export const LIVENESS_DEADLINE = 1500;

/** Default timing (§5.2 example) or a deliberately narrow timeout range that provokes split votes. */
export type Timing = 'default' | 'tight';
export const TIMINGS: Record<Timing, RaftOptions> = {
  default: {},
  tight: { electionTimeout: { min: 150, max: 155 } },
};

export interface RaftExperiment {
  readonly size: 3 | 4 | 5;
  readonly seed: number;
  readonly timing: Timing;
  /** Upper bound of the base latency range [1, latencyMax]: wider means more reordering. */
  readonly latencyMax: number;
  readonly faults: FaultSpec[];
}

export const MAX_TIME = 2500;
export const nodesOf = (size: number): string[] => Array.from({ length: size }, (_, i) => `n${i + 1}`);

export function raftConfig(
  experiment: Pick<RaftExperiment, 'size' | 'seed' | 'timing' | 'latencyMax'>,
  faults: FaultSpec[],
  options: { readonly bug?: RaftBug | null; readonly invariants?: readonly Invariant[]; readonly liveness?: boolean; readonly maxTime?: number } = {},
): SimulationConfig {
  const { bug = null, invariants = raftInvariants, liveness = true, maxTime = MAX_TIME } = options;
  const timing = TIMINGS[experiment.timing];
  return {
    seed: experiment.seed,
    nodes: nodesOf(experiment.size),
    protocol: (bug === null ? createRaftElection(timing) : createBrokenRaftElection(bug, timing)) as never,
    network: { latency: { min: 1, max: experiment.latencyMax } },
    limits: { maxTime },
    faults,
    invariants,
    invariantPolicy: 'record-and-continue',
    liveness: liveness ? [raftLeaderLiveness({ deadline: LIVENESS_DEADLINE })] : [],
  };
}

/** Fault plans for a cluster of `size` nodes, at times in [0, 1500]. */
export function raftFaultsArb(size: number): fc.Arbitrary<FaultSpec[]> {
  const nodes = nodesOf(size);
  const at = fc.integer({ min: 0, max: 1500 });
  const node = fc.constantFrom(...nodes);
  const link = fc.tuple(node, node).filter(([a, b]) => a !== b);
  const one = (arbitrary: fc.Arbitrary<FaultSpec>) => arbitrary.map((f) => [f]);
  const step: fc.Arbitrary<FaultSpec[]> = fc.oneof(
    // Crash + recovery of one node (an outage), possibly immediately.
    { weight: 3, arbitrary: fc.record({ at, node, downFor: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 600 })) }).map(({ at, node, downFor }) => [{ at, type: 'crash', node }, { at: at + downFor, type: 'recover', node }] as FaultSpec[]) },
    { weight: 1, arbitrary: one(fc.record({ at, type: fc.constant('crash' as const), node })) },
    // Any split of the nodes into up to three groups (minorities, majorities, isolated nodes).
    { weight: 3, arbitrary: one(fc.record({ at, type: fc.constant('partition' as const), groups: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: size, maxLength: size }).map((g) => [0, 1, 2].map((k) => nodes.filter((_, i) => g[i] === k)).filter((x) => x.length > 0)).filter((groups) => groups.length >= 2) })) },
    { weight: 2, arbitrary: one(fc.record({ at, type: fc.constant('heal' as const) })) },
    // Lost messages on a link.
    { weight: 1, arbitrary: one(fc.record({ at, link, loss: fc.integer({ min: 20, max: 100 }) }).map(({ at, link: [from, to], loss }) => ({ at, type: 'link' as const, from, to, loss: loss / 100 }))) },
    // Delayed messages (e.g. votes arriving after the next election started).
    { weight: 2, arbitrary: one(fc.record({ at, link, min: fc.integer({ min: 0, max: 200 }), extra: fc.integer({ min: 0, max: 300 }) }).map(({ at, link: [from, to], min, extra }) => ({ at, type: 'link' as const, from, to, delay: { min, max: min + extra } }))) },
    { weight: 1, arbitrary: one(fc.record({ at, link }).map(({ at, link: [from, to] }) => ({ at, type: 'link-restore' as const, from, to }))) },
  );
  return fc.oneof({ weight: 1, arbitrary: fc.constant<FaultSpec[]>([]) }, { weight: 9, arbitrary: fc.array(step, { maxLength: 8 }).map((g) => g.flat()) });
}

export const raftExperimentArb: fc.Arbitrary<RaftExperiment> = fc
  .record({
    size: fc.constantFrom<3 | 4 | 5>(3, 4, 5),
    seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    timing: fc.constantFrom<Timing>('default', 'default', 'tight'),
    latencyMax: fc.constantFrom(10, 10, 25),
  })
  .chain((base) => raftFaultsArb(base.size).map((faults) => ({ ...base, faults })));

/** What happened in a run, derived from the trace only: used to show what exploration covered. */
export interface Coverage {
  readonly elected: boolean;
  /** Some term had a candidate but no leader (a split or failed election). */
  readonly failedElection: boolean;
  /** Two or more nodes were candidates in the same term. */
  readonly competingCandidates: boolean;
  /** A leader stepped down because it met a higher term. */
  readonly oldLeaderMetHigherTerm: boolean;
  /** A message with a term lower than the receiver's was delivered (stale candidate / leader / vote). */
  readonly staleMessage: boolean;
  /** Two nodes believed they were leader at the same moment (in different terms). */
  readonly concurrentLeaderBeliefs: boolean;
  readonly recovered: boolean;
  readonly partitioned: boolean;
  readonly healed: boolean;
  readonly lost: boolean;
  readonly delayedLink: boolean;
  readonly livenessMet: boolean;
  readonly livenessMissed: boolean;
  readonly maxTerm: number;
  /** raft-leader-elected: waiting periods started, and how many ended met / missed. */
  readonly livenessPeriods: number;
  readonly livenessMetCount: number;
  readonly livenessMissedCount: number;
  /** Virtual time during which the check's assumptions held (it was armed), and the run's length. */
  readonly livenessEligibleTicks: number;
  readonly runTicks: number;
  /** The same, counted only from the first applied fault on (0 / 0 for fault-free runs). */
  readonly livenessEligibleTicksAfterFault: number;
  readonly ticksAfterFault: number;
}

export function coverageOf(trace: readonly TraceEntry[]): Coverage {
  const role = new Map<string, RaftState>();
  const candidates = new Map<number, Set<string>>();
  const leaders = new Set<number>();
  let oldLeaderMetHigherTerm = false;
  let staleMessage = false;
  let concurrentLeaderBeliefs = false;
  let maxTerm = 0;
  for (const e of trace) {
    if (e.kind === 'state.update') {
      const s = e.state as unknown as RaftState;
      const before = role.get(e.node);
      if (before?.role === 'leader' && s.role === 'follower' && s.currentTerm > before.currentTerm) oldLeaderMetHigherTerm = true;
      role.set(e.node, s);
      maxTerm = Math.max(maxTerm, s.currentTerm);
      if (s.role === 'candidate') candidates.set(s.currentTerm, (candidates.get(s.currentTerm) ?? new Set()).add(e.node));
      if (s.role === 'leader') leaders.add(s.currentTerm);
      if ([...role.values()].filter((r) => r.role === 'leader').length > 1) concurrentLeaderBeliefs = true;
    } else if (e.kind === 'node.crash') role.delete(e.node);
    else if (e.kind === 'message.deliver') {
      const current = role.get(e.node);
      if (current !== undefined && (e.payload as { term: number }).term < current.currentTerm) staleMessage = true;
    }
  }
  const has = (kind: TraceEntry['kind']) => trace.some((e) => e.kind === kind);
  // Eligibility of raft-leader-elected: from the first armed (out of idle) to the next disarmed.
  const runTicks = trace.at(-1)?.time ?? 0;
  const FAULT_KINDS: readonly TraceEntry['kind'][] = ['node.crash', 'node.recover', 'network.partition', 'network.heal', 'link.fault', 'link.restore'];
  const firstFault = trace.find((e) => FAULT_KINDS.includes(e.kind))?.time ?? null;
  const intervals: [number, number][] = [];
  let eligibleSince: number | null = null;
  let livenessEligibleTicks = 0;
  let livenessPeriods = 0;
  let livenessMetCount = 0;
  let livenessMissedCount = 0;
  for (const e of trace) {
    if (!e.kind.startsWith('liveness.') || (e as { check?: { id: string } }).check?.id !== 'raft-leader-elected') continue;
    if (e.kind === 'liveness.armed') {
      livenessPeriods++;
      eligibleSince ??= e.time;
    } else if (e.kind === 'liveness.met') livenessMetCount++;
    else if (e.kind === 'liveness.missed') livenessMissedCount++;
    else if (e.kind === 'liveness.disarmed' && eligibleSince !== null) {
      intervals.push([eligibleSince, e.time]);
      eligibleSince = null;
    }
  }
  if (eligibleSince !== null) intervals.push([eligibleSince, runTicks]);
  livenessEligibleTicks = intervals.reduce((sum, [a, b]) => sum + (b - a), 0);
  const livenessEligibleTicksAfterFault = firstFault === null ? 0 : intervals.reduce((sum, [a, b]) => sum + Math.max(0, b - Math.max(a, firstFault)), 0);
  const ticksAfterFault = firstFault === null ? 0 : runTicks - firstFault;
  return {
    elected: leaders.size > 0,
    failedElection: [...candidates.keys()].some((t) => !leaders.has(t)),
    competingCandidates: [...candidates.values()].some((c) => c.size > 1),
    oldLeaderMetHigherTerm,
    staleMessage,
    concurrentLeaderBeliefs,
    recovered: has('node.recover'),
    partitioned: has('network.partition'),
    healed: has('network.heal'),
    lost: trace.some((e) => e.kind === 'message.drop' && e.reason === 'lost'),
    delayedLink: trace.some((e) => e.kind === 'link.fault' && e.delay.max > 0),
    livenessMet: has('liveness.met'),
    livenessMissed: has('liveness.missed'),
    maxTerm,
    livenessPeriods,
    livenessMetCount,
    livenessMissedCount,
    livenessEligibleTicks,
    runTicks,
    livenessEligibleTicksAfterFault,
    ticksAfterFault,
  };
}

export interface Outcome {
  readonly result: RunResult;
  readonly violations: Extract<TraceEntry, { kind: 'invariant.violation' }>[];
  readonly coverage: Coverage;
}

export function runExperiment(experiment: RaftExperiment, bug: RaftBug | null = null): Outcome {
  const result = runSimulation(raftConfig(experiment, experiment.faults, { bug }));
  return {
    result,
    violations: result.trace.filter((e): e is Extract<TraceEntry, { kind: 'invariant.violation' }> => e.kind === 'invariant.violation'),
    coverage: coverageOf(result.trace),
  };
}
