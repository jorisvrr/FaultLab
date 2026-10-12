import type { Invariant, JsonObject, JsonValue, LivenessCheck, Protocol } from '@faultlab/engine';
import {
  createHeartbeatProtocol,
  createNaiveLeaderProtocol,
  createPingProtocol,
  echoForever,
  naiveLeaderInvariants,
  type NaiveLeaderState,
} from '@faultlab/engine/fixtures';
import {
  createBrokenRaftElection,
  createRaftElection,
  RAFT_BUGS,
  raftInvariants,
  raftLeaderLiveness,
  type RaftBug,
  type RaftOptions,
  type RaftState,
} from '@faultlab/protocols';
import { createSpinProtocol } from './diagnostics';
import { SpecError } from './spec';

/**
 * The versioned registry (CP5, ADR-0021): everything a spec can name, keyed by (name, version).
 * A spec that names a version which is not registered is rejected, never silently reinterpreted.
 */

/** What the UI may show about a node's protocol state; derived from that state only. */
export interface NodeSummary {
  readonly role: string | null;
  /** Term (Raft) or epoch (naive leader), if the protocol has one. */
  readonly term: number | null;
  readonly leader: boolean;
  readonly label: string;
}

export type ProtocolCategory = 'protocol' | 'broken-variant' | 'diagnostic';

export interface ProtocolEntry {
  readonly name: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  /** `broken-variant` and `diagnostic` entries exist for testing; the UI labels them as such. */
  readonly category: ProtocolCategory;
  /** Validate options (unknown keys and out-of-range values are rejected); returns them unchanged. */
  readonly parseOptions: (options: JsonObject, path: string) => JsonObject;
  readonly create: (options: JsonObject) => Protocol;
  /** Pure view adapter for the UI. Never used by the simulation. */
  readonly describe: (state: JsonValue | undefined) => NodeSummary | null;
}

export interface InvariantEntry {
  readonly invariant: Invariant;
  /** Protocols it is meant for (documentation and UI suggestions only). */
  readonly protocols: readonly string[];
  /**
   * One sentence describing what the check actually tests, for the UI. It lives here, in the
   * UI-facing registry, rather than on the `Invariant` itself, so the engine's contract is
   * unchanged. Each one is derived from that invariant's own rule; none of them claims more
   * than the rule checks.
   */
  readonly description: string;
}

/**
 * Descriptions by invariant id. Raft's entries describe LEADER ELECTION only (CP4): there is no
 * log replication in this engine, so none of them may be read as full Raft consensus.
 */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'single-leader': 'At any single moment, at most one running node considers itself the leader.',
  'unique-leader-per-epoch': 'Across the whole run, no two different nodes ever lead the same epoch.',
  'epoch-monotonic': 'Within one incarnation, a node’s epoch never decreases; a crash and restart may reset it.',
  'leader-epoch-consistent': 'A leader’s epoch is positive and never higher than the highest epoch it has seen.',
  'no-overdue-messages': 'No message stays in flight past its delivery time (a sanity check on the engine itself).',
  'raft-election-safety': 'At most one node is elected leader in any given term, across the whole run.',
  'raft-term-monotonic': 'A node’s term never decreases, including across a crash and restart.',
  'raft-one-vote-per-term': 'A node grants its vote to at most one candidate per term, including across a crash.',
  'raft-leader-has-quorum': 'Every elected leader actually received votes from a majority of distinct nodes.',
  'raft-term-adoption': 'After processing a message carrying a higher term, a node adopts at least that term.',
};

export interface LivenessEntry {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly protocols: readonly string[];
  readonly parseParams: (params: JsonObject, path: string) => JsonObject;
  readonly create: (params: JsonObject) => LivenessCheck;
}

/** Integer options with inclusive ranges; every key is optional, unknown keys are rejected. */
function integerOptions(schema: Readonly<Record<string, readonly [number, number]>>) {
  return (options: JsonObject, path: string): JsonObject => {
    for (const [key, value] of Object.entries(options)) {
      const range = schema[key];
      if (range === undefined) throw new SpecError(`${path}.${key}`, 'unknown option');
      if (!Number.isInteger(value) || (value as number) < range[0] || (value as number) > range[1]) {
        throw new SpecError(`${path}.${key}`, `must be an integer in [${range[0]}, ${range[1]}]`);
      }
    }
    return options;
  };
}

