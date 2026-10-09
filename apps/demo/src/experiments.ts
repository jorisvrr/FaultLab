import {
  ENGINE_VERSION,
  fingerprintTrace,
  LEGACY_TRACE_VERSIONS,
  projectTrace,
  type FaultSpec,
  type LegacyTraceVersion,
  type TraceEntry,
  type Invariant,
  type JsonValue,
  type SimulationConfig,
} from '@faultlab/engine';
import {
  createHeartbeatProtocol,
  createNaiveLeaderProtocol,
  naiveLeaderInvariants,
  type NaiveLeaderOptions,
} from '@faultlab/engine/fixtures';
// The stored counterexamples are the single source of truth: imported as-is from the engine's tests.
import splitBrainFixture from '../../../packages/engine/test/counterexamples/naive-leader.single-leader.json';
import epochFixture from '../../../packages/engine/test/counterexamples/naive-leader.unique-leader-per-epoch.json';

/** How the viewer summarises a node's protocol state. Uses only fields present in that state. */
export type Describe = (state: JsonValue | undefined) => { label: string; emphasis: boolean } | null;

export interface Expected {
  /** Fingerprint as recorded by the fixture's engine version (see `fingerprintOf`). */
  readonly fingerprint: string;
  readonly violationTime: number;
  readonly nodes: readonly string[];
  readonly eventNumber: number;
}

export interface Experiment {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly source: 'preset' | 'stored counterexample';
  readonly build: () => SimulationConfig;
  readonly describe: Describe;
  /** For stored counterexamples: the outcome recorded when the fixture was created. */
  readonly expected?: Expected;
  /**
   * Fingerprint of a trace in the fixture's own trace format: identical for current fixtures,
   * via the engine's legacy projection for fixtures recorded by an older engine (SEMANTICS §16).
   */
  readonly fingerprintOf?: (trace: readonly TraceEntry[]) => string;
  /** Set when the experiment cannot be built faithfully (e.g. a version mismatch). */
  readonly problem?: string;
}

const NODES = ['n1', 'n2', 'n3', 'n4'];

const describeLeader: Describe = (state) => {
  const s = state as { role?: string; leaderEpoch?: number | null; epoch?: number } | undefined;
  if (s?.role === undefined) return null;
  return s.role === 'leader' ? { label: `leader · epoch ${String(s.leaderEpoch)}`, emphasis: true } : { label: `follower · seen ${String(s.epoch)}`, emphasis: false };
};

const describeHeartbeat: Describe = (state) => {
  const s = state as { suspected?: string[]; boot?: number } | undefined;
  if (s?.suspected === undefined) return null;
  return { label: s.suspected.length === 0 ? `boot ${String(s.boot)} · suspects none` : `boot ${String(s.boot)} · suspects ${s.suspected.join(', ')}`, emphasis: false };
};

const leaderConfig = (seed: number, faults: FaultSpec[], options: NaiveLeaderOptions = {}): SimulationConfig =>
  ({
    seed,
    nodes: NODES,
    protocol: createNaiveLeaderProtocol(options),
    network: { latency: { min: 1, max: 10 } },
    limits: { maxTime: 600, maxEvents: 20_000 },
    faults,
    invariants: naiveLeaderInvariants,
  }) as SimulationConfig;

interface FixtureJson {
  readonly format: string;
  readonly description: string;
  readonly engineVersion: string;
  readonly protocol: { readonly name: string; readonly version: string; readonly options: NaiveLeaderOptions };
  readonly invariant: { readonly id: string; readonly version: string };
  readonly config: { readonly seed: number; readonly nodes: string[]; readonly latency: { min: number; max: number }; readonly maxTime: number; readonly faults: FaultSpec[] };
  readonly expected: Expected & { readonly observed: string };
}

