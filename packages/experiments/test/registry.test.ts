import { fingerprintTrace, runSimulation, type TraceEntry } from '@faultlab/engine';
import { createNaiveLeaderProtocol, naiveLeaderInvariants } from '@faultlab/engine/fixtures';
import { describe, expect, it } from 'vitest';
import { EXPERIMENT_SPEC_FORMAT, findProtocol, INVARIANTS, LIVENESS, PRESETS, PROTOCOLS, resolveExperiment, specFingerprint, SpecError, type ExperimentSpec } from '../src';

const base: ExperimentSpec = {
  format: EXPERIMENT_SPEC_FORMAT,
  seed: 7,
  nodes: ['n1', 'n2', 'n3', 'n4'],
  protocol: { name: 'naive-leader', version: '1', options: {} },
  network: { latency: { min: 1, max: 10 } },
  limits: { maxTime: 600, maxEvents: 20_000 },
  invariants: naiveLeaderInvariants.map(({ id, version }) => ({ id, version })),
};

describe('registry', () => {
  it('registers every protocol under the name and version it reports itself', () => {
    for (const entry of PROTOCOLS) {
      const protocol = entry.create({});
      expect([protocol.name, protocol.version]).toEqual([entry.name, entry.version]);
    }
    expect(new Set(PROTOCOLS.map((p) => `${p.name}@${p.version}`)).size).toBe(PROTOCOLS.length);
  });

  it('labels test-only entries: broken variants and diagnostics are never plain protocols', () => {
    expect(PROTOCOLS.filter((p) => p.name.includes('/bug:')).every((p) => p.category === 'broken-variant')).toBe(true);
    expect(findProtocol('diagnostic-spin', '1')?.category).toBe('diagnostic');
  });

  it('registers invariants and liveness checks under unique (id, version)', () => {
    expect(new Set(INVARIANTS.map((e) => `${e.invariant.id}@${e.invariant.version}`)).size).toBe(INVARIANTS.length);
    expect(LIVENESS.map((e) => `${e.id}@${e.version}`)).toEqual(['raft-leader-elected@1']);
  });
});

describe('resolving a spec', () => {
  it('builds the same experiment as a hand-written config (identical trace)', () => {
    const fromSpec = runSimulation(resolveExperiment(base).config);
    const byHand = runSimulation({ seed: 7, nodes: ['n1', 'n2', 'n3', 'n4'], protocol: createNaiveLeaderProtocol() as never, network: { latency: { min: 1, max: 10 } }, limits: { maxTime: 600, maxEvents: 20_000 }, invariants: naiveLeaderInvariants });
    expect(fingerprintTrace(fromSpec.trace)).toBe(fingerprintTrace(byHand.trace));
  });

  it('survives JSON (the form in which it crosses the Worker boundary)', () => {
    const roundTrip = JSON.parse(JSON.stringify(base)) as unknown;
    expect(fingerprintTrace(runSimulation(resolveExperiment(roundTrip).config).trace)).toBe(fingerprintTrace(runSimulation(resolveExperiment(base).config).trace));
  });

  const reject: [string, unknown, string][] = [
    ['a non-object', 42, 'spec'],
    ['a function anywhere', { ...base, protocol: { ...base.protocol, options: { interval: () => 1 } } }, 'spec'],
    ['a wrong format', { ...base, format: 'faultlab-experiment/0' }, 'spec.format'],
    ['an unknown top-level field', { ...base, code: 'x' }, 'spec.code'],
    ['an unregistered protocol version', { ...base, protocol: { ...base.protocol, version: '2' } }, 'spec.protocol'],
    ['an unknown protocol option', { ...base, protocol: { ...base.protocol, options: { speed: 1 } } }, 'spec.protocol.options.speed'],
    ['an out-of-range protocol option', { ...base, protocol: { ...base.protocol, options: { interval: 0 } } }, 'spec.protocol.options.interval'],
    ['an unregistered invariant version', { ...base, invariants: [{ id: 'single-leader', version: '9' }] }, 'spec.invariants[0]'],
    ['an unregistered liveness check', { ...base, liveness: [{ id: 'nope', version: '1', params: {} }] }, 'spec.liveness[0]'],
    ['bad liveness params', { ...base, liveness: [{ id: 'raft-leader-elected', version: '1', params: { deadline: 'soon' } }] }, 'spec.liveness[0].params.deadline'],
    ['an invalid fault (engine validation)', { ...base, faults: [{ at: 10, type: 'crash', node: 'n9' }] }, 'spec.faults[0].node'],
    ['an invalid seed (engine validation)', { ...base, seed: -1 }, 'spec.seed'],
  ];
  it.each(reject)('rejects %s with its path', (_label, input, path) => {
    try {
      resolveExperiment(input);
      expect.fail('accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(SpecError);
      expect((error as SpecError).path).toBe(path);
    }
  });

  it('fingerprints specs independently of key order', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as ExperimentSpec;
    expect(specFingerprint(reordered)).toBe(specFingerprint(base));
    expect(specFingerprint({ ...base, seed: 8 })).not.toBe(specFingerprint(base));
  });
});

describe('presets', () => {
  const run = (id: string) => runSimulation(resolveExperiment(PRESETS.find((p) => p.id === id)!.spec).config);
  const violations = (trace: readonly TraceEntry[]) => trace.filter((e) => e.kind === 'invariant.violation');

  it('all resolve; ids are unique', () => {
    for (const preset of PRESETS) expect(() => resolveExperiment(preset.spec)).not.toThrow();
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it('behave as their summaries say', () => {
    expect(violations(run('naive-healthy').trace)).toEqual([]);
    expect(violations(run('naive-split-brain').trace)).toHaveLength(1);
    for (const id of ['raft-healthy', 'raft-isolate-leader', 'raft-split-2-2']) expect(violations(run(id).trace)).toEqual([]);
    const healthy = run('raft-healthy').trace;
    expect(healthy.find((e) => e.kind === 'state.update' && (e.state as { role: string }).role === 'leader')).toMatchObject({ node: 'n5', time: 202 });
    expect(run('diagnostic-echo-forever').reason).toBe('event-limit');
  });
});
