import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprintTrace } from '@faultlab/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coverageOf, raftExperimentArb, runExperiment, type Coverage, type RaftExperiment } from './raft-experiments';

/**
 * Fault-space exploration of CORRECT Raft leader election (CP4).
 *
 * Every generated experiment (3/4/5 nodes, default or deliberately tight election timeouts, base
 * latency 1–10 or 1–25, up to 8 fault groups: outages, crashes, arbitrary partitions into up to
 * three groups, heals, lossy links, delayed links, link restores) must satisfy ALL five Raft safety
 * invariants. Bounded liveness is reported separately (never as a safety result).
 *
 * - CI (default): a fixed fast-check seed and EXPERIMENTS_CI experiments: deterministic.
 * - `npm run test:explore` (FAULTLAB_EXPLORE=full, random seed): EXPERIMENTS_FULL ≥ 10,000.
 *
 * Passing is evidence, not a formal proof: it covers what the generators produce, nothing more.
 */
const FULL = process.env['FAULTLAB_EXPLORE'] === 'full';
const EXPERIMENTS_CI = 1_000;
const EXPERIMENTS_FULL = 10_000;
const REPORT = process.env['FAULTLAB_EXPLORE_REPORT'];

type Eligibility = { experiments: number; armedAtLeastOnce: number; neverEligible: number; eligibleTicks: number; runTicks: number; eligibleTicksAfterFault: number; ticksAfterFault: number; eligibleAfterFault: number; periods: number; met: number; missed: number };
type Tally = { fastCheckSeed: number | null; experiments: number; byKey: Record<string, number>; livenessMissed: { default: number; tight: number }; maxTerm: number; eligibility: Record<string, Eligibility> };

