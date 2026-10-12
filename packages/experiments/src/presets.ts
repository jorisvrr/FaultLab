import { naiveLeaderInvariants } from '@faultlab/engine/fixtures';
import { raftInvariants } from '@faultlab/protocols';
import { COUNTEREXAMPLES } from './counterexamples';
import { EXPERIMENT_SPEC_FORMAT, type CheckRef, type ExperimentSpec } from './spec';

/** Ready-made experiments for the application (CP5). Every one is a plain ExperimentSpec. */
export type PresetCategory = 'education' | 'raft' | 'counterexample' | 'diagnostic';

export interface Preset {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: PresetCategory;
  readonly spec: ExperimentSpec;
}

/** A stored counterexample: the outcome recorded when its fixture was created. */
export interface CounterexamplePreset {
  readonly id: string;
  readonly title: string;
  /** The fixture file this preset was generated from (the source of truth). */
  readonly source: string;
  readonly format: 'faultlab-counterexample/1' | 'faultlab-counterexample/2';
  readonly spec: ExperimentSpec;
  readonly expected: {
    /** Engine that recorded it; older versions are compared through `projectTrace`. */
    readonly engineVersion: string;
    readonly reason: 'invariant-violation';
    readonly fingerprint: string;
    readonly violation: { readonly invariantId: string; readonly time: number; readonly nodes: readonly string[]; readonly observed: string; readonly eventNumber: number };
  };
}

const refs = (invariants: readonly { id: string; version: string }[]): CheckRef[] => invariants.map(({ id, version }) => ({ id, version }));
const NAIVE = refs(naiveLeaderInvariants);
const RAFT = refs(raftInvariants);
const FOUR = ['n1', 'n2', 'n3', 'n4'];
const FIVE = ['n1', 'n2', 'n3', 'n4', 'n5'];
const raftLiveness = [{ id: 'raft-leader-elected', version: '1', params: { deadline: 1500 } }];

const spec = (s: Omit<ExperimentSpec, 'format'>): ExperimentSpec => ({ format: EXPERIMENT_SPEC_FORMAT, ...s });
const raft = (s: Partial<Omit<ExperimentSpec, 'format' | 'protocol'>>): ExperimentSpec =>
  spec({ seed: 1, nodes: FIVE, protocol: { name: 'raft-election', version: '1', options: {} }, network: { latency: { min: 1, max: 10 } }, invariants: RAFT, invariantPolicy: 'record-and-continue', liveness: raftLiveness, ...s });

