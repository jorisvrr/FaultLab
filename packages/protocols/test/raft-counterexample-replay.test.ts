import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, fingerprintTrace, resolveFaults, runSimulation, Simulation } from '@faultlab/engine';
import { describe, expect, it } from 'vitest';
import { createBrokenRaftElection, createRaftElection, raftInvariants } from '../src';
import { configFor, DIR, isOneMinimal, violationOf, type RaftCounterexampleFixture } from './raft-counterexamples';

/**
 * Stored Raft counterexamples (format faultlab-counterexample/2) are permanent regression tests.
 * They are never rewritten: a fixture from an older engine would have to be replayed through a
 * documented legacy projection (none exists yet for 0.4.0-cp4, the version they were recorded with).
 */
const fixtures = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => [name, JSON.parse(readFileSync(join(DIR, name), 'utf8')) as RaftCounterexampleFixture] as const);

describe('stored Raft counterexamples', () => {
  it('exist for every deliberately broken variant', () => {
    expect(new Set(fixtures.map(([, f]) => f.protocol.variant))).toEqual(new Set(['volatile-voted-for', 'volatile-term', 'double-vote', 'ceil-half-majority', 'no-step-down', 'ignore-higher-term']));
  });

  describe.each(fixtures)('%s', (_name, fixture) => {
    it('is in a known format and matches the engine, protocol and invariant versions', () => {
      expect(fixture.format).toBe('faultlab-counterexample/2');
      expect(fixture.engineVersion, 'no legacy projection exists for this engine version').toBe(ENGINE_VERSION);
      const protocol = fixture.protocol.variant === null ? createRaftElection(fixture.protocol.options) : createBrokenRaftElection(fixture.protocol.variant, fixture.protocol.options);
      expect(fixture.protocol).toMatchObject({ name: protocol.name, version: protocol.version });
      expect(raftInvariants.find((i) => i.id === fixture.invariant.id)?.version).toBe(fixture.invariant.version);
      expect(() => resolveFaults(fixture.config.faults, fixture.config.nodes)).not.toThrow();
    });

    it('replays to the exact recorded violation and trace fingerprint', () => {
      const found = violationOf(configFor(fixture), fixture.invariant.id);
      expect(found).not.toBeNull();
      const { violation, result } = found!;
      expect({
        reason: result.reason,
        violationTime: violation.time,
        nodes: violation.nodes,
        observed: violation.observed,
        eventNumber: violation.eventNumber,
        fingerprint: fingerprintTrace(result.trace),
      }).toEqual(fixture.expected);
    });

    it('replays identically after a snapshot taken mid-run (restored without the trace prefix)', () => {
      const config = configFor(fixture);
      const reference = runSimulation(config);
      const sim = new Simulation(config);
      while (sim.stopReason === null && sim.stepsCompleted < Math.floor(reference.eventsProcessed / 2)) sim.step();
      const restored = Simulation.restore(config, JSON.parse(JSON.stringify(sim.snapshot())));
      restored.run();
      expect(restored.trace).toEqual(reference.trace.slice(restored.traceStart));
    });

    it('is still 1-minimal', () => {
      expect(isOneMinimal(fixture, fixture.config.faults)).toBe(true);
    });

    it('the CORRECT protocol violates no Raft invariant under the same experiment (as recorded)', () => {
      const correct = runSimulation(configFor(fixture, fixture.config.faults, null));
      expect({
        reason: correct.reason,
        violations: correct.trace.filter((e) => e.kind === 'invariant.violation').length,
        fingerprint: fingerprintTrace(correct.trace),
      }).toEqual(fixture.correctProtocol);
      expect(fixture.correctProtocol.violations).toBe(0);
    });
  });
});
