import { ENGINE_VERSION, serializeTrace } from '@faultlab/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runSimulation, type FaultSpec, type TraceEntry } from '@faultlab/engine';
import { type RaftBug, type RaftState } from '../src';
import { configFor, exploreVariant, isOneMinimal, violationOf, writeNewFixture } from './raft-counterexamples';
import { raftConfig, raftExperimentArb, runExperiment } from './raft-experiments';

/**
 * Deliberately broken Raft variants (CP4). Each one breaks exactly one rule. For each, exploration
 * must FIND a violation of the property that rule protects, minimise it, replay it
 * deterministically, and show the CORRECT protocol does not violate any Raft invariant under the
 * very same experiment. Found counterexamples are stored with
 *   FAULTLAB_UPDATE_COUNTEREXAMPLES=1 npx vitest run test/raft-broken-variants.test.ts
 * (existing fixtures are never overwritten).
 */
const UPDATE = process.env['FAULTLAB_UPDATE_COUNTEREXAMPLES'] === '1';

const TARGETS: readonly { bug: RaftBug; invariantId: string; why: string; numRuns: number; seed?: number }[] = [
  { bug: 'volatile-voted-for', invariantId: 'raft-one-vote-per-term', why: 'votedFor is lost on a crash, so the node can vote again in the same term', numRuns: 3000 },
  // Rarer: needs a crash between voting and a second candidate's request; seed 777 finds it at run 951.
  { bug: 'volatile-voted-for', invariantId: 'raft-election-safety', why: 'a node that forgot its vote helps a second candidate win the same term', numRuns: 1000, seed: 777 },
  { bug: 'volatile-term', invariantId: 'raft-term-monotonic', why: 'currentTerm is lost on a crash and restarts at 0', numRuns: 1000 },
  { bug: 'volatile-term', invariantId: 'raft-election-safety', why: 'a node that forgot its term adopts the old term again and votes in it a second time', numRuns: 1000, seed: 777 },
  { bug: 'double-vote', invariantId: 'raft-one-vote-per-term', why: 'every RequestVote of the current term is granted, ignoring votedFor', numRuns: 1000 },
  { bug: 'double-vote', invariantId: 'raft-election-safety', why: 'double votes let two candidates both reach a majority in one term', numRuns: 1000 },
  { bug: 'ceil-half-majority', invariantId: 'raft-leader-has-quorum', why: '⌈n/2⌉ is not a majority for even n: 2 of 4 votes elect a leader', numRuns: 1000 },
  { bug: 'ceil-half-majority', invariantId: 'raft-election-safety', why: 'two disjoint halves of a 4-node cluster can both elect a leader in one term', numRuns: 3000 },
  { bug: 'no-step-down', invariantId: 'raft-election-safety', why: 'a leader that meets a higher term adopts it but keeps leading, next to the leader elected in that term', numRuns: 1000 },
  { bug: 'ignore-higher-term', invariantId: 'raft-term-adoption', why: 'messages with a higher term are ignored instead of adopted', numRuns: 1000 },
];

describe.each(TARGETS)('$bug violates $invariantId', ({ bug, invariantId, why, numRuns, seed = 4242 }) => {
  const found = exploreVariant({
    bug,
    invariantId,
    experiments: raftExperimentArb,
    numRuns,
    seed,
    engineVersion: ENGINE_VERSION,
    description: `raft-election/bug:${bug}: ${why} (found by fault exploration)`,
  });

  it('is found by exploration', () => {
    expect(found, `no ${invariantId} violation found for ${bug} in ${numRuns} experiments`).not.toBeNull();
  });

  it('is minimised to a valid, 1-minimal fault plan', () => {
    const { fixture } = found!;
    expect(fixture.config.faults.length).toBeLessThanOrEqual(fixture.discovery.originalFaultCount);
    expect(isOneMinimal(fixture, fixture.config.faults)).toBe(true);
  });

  it('replays deterministically (byte-identical trace)', () => {
    const again = violationOf(configFor(found!.fixture), invariantId)!;
    expect(serializeTrace(again.result.trace)).toBe(serializeTrace(found!.result.trace));
    expect(again.violation.observed).toBe(found!.fixture.expected.observed);
  });

  it('does not happen with the CORRECT protocol under the same experiment (all invariants)', () => {
    expect(found!.fixture.correctProtocol.violations).toBe(0);
  });

  it.runIf(UPDATE)('writes the counterexample fixture (only if missing)', () => {
    writeNewFixture(`raft.${bug}.${invariantId}.json`, found!.fixture);
  });
});

