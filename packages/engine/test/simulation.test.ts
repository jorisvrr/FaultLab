import { describe, expect, it } from 'vitest';
import { createPingProtocol, echoForever } from '../src/fixtures';
import { runSimulation, Simulation } from '../src/simulation';
import type { JsonValue } from '../src/json';
import type { NodeContext } from '../src/protocol';
import { config, ofKind, protocol, THREE_NODES, type TestHandlers } from './helpers';

describe('CP0: three nodes exchanging messages', () => {
  const result = runSimulation(config(createPingProtocol()));
  const { trace } = result;

  it('models three independent nodes, each started once at t=0 in config order', () => {
    expect(ofKind(trace, 'node.start').map((e) => [e.node, e.time])).toEqual([
      ['n1', 0],
      ['n2', 0],
      ['n3', 0],
    ]);
  });

  it('runs to quiescence with the exact expected event count and final time', () => {
    // 3 starts + 6 ping deliveries + 6 pong deliveries; pings land at t=5, pongs at t=10.
    expect(result.reason).toBe('quiescent');
    expect(result.eventsProcessed).toBe(15);
    expect(result.finalTime).toBe(10);
    expect(result.pendingEvents).toBe(0);
  });

  it('delivers every message exactly once, at its scheduled virtual time', () => {
    const sends = ofKind(trace, 'message.send');
    const delivers = ofKind(trace, 'message.deliver');
    expect(sends).toHaveLength(12);
    expect(delivers.map((d) => d.messageId).sort()).toEqual(sends.map((s) => s.messageId).sort());
    for (const deliver of delivers) {
      const send = trace[deliver.cause as number];
      expect(send?.kind).toBe('message.send');
      if (send?.kind !== 'message.send') continue;
      expect(deliver.time).toBe(send.deliverAt);
      expect(send.deliverAt! - send.time).toBe(5);
      expect([deliver.node, deliver.from, deliver.payload]).toEqual([send.to, send.node, send.payload]);
    }
  });

  it('orders simultaneous deliveries by send order', () => {
    const atFive = ofKind(trace, 'message.deliver').filter((d) => d.time === 5);
    expect(atFive.map((d) => d.messageId)).toEqual(['n1:m1', 'n1:m2', 'n2:m1', 'n2:m2', 'n3:m1', 'n3:m2']);
  });

  it('ends with every node having seen two pings and two pongs', () => {
    const sim = new Simulation(config(createPingProtocol()));
    sim.run();
    for (const id of THREE_NODES) {
      expect(sim.nodeState(id)).toEqual({ round: 1, pingsReceived: 2, pongsReceived: 2 });
    }
  });

  it('produces a well-formed trace: dense indices, monotonic time, causes point backwards', () => {
    trace.forEach((entry, i) => {
      expect(entry.index).toBe(i);
      if (i > 0) expect(entry.time).toBeGreaterThanOrEqual(trace[i - 1]!.time);
      if (entry.kind === 'run.start' || entry.kind === 'run.end') expect(entry.cause).toBeNull();
      else expect(entry.cause).toBeLessThan(i);
      expect(Object.isFrozen(entry)).toBe(true);
    });
    expect(trace[0]?.kind).toBe('run.start');
    expect(trace.at(-1)?.kind).toBe('run.end');
  });

  it('never delivers before the send (random latency, many seeds)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const run = runSimulation(config(createPingProtocol({ rounds: 3, jitter: 10 }), { seed, network: { latency: { min: 0, max: 20 } } }));
      for (const deliver of ofKind(run.trace, 'message.deliver')) {
        const send = run.trace[deliver.cause as number];
        expect(send?.kind === 'message.send' && deliver.time >= send.time && send.deliverAt! - send.time <= 20).toBe(true);
      }
    }
  });
});