describe('exploring correct Raft leader election', () => {
  const tally: Tally = { fastCheckSeed: null, experiments: 0, byKey: {}, livenessMissed: { default: 0, tight: 0 }, maxTerm: 0, eligibility: {} };
  const eligibility = (key: string): Eligibility => (tally.eligibility[key] ??= { experiments: 0, armedAtLeastOnce: 0, neverEligible: 0, eligibleTicks: 0, runTicks: 0, eligibleTicksAfterFault: 0, ticksAfterFault: 0, eligibleAfterFault: 0, periods: 0, met: 0, missed: 0 });
  const count = (key: string) => (tally.byKey[key] = (tally.byKey[key] ?? 0) + 1);
  const numRuns = FULL ? EXPERIMENTS_FULL : EXPERIMENTS_CI;

  it(`never violates a safety invariant (${numRuns} generated experiments)`, () => {
    const details = fc.check(
      fc.property(raftExperimentArb, (experiment) => {
        const { violations, coverage } = runExperiment(experiment);
        if (violations.length > 0) return false;
        tally.experiments++;
        count(`size ${experiment.size}`);
        count(`timing ${experiment.timing}`);
        count(`latency 1–${experiment.latencyMax}`);
        for (const [key, value] of Object.entries(coverage) as [keyof Coverage, unknown][]) if (value === true) count(key);
        if (coverage.livenessMissed) tally.livenessMissed[experiment.timing]++;
        tally.maxTerm = Math.max(tally.maxTerm, coverage.maxTerm);
        for (const key of ['all', `timing ${experiment.timing}`, `size ${experiment.size}`, experiment.faults.length === 0 ? 'fault-free' : 'with faults']) {
          const row = eligibility(key);
          row.experiments++;
          if (coverage.livenessPeriods > 0) row.armedAtLeastOnce++;
          else row.neverEligible++;
          row.eligibleTicks += coverage.livenessEligibleTicks;
          row.runTicks += coverage.runTicks;
          row.eligibleTicksAfterFault += coverage.livenessEligibleTicksAfterFault;
          row.ticksAfterFault += coverage.ticksAfterFault;
          if (coverage.livenessEligibleTicksAfterFault > 0) row.eligibleAfterFault++;
          row.periods += coverage.livenessPeriods;
          row.met += coverage.livenessMetCount;
          row.missed += coverage.livenessMissedCount;
        }
        return true;
      }),
      { numRuns },
    );
    tally.fastCheckSeed = details.seed; // with FAULTLAB_FC_SEED=random: the seed to re-run this exploration
    if (details.failed) {
      const [experiment] = details.counterexample as [RaftExperiment];
      const { violations } = runExperiment(experiment);
      expect.fail(`safety violation (seed ${details.seed}):\n${JSON.stringify({ experiment, violations: violations.map((v) => [v.invariant.id, v.observed]) }, null, 2)}`);
    }
    expect(tally.experiments).toBe(numRuns);
  });

  it('actually covered the scenarios it claims to explore', () => {
    for (const key of [
      'size 3', 'size 4', 'size 5', 'timing default', 'timing tight', 'latency 1–25',
      'elected', 'failedElection', 'competingCandidates', 'oldLeaderMetHigherTerm', 'staleMessage',
      'concurrentLeaderBeliefs', 'recovered', 'partitioned', 'healed', 'lost', 'delayedLink', 'livenessMet',
    ]) {
      expect(tally.byKey[key] ?? 0, key).toBeGreaterThan(0);
    }
    if (REPORT !== undefined) {
      mkdirSync(join(REPORT, '..'), { recursive: true });
      writeFileSync(REPORT, `${JSON.stringify({ full: FULL, ...tally }, null, 2)}\n`);
    }
  });

  it('the liveness check was actually exercised: eligible in most experiments and for most of their time', () => {
    // Without this, "no liveness misses" would say nothing. Conservative health filtering must not
    // leave the checker idle in normal workloads.
    const all = tally.eligibility['all']!;
    expect(all.armedAtLeastOnce / all.experiments).toBeGreaterThan(0.9);
    expect(all.eligibleTicks / all.runTicks).toBeGreaterThan(0.5);
    // Every run starts healthy, so "armed at least once" is trivial; what matters is eligibility
    // once faults are active.
    const faulty = tally.eligibility['with faults']!;
    expect(faulty.eligibleAfterFault / faulty.experiments).toBeGreaterThan(0.5);
    expect(faulty.eligibleTicksAfterFault / faulty.ticksAfterFault).toBeGreaterThan(0.3);
    expect(tally.eligibility['fault-free']!.neverEligible).toBe(0);
    expect(all.met).toBeGreaterThan(all.experiments); // re-armed and met again after progress was lost
  });

  it('meets the bounded liveness expectation in every DEFAULT-timing experiment where its assumptions held', () => {
    // A test bound, not a Raft guarantee (docs/RAFT.md §6). Tight timeouts deliberately weaken
    // the randomization Raft relies on, so misses there are reported, not asserted.
    expect(tally.livenessMissed.default).toBe(0);
  });

  it('a leader never holds an election timer in any reachable state (why mutant R15 is equivalent)', () => {
    // becomeLeader cancels the election timer and sets it to null; only stepDown (leaving the
    // leader role) creates a new one. So the "role !== leader" guard on election timeouts is
    // redundant in reachable states. Checked on every state.update of 300 generated runs.
    let leaderStates = 0;
    for (const experiment of fc.sample(raftExperimentArb, { numRuns: 300, seed: 15 })) {
      for (const e of runExperiment(experiment).result.trace) {
        if (e.kind !== 'state.update' || (e.state as { role: string }).role !== 'leader') continue;
        leaderStates++;
        expect((e.state as { electionTimer: string | null }).electionTimer).toBeNull();
      }
    }
    expect(leaderStates).toBeGreaterThan(1000);
  });

  it('replays experiments deterministically', () => {
    const samples = fc.sample(raftExperimentArb, { numRuns: 20, seed: 7 });
    for (const experiment of samples) {
      const a = runExperiment(experiment);
      const b = runExperiment(experiment);
      expect(fingerprintTrace(b.result.trace)).toBe(fingerprintTrace(a.result.trace));
      expect(coverageOf(b.result.trace)).toEqual(a.coverage);
    }
  });
});
