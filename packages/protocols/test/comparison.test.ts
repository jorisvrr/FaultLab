import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leadershipsOf, measure, SCENARIOS, type Contender, type Metrics, type Scenario } from './comparison';

/**
 * Naive leader election vs Raft under identical external conditions (CP4, ADR-0020).
 * Each scenario asserts the qualitative outcome, and every metric is pinned in
 * test/comparison/results.json (written only if missing:
 *   FAULTLAB_UPDATE_COMPARISON=1 npx vitest run test/comparison.test.ts).
 */
const RESULTS = join(import.meta.dirname, 'comparison', 'results.json');
const UPDATE = process.env['FAULTLAB_UPDATE_COMPARISON'] === '1';

const runs = new Map<string, ReturnType<typeof measure>>();
const run = (id: string, contender: Contender) => {
  const key = `${id} ${contender}`;
  if (!runs.has(key)) runs.set(key, measure(SCENARIOS.find((s) => s.id === id)!, contender));
  return runs.get(key)!;
};
const leaderships = (id: string, contender: Contender) => leadershipsOf(run(id, contender).trace, contender);
const missed = (m: Metrics) => Object.values(m.liveness).reduce((sum, r) => sum + r.missed, 0);

describe('A. healthy 5-node cluster', () => {
  it('both elect exactly one leader and stay safe; Raft needs a vote round, naive only a timeout', () => {
    for (const c of ['naive', 'raft'] as const) {
      expect(run('A', c)).toMatchObject({ electionSafetyViolations: 0, leaderships: 1, maxConcurrentLeaderBeliefs: 1 });
      expect(missed(run('A', c))).toBe(0);
    }
    expect(run('A', 'raft')).toMatchObject({ votingViolations: 0, quorumViolations: 0 });
    expect(leaderships('A', 'naive')[0]!.node).toBe('n5'); // naive: always the highest id
  });
});

describe('B. isolate the established leader n5 (t=400–900)', () => {
  it('n5 is the established leader of BOTH protocols when it is isolated', () => {
    for (const c of ['naive', 'raft'] as const) expect(leaderships('B', c).filter((l) => l.at < 400).map((l) => l.node)).toEqual(['n5']);
  });

  it('both get a second leader on the majority side while n5 still believes it leads (2 leader beliefs at once)', () => {
    for (const c of ['naive', 'raft'] as const) expect(run('B', c).maxConcurrentLeaderBeliefs).toBe(2);
  });

  it('that is NOT an Election Safety violation in Raft: the new leader has a higher term and a quorum', () => {
    expect(run('B', 'raft')).toMatchObject({ electionSafetyViolations: 0, votingViolations: 0, quorumViolations: 0 });
    const [first, second] = leaderships('B', 'raft');
    expect(second!.term).toBeGreaterThan(first!.term);
  });

  it('after the heal the stale leader steps down and one leader remains', () => {
    for (const c of ['naive', 'raft'] as const) expect(run('B', c).recoveryAfterHeal).not.toBeNull();
    expect(missed(run('B', 'raft'))).toBe(0);
  });
});

describe('B2. same plan, seed 3: the isolated node is a Raft FOLLOWER', () => {
  it('Raft stays safe, but the isolated follower’s higher term deposes the healthy leader after the heal (no PreVote)', () => {
    expect(run('B2', 'raft')).toMatchObject({ electionSafetyViolations: 0, votingViolations: 0, quorumViolations: 0 });
    const ls = leaderships('B2', 'raft');
    expect(ls[0]!.node).not.toBe('n5');
    expect(ls.find((l) => l.at >= 900)).toMatchObject({ node: 'n5' });
    expect(ls.at(-1)!.term).toBeGreaterThan(ls[0]!.term + 1);
  });
});

describe('C. stored CP2 counterexample: two partitions, 4 nodes', () => {
  it('naive: two leaders of the same epoch (its Election Safety analogue fails)', () => {
    expect(run('C', 'naive')).toMatchObject({ electionSafetyViolations: 1, electionSafetyFirst: 'Epoch 2 was led by n3 and later also by n2' });
  });

  it('Raft: safe, and no leader at all: no majority exists after the second partition (2|2)', () => {
    expect(run('C', 'raft')).toMatchObject({ electionSafetyViolations: 0, votingViolations: 0, quorumViolations: 0, leaderships: 0 });
    expect(missed(run('C', 'raft'))).toBe(0); // assumptions do not hold: disarmed, not missed
  });
});

describe('D. stored CP2 crash-only counterexample, 4 nodes', () => {
  it('naive reuses an epoch with crashes alone; Raft elects nobody because a majority is never running', () => {
    expect(run('D', 'naive')).toMatchObject({ electionSafetyViolations: 1, electionSafetyFirst: 'Epoch 1 was led by n3 and later also by n1' });
    expect(run('D', 'raft')).toMatchObject({ electionSafetyViolations: 0, leaderships: 0 });
  });
});

describe('E. symmetric splits', () => {
  it('2|3 (5 nodes): naive elects on both sides; Raft only on the majority side', () => {
    expect(run('E5', 'naive').maxConcurrentLeaderBeliefs).toBe(2);
    const raft = leaderships('E5', 'raft').filter((l) => l.at >= 400 && l.at < 1200);
    expect(raft.every((l) => ['n3', 'n4', 'n5'].includes(l.node))).toBe(true);
    expect(run('E5', 'raft')).toMatchObject({ electionSafetyViolations: 0, majoritySideAvailability: expect.any(Number) });
  });

  it('2|2 (4 nodes): naive elects on both sides; Raft elects NOBODY during the split (unavailable but safe), and recovers after the heal', () => {
    expect(run('E4', 'naive').maxConcurrentLeaderBeliefs).toBe(2);
    expect(leaderships('E4', 'raft').filter((l) => l.at >= 400 && l.at < 1200)).toEqual([]);
    expect(run('E4', 'raft')).toMatchObject({ electionSafetyViolations: 0, majoritySideAvailability: null });
    expect(run('E4', 'raft').recoveryAfterHeal).not.toBeNull();
    expect(missed(run('E4', 'raft'))).toBe(0);
  });
});

describe('F. Raft without durable votedFor (stored counterexample)', () => {
  it('the broken variant elects two leaders in term 1; correct Raft under the identical experiment does not', () => {
    expect(run('F', 'raft/bug:volatile-voted-for')).toMatchObject({ electionSafetyViolations: 1, electionSafetyFirst: 'Term 1 was led by n1 and also by n3' });
    expect(run('F', 'raft')).toMatchObject({ electionSafetyViolations: 0, votingViolations: 0, quorumViolations: 0 });
  });
});

describe('reproducibility', () => {
  const all = () => Object.fromEntries(SCENARIOS.flatMap((s: Scenario) => s.contenders.map((c) => [`${s.id} ${c}`, (({ trace, ...m }) => m)(run(s.id, c))])));

  it('every metric (and trace fingerprint) matches the pinned results', () => {
    if (UPDATE && !existsSync(RESULTS)) writeFileSync(RESULTS, `${JSON.stringify(all(), null, 2)}\n`);
    expect(all()).toEqual(JSON.parse(readFileSync(RESULTS, 'utf8')));
  });

  it('re-running a scenario reproduces it exactly', () => {
    for (const s of SCENARIOS) for (const c of s.contenders) expect(measure(s, c).fingerprint).toBe(run(s.id, c).fingerprint);
  });
});
