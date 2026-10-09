import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FaultSpec } from '../src/faults';
import { createNaiveLeaderProtocol, naiveLeaderInvariants } from '../src/fixtures';
import { serializeTrace } from '../src/trace';
import { ENGINE_VERSION } from '../src/version';
import { configFor, LEADER_OPTIONS, type CounterexampleFixture } from './counterexample-format';
import { explore, isOneMinimal, violationOf } from './explore';
import { runSimulation } from '../src/simulation';

const NODES = ['n1', 'n2', 'n3', 'n4'];
const UPDATE = process.env['FAULTLAB_UPDATE_COUNTEREXAMPLES'] === '1';
const OUT = join(import.meta.dirname, 'counterexamples');

/**
 * Fault plans that start after the leader has converged (t ≥ 150), so every counterexample shows
 * a fault breaking an ESTABLISHED leader rather than a startup artefact.
 */
const leaderFaults: fc.Arbitrary<FaultSpec[]> = (() => {
  const at = fc.integer({ min: 150, max: 700 });
  const node = fc.constantFrom(...NODES);
  const link = fc.tuple(node, node).filter(([a, b]) => a !== b);
  const fault: fc.Arbitrary<FaultSpec> = fc.oneof(
    fc.record({ at, type: fc.constant('crash' as const), node }),
    fc.record({ at, type: fc.constant('recover' as const), node }),
    fc.record({ at, type: fc.constant('partition' as const), groups: fc.subarray(NODES, { minLength: 1, maxLength: 3 }).map((g) => [g]) }),
    fc.record({ at, type: fc.constant('heal' as const) }),
    fc
      .record({ at, link, loss: fc.integer({ min: 50, max: 100 }).map((p) => p / 100) })
      .map(({ at, link: [from, to], loss }) => ({ at, type: 'link' as const, from, to, loss })),
  );
  return fc.array(fault, { maxLength: 12 });
})();

const fixtureBase = (invariantId: string) => {
  const invariant = naiveLeaderInvariants.find((i) => i.id === invariantId)!;
  return {
    protocol: { name: 'naive-leader' as const, version: createNaiveLeaderProtocol().version, options: LEADER_OPTIONS },
    invariant: { id: invariant.id, version: invariant.version },
    config: { seed: 11, nodes: NODES, latency: { min: 1, max: 10 }, maxTime: 1000, faults: [] as FaultSpec[] },
  };
};

describe.each([
  ['single-leader', 'split brain: two simultaneous leaders'],
  ['unique-leader-per-epoch', 'two leaders of the same epoch over the run'],
])('exploring fault plans against %s', (invariantId, description) => {
  const base = fixtureBase(invariantId);
  const build = (faults: FaultSpec[]) => configFor(base, faults);
  const found = explore({ build, faults: leaderFaults, invariantId, numRuns: 500, seed: 424242 });

  it('finds a violation', () => {
    expect(found).not.toBeNull();
  });

  it('minimises it to a valid, 1-minimal plan no larger than the original', () => {
    const { faults, discovery } = found!;
    expect(faults.length).toBeGreaterThan(0);
    expect(faults.length).toBeLessThanOrEqual(discovery.originalFaultCount);
    expect(isOneMinimal(build, faults, invariantId)).toBe(true);
    expect(faults.every((f) => f.at >= 150)).toBe(true); // stayed inside the post-convergence space
  });

  it('replays deterministically', () => {
    const again = violationOf(build(found!.faults), invariantId)!;
    expect(serializeTrace(again.result.trace)).toBe(serializeTrace(found!.result.trace));
    expect(again.violation).toEqual(found!.violation);
  });

  it('is not a startup artefact: the leader was stable before the first fault', () => {
    const first = Math.min(...found!.faults.map((f) => f.at));
    const healthy = runSimulation(build([]));
    expect(healthy.trace.some((e) => e.kind === 'invariant.violation')).toBe(false);
    expect(found!.violation.time).toBeGreaterThanOrEqual(first);
  });

  it.runIf(UPDATE)('writes the counterexample fixture', () => {
    const { faults, violation, fingerprint, discovery } = found!;
    const fixture: CounterexampleFixture = {
      format: 'faultlab-counterexample/1',
      description: `naive-leader: ${description} (found by fault exploration)`,
      engineVersion: ENGINE_VERSION,
      ...base,
      config: { ...base.config, faults },
      discovery: { ...discovery, minimisedFaultCount: faults.length },
      expected: {
        reason: 'invariant-violation',
        violationTime: violation.time,
        nodes: [...violation.nodes],
        observed: violation.observed,
        eventNumber: violation.eventNumber,
        fingerprint,
      },
    };
    writeNewFixture(`naive-leader.${invariantId}.json`, fixture);
  });
});

/**
 * Fixtures are written only if they do not exist yet: a stored counterexample is never silently
 * overwritten (e.g. after an engine version bump). To replace one on purpose, delete it first
 * and explain why in the engineering log.
 */
function writeNewFixture(name: string, fixture: CounterexampleFixture): void {
  const path = join(OUT, name);
  if (existsSync(path)) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
}

/**
 * CP4 regression fixture for the CP2 finding "crashes alone can still reuse an epoch". In CP2 it
 * existed only as an inline test (naive-leader.test.ts); here the same weakness is rediscovered
 * by exploring CRASH/RECOVER-ONLY plans, so the stored discovery data is real.
 */
describe('exploring crash/recover-only plans against unique-leader-per-epoch', () => {
  const crashOnly: fc.Arbitrary<FaultSpec[]> = (() => {
    const at = fc.integer({ min: 0, max: 700 });
    const node = fc.constantFrom(...NODES);
    return fc.array(fc.oneof(fc.record({ at, type: fc.constant('crash' as const), node }), fc.record({ at, type: fc.constant('recover' as const), node })), { maxLength: 12 });
  })();
  const base = { ...fixtureBase('unique-leader-per-epoch'), config: { ...fixtureBase('unique-leader-per-epoch').config, seed: 0 } };
  const build = (faults: FaultSpec[]) => configFor(base, faults);
  const found = explore({ build, faults: crashOnly, invariantId: 'unique-leader-per-epoch', numRuns: 2000, seed: 424242 });

  it('finds an epoch reused without any network fault, minimised to a 1-minimal plan', () => {
    expect(found).not.toBeNull();
    expect(found!.faults.every((f) => f.type === 'crash' || f.type === 'recover')).toBe(true);
    expect(isOneMinimal(build, found!.faults, 'unique-leader-per-epoch')).toBe(true);
    expect(found!.violation.observed).toMatch(/^Epoch \d+ was led by n\d and later also by n\d$/);
  });

  it.runIf(UPDATE)('writes the counterexample fixture (only if missing)', () => {
    const { faults, violation, fingerprint, discovery } = found!;
    writeNewFixture('naive-leader.crash-only.unique-leader-per-epoch.json', {
      format: 'faultlab-counterexample/1',
      description: 'naive-leader: crashes alone reuse an epoch, no network fault (CP2 finding; stored as a fixture in CP4 after crash/recover-only exploration)',
      engineVersion: ENGINE_VERSION,
      ...base,
      config: { ...base.config, faults },
      discovery: { ...discovery, minimisedFaultCount: faults.length },
      expected: {
        reason: 'invariant-violation',
        violationTime: violation.time,
        nodes: [...violation.nodes],
        observed: violation.observed,
        eventNumber: violation.eventNumber,
        fingerprint,
      },
    });
  });
});
