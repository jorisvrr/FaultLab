import { describe, expect, it } from 'vitest';
import { approach, nodeVisual, REST, type NodeVisualInput } from '../src/stage/node-visual';

const base: NodeVisualInput = { role: 'follower', status: 'up', recovering: false, partitioned: false, active: false, hovered: false, selected: false };
const v = (patch: Partial<NodeVisualInput>) => nodeVisual({ ...base, ...patch });

describe('node visual model (pure; shared by every rendering tier)', () => {
  it('an idle follower is the reference appearance', () => {
    expect(v({})).toEqual(REST);
    expect(v({ role: null })).toEqual(REST);
  });

  it('protocol states use shape, not colour alone', () => {
    expect(v({ role: 'candidate' }).segmented).toBe(1);
    expect(v({ status: 'crashed' })).toMatchObject({ broken: 1, fault: 1 });
    expect(v({ partitioned: true }).fence).toBe(1);
    expect(v({ recovering: true }).recovery).toBe(1);
    const leader = v({ role: 'leader' });
    expect(leader.rim).toBeGreaterThan(REST.rim);
    expect(leader.halo).toBeGreaterThan(REST.halo);
  });

  it('combinations do not conflict: each state keeps its own channel', () => {
    const selectedLeader = v({ role: 'leader', selected: true });
    expect(selectedLeader).toEqual({ ...v({ role: 'leader' }), selection: 1 });
    const crashedSelectedPartitioned = v({ status: 'crashed', selected: true, partitioned: true });
    expect(crashedSelectedPartitioned).toMatchObject({ broken: 1, fault: 1, selection: 1, fence: 1 });
  });

  it('a node that has not started yet is dimmer and shows no role or activity', () => {
    const idle = v({ status: 'idle', role: null });
    expect(idle.rim).toBeLessThan(REST.rim);
    expect(idle.halo).toBeLessThan(REST.halo);
    expect(v({ status: 'idle', role: 'leader', active: true })).toEqual(idle);
  });

  it('a crashed node shows no role and no activity (its protocol is not running)', () => {
    expect(v({ status: 'crashed', role: 'leader' })).toEqual(v({ status: 'crashed' }));
    expect(v({ status: 'crashed', active: true })).toEqual(v({ status: 'crashed' }));
    expect(v({ status: 'crashed', recovering: true }).recovery).toBe(0);
  });

  it('interaction is subtle: hover changes light by tens of percent, never the shape', () => {
    const hovered = v({ hovered: true });
    expect(hovered.rim / REST.rim).toBeCloseTo(1.1);
    expect(hovered.halo / REST.halo).toBeCloseTo(1.2);
    expect([hovered.broken, hovered.segmented, hovered.selection, hovered.fence]).toEqual([0, 0, 0, 0]);
  });

  it('transitions approach the target without jumps and can be interrupted midway', () => {
    const current = { ...REST };
    const selected = v({ selected: true });
    approach(current, selected, 0.03);
    const midway = current.selection;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);
    // Interrupt: deselect. The next step starts from the midway value (no jump back to 0 or 1).
    approach(current, REST, 0.016);
    expect(current.selection).toBeLessThan(midway);
    expect(current.selection).toBeGreaterThan(0);
    // It settles exactly, then reports that nothing moves (so on-demand rendering can stop).
    for (let i = 0; i < 200; i++) approach(current, REST, 0.016);
    expect(current).toEqual(REST);
    expect(approach(current, REST, 0.016)).toBe(false);
  });

  it('reduced motion: a zero time constant snaps in one step', () => {
    const current = { ...REST };
    approach(current, v({ selected: true, role: 'leader' }), 0.016, 0);
    expect(current).toEqual(v({ selected: true, role: 'leader' }));
  });
});
