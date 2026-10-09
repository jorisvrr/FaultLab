import type { InvariantVerdict, JsonValue, SimulationView, StepInfo, TraceEntry } from '@faultlab/engine';
import { describe, expect, it } from 'vitest';
import { electionSafety, leaderHasQuorum, oneVotePerTerm, termAdoption, termMonotonic, type RaftMessage, type RaftState } from '../src';

/**
 * The Raft invariants are pure functions of (view, step, history): tested here with hand-made
 * views and steps, independent of the protocol implementation they are meant to judge.
 */
const FIVE = ['n1', 'n2', 'n3', 'n4', 'n5'];
let nextIndex = 100;

const raft = (overrides: Partial<RaftState> = {}): RaftState => ({
  role: 'follower',
  currentTerm: 1,
  votedFor: null,
  leaderId: null,
  votesGranted: [],
  electionTimer: null,
  heartbeatTimer: null,
  ...overrides,
});

type NodeSpec = { state?: RaftState; storage?: Record<string, JsonValue>; status?: 'running' | 'crashed' };
const view = (specs: Record<string, NodeSpec> = {}, ids = FIVE): SimulationView => {
  const nodes = ids.map((id) => ({
    id,
    status: specs[id]?.status ?? 'running',
    incarnation: 1,
    state: (specs[id]?.state ?? raft()) as unknown as JsonValue,
    storage: specs[id]?.storage ?? {},
    stateEntry: 1,
  }));
  return { time: 10, eventNumber: 1, nodes, node: (id: string) => nodes.find((n) => n.id === id)!, inFlight: [], network: { partition: null, links: [] } } as never;
};

const send = (node: string, to: string, payload: RaftMessage): TraceEntry => ({ kind: 'message.send', index: nextIndex++, time: 10, node, to, payload }) as never;
const deliver = (node: string, from: string, payload: RaftMessage): TraceEntry => ({ kind: 'message.deliver', index: nextIndex++, time: 10, node, from, payload }) as never;
const update = (node: string, state: RaftState, incarnation = 1): TraceEntry => ({ kind: 'state.update', index: nextIndex++, time: 10, node, incarnation, state }) as never;
const step = (...entries: TraceEntry[]): StepInfo => ({ trigger: entries[0]!, entries });

const grant = (term: number) => ({ type: 'RequestVoteResponse', term, voteGranted: true }) as const;
const requestVote = (term: number, candidateId: string) => ({ type: 'RequestVote', term, candidateId, lastLogIndex: 0, lastLogTerm: 0 }) as const;

/** Feed steps through an invariant, threading its history; return every verdict. */
function feed<H extends JsonValue>(invariant: { initialHistory: H; check(i: { view: SimulationView; step: StepInfo; history: H }): InvariantVerdict<H> }, ...steps: [SimulationView, StepInfo][]) {
  let history = invariant.initialHistory;
  return steps.map(([v, s]) => {
    const verdict = invariant.check({ view: v, step: s, history });
    history = (verdict.history ?? history) as H;
    return verdict;
  });
}

describe('raft-election-safety: at most one leader ELECTED per term, over the whole history', () => {
  it('flags a second leader of the same term, even long after the first stepped down', () => {
    const verdicts = feed(electionSafety, [view(), step(update('n1', raft({ role: 'leader', currentTerm: 3 })))], [view(), step(update('n1', raft({ currentTerm: 4 })))], [view(), step(update('n2', raft({ role: 'leader', currentTerm: 3 })))]);
    expect(verdicts.map((v) => v.ok)).toEqual([true, true, false]);
    expect(verdicts[2]).toMatchObject({ violation: { nodes: ['n1', 'n2'], observed: 'Term 3 was led by n1 and also by n2' } });
  });

  it('allows two nodes that BOTH believe they lead at the same moment, in DIFFERENT terms (stale leader)', () => {
    // n1 still believes it leads term 2 (minority partition); n3 is elected in term 3.
    const both = view({ n1: { state: raft({ role: 'leader', currentTerm: 2 }) }, n3: { state: raft({ role: 'leader', currentTerm: 3 }) } });
    const verdicts = feed(electionSafety, [both, step(update('n1', raft({ role: 'leader', currentTerm: 2 })))], [both, step(update('n3', raft({ role: 'leader', currentTerm: 3 })))]);
    expect(verdicts.every((v) => v.ok)).toBe(true);
  });

  it('allows the same leader to re-announce its term (heartbeats update its state)', () => {
    const leader = raft({ role: 'leader', currentTerm: 2 });
    expect(feed(electionSafety, [view(), step(update('n1', leader))], [view(), step(update('n1', { ...leader, heartbeatTimer: 'n1:t9' }))]).every((v) => v.ok)).toBe(true);
  });

  it('distinguishes the latest observed term from elected terms', () => {
    const [, second] = feed(electionSafety, [view(), step(update('n1', raft({ role: 'leader', currentTerm: 2 })))], [view(), step(update('n4', raft({ role: 'candidate', currentTerm: 9 })))]);
    expect(second!.history).toEqual({ leaders: { '2': { node: 'n1', entry: expect.any(Number) } }, maxObservedTerm: 9 });
  });
});

