import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineInvariantError } from '../src/errors';
import { EventScheduler } from '../src/scheduler';

const drain = <E>(scheduler: EventScheduler<E>): E[] => {
  const out: E[] = [];
  for (let next = scheduler.next(); next !== undefined; next = scheduler.next()) out.push(next.event);
  return out;
};

describe('EventScheduler', () => {
  it('dispatches by virtual time, advancing the clock', () => {
    const s = new EventScheduler<string>();
    s.schedule(30, 'c');
    s.schedule(10, 'a');
    s.schedule(20, 'b');
    expect(s.next()?.event).toBe('a');
    expect(s.now).toBe(10);
    expect(drain(s)).toEqual(['b', 'c']);
    expect(s.now).toBe(30);
  });

  it('breaks ties at the same time by scheduling order (FIFO)', () => {
    const s = new EventScheduler<string>();
    ['first', 'second', 'third', 'fourth'].forEach((e) => s.schedule(5, e));
    expect(drain(s)).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('orders by (time, seq) for arbitrary schedules (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 300 }), (times) => {
        const s = new EventScheduler<number>();
        times.forEach((t, i) => s.schedule(t, i));
        // Reference: a stable sort by time keeps insertion order for ties.
        const expected = times.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t).map((x) => x.i);
        expect(drain(s)).toEqual(expected);
      }),
    );
  });

  it('allows scheduling at the current time; such events run after already-queued ones', () => {
    const s = new EventScheduler<string>();
    s.schedule(5, 'a');
    s.schedule(5, 'b');
    expect(s.next()?.event).toBe('a');
    s.schedule(5, 'scheduled-during-a');
    expect(drain(s)).toEqual(['b', 'scheduled-during-a']);
  });

  it('rejects scheduling in the past or at invalid times', () => {
    const s = new EventScheduler<string>();
    s.schedule(10, 'x');
    s.next();
    expect(() => s.schedule(9, 'past')).toThrow(EngineInvariantError);
    for (const t of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => s.schedule(t, 'bad')).toThrow(EngineInvariantError);
    }
  });

  it('cancels lazily: cancelled events never dispatch and are excluded from pendingCount', () => {
    const s = new EventScheduler<string>();
    const a = s.schedule(1, 'a');
    s.schedule(2, 'b');
    const c = s.schedule(3, 'c');
    expect(s.cancel(a)).toBe(true);
    expect(s.cancel(a)).toBe(false);
    expect(s.pendingCount).toBe(2);
    expect(s.peek()?.event).toBe('b');
    expect(s.isPending(c)).toBe(true);
    expect(s.cancel(c)).toBe(true);
    expect(drain(s)).toEqual(['b']);
    expect(s.pendingCount).toBe(0);
  });

  it('cannot cancel an event that already ran', () => {
    const s = new EventScheduler<string>();
    const a = s.schedule(1, 'a');
    s.next();
    expect(s.cancel(a)).toBe(false);
  });

  it('peek does not advance the clock', () => {
    const s = new EventScheduler<string>();
    s.schedule(7, 'a');
    expect(s.peek()?.time).toBe(7);
    expect(s.now).toBe(0);
  });
});
