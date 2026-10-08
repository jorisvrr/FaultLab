import type { SimulationConfig } from '../src/config';
import type { FaultSpec } from '../src/faults';
import { createNaiveLeaderProtocol, naiveLeaderInvariants, type NaiveLeaderOptions } from '../src/fixtures';
import type { Invariant } from '../src/invariants';
import type { NodeId } from '../src/protocol';

/**
 * Stored counterexample fixture, format `faultlab-counterexample/1` (ADR-0014). Plain JSON:
 * everything needed to rebuild the experiment and check the exact outcome on replay.
 */
export interface CounterexampleFixture {
  readonly format: 'faultlab-counterexample/1';
  readonly description: string;
  readonly engineVersion: string;
  readonly protocol: { readonly name: 'naive-leader'; readonly version: string; readonly options: NaiveLeaderOptions };
  readonly invariant: { readonly id: string; readonly version: string };
  readonly config: {
    readonly seed: number;
    readonly nodes: NodeId[];
    readonly latency: { readonly min: number; readonly max: number };
    readonly maxTime: number;
    readonly faults: FaultSpec[];
  };
  readonly discovery: {
    readonly fastCheckSeed: number;
    readonly runsUntilFailure: number;
    readonly originalFaultCount: number;
    readonly shrinkSteps: number;
    readonly removedByMinimiser: number;
    readonly minimisedFaultCount: number;
  };
  readonly expected: {
    readonly reason: 'invariant-violation';
    readonly violationTime: number;
    readonly nodes: NodeId[];
    readonly observed: string;
    readonly eventNumber: number;
    readonly fingerprint: string;
  };
}

export const LEADER_OPTIONS: NaiveLeaderOptions = { interval: 20, jitter: 5, timeout: 60 };

/** Rebuild the simulation config a fixture describes, checking only its own invariant. */
export function configFor(fixture: Pick<CounterexampleFixture, 'protocol' | 'invariant' | 'config'>, faults = fixture.config.faults): SimulationConfig {
  if (fixture.protocol.name !== 'naive-leader') throw new Error(`unknown protocol ${fixture.protocol.name}`);
  const invariant = naiveLeaderInvariants.find((i) => i.id === fixture.invariant.id) as Invariant | undefined;
  if (invariant === undefined) throw new Error(`unknown invariant ${fixture.invariant.id}`);
  return {
    seed: fixture.config.seed,
    nodes: fixture.config.nodes,
    protocol: createNaiveLeaderProtocol(fixture.protocol.options) as never,
    network: { latency: fixture.config.latency },
    limits: { maxTime: fixture.config.maxTime },
    faults,
    invariants: [invariant],
  };
}
