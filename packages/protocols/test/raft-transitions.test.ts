import { describe, expect, it } from 'vitest';
import type { JsonValue, NodeContext } from '@faultlab/engine';
import { createBrokenRaftElection, createRaftElection, majorityOf, type RaftMessage, type RaftState } from '../src';

/**
 * Explicit state-machine transition tests: each test drives ONE handler call through a recording
 * context and checks the resulting state, messages, timers and durable writes against the
 * corresponding rule in Figure 2 / docs/RAFT.md §4.
 */
interface Recorded {
  sends: Array<{ to: string; payload: RaftMessage }>;
  timersSet: Array<{ id: string; tag: string; delay: number }>;
  timersCancelled: string[];
  writes: Array<[string, JsonValue | undefined]>;
}

function context(self: string, peers: string[], storage: Record<string, JsonValue> = {}) {
  const rec: Recorded = { sends: [], timersSet: [], timersCancelled: [], writes: [] };
  let t = 0;
  const store = new Map(Object.entries(storage));
  const ctx = {
    self,
    now: 1000,
    peers,
    random: { nextUint32: () => 7, nextFloat: () => 0.5, nextInt: (min: number) => min + 5, chance: () => false },
    storage: {
      get: (k: string) => store.get(k),
      set: (k: string, v: JsonValue) => (store.set(k, v), rec.writes.push([k, v])),
      delete: (k: string) => (store.delete(k), rec.writes.push([k, undefined])),
      keys: () => [...store.keys()].sort(),
    },
    send: (to: string, payload: RaftMessage) => (rec.sends.push({ to, payload }), `${self}:m${rec.sends.length}`),
    broadcast: (payload: RaftMessage) => peers.map((to) => (rec.sends.push({ to, payload }), `${self}:m${rec.sends.length}`)),
    setTimer: (delay: number, tag: string) => {
      const id = `${self}:t${++t}`;
      rec.timersSet.push({ id, tag, delay });
      return id;
    },
    cancelTimer: (id: string) => void rec.timersCancelled.push(id),
  } as unknown as NodeContext<RaftMessage>;
  return { ctx, rec };
}

const raft = createRaftElection();
const PEERS5 = ['n2', 'n3', 'n4', 'n5'];
const follower = (patch: Partial<RaftState> = {}): RaftState => ({ role: 'follower', currentTerm: 3, votedFor: null, leaderId: null, votesGranted: [], electionTimer: 'n1:t0', heartbeatTimer: null, ...patch });
const msg = (from: string, payload: RaftMessage) => ({ id: 'x', from, sentAt: 990, payload });
const rv = (term: number, candidateId: string): RaftMessage => ({ type: 'RequestVote', term, candidateId, lastLogIndex: 0, lastLogTerm: 0 });
const ae = (term: number, leaderId: string): RaftMessage => ({ type: 'AppendEntries', term, leaderId, prevLogIndex: 0, prevLogTerm: 0, entries: [], leaderCommit: 0 });
const vr = (term: number, voteGranted: boolean): RaftMessage => ({ type: 'RequestVoteResponse', term, voteGranted });