function raftOptions(options: JsonObject, path: string): JsonObject {
  for (const key of Object.keys(options)) if (key !== 'electionTimeout' && key !== 'heartbeatInterval') throw new SpecError(`${path}.${key}`, 'unknown option');
  const timeout = options['electionTimeout'];
  if (timeout !== undefined) {
    const t = timeout as { min?: unknown; max?: unknown };
    if (typeof timeout !== 'object' || timeout === null || Array.isArray(timeout) || Object.keys(timeout).some((k) => k !== 'min' && k !== 'max')) {
      throw new SpecError(`${path}.electionTimeout`, 'must be { min, max }');
    }
    if (!Number.isInteger(t.min) || !Number.isInteger(t.max) || (t.min as number) < 1 || (t.max as number) < (t.min as number) || (t.max as number) > 100_000) {
      throw new SpecError(`${path}.electionTimeout`, 'must be integers with 1 ≤ min ≤ max ≤ 100000');
    }
  }
  const heartbeat = options['heartbeatInterval'];
  if (heartbeat !== undefined && (!Number.isInteger(heartbeat) || (heartbeat as number) < 1 || (heartbeat as number) > 100_000)) {
    throw new SpecError(`${path}.heartbeatInterval`, 'must be an integer in [1, 100000]');
  }
  return options;
}

const describeNaive = (state: JsonValue | undefined): NodeSummary | null => {
  const s = state as NaiveLeaderState | undefined;
  if (s?.role === undefined) return null;
  return s.role === 'leader'
    ? { role: 'leader', term: s.leaderEpoch, leader: true, label: `leader · epoch ${String(s.leaderEpoch)}` }
    : { role: 'follower', term: s.epoch, leader: false, label: `follower · seen epoch ${s.epoch}` };
};

const describeRaft = (state: JsonValue | undefined): NodeSummary | null => {
  const s = state as RaftState | undefined;
  if (s?.role === undefined) return null;
  const follows = s.role === 'follower' && s.leaderId !== null ? ` → ${s.leaderId}` : '';
  return { role: s.role, term: s.currentTerm, leader: s.role === 'leader', label: `${s.role} · term ${s.currentTerm}${follows}` };
};

const describeHeartbeat = (state: JsonValue | undefined): NodeSummary | null => {
  const s = state as { suspected?: readonly string[]; boot?: number } | undefined;
  if (s?.suspected === undefined) return null;
  return { role: null, term: null, leader: false, label: s.suspected.length === 0 ? `boot ${String(s.boot)} · suspects none` : `boot ${String(s.boot)} · suspects ${s.suspected.join(', ')}` };
};

const describeGeneric = (state: JsonValue | undefined): NodeSummary | null =>
  state === undefined ? null : { role: null, term: null, leader: false, label: JSON.stringify(state).slice(0, 60) };

const raftEntry = (bug: RaftBug | null): ProtocolEntry => {
  const sample = bug === null ? createRaftElection() : createBrokenRaftElection(bug);
  return {
    name: sample.name,
    version: sample.version,
    title: bug === null ? 'Raft leader election' : `Raft leader election, deliberately broken: ${bug}`,
    description:
      bug === null
        ? 'Raft leader election per Figure 2 (§5.1, 5.2, 5.4.1): terms, durable votes, majorities, randomized timeouts, heartbeats. No log replication (CP8).'
        : `Test-only variant that breaks exactly one rule (${bug}); see docs/RAFT.md §8.`,
    category: bug === null ? 'protocol' : 'broken-variant',
    parseOptions: raftOptions,
    create: (options) => (bug === null ? createRaftElection(options as RaftOptions) : createBrokenRaftElection(bug, options as RaftOptions)) as unknown as Protocol,
    describe: describeRaft,
  };
};