describe('no-step-down: the targeted defect, exercised after a leader is established', () => {
  // 5 nodes, seed 1: n5 is elected under healthy conditions; it is then isolated and healed.
  const plan: FaultSpec[] = [{ at: 400, type: 'partition', groups: [['n5'], ['n1', 'n2', 'n3', 'n4']] }, { at: 900, type: 'heal' }];
  const run = (bug: RaftBug | null) => runSimulation(raftConfig({ size: 5, seed: 1, timing: 'default', latencyMax: 10 }, plan, { bug, maxTime: 1500 }));
  type Update = Extract<TraceEntry, { kind: 'state.update' }>;
  const updates = (trace: readonly TraceEntry[]) => trace.filter((e): e is Update => e.kind === 'state.update');
  const raftState = (e: Update) => e.state as unknown as RaftState;
  const broken = run('no-step-down');
  const correct = run(null);

  it('elects a leader under healthy conditions first, with no violation before the fault', () => {
    const first = updates(broken.trace).find((e) => raftState(e).role === 'leader')!;
    expect(first).toMatchObject({ node: 'n5', time: 202 });
    expect(broken.trace.filter((e) => e.kind === 'invariant.violation' && e.time < 400)).toEqual([]);
  });

  it('the stale leader receives a higher term after the heal, adopts it, and keeps leading', () => {
    const stale = updates(broken.trace).find((e) => e.node === 'n5' && raftState(e).role === 'leader' && raftState(e).currentTerm > 1)!;
    expect(stale).toBeDefined();
    expect(stale.time).toBeGreaterThanOrEqual(900);
    // The step that produced it was triggered by delivering a message with that higher term.
    const trigger = broken.trace[stale.cause!]!;
    expect(trigger).toMatchObject({ kind: 'message.deliver', node: 'n5', payload: { term: raftState(stale).currentTerm } });
    expect(broken.trace.some((e) => e.kind === 'storage.write' && e.node === 'n5' && e.set['currentTerm'] === raftState(stale).currentTerm)).toBe(true);
  });

  it('is detected by raft-election-safety (two leaders of one term), citing both leaderships', () => {
    const violation = broken.trace.find((e): e is Extract<TraceEntry, { kind: 'invariant.violation' }> => e.kind === 'invariant.violation' && e.invariant.id === 'raft-election-safety')!;
    expect(violation.observed).toBe('Term 2 was led by n4 and also by n5');
    expect(violation.references.map((i) => (broken.trace[i] as Update).node)).toEqual(['n4', 'n5']);
  });

  it('correct Raft under the identical experiment: n5 steps down to follower in the higher term, no violation', () => {
    expect(correct.trace.some((e) => e.kind === 'invariant.violation')).toBe(false);
    const after = updates(correct.trace).find((e) => e.node === 'n5' && e.time >= 900 && raftState(e).currentTerm > 1)!;
    expect(raftState(after)).toMatchObject({ role: 'follower', currentTerm: 2 });
  });
});

describe('what the variants do NOT violate (reported, not hidden)', () => {
  it('ignore-higher-term elects no leader at all (2+ nodes), so it shows no Election Safety violation; it breaks term adoption and liveness instead', () => {
    // By construction: every node refuses RequestVotes with a term above its own, and an
    // equal-term request finds votedFor = itself. So no candidate ever gets a second vote.
    const samples = fc.sample(raftExperimentArb, { numRuns: 300, seed: 4242 });
    for (const experiment of samples) {
      const { violations, coverage } = runExperiment(experiment, 'ignore-higher-term');
      expect(coverage.elected).toBe(false);
      expect(violations.map((v) => v.invariant.id).filter((id) => id !== 'raft-term-adoption')).toEqual([]);
    }
  });
});
