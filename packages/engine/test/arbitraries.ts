import fc from 'fast-check';
import type { FaultSpec } from '../src/faults';
import { createHeartbeatProtocol } from '../src/fixtures';
import { config } from './helpers';

/**
 * Shared fast-check arbitraries and experiment builders. Kept in a plain module (not a *.test.ts
 * file): importing a test file from another test file would register its tests twice.
 */
export const NODES = ['n1', 'n2', 'n3', 'n4'];

/** Random fault plans. Crash/recover are weighted up so nodes actually flap. */
export const faultArb = (maxAt: number): fc.Arbitrary<FaultSpec> => {
  const at = fc.integer({ min: 0, max: maxAt });
  const node = fc.constantFrom(...NODES);
  const link = fc.tuple(node, node).filter(([from, to]) => from !== to);
  return fc.oneof(
    { weight: 3, arbitrary: fc.record({ at, type: fc.constant('crash' as const), node }) },
    { weight: 3, arbitrary: fc.record({ at, type: fc.constant('recover' as const), node }) },
    {
      weight: 2,
      arbitrary: fc.record({
        at,
        type: fc.constant('partition' as const),
        groups: fc.subarray(NODES, { minLength: 1, maxLength: NODES.length - 1 }).map((group) => [group]),
      }),
    },
    { weight: 1, arbitrary: fc.record({ at, type: fc.constant('heal' as const) }) },
    {
      weight: 2,
      arbitrary: fc
        .record({
          at,
          link,
          loss: fc.integer({ min: 0, max: 100 }).map((p) => p / 100),
          delay: fc.tuple(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 30 })).map(([min, extra]) => ({ min, max: min + extra })),
        })
        .map(({ at, link: [from, to], loss, delay }) => ({ at, type: 'link' as const, from, to, loss, delay })),
    },
    { weight: 1, arbitrary: fc.record({ at, link }).map(({ at, link: [from, to] }) => ({ at, type: 'link-restore' as const, from, to })) },
  );
};

/**
 * A crash followed by a recovery of the same node, possibly at the same tick (downFor = 0).
 * Without this, independently generated recoveries mostly hit running nodes and get skipped,
 * so incarnation edge cases would be under-tested.
 */
const outageArb = (maxAt: number): fc.Arbitrary<FaultSpec[]> =>
  fc
    .record({ at: fc.integer({ min: 0, max: maxAt }), node: fc.constantFrom(...NODES), downFor: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 120 })) })
    .map(({ at, node, downFor }) => [
      { at, type: 'crash', node },
      { at: at + downFor, type: 'recover', node },
    ]);

export const faultPlanArb = (maxAt: number): fc.Arbitrary<FaultSpec[]> =>
  fc
    .array(fc.oneof({ weight: 3, arbitrary: faultArb(maxAt).map((f) => [f]) }, { weight: 2, arbitrary: outageArb(maxAt) }), { maxLength: 20 })
    .map((groups) => groups.flat());

export const experiment = fc.record({
  seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
  faults: faultPlanArb(400),
  latencyMax: fc.integer({ min: 1, max: 25 }),
});

export const heartbeatConfig = ({ seed, faults, latencyMax }: { seed: number; faults: FaultSpec[]; latencyMax: number }) =>
  config(createHeartbeatProtocol({ interval: 20, jitter: 5, timeout: 60 }), {
    seed,
    nodes: NODES,
    faults,
    network: { latency: { min: 1, max: latencyMax } },
    limits: { maxTime: 500 },
  });

