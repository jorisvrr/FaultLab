import { fingerprintTrace, runSimulation, type Protocol, type TraceEntry } from '@faultlab/engine';
import { PRESETS, resolveExperiment } from '@faultlab/experiments';
import { describe, expect, it } from 'vitest';
import { guardActive, guarded, NondeterminismError, withGuards } from '../src';

/** Determinism guards: active only inside simulation code, invisible to everything else. */
const misbehaving = (call: () => unknown): Protocol =>
  ({
    name: 'misbehaving',
    version: '1',
    init: (ctx: { setTimer(d: number, tag: string): void }) => (ctx.setTimer(10, 't'), { n: 0 }),
    onMessage: (s: unknown) => s,
    onTimer: (s: unknown) => (call(), s),
  }) as never;

const errorsOf = (call: () => unknown) => {
  const { trace, reason } = withGuards(() => runSimulation({ seed: 1, nodes: ['n1'], protocol: misbehaving(call) as never, network: { latency: { min: 1, max: 1 } } }));
  return { reason, errors: trace.filter((e): e is Extract<TraceEntry, { kind: 'protocol.error' }> => e.kind === 'protocol.error').map((e) => e.error) };
};

describe('determinism guard', () => {
  it.each([
    ['Math.random', () => Math.random()],
    ['Date.now', () => Date.now()],
    ['Date', () => new Date()],
    ['performance.now', () => performance.now()],
    ['setTimeout', () => setTimeout(() => {}, 1)],
    ['setInterval', () => setInterval(() => {}, 1)],
    ['queueMicrotask', () => queueMicrotask(() => {})],
    ['crypto.getRandomValues', () => crypto.getRandomValues(new Uint8Array(1))],
    ['crypto.randomUUID', () => crypto.randomUUID()],
  ])('turns %s inside a handler into a reproducible protocol.error', (label, call) => {
    const first = errorsOf(call);
    expect(first.reason).toBe('protocol-error');
    expect(first.errors).toEqual([`NondeterminismError: ${label} is not available inside a simulation step (FaultLab determinism guard)`]);
    expect(errorsOf(call)).toEqual(first); // same outcome every run
  });

  it('restores everything after each call, so the rest of the program is unaffected', () => {
    const before = [Math.random, Date, setTimeout, setInterval, queueMicrotask, performance.now, crypto.getRandomValues];
    expect(() => guarded(() => Math.random())()).toThrow(NondeterminismError);
    expect([Math.random, Date, setTimeout, setInterval, queueMicrotask, performance.now, crypto.getRandomValues]).toEqual(before);
    expect(typeof Math.random()).toBe('number');
    expect(Object.getOwnPropertyDescriptor(performance, 'now')).toBeUndefined(); // the shadow was removed again
    expect(guardActive()).toBe(false);
  });

  it('nests (an invariant inside a handler) and restores only at the outermost exit', () => {
    const inner = guarded(() => guardActive());
    const outer = guarded(() => [inner(), guardActive()]);
    expect(outer()).toEqual([true, true]);
    expect(guardActive()).toBe(false);
  });

  it('does not change any trace: guarded and unguarded presets are byte-identical', () => {
    for (const preset of PRESETS.filter((p) => p.category !== 'diagnostic' && p.id !== 'raft-long-heartbeats' && p.id !== 'raft-leader-churn')) {
      const config = resolveExperiment(preset.spec).config;
      expect(fingerprintTrace(withGuards(() => runSimulation(config)).trace), preset.id).toBe(fingerprintTrace(runSimulation(config).trace));
    }
  });

  it('is installed once per execution slice in the Worker: the clock it measures with keeps working', () => {
    const before = performance.now();
    const insideSlice = withGuards(() => {
      expect(() => performance.now()).toThrow(NondeterminismError); // protocol code is blocked …
      return true;
    });
    expect(insideSlice).toBe(true);
    expect(performance.now()).toBeGreaterThanOrEqual(before); // … the Worker's own timing is not, outside the slice
  });
});
