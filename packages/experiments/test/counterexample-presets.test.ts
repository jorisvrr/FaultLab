import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, fingerprintTrace, LEGACY_TRACE_VERSIONS, projectTrace, runSimulation, type LegacyTraceVersion, type TraceEntry } from '@faultlab/engine';
import { describe, expect, it } from 'vitest';
import { COUNTEREXAMPLES, resolveExperiment } from '../src';

/**
 * The application must not import data from test fixture directories, so the counterexamples are
 * copied into this package as specs. These tests are allowed to read the fixtures, and prove the
 * copies are exact and still replay to the recorded outcome.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..');

describe.each(COUNTEREXAMPLES.map((c) => [c.id, c] as const))('%s', (_id, preset) => {
  const fixture = JSON.parse(readFileSync(join(ROOT, preset.source), 'utf8'));

  it('is an exact copy of its fixture (spec and expected outcome)', () => {
    expect(preset.format).toBe(fixture.format);
    expect(preset.spec).toMatchObject({
      seed: fixture.config.seed,
      nodes: fixture.config.nodes,
      protocol: { name: fixture.protocol.name, version: fixture.protocol.version, options: fixture.protocol.options },
      network: { latency: fixture.config.latency },
      limits: { maxTime: fixture.config.maxTime },
      faults: fixture.config.faults,
      invariants: [fixture.invariant],
    });
    expect(preset.expected).toEqual({
      engineVersion: fixture.engineVersion,
      reason: fixture.expected.reason,
      fingerprint: fixture.expected.fingerprint,
      violation: { invariantId: fixture.invariant.id, time: fixture.expected.violationTime, nodes: fixture.expected.nodes, observed: fixture.expected.observed, eventNumber: fixture.expected.eventNumber },
    });
  });

  it('replays through the registry to the recorded violation and fingerprint', () => {
    const { trace, reason } = runSimulation(resolveExperiment(preset.spec).config);
    const violation = trace.find((e): e is Extract<TraceEntry, { kind: 'invariant.violation' }> => e.kind === 'invariant.violation')!;
    const legacy = preset.expected.engineVersion !== ENGINE_VERSION;
    if (legacy) expect(LEGACY_TRACE_VERSIONS).toContain(preset.expected.engineVersion);
    const fingerprint = legacy ? fingerprintTrace(projectTrace(trace, preset.expected.engineVersion as LegacyTraceVersion) as never) : fingerprintTrace(trace);
    expect({ reason, time: violation.time, nodes: violation.nodes, observed: violation.observed, eventNumber: violation.eventNumber, fingerprint }).toEqual({
      reason: preset.expected.reason,
      time: preset.expected.violation.time,
      nodes: preset.expected.violation.nodes,
      observed: preset.expected.violation.observed,
      eventNumber: preset.expected.violation.eventNumber,
      fingerprint: preset.expected.fingerprint,
    });
  });
});

it('covers every stored fixture', () => {
  expect(COUNTEREXAMPLES).toHaveLength(13);
});
