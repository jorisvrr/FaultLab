import { describe, expect, it } from 'vitest';
import { resolveConfig, type SimulationConfig } from '../src/config';
import { ConfigError } from '../src/errors';
import { MAX_FAULT_TIME, MAX_FAULTS, resolveFaults } from '../src/faults';
import { createPingProtocol } from '../src/fixtures';
import { runSimulation } from '../src/simulation';
import { config, ofKind } from './helpers';

const NODES = ['n1', 'n2', 'n3'];

const pathOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.path;
    throw error;
  }
  return undefined;
};

describe('fault plan validation', () => {
  it.each<[string, unknown, string]>([
    ['not an array', { at: 1, type: 'heal' }, 'faults'],
    ['a non-object fault', [null], 'faults[0]'],
    ['a missing time', [{ type: 'heal' }], 'faults[0].at'],
    ['a negative time', [{ at: -1, type: 'heal' }], 'faults[0].at'],
    ['a fractional time', [{ at: 1.5, type: 'heal' }], 'faults[0].at'],
    ['a time beyond the safe range', [{ at: MAX_FAULT_TIME + 1, type: 'heal' }], 'faults[0].at'],
    ['an unknown type', [{ at: 1, type: 'explode' }], 'faults[0].type'],
    ['a crash of an unknown node', [{ at: 1, type: 'crash', node: 'n9' }], 'faults[0].node'],
    ['a crash without a node', [{ at: 1, type: 'crash' }], 'faults[0].node'],
    ['a crash with a misspelled field', [{ at: 1, type: 'crash', nodes: 'n1' }], 'faults[0].nodes'],
    ['a recover of an unknown node', [{ at: 1, type: 'recover', node: 7 }], 'faults[0].node'],
    ['a heal with extra fields', [{ at: 1, type: 'heal', groups: [] }], 'faults[0].groups'],
    ['a partition without groups', [{ at: 1, type: 'partition' }], 'faults[0].groups'],
    ['a partition with no groups', [{ at: 1, type: 'partition', groups: [] }], 'faults[0].groups'],
    ['a partition with an empty group', [{ at: 1, type: 'partition', groups: [[]] }], 'faults[0].groups[0]'],
    ['a partition group that is not an array', [{ at: 1, type: 'partition', groups: ['n1'] }], 'faults[0].groups[0]'],
    ['a partition with an unknown node', [{ at: 1, type: 'partition', groups: [['n1', 'x']] }], 'faults[0].groups[0][1]'],
    ['a node in two groups', [{ at: 1, type: 'partition', groups: [['n1'], ['n1', 'n2']] }], 'faults[0].groups[1][0]'],
    ['a node twice in one group', [{ at: 1, type: 'partition', groups: [['n1', 'n1']] }], 'faults[0].groups[0][1]'],
    ['a partition that separates nothing', [{ at: 1, type: 'partition', groups: [NODES] }], 'faults[0].groups'],
    ['a link from a node to itself', [{ at: 1, type: 'link', from: 'n1', to: 'n1', loss: 1 }], 'faults[0].to'],
    ['a link from an unknown node', [{ at: 1, type: 'link', from: 'x', to: 'n1', loss: 1 }], 'faults[0].from'],
    ['a link without a destination', [{ at: 1, type: 'link', from: 'n1', loss: 1 }], 'faults[0].to'],
    ['a link with neither loss nor delay', [{ at: 1, type: 'link', from: 'n1', to: 'n2' }], 'faults[0]'],
    ['a loss above 1', [{ at: 1, type: 'link', from: 'n1', to: 'n2', loss: 1.01 }], 'faults[0].loss'],
    ['a negative loss', [{ at: 1, type: 'link', from: 'n1', to: 'n2', loss: -0.1 }], 'faults[0].loss'],
    ['a NaN loss', [{ at: 1, type: 'link', from: 'n1', to: 'n2', loss: Number.NaN }], 'faults[0].loss'],
    ['a string loss', [{ at: 1, type: 'link', from: 'n1', to: 'n2', loss: '0.5' }], 'faults[0].loss'],
    ['a delay with min > max', [{ at: 1, type: 'link', from: 'n1', to: 'n2', delay: { min: 5, max: 4 } }], 'faults[0].delay.max'],
    ['a negative delay', [{ at: 1, type: 'link', from: 'n1', to: 'n2', delay: { min: -1, max: 4 } }], 'faults[0].delay.min'],
    ['a fractional delay', [{ at: 1, type: 'link', from: 'n1', to: 'n2', delay: { min: 0, max: 2.5 } }], 'faults[0].delay.max'],
    ['a delay that is not an object', [{ at: 1, type: 'link', from: 'n1', to: 'n2', delay: 10 }], 'faults[0].delay'],
    ['a delay with an unknown field', [{ at: 1, type: 'link', from: 'n1', to: 'n2', delay: { min: 1, max: 2, avg: 1 } }], 'faults[0].delay.avg'],
    ['a link-restore from a node to itself', [{ at: 1, type: 'link-restore', from: 'n2', to: 'n2' }], 'faults[0].to'],
    ['a link-restore with extra fields', [{ at: 1, type: 'link-restore', from: 'n1', to: 'n2', loss: 0 }], 'faults[0].loss'],
    ['an error in a later fault', [{ at: 1, type: 'heal' }, { at: 2, type: 'crash', node: 'zz' }], 'faults[1].node'],
  ])('rejects %s', (_label, faults, path) => {
    expect(pathOf(() => resolveFaults(faults, NODES))).toBe(path);
  });

  it(`rejects more than ${MAX_FAULTS} faults`, () => {
    const faults = Array.from({ length: MAX_FAULTS + 1 }, (_, i) => ({ at: i, type: 'heal' }));
    expect(pathOf(() => resolveFaults(faults, NODES))).toBe('faults');
  });

  it('rejects a plan that would overflow maxPendingEvents before the first step', () => {
    const faults = Array.from({ length: 8 }, (_, i) => ({ at: i, type: 'heal' as const }));
    expect(pathOf(() => resolveConfig({ ...config(createPingProtocol()), faults, limits: { maxPendingEvents: 10 } }))).toBe('faults');
    expect(pathOf(() => resolveConfig({ ...config(createPingProtocol()), faults, limits: { maxPendingEvents: 11 } }))).toBeUndefined();
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['a misspelled top-level field', { fault: [] }, 'config.fault'],
    ['an unknown network field', { network: { latency: { min: 1, max: 1 }, loss: 0.1 } }, 'network.loss'],
    ['an unknown latency field', { network: { latency: { min: 1, max: 1, mean: 1 } } }, 'network.latency.mean'],
    ['an unknown limit', { limits: { maxSteps: 5 } }, 'limits.maxSteps'],
  ])('rejects %s in the config', (_label, patch, path) => {
    expect(pathOf(() => resolveConfig({ ...config(createPingProtocol()), ...patch } as SimulationConfig))).toBe(path);
  });
});