describe('raft-term-monotonic', () => {
  it('flags a term that decreases, also across a crash (currentTerm is durable)', () => {
    const verdicts = feed(termMonotonic, [view(), step(update('n1', raft({ currentTerm: 5 })))], [view(), step(update('n1', raft({ currentTerm: 0 }), 2))]);
    expect(verdicts[1]).toMatchObject({ ok: false, violation: { nodes: ['n1'], observed: 'currentTerm went from 5 to 0 (incarnation 2)' } });
  });

  it('accepts equal and increasing terms', () => {
    expect(feed(termMonotonic, [view(), step(update('n1', raft({ currentTerm: 5 })), update('n1', raft({ currentTerm: 5 })), update('n1', raft({ currentTerm: 6 })))]).every((v) => v.ok)).toBe(true);
  });
});

describe('raft-one-vote-per-term (evidence: actual vote sends)', () => {
  it('flags a node that grants two different candidates in one term', () => {
    const verdicts = feed(oneVotePerTerm, [view(), step(send('n3', 'n1', grant(2)))], [view(), step(send('n3', 'n2', grant(2)))]);
    expect(verdicts[1]).toMatchObject({ ok: false, violation: { observed: 'n3 voted for n1 and then for n2 in term 2' } });
  });

  it('counts a candidate’s RequestVote broadcast as its self-vote', () => {
    const verdicts = feed(oneVotePerTerm, [view(), step(send('n3', 'n1', requestVote(2, 'n3')))], [view(), step(send('n3', 'n1', grant(2)))]);
    expect(verdicts[1]).toMatchObject({ ok: false, violation: { observed: 'n3 voted for n3 and then for n1 in term 2' } });
  });

  it('accepts re-granting the same candidate, rejections, and votes in different terms', () => {
    const ok = feed(
      oneVotePerTerm,
      [view(), step(send('n3', 'n1', grant(2)), send('n3', 'n1', grant(2)))],
      [view(), step(send('n3', 'n2', { type: 'RequestVoteResponse', term: 2, voteGranted: false }))],
      [view(), step(send('n3', 'n2', grant(3)))],
    );
    expect(ok.every((v) => v.ok)).toBe(true);
  });
});

