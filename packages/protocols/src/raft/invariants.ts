import type { Invariant, NodeId, TraceEntry } from '@faultlab/engine';
import { majorityOf, type RaftMessage, type RaftState } from './election';

/**
 * Raft election safety invariants (CP4). All are HISTORICAL: they follow real protocol events
 * from each step's trace entries (sends, deliveries, durable writes, state updates), not only the
 * current state. See docs/RAFT.md §5 for what is and is not claimed.
 *
 * Deliberately NOT an invariant here: "at most one node believes it is leader at any moment".
 * A stale leader in a minority partition can still believe it leads in an OLDER term; that is
 * not an Election Safety violation.
 */

type Entry<K extends TraceEntry['kind']> = Extract<TraceEntry, { kind: K }>;
const payloadOf = (e: Entry<'message.send'> | Entry<'message.deliver'>): RaftMessage => e.payload as unknown as RaftMessage;
const stateOf = (e: Entry<'state.update'>): RaftState => e.state as unknown as RaftState;
const key = (node: NodeId, term: number): string => `${node}|${term}`;

/**
 * ELECTION SAFETY (Figure 3): at most one leader is ELECTED in a given term, over the whole run.
 * History: the first node seen leading each term; also the highest term any node has observed
 * (which is NOT the same as a term in which someone was actually elected).
 */
export const electionSafety: Invariant<{ readonly leaders: Readonly<Record<string, { node: NodeId; entry: number }>>; readonly maxObservedTerm: number }> = {
  id: 'raft-election-safety',
  version: '1',
  name: 'Election Safety: at most one leader per term',
  initialHistory: { leaders: {}, maxObservedTerm: 0 },
  check({ step, history }) {
    let leaders = history.leaders;
    let maxObservedTerm = history.maxObservedTerm;
    for (const e of step.entries) {
      if (e.kind !== 'state.update') continue;
      const s = stateOf(e);
      maxObservedTerm = Math.max(maxObservedTerm, s.currentTerm);
      if (s.role !== 'leader') continue;
      const term = String(s.currentTerm);
      const first = leaders[term];
      if (first === undefined) leaders = { ...leaders, [term]: { node: e.node, entry: e.index } };
      else if (first.node !== e.node) {
        return {
          ok: false,
          history: { leaders, maxObservedTerm },
          violation: {
            nodes: [first.node, e.node],
            expected: `At most one leader is elected in term ${term}, across the whole execution`,
            observed: `Term ${term} was led by ${first.node} and also by ${e.node}`,
            evidence: { term: s.currentTerm, first: first.node, second: e.node, electedTerms: Object.keys(leaders).length, maxObservedTerm },
            references: [first.entry, e.index],
          },
        };
      }
    }
    return { ok: true, history: { leaders, maxObservedTerm } };
  },
};

/** currentTerm never decreases on any node, across crashes and recoveries (it is durable). */
export const termMonotonic: Invariant<Readonly<Record<NodeId, { term: number; entry: number }>>> = {
  id: 'raft-term-monotonic',
  version: '1',
  name: 'Terms never decrease, even across crashes',
  initialHistory: {},
  check({ step, history }) {
    let next = history;
    for (const e of step.entries) {
      if (e.kind !== 'state.update') continue;
      const term = stateOf(e).currentTerm;
      const seen = next[e.node];
      if (seen !== undefined && term < seen.term) {
        return {
          ok: false,
          history: next,
          violation: {
            nodes: [e.node],
            expected: `${e.node}'s currentTerm never decreases`,
            observed: `currentTerm went from ${seen.term} to ${term} (incarnation ${e.incarnation})`,
            evidence: { before: seen.term, after: term, incarnation: e.incarnation },
            references: [seen.entry, e.index],
          },
        };
      }
      if (seen === undefined || term > seen.term) next = { ...next, [e.node]: { term, entry: e.index } };
    }
    return { ok: true, history: next };
  },
};

/**
 * A node votes for at most one candidate per term, across crashes. Evidence: actual granted
 * RequestVoteResponse sends, plus the implicit self-vote of a candidate's RequestVote broadcast.
 */
export const oneVotePerTerm: Invariant<Readonly<Record<string, { candidate: NodeId; entry: number }>>> = {
  id: 'raft-one-vote-per-term',
  version: '1',
  name: 'At most one vote per node per term',
  initialHistory: {},
  check({ step, history }) {
    let next = history;
    for (const e of step.entries) {
      if (e.kind !== 'message.send') continue;
      const m = payloadOf(e);
      let voter: NodeId;
      let candidate: NodeId;
      if (m.type === 'RequestVoteResponse' && m.voteGranted) [voter, candidate] = [e.node, e.to];
      else if (m.type === 'RequestVote' && m.candidateId === e.node) [voter, candidate] = [e.node, e.node];
      else continue;
      const k = key(voter, m.term);
      const previous = next[k];
      if (previous === undefined) next = { ...next, [k]: { candidate, entry: e.index } };
      else if (previous.candidate !== candidate) {
        return {
          ok: false,
          history: next,
          violation: {
            nodes: [...new Set([voter, previous.candidate, candidate])],
            expected: `${voter} votes for at most one candidate in term ${m.term}`,
            observed: `${voter} voted for ${previous.candidate} and then for ${candidate} in term ${m.term}`,
            evidence: { voter, term: m.term, first: previous.candidate, second: candidate },
            references: [previous.entry, e.index],
          },
        };
      }
    }
    return { ok: true, history: next };
  },
};