describe('majority', () => {
  it('is ⌊n/2⌋ + 1', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(majorityOf)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('init and crash recovery', () => {
  it('starts as a follower in term 0 on first boot, with an election timer in [min, max]', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const s = raft.init(ctx);
    expect(s).toMatchObject({ role: 'follower', currentTerm: 0, votedFor: null });
    expect(rec.timersSet).toEqual([{ id: 'n1:t1', tag: 'election', delay: 155 }]);
  });

  it('restores currentTerm and votedFor from durable storage after a crash', () => {
    const { ctx } = context('n1', PEERS5, { currentTerm: 7, votedFor: 'n4' });
    expect(raft.init(ctx)).toMatchObject({ role: 'follower', currentTerm: 7, votedFor: 'n4', leaderId: null, votesGranted: [] });
  });
});

describe('follower → candidate (election timeout)', () => {
  it('increments the term, votes for itself durably, resets the timer, and asks everyone', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const s = raft.onTimer(follower(), { id: 'n1:t0', tag: 'election', setAt: 0 }, ctx);
    expect(s).toMatchObject({ role: 'candidate', currentTerm: 4, votedFor: 'n1', votesGranted: ['n1'] });
    expect(rec.writes).toEqual([['currentTerm', 4], ['votedFor', 'n1']]);
    expect(rec.timersCancelled).toEqual(['n1:t0']);
    expect(rec.sends.map((s) => s.to)).toEqual(PEERS5);
    expect(rec.sends[0]!.payload).toEqual(rv(4, 'n1'));
  });

  it('ignores a stale election timer id (a timer that was already replaced)', () => {
    const { ctx, rec } = context('n1', PEERS5);
    expect(raft.onTimer(follower(), { id: 'n1:t-old', tag: 'election', setAt: 0 }, ctx)).toEqual(follower());
    expect(rec.sends).toEqual([]);
  });

  it('a single-node cluster elects itself immediately', () => {
    const { ctx } = context('n1', []);
    expect(raft.onTimer(follower(), { id: 'n1:t0', tag: 'election', setAt: 0 }, ctx).role).toBe('leader');
  });
});

describe('RequestVote receiver', () => {
  it('rejects a stale term without changing anything (rule 1)', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const s = raft.onMessage(follower(), msg('n2', rv(2, 'n2')), ctx);
    expect(s).toEqual(follower());
    expect(rec.sends).toEqual([{ to: 'n2', payload: vr(3, false) }]);
    expect(rec.writes).toEqual([]);
    expect(rec.timersSet).toEqual([]); // a rejection does not reset the election timer
  });

  it('grants a vote when votedFor is null, persists it, and resets the timer (rule 2)', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const s = raft.onMessage(follower(), msg('n2', rv(3, 'n2')), ctx);
    expect(s.votedFor).toBe('n2');
    expect(rec.writes).toEqual([['votedFor', 'n2']]);
    expect(rec.sends).toEqual([{ to: 'n2', payload: vr(3, true) }]);
    expect(rec.timersCancelled).toEqual(['n1:t0']);
  });

  it('grants again to the same candidate (duplicate request) but never to a second candidate in the term', () => {
    const { ctx, rec } = context('n1', PEERS5);
    expect(raft.onMessage(follower({ votedFor: 'n2' }), msg('n2', rv(3, 'n2')), ctx).votedFor).toBe('n2');
    const s = raft.onMessage(follower({ votedFor: 'n2' }), msg('n3', rv(3, 'n3')), ctx);
    expect(s.votedFor).toBe('n2');
    expect(rec.sends.map((m) => m.payload)).toEqual([vr(3, true), vr(3, false)]);
  });

  it('a higher term first makes the node a follower of that term with no vote, then grants (All Servers rule)', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const s = raft.onMessage(follower({ votedFor: 'n4' }), msg('n2', rv(5, 'n2')), ctx);
    expect(s).toMatchObject({ role: 'follower', currentTerm: 5, votedFor: 'n2' });
    expect(rec.writes).toEqual([['currentTerm', 5], ['votedFor', null], ['votedFor', 'n2']]);
    expect(rec.sends).toEqual([{ to: 'n2', payload: vr(5, true) }]);
  });
});

