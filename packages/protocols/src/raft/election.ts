import type { FiredTimer, IncomingMessage, NodeContext, NodeId, Protocol, TimerId } from '@faultlab/engine';

/**
 * Raft LEADER ELECTION (CP4), following Figure 2 and §5.1, §5.2, §5.4 of Ongaro & Ousterhout.
 * Rule-by-rule mapping and FaultLab-specific handling: docs/RAFT.md.
 *
 * Not implemented here: log replication, commitment, state-machine replication (CP8). The log
 * fields of RequestVote/AppendEntries are carried as 0 so CP8 can extend the same messages;
 * with an empty log, §5.4.1's "at least as up-to-date" condition is always satisfied.
 */

export type RaftRole = 'follower' | 'candidate' | 'leader';

export type RaftState = {
  readonly role: RaftRole;
  /** Mirror of the durable value in storage ("currentTerm"). */
  readonly currentTerm: number;
  /** Mirror of the durable value in storage ("votedFor"). */
  readonly votedFor: NodeId | null;
  /** The leader this node currently follows (from AppendEntries), or itself when leader. */
  readonly leaderId: NodeId | null;
  /** Distinct nodes whose vote this candidate received in `currentTerm` (incl. itself). */
  readonly votesGranted: readonly NodeId[];
  readonly electionTimer: TimerId | null;
  readonly heartbeatTimer: TimerId | null;
};

export type RequestVote = { readonly type: 'RequestVote'; readonly term: number; readonly candidateId: NodeId; readonly lastLogIndex: number; readonly lastLogTerm: number };
export type RequestVoteResponse = { readonly type: 'RequestVoteResponse'; readonly term: number; readonly voteGranted: boolean };
export type AppendEntries = {
  readonly type: 'AppendEntries';
  readonly term: number;
  readonly leaderId: NodeId;
  readonly prevLogIndex: number;
  readonly prevLogTerm: number;
  readonly entries: readonly never[];
  readonly leaderCommit: number;
};
export type AppendEntriesResponse = { readonly type: 'AppendEntriesResponse'; readonly term: number; readonly success: boolean };
export type RaftMessage = RequestVote | RequestVoteResponse | AppendEntries | AppendEntriesResponse;

export interface RaftOptions {
  /** Election timeout, drawn uniformly per reset from [min, max] ticks (§5.2 example: 150–300). */
  readonly electionTimeout?: { readonly min: number; readonly max: number };
  /** Leader heartbeat interval in ticks (must be well below electionTimeout.min). */
  readonly heartbeatInterval?: number;
}

/**
 * DELIBERATELY BROKEN variants for testing (CP4). Each differs from correct Raft in exactly one
 * rule. Never use outside tests.
 * - volatile-voted-for: votedFor is not written to stable storage (Figure 2: persistent state).
 * - volatile-term: currentTerm is not written to stable storage.
 * - double-vote: grants every RequestVote in the current term, ignoring votedFor (RequestVote rule 2).
 * - ceil-half-majority: majority computed as ⌈n/2⌉ instead of ⌊n/2⌋+1 (wrong for even n).
 * - no-step-down: on a higher term T, adopts T (persisted, votedFor reset) but does NOT convert to
 *   follower (the "convert to follower" half of the All Servers rule). A leader stays leader in T.
 * - ignore-higher-term: ignores every message with a higher term instead of adopting it (the whole
 *   All Servers rule). In a cluster of 2+ nodes nobody ever adopts a candidate's newer term, so no
 *   leader is ever elected and the step-down path is never reached.
 */
export type RaftBug = 'volatile-voted-for' | 'volatile-term' | 'double-vote' | 'ceil-half-majority' | 'no-step-down' | 'ignore-higher-term';
export const RAFT_BUGS: readonly RaftBug[] = ['volatile-voted-for', 'volatile-term', 'double-vote', 'ceil-half-majority', 'no-step-down', 'ignore-higher-term'];

export const RAFT_PROTOCOL_NAME = 'raft-election';
export const RAFT_PROTOCOL_VERSION = '1';
export const DEFAULT_ELECTION_TIMEOUT = Object.freeze({ min: 150, max: 300 });
export const DEFAULT_HEARTBEAT_INTERVAL = 50;

