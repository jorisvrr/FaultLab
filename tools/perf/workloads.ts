import { runSimulation, type SimulationConfig } from '@faultlab/engine';
import { createNaiveLeaderProtocol } from '@faultlab/engine/fixtures';
import { createRaftElection, raftInvariants, raftLeaderLiveness } from '@faultlab/protocols';

/** Shared measurement workloads (Phase 0 baseline, CP5). */
export const WORKLOADS: Record<string, (size?: number) => SimulationConfig> = {
  /** CP3's reference: naive leader, 8 nodes, healthy, 100 000 steps (≈ 287 000 entries). */
  naive8: () => ({ seed: 1, nodes: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'], protocol: createNaiveLeaderProtocol() as never, network: { latency: { min: 1, max: 10 } }, limits: { maxEvents: 100_000, maxTime: null } }),
  /** Heartbeat-heavy Raft: 5 nodes, healthy, with invariants and liveness, `size` ticks. */
  raft5: (ticks = 200_000) => ({
    seed: 1,
    nodes: ['n1', 'n2', 'n3', 'n4', 'n5'],
    protocol: createRaftElection() as never,
    network: { latency: { min: 1, max: 10 } },
    limits: { maxTime: ticks, maxEvents: 50_000_000 },
    invariants: raftInvariants,
    invariantPolicy: 'record-and-continue',
    liveness: [raftLeaderLiveness({ deadline: 1500 })],
  }),
  /** Small educational experiment: Raft, 5 nodes, 2 000 ticks, one leader isolation. */
  small: () => ({
    seed: 1,
    nodes: ['n1', 'n2', 'n3', 'n4', 'n5'],
    protocol: createRaftElection() as never,
    network: { latency: { min: 1, max: 10 } },
    limits: { maxTime: 2000 },
    faults: [{ at: 400, type: 'partition', groups: [['n5']] }, { at: 900, type: 'heal' }],
    invariants: raftInvariants,
    invariantPolicy: 'record-and-continue',
    liveness: [raftLeaderLiveness({ deadline: 1500 })],
  }),
};

export const traceOf = (name: string, size?: number) => runSimulation(WORKLOADS[name]!(size)).trace;