describe('timers', () => {
  it('fires at now + delay with its tag, and records set and fire', () => {
    const p = protocol({
      init: (ctx) => (ctx.self === 'n1' && ctx.setTimer(7, 'wake'), { fired: 0 }),
      onTimer: (state, timer, ctx) => ({ fired: (state as { fired: number }).fired + 1, at: ctx.now, tag: timer.tag, setAt: timer.setAt }),
    });
    const sim = new Simulation(config(p));
    const result = sim.run();
    expect(sim.nodeState('n1')).toEqual({ fired: 1, at: 7, tag: 'wake', setAt: 0 });
    const [set] = ofKind(result.trace, 'timer.set');
    const [fire] = ofKind(result.trace, 'timer.fire');
    expect(set).toMatchObject({ node: 'n1', timerId: 'n1:t1', fireAt: 7 });
    expect(fire).toMatchObject({ time: 7, timerId: 'n1:t1', cause: set?.index });
  });

  it('cancelled timers never fire; cancelling twice or after firing is a traced no-op', () => {
    const p = protocol({
      init: (ctx) => {
        if (ctx.self !== 'n1') return { fired: [] };
        const doomed = ctx.setTimer(10, 'doomed');
        ctx.setTimer(5, 'cancel-it');
        ctx.setTimer(1, 'early');
        return { fired: [], doomed };
      },
      onTimer: (state, timer, ctx) => {
        const s = state as { fired: string[]; doomed: string };
        if (timer.tag === 'cancel-it') {
          ctx.cancelTimer(s.doomed);
          ctx.cancelTimer(s.doomed);
          ctx.cancelTimer('n1:t3'); // the 'early' timer, which already fired
        }
        return { ...s, fired: [...s.fired, timer.tag] };
      },
    });
    const sim = new Simulation(config(p));
    const result = sim.run();
    expect((sim.nodeState('n1') as { fired: string[] }).fired).toEqual(['early', 'cancel-it']);
    expect(ofKind(result.trace, 'timer.cancel').map((c) => c.timerId)).toEqual(['n1:t1']);
    expect(result.reason).toBe('quiescent');
  });

  it('a zero-delay timer runs at the same time, after events already queued for that time', () => {
    const order: string[] = [];
    const p = protocol({
      init: (ctx) => {
        order.push(`start ${ctx.self}`);
        if (ctx.self === 'n1') ctx.setTimer(0, 'now');
        return {};
      },
      onTimer: (state, timer, ctx) => (order.push(`${timer.tag} @${ctx.now}`), state),
    });
    runSimulation(config(p));
    expect(order).toEqual(['start n1', 'start n2', 'start n3', 'now @0']);
  });
});

describe('termination and resource limits', () => {
  it('stops a protocol that never terminates at maxEvents', () => {
    const result = runSimulation(config(echoForever, { limits: { maxEvents: 10 } }));
    expect(result.reason).toBe('event-limit');
    expect(result.eventsProcessed).toBe(10);
    expect(result.pendingEvents).toBe(1);
    expect(result.trace.at(-1)).toMatchObject({ kind: 'run.end', reason: 'event-limit', eventsProcessed: 10 });
  });

  it('reports quiescent (not event-limit) when the last allowed event empties the queue', () => {
    expect(runSimulation(config(createPingProtocol(), { limits: { maxEvents: 15 } })).reason).toBe('quiescent');
    expect(runSimulation(config(createPingProtocol(), { limits: { maxEvents: 14 } })).reason).toBe('event-limit');
  });

  it('stops before the first event later than maxTime; events exactly at maxTime still run', () => {
    // echo between a and b with latency 10: deliveries at 10, 20, 30, 40, ...
    const base = config(echoForever, { nodes: ['a', 'b'], network: { latency: { min: 10, max: 10 } } });
    for (const maxTime of [30, 39]) {
      const result = runSimulation({ ...base, limits: { maxTime } });
      expect(result.reason).toBe('time-limit');
      expect(result.finalTime).toBe(30);
      expect(result.eventsProcessed).toBe(5); // 2 starts + deliveries at 10, 20, 30
    }
  });

  it('stops a flooding protocol at maxPendingEvents', () => {
    const flood = protocol({
      init: (ctx) => (ctx.broadcast({}), {}),
      onMessage: (state, _message, ctx) => (ctx.broadcast({}), state),
    });
    const result = runSimulation(config(flood, { limits: { maxPendingEvents: 50 } }));
    expect(result.reason).toBe('pending-limit');
    expect(result.pendingEvents).toBeGreaterThan(50);
    expect(result.pendingEvents).toBeLessThanOrEqual(52);
  });

  it('treats a single handler emitting more effects than maxPendingEvents as a protocol error', () => {
    const burst = protocol({
      init: (ctx) => {
        for (let i = 0; i < 100; i++) ctx.setTimer(1, 'x');
        return {};
      },
    });
    const result = runSimulation(config(burst, { limits: { maxPendingEvents: 10 } }));
    expect(result.reason).toBe('protocol-error');
    expect(ofKind(result.trace, 'timer.set')).toHaveLength(0);
  });

  it('step() is a no-op once the run has stopped', () => {
    const sim = new Simulation(config(createPingProtocol()));
    sim.run();
    const length = sim.trace.length;
    expect(sim.step()).toBe(false);
    expect(sim.trace).toHaveLength(length);
  });
});

