import { canonicalJson, DEFAULT_LIMITS, fingerprintTrace, runSimulation } from '@faultlab/engine';
import { PRESETS, resolveExperiment, specFingerprint } from '@faultlab/experiments';
import { describe, expect, it } from 'vitest';
import { clampNodeCount, draftFromSpec, effectiveSpec, faultWarnings, nodeIds, signature, validate, withNodeCount, withProtocol, type Draft } from '../src/features/configure/draft';

/**
 * The Configure form's model. These tests exist because the thing that must never go wrong here
 * is the gap between what the screen says and what the Worker runs.
 */
const reference = PRESETS.find((p) => p.id === 'configure-reference')!;
const base = (): Draft => draftFromSpec(reference.spec);

describe('draft → effective spec', () => {
  it('reproduces the reference preset exactly, including its fingerprint', () => {
    const spec = effectiveSpec(base());
    expect(spec).toEqual(reference.spec);
    // Not just structurally equal: it runs to the same trace.
    expect(fingerprintTrace(runSimulation(resolveExperiment(spec).config).trace)).toBe('6dfb02d2');
  });

  it('is canonical: the same configuration always serialises identically', () => {
    const a = base();
    // Reaching the same state by a different route must not change the spec or its signature.
    const b = withProtocol(withProtocol(a, 'raft-election'), 'naive-leader');
    const c: Draft = { ...a, invariants: [...a.invariants].reverse(), faults: [...a.faults].reverse() };
    expect(JSON.stringify(effectiveSpec(c))).toBe(JSON.stringify(effectiveSpec(a)));
    expect(specFingerprint(effectiveSpec(c))).toBe(specFingerprint(effectiveSpec(a)));
    expect(effectiveSpec(b).protocol).toEqual(effectiveSpec(a).protocol);
  });

  it('every spec it produces is accepted by the engine', () => {
    for (const preset of PRESETS) {
      const spec = effectiveSpec(draftFromSpec(preset.spec));
      expect(() => resolveExperiment(spec), preset.id).not.toThrow();
    }
  });

  /**
   * The property the whole screen rests on: loading an experiment and pressing Run must execute
   * THAT experiment. Structural equality is the wrong test — the form always has a value in every
   * field, so a spec that omits `limits.maxEvents` comes back with the engine's own default
   * written out, and one that omits `invariantPolicy` comes back with `stop-on-first` spelled in.
   * What must hold is that the engine resolves both to the same configuration, and that they run
   * to the same trace.
   *
   * This test is here because it caught a real defect: the draft defaulted a missing event limit
   * to 20 000 while the engine's default is 100 000, so opening any preset that omitted it (every
   * Raft preset) silently imposed a five-times stricter limit and truncated the run. The round
   * trip also used to drop `protocol.options`, which quietly reconfigured the heartbeat protocol.
   */
  it('round-trips every preset: the engine resolves it to the same configuration', () => {
    for (const preset of PRESETS) {
      // `diagnostic-spin` runs with no time limit at all. The form's "Max virtual time" field
      // always holds a number, so an unbounded spec cannot round-trip through it; the diagnostic
      // presets are not offered in Configure for exactly that reason (see Known limitations).
      if (preset.category === 'diagnostic') continue;
      const rebuilt = effectiveSpec(draftFromSpec(preset.spec));
      // The form always holds a value in every field, so a spec that leaves a default implicit
      // comes back with that same default written out. Both sides are therefore settled with the
      // engine's OWN defaults before comparing — not ignored, so a real difference still fails.
      const settled = (spec: typeof preset.spec) => {
        const config = resolveExperiment(spec).config as unknown as Record<string, unknown>;
        const limits = (config['limits'] ?? {}) as Record<string, unknown>;
        return canonicalJson({
          ...config,
          invariantPolicy: config['invariantPolicy'] ?? 'stop-on-first',
          limits: { ...limits, maxEvents: limits['maxEvents'] ?? DEFAULT_LIMITS.maxEvents, maxTime: limits['maxTime'] ?? DEFAULT_LIMITS.maxTime },
        } as never);
      };
      expect(settled(rebuilt), preset.id).toBe(settled(preset.spec));
      // Nothing about the protocol's own configuration may be lost on the way through the form.
      expect(rebuilt.protocol, preset.id).toEqual(preset.spec.protocol);
    }
  });

  it('round-trips every preset: it runs to the same trace', () => {
    for (const preset of PRESETS) {
      // The unbounded diagnostic spins to its event limit; it is not offered in Configure.
      if (preset.category === 'diagnostic') continue;
      const rebuilt = effectiveSpec(draftFromSpec(preset.spec));
      const expected = fingerprintTrace(runSimulation(resolveExperiment(preset.spec).config).trace);
      expect(fingerprintTrace(runSimulation(resolveExperiment(rebuilt).config).trace), preset.id).toBe(expected);
    }
  }, 120_000);
});

