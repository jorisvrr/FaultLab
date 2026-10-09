import type { LivenessCheck, NodeId, NodeView, SimulationView } from '@faultlab/engine';
import { majorityOf, type RaftState } from './election';

/**
 * The HEALTHY GROUP: the largest set of nodes that are running, in the same partition group, and
 * not an endpoint of any active link fault (loss or extra delay, either direction). A node on a
 * degraded link is conservatively not counted as healthy, even if the link is only slightly
 * degraded. Ties go to the group listed first. Derived only from the frozen view.
 */
export function stableGroup(view: SimulationView): readonly NodeView[] {
  const degraded = new Set(view.network.links.flatMap((link) => [link.from, link.to]));
  const groups = view.network.partition ?? [view.nodes.map((n) => n.id)];
  let best: NodeView[] = [];
  for (const group of groups) {
    const members = view.nodes.filter((n) => n.status === 'running' && group.includes(n.id) && !degraded.has(n.id));
    if (members.length > best.length) best = members;
  }
  return best;
}

export interface RaftLivenessOptions {
  /** Test bound D in ticks. A configured bound under the assumptions, NOT a guarantee of Raft. */
  readonly deadline: number;
}

/**
 * Bounded, conditional liveness for Raft leader election (CP4, ADR-0019).
 *
 * While a majority of the cluster is healthy (see `stableGroup`), one leader must emerge within
 * `deadline` ticks and be acknowledged by every healthy node, in the leader's term.
 * Randomized timeouts make long elections unlikely, never impossible: a miss is a bounded-test
 * result under the stated assumptions, never a safety violation.
 */
export function raftLeaderLiveness(options: RaftLivenessOptions): LivenessCheck {
  return {
    id: 'raft-leader-elected',
    version: '1',
    name: 'A leader is elected and acknowledged while a majority is healthy',
    deadline: options.deadline,
    assumptions: [
      'A majority (⌊n/2⌋+1) of the configured cluster is healthy: running, in one partition group, and not an endpoint of any lossy or delayed link.',
      'Message latency stays within the configured base range, well below the minimum election timeout (broadcastTime ≪ electionTimeout, Raft §5.6).',
      `The deadline (${options.deadline} ticks) is a test bound chosen from measured election durations, not a guarantee: randomized timeouts make long elections unlikely, not impossible.`,
    ],
    assumptionsHold(view) {
      return stableGroup(view).length >= majorityOf(view.nodes.length);
    },
    progress(view) {
      // One running leader, in the healthy group's partition group (it may itself sit on a
      // degraded link), acknowledged in its own term by every node of the healthy group.
      const group = stableGroup(view);
      if (group.length === 0) return false;
      const reachable = view.network.partition?.find((g) => g.includes(group[0]!.id)) ?? view.nodes.map((n) => n.id);
      const leaders = view.nodes.filter((n) => n.status === 'running' && reachable.includes(n.id) && raftState(n)?.role === 'leader');
      if (leaders.length !== 1) return false;
      const leader = leaders[0]!;
      const term = raftState(leader)!.currentTerm;
      return group.every((n) => {
        const s = raftState(n);
        return s !== undefined && s.currentTerm === term && (n.id === leader.id || (s.role === 'follower' && s.leaderId === leader.id));
      });
    },
  };
}

const raftState = (node: NodeView): RaftState | undefined => node.state as unknown as RaftState | undefined;

export type { NodeId };