export const PRESETS: readonly Preset[] = Object.freeze([
  {
    id: 'naive-healthy',
    title: 'Naive leader election, healthy network',
    summary: 'No faults, all five naive-leader invariants. Nodes claim leadership only after 60 ticks; n4 (highest id) becomes the single leader.',
    category: 'education',
    spec: spec({ seed: 7, nodes: FOUR, protocol: { name: 'naive-leader', version: '1', options: {} }, network: { latency: { min: 1, max: 10 } }, limits: { maxTime: 600, maxEvents: 20_000 }, invariants: NAIVE }),
  },
  {
    id: 'heartbeat-crash-partition',
    title: 'Crash, recovery and partition',
    summary: 'Heartbeat failure detector. n2 crashes at t=150 and recovers at t=300 (incarnation 2); n1 is partitioned at t=400 and the partition heals at t=520.',
    category: 'education',
    spec: spec({
      seed: 2026,
      nodes: FOUR,
      protocol: { name: 'heartbeat', version: '1', options: { interval: 20, jitter: 5, timeout: 60 } },
      network: { latency: { min: 1, max: 10 } },
      limits: { maxTime: 650, maxEvents: 20_000 },
      faults: [
        { at: 150, type: 'crash', node: 'n2' },
        { at: 300, type: 'recover', node: 'n2' },
        { at: 400, type: 'partition', groups: [['n1']] },
        { at: 520, type: 'heal' },
      ],
    }),
  },
  {
    id: 'configure-reference',
    title: 'Naive leader election: crash, partition, recovery and heal',
    summary:
      'The reference experiment for the Configure screen, and a complete tour of the naive protocol’s weakness. n4 leads from t=63; n2 crashes at t=150; a partition isolates n4 at t=400; n3 claims leadership in epoch 2 at t=477, so two running nodes lead at once and single-leader fails; n2 recovers at t=650 and the partition heals at t=900, after which n4 is still leading epoch 1. Recorded rather than stopped, so all four scheduled faults actually run.',
    category: 'education',
    spec: spec({
      seed: 2026,
      nodes: FOUR,
      protocol: { name: 'naive-leader', version: '1', options: {} },
      network: { latency: { min: 1, max: 10 } },
      limits: { maxTime: 1000, maxEvents: 20_000 },
      faults: [
        { at: 150, type: 'crash', node: 'n2' },
        { at: 400, type: 'partition', groups: [['n4']] },
        { at: 650, type: 'recover', node: 'n2' },
        { at: 900, type: 'heal' },
      ],
      invariants: NAIVE,
      invariantPolicy: 'record-and-continue',
    }),
  },
  {
    id: 'naive-split-brain',
    title: 'Naive leader election: split brain after a partition',
    summary: 'n4 leads, then a partition at t=300 isolates it; n3 also claims leadership and single-leader fails (stop-on-first).',
    category: 'education',
    spec: spec({ seed: 7, nodes: FOUR, protocol: { name: 'naive-leader', version: '1', options: {} }, network: { latency: { min: 1, max: 10 } }, limits: { maxTime: 1000, maxEvents: 20_000 }, faults: [{ at: 300, type: 'partition', groups: [['n4']] }], invariants: NAIVE }),
  },
  {
    id: 'raft-healthy',
    title: 'Raft, healthy 5-node cluster',
    summary: 'One leader is elected (n5 at t=202 with seed 1) and keeps the others quiet with heartbeats. Five safety invariants and the bounded liveness check (D = 1500, a test bound).',
    category: 'raft',
    spec: raft({ limits: { maxTime: 2000 } }),
  },
  {
    id: 'raft-isolate-leader',
    title: 'Raft: isolate the leader, then heal',
    summary: 'n5 leads term 1 and is isolated at t=400; the majority elects a leader in term 2; after the heal at t=900 n5 learns term 2 and steps down. Two nodes believe they lead at once, in different terms: not an Election Safety violation.',
    category: 'raft',
    spec: raft({ limits: { maxTime: 2000 }, faults: [{ at: 400, type: 'partition', groups: [['n5'], ['n1', 'n2', 'n3', 'n4']] }, { at: 900, type: 'heal' }] }),
  },
  {
    id: 'raft-split-2-2',
    title: 'Raft: 4 nodes split 2|2',
    summary: 'No side has a majority, so nobody is elected during the split (unavailable but safe) and the liveness check is disarmed. A leader is elected after the heal.',
    category: 'raft',
    spec: raft({ nodes: FOUR, limits: { maxTime: 2000 }, faults: [{ at: 400, type: 'partition', groups: [['n1', 'n2'], ['n3', 'n4']] }, { at: 1200, type: 'heal' }] }),
  },
  {
    id: 'raft-long-heartbeats',
    title: 'Raft: long heartbeat-heavy run (200 000 ticks)',
    summary: 'A large trace (≈ 124 000 entries) for streaming, memory and navigation measurements.',
    category: 'raft',
    spec: raft({ limits: { maxTime: 200_000, maxEvents: 5_000_000 } }),
  },
  {
    id: 'raft-leader-churn',
    title: 'Raft: leader churn (a new term every ≈ 350 ticks)',
    summary: 'The leader position is isolated every 1 000 ticks for 40 000 ticks. Used to measure invariant history growth (PERF-5).',
    category: 'raft',
    spec: raft({
      limits: { maxTime: 40_000, maxEvents: 5_000_000 },
      faults: Array.from({ length: 40 }, (_, k) => [
        { at: 1000 * k + 400, type: 'partition' as const, groups: [[`n${(k % 5) + 1}`]] },
        { at: 1000 * k + 900, type: 'heal' as const },
      ]).flat(),
    }),
  },
  {
    id: 'diagnostic-spin',
    title: 'Diagnostic: a handler that never returns',
    summary: 'n1 enters an infinite loop at t=100. Only the Worker watchdog can stop it; the run is reported as aborted.',
    category: 'diagnostic',
    spec: spec({ seed: 1, nodes: ['n1', 'n2'], protocol: { name: 'diagnostic-spin', version: '1', options: { spinAt: 100 } }, network: { latency: { min: 1, max: 5 } } }),
  },
  {
    id: 'diagnostic-echo-forever',
    title: 'Diagnostic: echo forever, stopped by maxEvents',
    summary: 'A message bounces forever; the engine stops at maxEvents (a deterministic, reproducible outcome).',
    category: 'diagnostic',
    spec: spec({ seed: 1, nodes: ['n1', 'n2'], protocol: { name: 'echo-forever', version: '1', options: {} }, network: { latency: { min: 1, max: 5 } }, limits: { maxEvents: 100_000, maxTime: null } }),
  },
] satisfies Preset[]);

export { COUNTEREXAMPLES };