describe('raft-leader-has-quorum (historical evidence, protocol vote counter NOT trusted)', () => {
  const durableSelf = (node: string, term: number) => ({ [node]: { storage: { currentTerm: term, votedFor: node } } });
  const leaderStep = (node: string, term: number, votesGranted: string[] = []) => step(update(node, raft({ role: 'leader', currentTerm: term, votedFor: node, votesGranted })));

  it('accepts a leader with its durable self-vote plus two DELIVERED grants (3 of 5)', () => {
    const verdicts = feed(leaderHasQuorum, [view(), step(deliver('n1', 'n2', grant(2)))], [view(), step(deliver('n1', 'n3', grant(2)))], [view(durableSelf('n1', 2)), leaderStep('n1', 2)]);
    expect(verdicts.every((v) => v.ok)).toBe(true);
  });

  it('flags a leader with only 2 of 5 votes, even if its own counter claims 5', () => {
    const verdicts = feed(leaderHasQuorum, [view(), step(deliver('n1', 'n2', grant(2)))], [view(durableSelf('n1', 2)), leaderStep('n1', 2, FIVE)]);
    expect(verdicts[1]).toMatchObject({ ok: false, violation: { observed: '2 vote(s) evidenced (n1, n2); 3 required', evidence: { required: 3, durableSelfVote: true } } });
  });

  it('does not count grants that were sent but never delivered, or delivered for another term', () => {
    const verdicts = feed(
      leaderHasQuorum,
      [view(), step(send('n2', 'n1', grant(2)), send('n3', 'n1', grant(2)))],
      [view(), step(deliver('n1', 'n4', grant(1)))],
      [view(durableSelf('n1', 2)), leaderStep('n1', 2)],
    );
    expect(verdicts[2]).toMatchObject({ ok: false, violation: { evidence: { voters: ['n1'] } } });
  });

  it('counts a duplicated delivery from the same voter once', () => {
    const verdicts = feed(leaderHasQuorum, [view(), step(deliver('n1', 'n2', grant(2)), deliver('n1', 'n2', grant(2)))], [view(durableSelf('n1', 2)), leaderStep('n1', 2)]);
    expect(verdicts[1]).toMatchObject({ ok: false, violation: { evidence: { voters: ['n1', 'n2'] } } });
  });

  it('requires the self-vote to be DURABLE for that term', () => {
    const verdicts = feed(
      leaderHasQuorum,
      [view(), step(deliver('n1', 'n2', grant(2)), deliver('n1', 'n3', grant(2)))],
      [view({ n1: { storage: { currentTerm: 2, votedFor: null } } }), leaderStep('n1', 2)],
    );
    expect(verdicts[1]).toMatchObject({
      ok: false,
      violation: { observed: '2 vote(s) evidenced (n2, n3); 3 required; its own vote is not durable (storage: currentTerm 2, votedFor null)', evidence: { voters: ['n2', 'n3'], durableSelfVote: false } },
    });
  });

  it('regression: a split-vote retry keeps an EARLIER durable votedFor = self (no new votedFor write)', () => {
    // Probe finding (CP4): n1 wins term 3 after a failed term-2 election. Only currentTerm was
    // written in the term-3 step, because votedFor was already n1. The durable state is the evidence.
    const verdicts = feed(leaderHasQuorum, [view(), step(deliver('n1', 'n2', grant(3)), deliver('n1', 'n5', grant(3)))], [view(durableSelf('n1', 3)), leaderStep('n1', 3)]);
    expect(verdicts.every((v) => v.ok)).toBe(true);
  });

  it('flags a quorum that includes a voter who also granted another candidate in that term', () => {
    const verdicts = feed(
      leaderHasQuorum,
      [view(), step(send('n3', 'n2', grant(2)), send('n3', 'n1', grant(2)))],
      [view(), step(deliver('n1', 'n3', grant(2)), deliver('n1', 'n4', grant(2)))],
      [view(durableSelf('n1', 2)), leaderStep('n1', 2)],
    );
    expect(verdicts[2]).toMatchObject({ ok: false, violation: { observed: 'voters n3 also granted another candidate in term 2', evidence: { conflicts: ['n3'] } } });
  });

  it('uses the FULL configured cluster: 3 of 4 required in a 4-node cluster', () => {
    const four = FIVE.slice(0, 4);
    const verdicts = feed(leaderHasQuorum, [view({}, four), step(deliver('n1', 'n2', grant(2)))], [view(durableSelf('n1', 2), four), leaderStep('n1', 2)]);
    expect(verdicts[1]).toMatchObject({ ok: false, violation: { evidence: { required: 3, voters: ['n1', 'n2'] } } });
  });

  it('checks each (leader, term) once: later heartbeats of the same leader are not re-judged', () => {
    const verdicts = feed(
      leaderHasQuorum,
      [view(), step(deliver('n1', 'n2', grant(2)), deliver('n1', 'n3', grant(2)))],
      [view(durableSelf('n1', 2)), leaderStep('n1', 2)],
      [view({ n1: { storage: { currentTerm: 2, votedFor: 'n1' } } }), leaderStep('n1', 2)],
    );
    expect(verdicts.every((v) => v.ok)).toBe(true);
  });
});

describe('raft-term-adoption (Figure 2, All Servers)', () => {
  it('flags a running node that stays in a lower term after receiving a higher one', () => {
    const v = view({ n2: { state: raft({ currentTerm: 1 }) } });
    expect(termAdoption.check({ view: v, step: step(deliver('n2', 'n1', requestVote(4, 'n1'))), history: null })).toMatchObject({
      ok: false,
      violation: { nodes: ['n2', 'n1'], observed: 'n2 stayed in term 1' },
    });
  });

  it('accepts adoption, equal or lower terms, and ignores nodes that are not running', () => {
    const delivered = step(deliver('n2', 'n1', requestVote(4, 'n1')));
    expect(termAdoption.check({ view: view({ n2: { state: raft({ currentTerm: 4 }) } }), step: delivered, history: null }).ok).toBe(true);
    expect(termAdoption.check({ view: view({ n2: { state: raft({ currentTerm: 7 }) } }), step: delivered, history: null }).ok).toBe(true);
    expect(termAdoption.check({ view: view({ n2: { status: 'crashed' } }), step: delivered, history: null }).ok).toBe(true);
  });
});