type QuorumHistory = {
  /** cand|term → distinct voters whose GRANTED response was delivered to the candidate. */
  readonly received: Readonly<Record<string, readonly NodeId[]>>;
  /** voter|term → every candidate this voter granted (by send), for conflict detection. */
  readonly grants: Readonly<Record<string, readonly NodeId[]>>;
  /** cand|term already verified. */
  readonly checked: Readonly<Record<string, true>>;
};

/**
 * LEADER HAS QUORUM: a node that becomes leader in term T must have obtained votes from a
 * majority (⌊n/2⌋+1) of DISTINCT cluster members in term T, as evidenced by:
 * - its DURABLE self-vote: committed storage shows currentTerm = T and votedFor = itself
 *   (a split-vote retry may legitimately keep an earlier durable votedFor = self and only write
 *   the new term, so the evidence is the durable state, not a write in a particular step);
 * - granted RequestVoteResponses with term T actually DELIVERED to it (distinct senders).
 * Counted voters must not have granted any other candidate in T. The protocol's own vote
 * counter is not trusted.
 */
export const leaderHasQuorum: Invariant<QuorumHistory> = {
  id: 'raft-leader-has-quorum',
  version: '1',
  name: 'Every elected leader obtained a majority of distinct votes',
  initialHistory: { received: {}, grants: {}, checked: {} },
  check({ view, step, history }) {
    let { received, grants, checked } = history;
    const required = majorityOf(view.nodes.length);
    for (const e of step.entries) {
      if (e.kind === 'message.send') {
        const m = payloadOf(e);
        if (m.type === 'RequestVoteResponse' && m.voteGranted) {
          const k = key(e.node, m.term);
          const list = grants[k] ?? [];
          if (!list.includes(e.to)) grants = { ...grants, [k]: [...list, e.to] };
        }
      } else if (e.kind === 'message.deliver') {
        const m = payloadOf(e);
        if (m.type === 'RequestVoteResponse' && m.voteGranted) {
          const k = key(e.node, m.term);
          const list = received[k] ?? [];
          if (!list.includes(e.from)) received = { ...received, [k]: [...list, e.from] };
        }
      } else if (e.kind === 'state.update') {
        const s = stateOf(e);
        const k = key(e.node, s.currentTerm);
        if (s.role !== 'leader' || checked[k] === true) continue;
        checked = { ...checked, [k]: true };
        const durable = view.node(e.node).storage;
        const selfVote = durable['currentTerm'] === s.currentTerm && durable['votedFor'] === e.node;
        const voters = [...new Set([...(selfVote ? [e.node] : []), ...(received[k] ?? [])])].filter((v) => view.nodes.some((n) => n.id === v));
        const conflicts = voters.filter((v) => v !== e.node && (grants[key(v, s.currentTerm)] ?? []).some((c) => c !== e.node));
        if (voters.length < required || conflicts.length > 0) {
          return {
            ok: false,
            history: { received, grants, checked },
            violation: {
              nodes: [e.node, ...voters.filter((v) => v !== e.node)],
              expected: `${e.node} became leader in term ${s.currentTerm} only after votes from ${required} distinct members of the ${view.nodes.length}-node cluster, none of which also voted for another candidate`,
              observed:
                conflicts.length > 0
                  ? `voters ${conflicts.join(', ')} also granted another candidate in term ${s.currentTerm}`
                  : `${voters.length} vote(s) evidenced (${voters.join(', ') || 'none'}); ${required} required` +
                    (selfVote ? '' : `; its own vote is not durable (storage: currentTerm ${JSON.stringify(durable['currentTerm'] ?? null)}, votedFor ${JSON.stringify(durable['votedFor'] ?? null)})`),
              evidence: {
                term: s.currentTerm,
                leader: e.node,
                voters,
                required,
                durableSelfVote: selfVote,
                conflicts,
              },
              references: [e.index],
            },
          };
        }
      }
    }
    return { ok: true, history: { received, grants, checked } };
  },
};

/**
 * TERM ADOPTION (Figure 2, All Servers): after a node processes a message carrying term T, its
 * currentTerm is at least T. A protocol-rule conformance check, separate from Election Safety.
 */
export const termAdoption: Invariant<null> = {
  id: 'raft-term-adoption',
  version: '1',
  name: 'Higher terms are always adopted',
  initialHistory: null,
  check({ view, step }) {
    for (const e of step.entries) {
      if (e.kind !== 'message.deliver') continue;
      const node = view.node(e.node);
      const state = node.state as unknown as RaftState | undefined;
      const term = payloadOf(e).term;
      if (node.status === 'running' && state !== undefined && state.currentTerm < term) {
        return {
          ok: false,
          violation: {
            nodes: [e.node, e.from],
            expected: `after receiving term ${term}, ${e.node}'s currentTerm is at least ${term}`,
            observed: `${e.node} stayed in term ${state.currentTerm}`,
            evidence: { node: e.node, deliveredTerm: term, currentTerm: state.currentTerm },
            references: [e.index, ...(node.stateEntry !== null ? [node.stateEntry] : [])],
          },
        };
      }
    }
    return { ok: true };
  },
};

/** The CP4 Raft safety invariants, in evaluation order. */
export const raftInvariants: readonly Invariant[] = Object.freeze([electionSafety, termMonotonic, oneVotePerTerm, leaderHasQuorum, termAdoption] as unknown as Invariant[]);
