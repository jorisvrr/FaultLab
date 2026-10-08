import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPingProtocol } from '../src/fixtures';
import { defineInvariant } from '../src/invariants';
import { Simulation } from '../src/simulation';
import { EventScheduler } from '../src/scheduler';
import type { MessageSendEntry, TraceEntry } from '../src/trace';
import { experiment, heartbeatConfig } from './arbitraries';
import { config } from './helpers';

/**
 * In-flight index contract (SEMANTICS §11): after every step, the index holds exactly the
 * messages whose `message.deliver` event is live in the scheduler, which is exactly the set
 * derived from the trace (sent with deliverAt ≠ null, not yet delivered or dropped), in send order.
 */
describe('in-flight message index', () => {
  const traceDerived = () => {
    const pending = new Map<string, MessageSendEntry>();
    let seen = 0;
    return (trace: readonly TraceEntry[]) => {
      for (; seen < trace.length; seen++) {
        const entry = trace[seen]!;
        if (entry.kind === 'message.send' && entry.deliverAt !== null) pending.set(entry.messageId, entry);
        if (entry.kind === 'message.deliver' || entry.kind === 'message.drop') pending.delete(entry.messageId);
      }
      return pending;
    };
  };

  it('agrees with the scheduler, the trace and the invariant view after every step (random fault plans)', () => {
    fc.assert(
      fc.property(experiment, (e) => {
        let viewIds: string[] = [];
        const observer = defineInvariant({
          id: 'observer',
          version: '1',
          name: 'In-flight observer',
          initialHistory: null,
          check: ({ view }) => {
            viewIds = view.inFlight.map((m) => m.id);
            return { ok: true };
          },
        });
        const sim = new Simulation({ ...heartbeatConfig(e), invariants: [observer] });
        const derive = traceDerived();
        while (sim.stopReason === null) {
          sim.step();
          const index = sim.inFlight();
          const ids = index.map((m) => m.id);
          const derived = derive(sim.trace);
          expect(ids).toEqual([...derived.keys()]); // same set, same (send) order
          expect([...ids].sort()).toEqual([...sim.scheduledDeliveries()].sort());
          if (sim.stopReason === null) expect(viewIds).toEqual(ids);
          for (const message of index) {
            const send = derived.get(message.id)!;
            expect(message).toEqual({
              id: send.messageId,
              from: send.node,
              to: send.to,
              payload: send.payload,
              sentAt: send.time,
              deliverAt: send.deliverAt,
              sendIndex: send.index,
            });
            expect(message.deliverAt).toBeGreaterThanOrEqual(sim.now);
          }
        }
        // At termination the index still describes exactly the undelivered messages.
        expect(sim.inFlight().length).toBe(sim.scheduledDeliveries().length);
      }),
      { numRuns: 40 },
    );
  });

  it('never indexes messages dropped at send time, and releases in-flight drops on delivery', () => {
    const sim = new Simulation(
      config(createPingProtocol({ rounds: 2, interval: 30 }), {
        faults: [
          { at: 2, type: 'partition', groups: [['n1']] },
          { at: 20, type: 'link', from: 'n2', to: 'n3', loss: 1 },
          { at: 31, type: 'crash', node: 'n2' }, // n3 → n2 messages still arrive, and hit a crashed node
        ],
      }),
    );
    const seenInIndex = new Set<string>();
    while (sim.stopReason === null) {
      sim.step();
      for (const m of sim.inFlight()) seenInIndex.add(m.id);
    }
    const trace = sim.trace;
    for (const drop of trace.filter((e) => e.kind === 'message.drop')) {
      const atSend = drop.reason === 'partitioned' || drop.reason === 'lost';
      expect(seenInIndex.has(drop.messageId)).toBe(!atSend);
    }
    expect(new Set(trace.filter((e) => e.kind === 'message.drop').map((e) => e.reason))).toEqual(
      new Set(['partitioned-in-flight', 'partitioned', 'lost', 'node-down']),
    );
    expect(sim.stopReason).toBe('quiescent');
    expect(sim.inFlight()).toEqual([]);
  });

  it('returns frozen records', () => {
    const sim = new Simulation(config(createPingProtocol()));
    sim.step();
    const [first] = sim.inFlight();
    expect(Object.isFrozen(sim.inFlight())).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });
});

describe('EventScheduler.liveEvents', () => {
  it('lists exactly the live events in dispatch order, without disturbing the queue', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 20 }), fc.boolean())), (ops) => {
        const s = new EventScheduler<number>({ compactionThreshold: 2 });
        const expected: Array<{ time: number; seq: number }> = [];
        ops.forEach(([time, cancel], i) => {
          const seq = s.schedule(time, i);
          if (cancel) s.cancel(seq);
          else expected.push({ time, seq });
        });
        expected.sort((a, b) => a.time - b.time || a.seq - b.seq);
        expect(s.liveEvents().map(({ time, seq }) => ({ time, seq }))).toEqual(expected);
        const drained: number[] = [];
        for (let next = s.next(); next !== undefined; next = s.next()) drained.push(next.seq);
        expect(drained).toEqual(expected.map((e) => e.seq));
      }),
    );
  });
});