describe('fault plan normalisation', () => {
  const faults = resolveFaults(
    [
      { at: 5, type: 'link', from: 'n2', to: 'n1', loss: 0.5 },
      { at: 6, type: 'link', from: 'n1', to: 'n3', delay: { min: 1, max: 3 } },
      { at: 7, type: 'partition', groups: [['n3', 'n1']] },
    ],
    NODES,
  );

  it('assigns ids in plan order and fills link defaults', () => {
    expect(faults).toEqual([
      { id: 'f1', at: 5, type: 'link', from: 'n2', to: 'n1', loss: 0.5, delay: { min: 0, max: 0 } },
      { id: 'f2', at: 6, type: 'link', from: 'n1', to: 'n3', loss: 0, delay: { min: 1, max: 3 } },
      { id: 'f3', at: 7, type: 'partition', groups: [['n1', 'n3'], ['n2']] },
    ]);
  });

  it('returns deeply frozen data and records it verbatim in run.start', () => {
    expect(Object.isFrozen(faults)).toBe(true);
    expect(Object.isFrozen(faults[2])).toBe(true);
    const result = runSimulation(config(createPingProtocol(), { faults: [{ at: 1, type: 'crash', node: 'n2' }] }));
    expect(ofKind(result.trace, 'run.start')[0]).toMatchObject({
      persistence: 'sync-on-commit',
      faults: [{ id: 'f1', at: 1, type: 'crash', node: 'n2' }],
    });
  });

  it('treats a missing plan as empty', () => {
    expect(resolveFaults(undefined, NODES)).toEqual([]);
  });
});