describe('protocol errors are contained, recorded and atomic', () => {
  const runWith = (init: TestHandlers['init']) => runSimulation(config(protocol({ init })));

  it('records a throwing handler and applies none of its effects', () => {
    const result = runWith((ctx) => {
      ctx.broadcast({ hello: true });
      ctx.setTimer(3, 'never');
      throw new Error('boom');
    });
    expect(result.reason).toBe('protocol-error');
    expect(ofKind(result.trace, 'protocol.error')).toEqual([expect.objectContaining({ node: 'n1', error: 'Error: boom', cause: 1 })]);
    expect(ofKind(result.trace, 'message.send')).toHaveLength(0);
    expect(ofKind(result.trace, 'timer.set')).toHaveLength(0);
    expect(ofKind(result.trace, 'state.update')).toHaveLength(0);
  });

  it.each<[string, TestHandlers['init'], string]>([
    ['send to unknown node', (ctx) => (ctx.send('ghost', {}), {}), 'unknown node ghost'],
    ['send to self', (ctx) => (ctx.send(ctx.self, {}), {}), 'cannot send a message to itself'],
    ['non-JSON payload', (ctx) => (ctx.send('n2', { f: () => 1 } as never), {}), 'InvalidJsonError'],
    ['negative timer delay', (ctx) => (ctx.setTimer(-1, 'x'), {}), 'timer delay'],
    ['fractional timer delay', (ctx) => (ctx.setTimer(1.5, 'x'), {}), 'timer delay'],
    ['oversized timer tag', (ctx) => (ctx.setTimer(1, 'x'.repeat(65)), {}), 'timer tag'],
    ['undefined initial state', () => undefined as never, 'InvalidJsonError'],
    ['async handler', (async () => ({})) as never, 'Promise is not a plain object'],
    ['non-Error throw', () => { throw 'just a string'; }, 'non-Error thrown: just a string'],
  ])('rejects %s', (_label, init, message) => {
    const result = runWith(init);
    expect(result.reason).toBe('protocol-error');
    expect(ofKind(result.trace, 'protocol.error')[0]?.error).toContain(message);
  });

  it('rejects mutation of frozen state', () => {
    const p = protocol({
      init: (ctx) => (ctx.self === 'n1' && ctx.setTimer(1, 'mutate'), { count: 0 }),
      onTimer: (state) => {
        (state as { count: number }).count++;
        return state;
      },
    });
    const result = runSimulation(config(p));
    expect(result.reason).toBe('protocol-error');
    expect(ofKind(result.trace, 'protocol.error')[0]?.error).toMatch(/^TypeError/);
  });

  it('rejects use of a context after its handler returned', () => {
    let leaked: NodeContext<JsonValue> | undefined;
    const p = protocol({
      init: (ctx) => {
        if (ctx.self === 'n1') {
          leaked = ctx;
          ctx.setTimer(1, 'use-stale');
        }
        return {};
      },
      onTimer: (state) => (leaked?.send('n2', {}), state),
    });
    const result = runSimulation(config(p));
    expect(ofKind(result.trace, 'protocol.error')[0]?.error).toContain('ProtocolViolationError: ctx.send was called after its handler returned');
  });

  it('does not let a sender mutate a payload after send()', () => {
    const p = protocol({
      init: (ctx) => {
        if (ctx.self === 'n1') {
          const payload = { value: 1 };
          ctx.send('n2', payload);
          payload.value = 999;
        }
        return { received: null };
      },
      onMessage: (_state, message) => ({ received: message.payload }),
    });
    const sim = new Simulation(config(p));
    sim.run();
    expect(sim.nodeState('n2')).toEqual({ received: { value: 1 } });
  });
});