describe('candidate', () => {
  const candidate = (votes: string[]) => follower({ role: 'candidate', votedFor: 'n1', votesGranted: votes });

  it('counts distinct granted votes of the current term and becomes leader at the majority', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const two = raft.onMessage(candidate(['n1']), msg('n2', vr(3, true)), ctx);
    expect(two).toMatchObject({ role: 'candidate', votesGranted: ['n1', 'n2'] });
    const dup = raft.onMessage(two, msg('n2', vr(3, true)), ctx);
    expect(dup.votesGranted).toEqual(['n1', 'n2']); // duplicate response counts once
    const leader = raft.onMessage(dup, msg('n4', vr(3, true)), ctx);
    expect(leader).toMatchObject({ role: 'leader', leaderId: 'n1', electionTimer: null });
    expect(rec.sends.filter((s) => s.payload.type === 'AppendEntries').map((s) => s.to)).toEqual(PEERS5); // immediate heartbeat
    expect(rec.timersSet.at(-1)).toMatchObject({ tag: 'heartbeat', delay: 50 });
  });

  it('ignores rejections and stale-term responses', () => {
    const { ctx } = context('n1', PEERS5);
    expect(raft.onMessage(candidate(['n1']), msg('n2', vr(3, false)), ctx).votesGranted).toEqual(['n1']);
    expect(raft.onMessage(candidate(['n1']), msg('n2', vr(2, true)), ctx).votesGranted).toEqual(['n1']);
  });

  it('steps down on a response with a higher term', () => {
    const { ctx, rec } = context('n1', PEERS5);
    expect(raft.onMessage(candidate(['n1']), msg('n2', vr(9, false)), ctx)).toMatchObject({ role: 'follower', currentTerm: 9, votedFor: null, votesGranted: [] });
    expect(rec.writes).toEqual([['currentTerm', 9], ['votedFor', null]]);
  });

  it('returns to follower on AppendEntries with an equal term (§5.2) and rejects a lower one', () => {
    const { ctx, rec } = context('n1', PEERS5);
    expect(raft.onMessage(candidate(['n1']), msg('n3', ae(3, 'n3')), ctx)).toMatchObject({ role: 'follower', leaderId: 'n3', currentTerm: 3 });
    const stale = raft.onMessage(candidate(['n1']), msg('n3', ae(2, 'n3')), ctx);
    expect(stale.role).toBe('candidate');
    expect(rec.sends.map((s) => s.payload)).toEqual([
      { type: 'AppendEntriesResponse', term: 3, success: true },
      { type: 'AppendEntriesResponse', term: 3, success: false },
    ]);
  });

  it('starts a new election when its timeout elapses (split vote)', () => {
    const { ctx } = context('n1', PEERS5);
    expect(raft.onTimer(candidate(['n1', 'n2']), { id: 'n1:t0', tag: 'election', setAt: 0 }, ctx)).toMatchObject({ role: 'candidate', currentTerm: 4, votesGranted: ['n1'] });
  });
});

describe('follower and leader', () => {
  const leader = follower({ role: 'leader', leaderId: 'n1', electionTimer: null, heartbeatTimer: 'n1:h' });

  it('a follower records the leader and resets its election timer on a valid heartbeat', () => {
    const { ctx, rec } = context('n1', PEERS5);
    expect(raft.onMessage(follower(), msg('n4', ae(3, 'n4')), ctx)).toMatchObject({ role: 'follower', leaderId: 'n4' });
    expect(rec.timersCancelled).toEqual(['n1:t0']);
  });

  it('a leader sends heartbeats on its timer and re-arms it', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const s = raft.onTimer(leader, { id: 'n1:h', tag: 'heartbeat', setAt: 0 }, ctx);
    expect(rec.sends.map((m) => m.payload.type)).toEqual(['AppendEntries', 'AppendEntries', 'AppendEntries', 'AppendEntries']);
    expect(s.heartbeatTimer).toBe('n1:t1');
  });

  it('an old leader steps down when it sees a higher term, stops heartbeating, and starts an election timer', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const s = raft.onMessage(leader, msg('n2', { type: 'AppendEntriesResponse', term: 4, success: false }), ctx);
    expect(s).toMatchObject({ role: 'follower', currentTerm: 4, heartbeatTimer: null });
    expect(rec.timersCancelled).toContain('n1:h');
    expect(s.electionTimer).not.toBeNull();
  });

  it('a leader that receives an equal-term AppendEntries steps down (documented: implies an Election Safety violation)', () => {
    const { ctx } = context('n1', PEERS5);
    expect(raft.onMessage(leader, msg('n2', ae(3, 'n2')), ctx)).toMatchObject({ role: 'follower', leaderId: 'n2' });
  });

  it('ignores responses to old AppendEntries and delayed votes from earlier elections', () => {
    const { ctx, rec } = context('n1', PEERS5);
    expect(raft.onMessage(leader, msg('n2', { type: 'AppendEntriesResponse', term: 3, success: true }), ctx)).toEqual(leader);
    expect(raft.onMessage(leader, msg('n5', vr(2, true)), ctx)).toEqual(leader);
    expect(rec.sends).toEqual([]);
  });
});