export const PROTOCOLS: readonly ProtocolEntry[] = Object.freeze([
  {
    name: 'ping',
    version: '1',
    title: 'Ping',
    description: 'Every node pings every other node for a few rounds (CP0 fixture).',
    category: 'protocol',
    parseOptions: integerOptions({ rounds: [1, 1000], interval: [1, 100_000], jitter: [0, 100_000] }),
    create: (options) => createPingProtocol(options) as unknown as Protocol,
    describe: describeGeneric,
  },
  {
    name: 'heartbeat',
    version: '1',
    title: 'Heartbeat failure detector',
    description: 'Nodes exchange heartbeats and suspect silent peers (CP1 fixture).',
    category: 'protocol',
    parseOptions: integerOptions({ interval: [1, 100_000], jitter: [0, 100_000], timeout: [1, 1_000_000] }),
    create: (options) => createHeartbeatProtocol(options) as unknown as Protocol,
    describe: describeHeartbeat,
  },
  {
    name: 'naive-leader',
    version: '1',
    title: 'Naive leader election (deliberately unsafe)',
    description: 'The highest node that hears no higher node claims leadership. Splits brains under partitions (CP2).',
    category: 'protocol',
    parseOptions: integerOptions({ interval: [1, 100_000], jitter: [0, 100_000], timeout: [1, 1_000_000] }),
    create: (options) => createNaiveLeaderProtocol(options) as unknown as Protocol,
    describe: describeNaive,
  },
  raftEntry(null),
  ...RAFT_BUGS.map((bug) => raftEntry(bug)),
  {
    name: 'echo-forever',
    version: '1',
    title: 'Echo forever (diagnostic)',
    description: 'Two nodes bounce one message forever; only limits stop it (CP0 fixture).',
    category: 'diagnostic',
    parseOptions: integerOptions({}),
    create: () => echoForever as unknown as Protocol,
    describe: describeGeneric,
  },
  {
    name: 'diagnostic-spin',
    version: '1',
    title: 'Spin forever at a given time (diagnostic)',
    description: 'n1 enters an infinite loop in a timer handler at `spinAt`. Exists only to test the Worker watchdog.',
    category: 'diagnostic',
    parseOptions: integerOptions({ spinAt: [1, 1_000_000] }),
    create: (options) => createSpinProtocol(options['spinAt'] as number | undefined) as unknown as Protocol,
    describe: describeGeneric,
  },
] satisfies ProtocolEntry[]);

export const INVARIANTS: readonly InvariantEntry[] = Object.freeze([
  ...naiveLeaderInvariants.map((invariant) => ({ invariant, protocols: ['naive-leader'], description: DESCRIPTIONS[invariant.id] ?? invariant.name })),
  ...raftInvariants.map((invariant) => ({ invariant, protocols: ['raft-election'], description: DESCRIPTIONS[invariant.id] ?? invariant.name })),
]);

/** Invariants registered for a protocol, in evaluation order. Empty for ping and heartbeat. */
export const invariantsFor = (protocolName: string): readonly InvariantEntry[] => INVARIANTS.filter((e) => e.protocols.includes(protocolName));

export const LIVENESS: readonly LivenessEntry[] = Object.freeze([
  {
    id: 'raft-leader-elected',
    version: raftLeaderLiveness({ deadline: 1 }).version,
    name: raftLeaderLiveness({ deadline: 1 }).name,
    protocols: ['raft-election'],
    parseParams: (params: JsonObject, path: string) => {
      for (const key of Object.keys(params)) if (key !== 'deadline') throw new SpecError(`${path}.${key}`, 'unknown parameter');
      if (!Number.isInteger(params['deadline'])) throw new SpecError(`${path}.deadline`, 'must be an integer number of ticks');
      return params;
    },
    create: (params: JsonObject) => raftLeaderLiveness({ deadline: params['deadline'] as number }),
  },
]);

export const findProtocol = (name: string, version: string): ProtocolEntry | undefined => PROTOCOLS.find((p) => p.name === name && p.version === version);
export const findInvariant = (id: string, version: string): Invariant | undefined =>
  INVARIANTS.find((e) => e.invariant.id === id && e.invariant.version === version)?.invariant;
export const findLiveness = (id: string, version: string): LivenessEntry | undefined => LIVENESS.find((e) => e.id === id && e.version === version);
