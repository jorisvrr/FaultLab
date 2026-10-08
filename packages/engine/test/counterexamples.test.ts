import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveFaults } from '../src/faults';
import { createNaiveLeaderProtocol, naiveLeaderInvariants } from '../src/fixtures';
import { ENGINE_VERSION } from '../src/version';
import { configFor, type CounterexampleFixture } from './counterexample-format';
import { isOneMinimal, violationOf } from './explore';
import { fingerprintTrace } from '../src/trace';

/**
 * Stored counterexamples are permanent regression tests (ADR-0014). Each one must replay to the
 * exact same violation and trace fingerprint. Regenerate with:
 *   FAULTLAB_UPDATE_COUNTEREXAMPLES=1 npx vitest run test/exploration.test.ts
 */
const DIR = join(import.meta.dirname, 'counterexamples');
const fixtures = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => [name, JSON.parse(readFileSync(join(DIR, name), 'utf8')) as CounterexampleFixture] as const);

describe('stored counterexamples', () => {
  it('exist', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(2);
  });

  describe.each(fixtures)('%s', (_name, fixture) => {
    it('is in a known format and matches the engine, protocol and invariant versions (never silently re-interpreted)', () => {
      expect(fixture.format, 'unknown counterexample format').toBe('faultlab-counterexample/1');
      // Any version mismatch means semantics may have changed: re-verify and regenerate on purpose.
      expect(fixture.engineVersion, `fixture recorded with engine ${fixture.engineVersion}; current is ${ENGINE_VERSION}`).toBe(ENGINE_VERSION);
      const protocolVersion = createNaiveLeaderProtocol(fixture.protocol.options).version;
      expect(fixture.protocol.version, `fixture recorded with ${fixture.protocol.name}@${fixture.protocol.version}; current is @${protocolVersion}`).toBe(protocolVersion);
      const invariant = naiveLeaderInvariants.find((i) => i.id === fixture.invariant.id);
      expect(invariant?.version, `fixture recorded with invariant ${fixture.invariant.id}@${fixture.invariant.version}; current is @${invariant?.version}`).toBe(
        fixture.invariant.version,
      );
    });

    it('holds a valid fault plan', () => {
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

    it('is still 1-minimal', () => {
      expect(isOneMinimal((faults) => configFor(fixture, faults), fixture.config.faults, fixture.invariant.id)).toBe(true);
    });
  });
});