describe('the signature only identifies a runnable experiment', () => {
  it('gives a fingerprint while the effective spec validates', () => {
    const sig = signature(base(), '0.4.0-cp4');
    expect(sig.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(validate(base()).ok).toBe(true);
  });

  it('withholds the fingerprint when the draft is invalid, rather than hashing something unrunnable', () => {
    const broken: Draft = { ...base(), maxEvents: 0 };
    expect(validate(broken).ok, 'the engine must reject this').toBe(false);
    expect(signature(broken, '0.4.0-cp4').fingerprint).toBeNull();
    // The other facts are still true of the draft, so they are still shown.
    expect(signature(broken, '0.4.0-cp4').seed).toBe(base().seed);
  });

  it('withholds it for a protocol-level error too, not only a malformed field', () => {
    const tooFew: Draft = { ...withProtocol(base(), 'raft-election'), nodeCount: 2 };
    expect(validate(tooFew).ok).toBe(false);
    expect(signature(tooFew, '0.4.0-cp4').fingerprint).toBeNull();
  });

  it('comes back, unchanged, as soon as the configuration is valid again', () => {
    const good = base();
    const before = signature(good, '0.4.0-cp4').fingerprint;
    const broken: Draft = { ...good, maxEvents: 0 };
    expect(signature(broken, '0.4.0-cp4').fingerprint).toBeNull();
    // Deterministic hashing is untouched: the same configuration hashes the same as before.
    expect(signature({ ...broken, maxEvents: good.maxEvents }, '0.4.0-cp4').fingerprint).toBe(before);
  });
});

describe('draft versus effective: disabling faults', () => {
  it('keeps the plan in the draft but removes it from what the engine runs', () => {
    const on = base();
    const off: Draft = { ...on, faultsEnabled: false };
    expect(off.faults, 'the draft must not lose the schedule').toHaveLength(4);
    expect(effectiveSpec(off).faults, 'the effective spec must not contain it').toBeUndefined();
    expect(effectiveSpec(on).faults).toHaveLength(4);
  });

  it('re-enabling restores exactly the same schedule and the same signature', () => {
    const on = base();
    const off: Draft = { ...on, faultsEnabled: false };
    const again: Draft = { ...off, faultsEnabled: true };
    expect(again.faults).toEqual(on.faults);
    expect(signature(again, '0.4.0-cp4')).toEqual(signature(on, '0.4.0-cp4'));
  });

  it('changes the signature, because it changes what will execute', () => {
    const on = base();
    const off: Draft = { ...on, faultsEnabled: false };
    expect(signature(off, '0.4.0-cp4').fingerprint).not.toBe(signature(on, '0.4.0-cp4').fingerprint);
    // And the two really do run differently.
    const fpOn = fingerprintTrace(runSimulation(resolveExperiment(effectiveSpec(on)).config).trace);
    const fpOff = fingerprintTrace(runSimulation(resolveExperiment(effectiveSpec(off)).config).trace);
    expect(fpOn).not.toBe(fpOff);
  });
});

describe('the signature tracks everything that can change execution', () => {
  const fp = (d: Draft) => signature(d, '0.4.0-cp4').fingerprint;

  it('changes for every execution-relevant edit', () => {
    const a = base();
    const edits: [string, Draft][] = [
      ['seed', { ...a, seed: a.seed + 1 }],
      ['node count', withNodeCount(a, 5)],
      ['latency', { ...a, latency: { min: 2, max: 10 } }],
      ['time limit', { ...a, maxTime: a.maxTime + 1 }],
      ['event limit', { ...a, maxEvents: a.maxEvents + 1 }],
      ['invariant selection', { ...a, invariants: a.invariants.slice(1) }],
      ['invariant policy', { ...a, invariantPolicy: 'stop-on-first' }],
      ['fault schedule', { ...a, faults: [...a.faults, { at: 950, type: 'crash', node: 'n1' }] }],
      ['faults disabled', { ...a, faultsEnabled: false }],
      ['protocol', withProtocol(a, 'raft-election')],
    ];
    for (const [what, edited] of edits) expect(fp(edited), `${what} must change the signature`).not.toBe(fp(a));
  });

  it('does not change for an edit the engine never sees', () => {
    const a = base();
    // Fault order in the draft is presentation only; the effective spec is sorted by time.
    expect(fp({ ...a, faults: [...a.faults].reverse() })).toBe(fp(a));
  });
});

describe('protocol and node count changes', () => {
  it('replaces the invariant selection with the new protocol’s own checks', () => {
    const raft = withProtocol(base(), 'raft-election');
    expect(raft.invariants).toEqual(['raft-election-safety', 'raft-term-monotonic', 'raft-one-vote-per-term', 'raft-leader-has-quorum', 'raft-term-adoption']);
    expect(effectiveSpec(raft).invariants?.map((i) => i.id)).toEqual(raft.invariants);
  });

  it('never submits an invariant the protocol does not register', () => {
    const heartbeat = withProtocol(base(), 'heartbeat');
    expect(heartbeat.invariants).toEqual([]);
    expect(effectiveSpec(heartbeat).invariants).toBeUndefined();
    // Even if stale ids survive in the draft, they are filtered out of the effective spec.
    const stale: Draft = { ...heartbeat, invariants: ['single-leader'] };
    expect(effectiveSpec(stale).invariants).toBeUndefined();
    expect(() => resolveExperiment(effectiveSpec(stale))).not.toThrow();
  });

  it('adds liveness only for Raft, and removes it again', () => {
    const raft = withProtocol(base(), 'raft-election');
    expect(effectiveSpec(raft).liveness).toHaveLength(1);
    expect(effectiveSpec(withProtocol(raft, 'naive-leader')).liveness).toBeUndefined();
  });

  it('raises the node count to the protocol’s minimum', () => {
    const small = withNodeCount(base(), 2);
    expect(small.nodeCount).toBe(2);
    expect(withProtocol(small, 'raft-election').nodeCount).toBe(3);
    expect(clampNodeCount('raft-election', 2)).toBe(3);
  });

  it('drops faults that would name a node that no longer exists', () => {
    const five = withNodeCount(base(), 5);
    const withN5: Draft = { ...five, faults: [...five.faults, { at: 700, type: 'crash', node: 'n5' }] };
    expect(withN5.faults).toHaveLength(5);
    // Down to three nodes: the crash of n5 goes, and so does the partition — its only listed
    // group is [n4], which no longer exists, and a group of nothing is not a partition.
    const back = withNodeCount(withN5, 3);
    expect(back.faults.map((f) => `${f.type}@${f.at}`)).toEqual(['crash@150', 'recover@650', 'heal@900']);
    expect(() => resolveExperiment(effectiveSpec(back))).not.toThrow();
  });

  it('generates node ids the engine accepts', () => {
    expect(nodeIds(4)).toEqual(['n1', 'n2', 'n3', 'n4']);
  });
});

describe('validation comes from the engine', () => {
  it('accepts the reference configuration', () => {
    expect(validate(base())).toMatchObject({ ok: true, errors: [] });
  });

  it('reports the engine’s own field path for a bad value', () => {
    const bad = validate({ ...base(), seed: -1 });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]?.path).toBe('spec.seed');
    expect(bad.errors[0]?.message.length).toBeGreaterThan(0);
  });

  it('rejects a latency range the engine rejects', () => {
    const bad = validate({ ...base(), latency: { min: 10, max: 1 } });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]?.path).toContain('latency');
  });

  it('rejects Raft with too few nodes for a majority', () => {
    const draft: Draft = { ...withProtocol(base(), 'raft-election'), nodeCount: 2 };
    expect(validate(draft).errors.map((e) => e.path)).toContain('spec.nodes');
  });
});

