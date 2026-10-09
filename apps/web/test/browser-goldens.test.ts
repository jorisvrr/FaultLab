import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprintTrace, runSimulation } from '@faultlab/engine';
import { COUNTEREXAMPLES, EXPERIMENT_SPEC_FORMAT, PRESETS, resolveExperiment, type ExperimentSpec } from '@faultlab/experiments';
import { describe, expect, it } from 'vitest';

/**
 * Reference fingerprints for the cross-browser determinism tests (e2e/determinism.spec.ts),
 * computed HERE in Node. The browsers must reproduce every one of them through a real Worker.
 * Written only if missing (FAULTLAB_UPDATE_BROWSER_GOLDENS=1); otherwise compared exactly.
 */
const FILE = join(import.meta.dirname, '..', 'e2e', 'expected-fingerprints.json');

/** The engine's own golden reference experiments, as specs (packages/engine/test/determinism + faults.property). */
const ENGINE_GOLDENS: { id: string; spec: ExperimentSpec; engineGolden: string }[] = [
  {
    id: 'engine-golden-cp0-ping',
    engineGolden: '7fda34b3',
    spec: { format: EXPERIMENT_SPEC_FORMAT, seed: 42, nodes: ['n1', 'n2', 'n3'], protocol: { name: 'ping', version: '1', options: { rounds: 3, interval: 40, jitter: 25 } }, network: { latency: { min: 1, max: 30 } } },
  },
  {
    id: 'engine-golden-cp1-faults',
    engineGolden: '6a1dfe65',
    spec: {
      format: EXPERIMENT_SPEC_FORMAT,
      seed: 2026,
      nodes: ['n1', 'n2', 'n3', 'n4'],
      protocol: { name: 'heartbeat', version: '1', options: { interval: 20, jitter: 5, timeout: 60 } },
      network: { latency: { min: 1, max: 15 } },
      limits: { maxTime: 500 },
      faults: [
        { at: 50, type: 'link', from: 'n3', to: 'n4', loss: 0.3, delay: { min: 10, max: 40 } },
        { at: 100, type: 'crash', node: 'n2' },
        { at: 150, type: 'partition', groups: [['n1']] },
        { at: 220, type: 'recover', node: 'n2' },
        { at: 300, type: 'heal' },
        { at: 350, type: 'link-restore', from: 'n3', to: 'n4' },
        { at: 400, type: 'crash', node: 'n2' },
        { at: 400, type: 'recover', node: 'n2' },
      ],
    },
  },
];

const experiments = [
  ...ENGINE_GOLDENS.map(({ id, spec }) => ({ id, spec })),
  ...PRESETS.filter((p) => p.category !== 'diagnostic').map(({ id, spec }) => ({ id, spec })),
  ...COUNTEREXAMPLES.map(({ id, spec }) => ({ id, spec })),
];
const computed = experiments.map(({ id, spec }) => {
  const { trace, reason } = runSimulation(resolveExperiment(spec).config);
  return { id, spec, reason, entries: trace.length, fingerprint: fingerprintTrace(trace) };
});

describe('browser determinism references', () => {
  it('include the engine goldens exactly (anchored to packages/engine/test)', () => {
    for (const g of ENGINE_GOLDENS) expect(computed.find((c) => c.id === g.id)?.fingerprint, g.id).toBe(g.engineGolden);
  });

  it('match the pinned file the browser tests read', () => {
    if (process.env['FAULTLAB_UPDATE_BROWSER_GOLDENS'] === '1' && !existsSync(FILE)) writeFileSync(FILE, `${JSON.stringify(computed, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(computed)));
  });
});