/** ⌊n/2⌋ + 1: the smallest number of servers that any two such sets must share at least one of. */
export const majorityOf = (clusterSize: number): number => Math.floor(clusterSize / 2) + 1;

export function createRaftElection(options: RaftOptions = {}): Protocol<RaftState, RaftMessage> {
  return build(options, null);
}

/** TEST ONLY: a Raft election with exactly one deliberate bug. */
export function createBrokenRaftElection(bug: RaftBug, options: RaftOptions = {}): Protocol<RaftState, RaftMessage> {
  return build(options, bug);
}

type Ctx = NodeContext<RaftMessage>;

function build(options: RaftOptions, bug: RaftBug | null): Protocol<RaftState, RaftMessage> {
  const { electionTimeout = DEFAULT_ELECTION_TIMEOUT, heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL } = options;
  const majority = (n: number): number => (bug === 'ceil-half-majority' ? Math.ceil(n / 2) : majorityOf(n));
  const clusterSize = (ctx: Ctx): number => ctx.peers.length + 1;

  /** Write durable state if it changed (persisted before this step's messages leave: ADR-0008). */
  const persist = (ctx: Ctx, before: RaftState, term: number, votedFor: NodeId | null): void => {
    if (term !== before.currentTerm && bug !== 'volatile-term') ctx.storage.set('currentTerm', term);
    if (votedFor !== before.votedFor && bug !== 'volatile-voted-for') ctx.storage.set('votedFor', votedFor);
  };

  const resetElectionTimer = (ctx: Ctx, state: RaftState): TimerId => {
    if (state.electionTimer !== null) ctx.cancelTimer(state.electionTimer);
    return ctx.setTimer(ctx.random.nextInt(electionTimeout.min, electionTimeout.max), 'election');
  };

  /** All Servers rule: a higher term T makes any node a follower in term T with no vote yet. */
  const stepDown = (ctx: Ctx, state: RaftState, term: number): RaftState => {
    persist(ctx, state, term, null);
    // BUG: adopt the newer term, but keep the current role (a leader keeps leading, now in `term`).
    if (bug === 'no-step-down') return { ...state, currentTerm: term, votedFor: null, votesGranted: [] };
    if (state.heartbeatTimer !== null) ctx.cancelTimer(state.heartbeatTimer);
    // A leader has no election timer; a follower/candidate keeps its running one.
    const electionTimer = state.role === 'leader' ? resetElectionTimer(ctx, state) : state.electionTimer;
    return { ...state, role: 'follower', currentTerm: term, votedFor: null, leaderId: null, votesGranted: [], heartbeatTimer: null, electionTimer };
  };

  const heartbeat = (state: RaftState, self: NodeId): AppendEntries => ({
    type: 'AppendEntries',
    term: state.currentTerm,
    leaderId: self,
    prevLogIndex: 0,
    prevLogTerm: 0,
    entries: [],
    leaderCommit: 0,
  });

  const becomeLeader = (ctx: Ctx, state: RaftState): RaftState => {
    if (state.electionTimer !== null) ctx.cancelTimer(state.electionTimer);
    const leader: RaftState = { ...state, role: 'leader', leaderId: ctx.self, electionTimer: null };
    ctx.broadcast(heartbeat(leader, ctx.self)); // "Upon election: send initial empty AppendEntries"
    return { ...leader, heartbeatTimer: ctx.setTimer(heartbeatInterval, 'heartbeat') };
  };

  const startElection = (ctx: Ctx, state: RaftState): RaftState => {
    const term = state.currentTerm + 1;
    persist(ctx, state, term, ctx.self); // increment currentTerm, vote for self — durable first
    const candidate: RaftState = {
      ...state,
      role: 'candidate',
      currentTerm: term,
      votedFor: ctx.self,
      leaderId: null,
      votesGranted: [ctx.self],
      electionTimer: resetElectionTimer(ctx, state),
    };
    ctx.broadcast({ type: 'RequestVote', term, candidateId: ctx.self, lastLogIndex: 0, lastLogTerm: 0 });
    return candidate.votesGranted.length >= majority(clusterSize(ctx)) ? becomeLeader(ctx, candidate) : candidate;
  };

  const onRequestVote = (ctx: Ctx, state: RaftState, from: NodeId, m: RequestVote): RaftState => {
    const grant = m.term === state.currentTerm && (bug === 'double-vote' || state.votedFor === null || state.votedFor === m.candidateId);
    let next = state;
    if (grant) {
      persist(ctx, state, state.currentTerm, m.candidateId);
      // Granting a vote resets the election timer (Followers rule); a rejection does not.
      next = { ...state, votedFor: m.candidateId, electionTimer: state.role === 'leader' ? state.electionTimer : resetElectionTimer(ctx, state) };
    }
    ctx.send(from, { type: 'RequestVoteResponse', term: next.currentTerm, voteGranted: grant });
    return next;
  };

  const onVoteResponse = (ctx: Ctx, state: RaftState, from: NodeId, m: RequestVoteResponse): RaftState => {
    if (state.role !== 'candidate' || m.term !== state.currentTerm || !m.voteGranted || state.votesGranted.includes(from)) return state;
    const next = { ...state, votesGranted: [...state.votesGranted, from] };
    return next.votesGranted.length >= majority(clusterSize(ctx)) ? becomeLeader(ctx, next) : next;
  };

  const onAppendEntries = (ctx: Ctx, state: RaftState, m: AppendEntries): RaftState => {
    if (m.term < state.currentTerm) {
      ctx.send(m.leaderId, { type: 'AppendEntriesResponse', term: state.currentTerm, success: false });
      return state;
    }
    // m.term === currentTerm here (a higher term already caused a step-down). A candidate returns
    // to follower (§5.2). A LEADER receiving an equal-term AppendEntries would mean two leaders in
    // one term: it steps down too, and the election-safety invariant reports the violation.
    if (state.heartbeatTimer !== null) ctx.cancelTimer(state.heartbeatTimer);
    const next: RaftState = {
      ...state,
      role: 'follower',
      leaderId: m.leaderId,
      votesGranted: [],
      heartbeatTimer: null,
      electionTimer: resetElectionTimer(ctx, state), // heard from the current leader
    };
    ctx.send(m.leaderId, { type: 'AppendEntriesResponse', term: next.currentTerm, success: true });
    return next;
  };

  return {
    name: bug === null ? RAFT_PROTOCOL_NAME : `${RAFT_PROTOCOL_NAME}/bug:${bug}`,
    version: RAFT_PROTOCOL_VERSION,

    init(ctx) {
      // Crash recovery: durable state survives; everything else starts fresh as a follower.
      const currentTerm = (ctx.storage.get('currentTerm') as number | undefined) ?? 0;
      const votedFor = (ctx.storage.get('votedFor') as NodeId | null | undefined) ?? null;
      const initial: RaftState = { role: 'follower', currentTerm, votedFor, leaderId: null, votesGranted: [], electionTimer: null, heartbeatTimer: null };
      return { ...initial, electionTimer: resetElectionTimer(ctx, initial) };
    },

    onMessage(state, message: IncomingMessage<RaftMessage>, ctx) {
      const { from, payload } = message;
      let current = state;
      if (payload.term > current.currentTerm) {
        if (bug === 'ignore-higher-term') {
          // BUG: ignore newer terms entirely (a vote request in a newer term is simply refused).
          if (payload.type === 'RequestVote') ctx.send(from, { type: 'RequestVoteResponse', term: current.currentTerm, voteGranted: false });
          return current;
        }
        current = stepDown(ctx, current, payload.term);
      }
      switch (payload.type) {
        case 'RequestVote':
          return onRequestVote(ctx, current, from, payload);
        case 'RequestVoteResponse':
          return onVoteResponse(ctx, current, from, payload);
        case 'AppendEntries':
          return onAppendEntries(ctx, current, payload);
        case 'AppendEntriesResponse':
          return current; // no log in CP4: only the term rule above applies
      }
    },

    onTimer(state, timer: FiredTimer, ctx) {
      if (timer.tag === 'election' && timer.id === state.electionTimer && state.role !== 'leader') return startElection(ctx, state);
      if (timer.tag === 'heartbeat' && timer.id === state.heartbeatTimer && state.role === 'leader') {
        ctx.broadcast(heartbeat(state, ctx.self));
        return { ...state, heartbeatTimer: ctx.setTimer(heartbeatInterval, 'heartbeat') };
      }
      return state;
    },
  };
}