describe('fault plan warnings (legal, but probably a mistake)', () => {
  const plan = (faults: Draft['faults']): Draft => ({ ...base(), faults, faultsEnabled: true });

  it('says nothing about the reference plan', () => {
    expect(faultWarnings(base())).toEqual([]);
  });

  it('warns when recovering a node that is not crashed', () => {
    expect(plan([{ at: 10, type: 'recover', node: 'n1' }])).toBeDefined();
    expect(faultWarnings(plan([{ at: 10, type: 'recover', node: 'n1' }]))[0]).toMatch(/not crashed/);
  });

  it('warns when healing with no partition active', () => {
    expect(faultWarnings(plan([{ at: 10, type: 'heal' }]))[0]).toMatch(/No partition is active/);
  });

  it('explains that a second partition replaces the first', () => {
    const warnings = faultWarnings(plan([{ at: 10, type: 'partition', groups: [['n1']] }, { at: 20, type: 'partition', groups: [['n2']] }]));
    expect(warnings.some((w) => /replaces the previous one/.test(w))).toBe(true);
  });

  it('explains that a second link fault replaces the previous condition, per direction', () => {
    const same = faultWarnings(plan([{ at: 10, type: 'link', from: 'n1', to: 'n2', loss: 0.5 }, { at: 20, type: 'link', from: 'n1', to: 'n2', loss: 0.9 }]));
    expect(same.some((w) => /replaces the previous condition on n1→n2/.test(w))).toBe(true);
    // The opposite direction is a different link, so it is not a replacement.
    const opposite = faultWarnings(plan([{ at: 10, type: 'link', from: 'n1', to: 'n2', loss: 0.5 }, { at: 20, type: 'link', from: 'n2', to: 'n1', loss: 0.9 }]));
    expect(opposite.some((w) => /replaces/.test(w))).toBe(false);
  });

  it('warns about a fault scheduled after the time limit', () => {
    expect(faultWarnings(plan([{ at: 99_999, type: 'crash', node: 'n1' }])).some((w) => /never happen/.test(w))).toBe(true);
  });

  it('says nothing at all while fault injection is switched off', () => {
    expect(faultWarnings({ ...plan([{ at: 10, type: 'heal' }]), faultsEnabled: false })).toEqual([]);
  });
});
