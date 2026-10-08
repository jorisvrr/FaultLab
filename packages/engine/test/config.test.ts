import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, MAX_NODES, resolveConfig, type SimulationConfig } from '../src/config';
import { ConfigError } from '../src/errors';
import { createPingProtocol } from '../src/fixtures';

const valid = (): SimulationConfig => ({
  seed: 1,
  nodes: ['n1', 'n2', 'n3'],
  protocol: createPingProtocol() as unknown as SimulationConfig['protocol'],
  network: { latency: { min: 1, max: 10 } },
});

/** Replace one path of a valid config with a bad value (simulates untrusted input). */
const withField = (patch: (config: Record<string, unknown>) => void): SimulationConfig => {
  const config = structuredClone({ ...valid(), protocol: undefined }) as Record<string, unknown>;
  config['protocol'] = valid().protocol;
  patch(config);
  return config as unknown as SimulationConfig;
};

describe('resolveConfig', () => {
  it('accepts a valid config, applies default limits, and freezes the result', () => {
    const resolved = resolveConfig(valid());
    expect(resolved.limits).toEqual(DEFAULT_LIMITS);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.nodes)).toBe(true);
  });

  it('copies the node list so later mutation of the input has no effect', () => {
    const input = { ...valid(), nodes: ['a', 'b'] };
    const resolved = resolveConfig(input);
    input.nodes.push('c');
    expect(resolved.nodes).toEqual(['a', 'b']);
  });

  it('merges partial limits and ignores undefined fields', () => {
    const resolved = resolveConfig({ ...valid(), limits: { maxEvents: 5, maxTime: undefined } as never });
    expect(resolved.limits).toEqual({ ...DEFAULT_LIMITS, maxEvents: 5 });
  });

  it.each<[string, (c: Record<string, unknown>) => void]>([
    ['seed', (c) => (c['seed'] = -1)],
    ['seed', (c) => (c['seed'] = 2 ** 32)],
    ['seed', (c) => (c['seed'] = 1.5)],
    ['seed', (c) => (c['seed'] = '1')],
    ['nodes', (c) => (c['nodes'] = [])],
    ['nodes', (c) => (c['nodes'] = 'n1')],
    ['nodes', (c) => (c['nodes'] = Array.from({ length: MAX_NODES + 1 }, (_, i) => `n${i}`))],
    ['nodes[1]', (c) => (c['nodes'] = ['n1', 'n1'])],
    ['nodes[0]', (c) => (c['nodes'] = ['has:colon'])],
    ['nodes[0]', (c) => (c['nodes'] = [''])],
    ['nodes[0]', (c) => (c['nodes'] = [42])],
    ['protocol', (c) => (c['protocol'] = null)],
    ['protocol.name', (c) => (c['protocol'] = { ...(c['protocol'] as object), name: '' })],
    ['protocol.onTimer', (c) => (c['protocol'] = { ...(c['protocol'] as object), onTimer: 'nope' })],
    ['network', (c) => (c['network'] = undefined)],
    ['network.latency.min', (c) => (c['network'] = { latency: { min: -1, max: 5 } })],
    ['network.latency.max', (c) => (c['network'] = { latency: { min: 5, max: 4 } })],
    ['network.latency.max', (c) => (c['network'] = { latency: { min: 0, max: 2 ** 31 + 1 } })],
    ['limits.maxEvents', (c) => (c['limits'] = { maxEvents: 0 })],
    ['limits.maxPendingEvents', (c) => (c['limits'] = { maxPendingEvents: 1.5 })],
    ['limits.maxTime', (c) => (c['limits'] = { maxTime: -5 })],
    ['limits', (c) => (c['limits'] = [])],
  ])('rejects an invalid %s with a ConfigError naming the path', (path, patch) => {
    let caught: unknown;
    try {
      resolveConfig(withField(patch));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).path).toBe(path);
  });

  it('rejects a non-object config', () => {
    expect(() => resolveConfig(null as never)).toThrow(ConfigError);
  });
});