/** Rebuild a stored counterexample exactly as the engine's replay test does, or explain why not. */
function fromFixture(id: string, title: string, fixture: FixtureJson): Experiment {
  const invariant = naiveLeaderInvariants.find((i) => i.id === fixture.invariant.id) as Invariant | undefined;
  const protocolVersion = createNaiveLeaderProtocol(fixture.protocol.options).version;
  const problems = [
    fixture.format !== 'faultlab-counterexample/1' && `unknown format ${fixture.format}`,
    fixture.engineVersion !== ENGINE_VERSION &&
      !(LEGACY_TRACE_VERSIONS as readonly string[]).includes(fixture.engineVersion) &&
      `recorded with engine ${fixture.engineVersion}, this is ${ENGINE_VERSION}, and no legacy projection exists`,
    fixture.protocol.version !== protocolVersion && `recorded with naive-leader@${fixture.protocol.version}, this is @${protocolVersion}`,
    invariant?.version !== fixture.invariant.version && `invariant ${fixture.invariant.id}@${fixture.invariant.version} unavailable`,
  ].filter((p): p is string => typeof p === 'string');
  return {
    id,
    title,
    summary: `${fixture.description}. Minimised fault plan, replayed from the stored fixture; expected: "${fixture.expected.observed}" at t=${fixture.expected.violationTime}.`,
    source: 'stored counterexample',
    describe: describeLeader,
    expected: fixture.expected,
    fingerprintOf: (trace) =>
      fixture.engineVersion === ENGINE_VERSION ? fingerprintTrace(trace) : fingerprintTrace(projectTrace(trace, fixture.engineVersion as LegacyTraceVersion) as never),
    ...(problems.length > 0 ? { problem: problems.join('; ') } : {}),
    build: () =>
      ({
        seed: fixture.config.seed,
        nodes: fixture.config.nodes,
        protocol: createNaiveLeaderProtocol(fixture.protocol.options),
        network: { latency: fixture.config.latency },
        limits: { maxTime: fixture.config.maxTime },
        faults: fixture.config.faults,
        invariants: invariant === undefined ? [] : [invariant],
      }) as SimulationConfig,
  };
}

export const experiments: readonly Experiment[] = [
  {
    id: 'healthy',
    title: 'Healthy network',
    summary:
      'Naive leader election on a healthy network, no faults, all five invariants checked. Nodes may claim leadership only after 60 ticks; n4 (highest id) becomes the single leader and stays leader.',
    source: 'preset',
    describe: describeLeader,
    build: () => leaderConfig(7, []),
  },
  {
    id: 'crash-partition',
    title: 'Crash, recovery and partition',
    summary:
      'Heartbeat failure detector. n2 crashes at t=150 and recovers at t=300 (incarnation 2, boots=2 from storage); n1 is partitioned from the rest at t=400 and the partition heals at t=520. Watch suspicions and dropped messages.',
    source: 'preset',
    describe: describeHeartbeat,
    build: () =>
      ({
        seed: 2026,
        nodes: NODES,
        protocol: createHeartbeatProtocol({ interval: 20, jitter: 5, timeout: 60 }),
        network: { latency: { min: 1, max: 10 } },
        limits: { maxTime: 650, maxEvents: 20_000 },
        faults: [
          { at: 150, type: 'crash', node: 'n2' },
          { at: 300, type: 'recover', node: 'n2' },
          { at: 400, type: 'partition', groups: [['n1']] },
          { at: 520, type: 'heal' },
        ],
      }) as SimulationConfig,
  },
  {
    id: 'partition-split-brain',
    title: 'Partition after convergence (split brain)',
    summary:
      'Naive leader election: n4 leads stably, then a partition at t=300 isolates n4. n3 no longer hears n4 and also claims leadership: the single-leader invariant fails and the run stops at the first violation.',
    source: 'preset',
    describe: describeLeader,
    build: () => ({ ...leaderConfig(7, [{ at: 300, type: 'partition', groups: [['n4']] }]), limits: { maxTime: 1000, maxEvents: 20_000 } }),
  },
  fromFixture('fixture-split-brain', 'Stored counterexample: split brain', splitBrainFixture as FixtureJson),
  fromFixture('fixture-epoch', 'Stored counterexample: epoch reused', epochFixture as FixtureJson),
];