describe('broken variants differ in exactly one rule', () => {
  it('volatile-voted-for does not persist votedFor; volatile-term does not persist currentTerm', () => {
    const a = context('n1', PEERS5);
    createBrokenRaftElection('volatile-voted-for').onTimer(follower(), { id: 'n1:t0', tag: 'election', setAt: 0 }, a.ctx);
    expect(a.rec.writes).toEqual([['currentTerm', 4]]);
    const b = context('n1', PEERS5);
    createBrokenRaftElection('volatile-term').onTimer(follower(), { id: 'n1:t0', tag: 'election', setAt: 0 }, b.ctx);
    expect(b.rec.writes).toEqual([['votedFor', 'n1']]);
  });

  it('double-vote grants a second candidate in the same term', () => {
    const { ctx, rec } = context('n1', PEERS5);
    createBrokenRaftElection('double-vote').onMessage(follower({ votedFor: 'n2' }), msg('n3', rv(3, 'n3')), ctx);
    expect(rec.sends).toEqual([{ to: 'n3', payload: vr(3, true) }]);
  });

  it('ceil-half-majority wins with 2 of 4 votes', () => {
    const { ctx } = context('n1', ['n2', 'n3', 'n4']);
    const s = createBrokenRaftElection('ceil-half-majority').onMessage(follower({ role: 'candidate', votedFor: 'n1', votesGranted: ['n1'] }), msg('n2', vr(3, true)), ctx);
    expect(s.role).toBe('leader');
    expect(raft.onMessage(follower({ role: 'candidate', votedFor: 'n1', votesGranted: ['n1'] }), msg('n2', vr(3, true)), context('n1', ['n2', 'n3', 'n4']).ctx).role).toBe('candidate');
  });

  it('no-step-down adopts and persists a higher term but keeps its role: a leader stays leader in the new term', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const leader = follower({ role: 'leader', leaderId: 'n1', electionTimer: null, heartbeatTimer: 'n1:h' });
    const s = createBrokenRaftElection('no-step-down').onMessage(leader, msg('n2', vr(9, false)), ctx);
    expect(s).toMatchObject({ role: 'leader', currentTerm: 9, votedFor: null, leaderId: 'n1', heartbeatTimer: 'n1:h' });
    expect(rec.writes).toEqual([['currentTerm', 9]]);
    expect(rec.timersCancelled).toEqual([]); // the heartbeat keeps running, now with term 9
    // The correct protocol converts to follower in term 9 and stops its heartbeat.
    expect(raft.onMessage(leader, msg('n2', vr(9, false)), context('n1', PEERS5).ctx)).toMatchObject({ role: 'follower', currentTerm: 9, heartbeatTimer: null });
  });

  it('ignore-higher-term ignores higher terms entirely and refuses their vote requests', () => {
    const { ctx, rec } = context('n1', PEERS5);
    const leader = follower({ role: 'leader', leaderId: 'n1', electionTimer: null, heartbeatTimer: 'n1:h' });
    const broken = createBrokenRaftElection('ignore-higher-term');
    expect(broken.onMessage(leader, msg('n2', ae(9, 'n2')), ctx)).toEqual(leader);
    broken.onMessage(follower(), msg('n2', rv(9, 'n2')), ctx);
    expect(rec.sends).toEqual([{ to: 'n2', payload: vr(3, false) }]);
  });
});
