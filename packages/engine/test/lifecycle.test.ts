import { describe, expect, it } from 'vitest';
import type { FaultSpec } from '../src/faults';
import { createHeartbeatProtocol, createPingProtocol } from '../src/fixtures';
import type { JsonValue } from '../src/json';
import { runSimulation, Simulation } from '../src/simulation';
import type { TraceEntry } from '../src/trace';
import { config, ofKind, protocol } from './helpers';
import { checkTraceInvariants, storageFromTrace } from './invariants';

const after = (trace: readonly TraceEntry[], index: number) => trace.slice(index + 1);
const ofNode = (trace: readonly TraceEntry[], node: string) => trace.filter((e) => 'node' in e && e.node === node);

/** Ticks every 10; volatile `count` and persistent `total` both count ticks. */
const ticker = protocol({
  init: (ctx) => {
    ctx.setTimer(10, 'tick');
    return { count: 0 };
  },
  onTimer: (state, _timer, ctx) => {
    ctx.storage.set('total', ((ctx.storage.get('total') as number | undefined) ?? 0) + 1);
    ctx.setTimer(10, 'tick');
    return { count: (state as { count: number }).count + 1 };
  },
});

describe('node crash', () => {
  // Ping with latency 5: pings land at t=5, pongs at t=10. n2 crashes at t=3.
  const faults: FaultSpec[] = [{ at: 3, type: 'crash', node: 'n2' }];
  const sim = new Simulation(config(createPingProtocol(), { faults }));
  const result = sim.run();
  const [crash] = ofKind(result.trace, 'node.crash');

  it('records the crash at the planned time with the ending incarnation', () => {
    expect(crash).toMatchObject({ time: 3, node: 'n2', incarnation: 1, faultId: 'f1', cause: 0 });
    expect(sim.nodeInfo('n2')).toEqual({ status: 'crashed', incarnation: 1 });
    expect(sim.nodeState('n2')).toBeUndefined();
  });

  it('runs no handler, sends nothing and changes nothing on the crashed node afterwards', () => {
    const afterCrash = ofNode(after(result.trace, crash!.index), 'n2');
    expect(afterCrash.every((e) => e.kind === 'message.drop')).toBe(true);
    expect(afterCrash.length).toBeGreaterThan(0);
  });

  it('drops messages that reach the crashed node, explaining the drop with the crash', () => {
    const drops = ofKind(result.trace, 'message.drop');
    // n1 and n3 pinged n2 (2 drops) and later answered n2's own pings with pongs (2 drops).
    // Message ids count per sender in peer order: n3's peers are [n1, n2], so n3:m2 is its ping to n2.
    expect(drops.map((d) => [d.messageId, d.reason, d.conditionIndex])).toEqual([
      ['n1:m1', 'node-down', crash!.index],
      ['n3:m2', 'node-down', crash!.index],
      ['n1:m3', 'node-down', crash!.index],
      ['n3:m4', 'node-down', crash!.index],
    ]);
  });

  it('still delivers what the node sent before it crashed (already on the wire)', () => {
    const fromN2 = ofKind(result.trace, 'message.deliver').filter((d) => d.from === 'n2');
    expect(fromN2.map((d) => d.node)).toEqual(['n1', 'n3']);
  });

  it('cancels every pending timer and lists them in the crash entry', () => {
    const sim2 = new Simulation(config(createHeartbeatProtocol({ interval: 20, timeout: 60 }), { faults: [{ at: 30, type: 'crash', node: 'n1' }], limits: { maxTime: 200 } }));
    const trace = sim2.run().trace;
    const [crash2] = ofKind(trace, 'node.crash');
    const pendingBefore = new Set<string>();
    for (const e of trace.slice(0, crash2!.index)) {
      if (e.kind === 'timer.set' && e.node === 'n1') pendingBefore.add(e.timerId);
      if ((e.kind === 'timer.fire' || e.kind === 'timer.cancel') && e.node === 'n1') pendingBefore.delete(e.timerId);
    }
    expect(new Set(crash2!.cancelledTimers)).toEqual(pendingBefore);
    expect(crash2!.cancelledTimers.length).toBe(3); // next beat + 2 watchdogs
    expect(ofKind(trace, 'timer.fire').filter((f) => f.node === 'n1' && f.time > 30)).toEqual([]);
  });

  it('satisfies the lifecycle invariants', () => {
    expect(checkTraceInvariants(result.trace)).toEqual([]);
  });
});

describe('node recovery', () => {
  const faults: FaultSpec[] = [
    { at: 55, type: 'crash', node: 'n1' },
    { at: 72, type: 'recover', node: 'n1' },
  ];
  const sim = new Simulation(config(ticker, { faults, limits: { maxTime: 150 } }));
  const result = sim.run();

  it('restarts as incarnation 2 and runs init with a fresh volatile state', () => {
    const [recover] = ofKind(result.trace, 'node.recover');
    expect(recover).toMatchObject({ time: 72, node: 'n1', incarnation: 2, faultId: 'f2', cause: 0 });
    const firstUpdate = ofKind(after(result.trace, recover!.index), 'state.update').find((e) => e.node === 'n1');
    expect(firstUpdate).toMatchObject({ time: 72, incarnation: 2, state: { count: 0 } });
    expect(sim.nodeInfo('n1')).toEqual({ status: 'running', incarnation: 2 });
  });

  it('resets volatile state but keeps persistent storage', () => {
    // Incarnation 1 ticked at 10..50 (5 ticks). Incarnation 2 ticks at 82..142 (7 ticks).
    expect(sim.nodeState('n1')).toEqual({ count: 7 });
    expect(sim.nodeStorage('n1')).toEqual({ total: 12 });
    expect(sim.nodeStorage('n2')).toEqual({ total: 15 }); // never crashed: ticks at 10..150
  });

  it('never fires a timer of the first incarnation after the crash', () => {
    const fires = ofKind(result.trace, 'timer.fire').filter((f) => f.node === 'n1');
    expect(fires.filter((f) => f.time > 55).every((f) => f.incarnation === 2)).toBe(true);
    expect(fires.map((f) => f.time)).toEqual([10, 20, 30, 40, 50, 82, 92, 102, 112, 122, 132, 142]);
  });

  it('agrees with storage re-derived from the trace, and satisfies the invariants', () => {
    expect(storageFromTrace(result.trace).get('n1')).toEqual(sim.nodeStorage('n1'));
    expect(checkTraceInvariants(result.trace)).toEqual([]);
  });

  it('lets a heartbeat node know it rebooted while forgetting what it had observed', () => {
    const hb = new Simulation(
      config(createHeartbeatProtocol({ interval: 20, timeout: 60 }), {
        faults: [
          { at: 50, type: 'crash', node: 'n2' },
          { at: 200, type: 'recover', node: 'n2' },
        ],
        limits: { maxTime: 400 },
      }),
    );
    const trace = hb.run().trace;
    expect(hb.nodeStorage('n2')).toEqual({ boots: 2 });
    const n1States = ofKind(trace, 'state.update').filter((e) => e.node === 'n1');
    // n1 suspects n2 during the outage and clears the suspicion once heartbeats return.
    expect(n1States.some((e) => (e.state as { suspected: string[] }).suspected.includes('n2'))).toBe(true);
    expect((hb.nodeState('n1') as { suspected: string[] }).suspected).toEqual([]);
    const recovered = ofKind(trace, 'state.update').find((e) => e.node === 'n2' && e.incarnation === 2);
    expect(recovered?.state).toMatchObject({ boot: 2, lastHeard: {}, suspected: [] });
    expect(checkTraceInvariants(trace)).toEqual([]);
  });
});

describe('same-tick edge cases (fault-plan events precede protocol events at equal time)', () => {
  const once = (delay: number) =>
    protocol({
      init: (ctx) => (ctx.self === 'n1' && ctx.setTimer(delay, `due@${ctx.now + delay}`), {}),
      onTimer: (state) => state,
    });

  it('a crash and a timer at the same tick: the timer never fires', () => {
    const result = runSimulation(config(once(10), { faults: [{ at: 10, type: 'crash', node: 'n1' }] }));
    expect(ofKind(result.trace, 'timer.fire')).toEqual([]);
    expect(ofKind(result.trace, 'node.crash')[0]?.cancelledTimers).toEqual(['n1:t1']);
    expect(checkTraceInvariants(result.trace)).toEqual([]);
  });

  it('crash, recover and the old timer at one tick: the old timer is gone, the new incarnation starts', () => {
    const p = protocol({
      init: (ctx) => {
        if (ctx.self === 'n1') ctx.setTimer(ctx.now === 0 ? 10 : 0, `set-by-${ctx.now === 0 ? 'first' : 'second'}`);
        return {};
      },
      onTimer: (state) => state,
    });
    const result = runSimulation(
      config(p, {
        faults: [
          { at: 10, type: 'crash', node: 'n1' },
          { at: 10, type: 'recover', node: 'n1' },
        ],
      }),
    );
    const fires = ofKind(result.trace, 'timer.fire');
    expect(fires.map((f) => [f.tag, f.time, f.incarnation])).toEqual([['set-by-second', 10, 2]]);
    expect(checkTraceInvariants(result.trace)).toEqual([]);
  });

  it('a delivery at the tick of a crash is dropped; at the tick of a recovery it reaches the new incarnation', () => {
    // Ping, latency 5: every ping arrives at t=5.
    const dropped = runSimulation(config(createPingProtocol(), { faults: [{ at: 5, type: 'crash', node: 'n2' }] }));
    expect(ofKind(dropped.trace, 'message.drop').filter((d) => d.time === 5).map((d) => d.node)).toEqual(['n2', 'n2']);

    const delivered = runSimulation(
      config(createPingProtocol(), {
        faults: [
          { at: 2, type: 'crash', node: 'n2' },
          { at: 5, type: 'recover', node: 'n2' },
        ],
      }),
    );
    const toN2 = ofKind(delivered.trace, 'message.deliver').filter((d) => d.node === 'n2' && d.time === 5);
    expect(toN2.map((d) => [d.from, d.incarnation])).toEqual([
      ['n1', 2],
      ['n3', 2],
    ]);
    expect(checkTraceInvariants(delivered.trace)).toEqual([]);
  });

  it('plan order decides between faults at the same tick', () => {
    const result = runSimulation(
      config(createPingProtocol(), {
        faults: [
          { at: 4, type: 'recover', node: 'n2' },
          { at: 4, type: 'crash', node: 'n2' },
        ],
      }),
    );
    expect(result.trace.filter((e) => e.time === 4).map((e) => e.kind)).toEqual(['fault.skipped', 'node.crash']);
  });
});

describe('idempotent lifecycle faults', () => {
  it('records crashing a crashed node and recovering a running node as skipped', () => {
    const result = runSimulation(
      config(createPingProtocol(), {
        faults: [
          { at: 1, type: 'recover', node: 'n1' },
          { at: 2, type: 'crash', node: 'n1' },
          { at: 3, type: 'crash', node: 'n1' },
          { at: 4, type: 'recover', node: 'n1' },
        ],
      }),
    );
    const lifecycle = result.trace.filter((e) => 'faultId' in e);
    expect(lifecycle.map((e) => [e.kind, (e as { reason?: string }).reason])).toEqual([
      ['fault.skipped', 'not-crashed'],
      ['node.crash', undefined],
      ['fault.skipped', 'already-crashed'],
      ['node.recover', undefined],
    ]);
    expect(checkTraceInvariants(result.trace)).toEqual([]);
  });
});

describe('persistent storage (sync-on-commit)', () => {
  const run = (handlers: Parameters<typeof protocol>[0], faults: FaultSpec[] = []) => {
    const sim = new Simulation(config(protocol(handlers), { faults }));
    return { sim, result: sim.run() };
  };

  it('reads its own uncommitted writes, sorts keys, and supports delete', () => {
    const { sim } = run({
      init: (ctx) => {
        ctx.storage.set('b', 1);
        ctx.storage.set('a', { nested: [true] });
        ctx.storage.set('gone', 0);
        ctx.storage.delete('gone');
        return { seen: ctx.storage.get('a') ?? null, keys: ctx.storage.keys(), gone: ctx.storage.get('gone') ?? null };
      },
    });
    expect(sim.nodeState('n1')).toEqual({ seen: { nested: [true] }, keys: ['a', 'b'], gone: null });
    expect(sim.nodeStorage('n1')).toEqual({ a: { nested: [true] }, b: 1 });
  });

  it('records durable writes before the messages of the same step (persist-before-send)', () => {
    const { result } = run({
      init: (ctx) => {
        if (ctx.self === 'n1') {
          ctx.send('n2', { vote: 1 });
          ctx.storage.set('votedFor', 'n2');
        }
        return {};
      },
    });
    const kinds = result.trace.filter((e) => e.time === 0 && 'node' in e && e.node === 'n1').map((e) => e.kind);
    expect(kinds).toEqual(['node.start', 'storage.write', 'message.send', 'state.update']);
    expect(ofKind(result.trace, 'storage.write')[0]).toMatchObject({ set: { votedFor: 'n2' }, deleted: [] });
  });

  it('persists nothing from a handler that throws', () => {
    const { sim, result } = run({
      init: (ctx) => {
        ctx.storage.set('half', 'written');
        throw new Error('boom');
      },
    });
    expect(result.reason).toBe('protocol-error');
    expect(ofKind(result.trace, 'storage.write')).toEqual([]);
    expect(sim.nodeStorage('n1')).toEqual({});
  });

  it('keeps deletions durable across a crash', () => {
    const { sim } = run(
      {
        init: (ctx) => {
          if (ctx.storage.get('booted') === undefined) {
            ctx.storage.set('booted', true);
            ctx.storage.set('x', 1);
            ctx.setTimer(5, 'delete-x');
          }
          return { sawX: ctx.storage.get('x') ?? null };
        },
        onTimer: (state, _t, ctx) => (ctx.storage.delete('x'), state),
      },
      [
        { at: 10, type: 'crash', node: 'n1' },
        { at: 20, type: 'recover', node: 'n1' },
      ],
    );
    // The deletion at t=5 was committed, so the recovered incarnation no longer sees 'x'.
    expect(sim.nodeInfo('n1').incarnation).toBe(2);
    expect(sim.nodeState('n1')).toEqual({ sawX: null });
    expect(sim.nodeStorage('n1')).toEqual({ booted: true });
  });

  it.each<[string, Parameters<typeof protocol>[0]['init'], string]>([
    ['an empty key', (ctx) => (ctx.storage.set('', 1), {}), 'storage keys'],
    ['an oversized key', (ctx) => (ctx.storage.set('k'.repeat(129), 1), {}), 'storage keys'],
    ['a non-string key', (ctx) => (ctx.storage.get(7 as never), {}), 'storage keys'],
    ['an undefined value', (ctx) => (ctx.storage.set('k', undefined as never), {}), 'InvalidJsonError'],
    ['a Map value', (ctx) => (ctx.storage.set('k', new Map() as never), {}), 'InvalidJsonError'],
  ])('rejects %s', (_label, init, message) => {
    const result = runSimulation(config(protocol({ init })));
    expect(result.reason).toBe('protocol-error');
    expect(ofKind(result.trace, 'protocol.error')[0]?.error).toContain(message);
  });

  it('rejects storage use after the handler returned', () => {
    let leaked: { storage: { get(k: string): JsonValue | undefined } } | undefined;
    const result = runSimulation(
      config(
        protocol({
          init: (ctx) => {
            if (ctx.self === 'n1') {
              leaked = ctx;
              ctx.setTimer(1, 'stale');
            }
            return {};
          },
          onTimer: (state) => (leaked?.storage.get('k'), state),
        }),
      ),
    );
    expect(ofKind(result.trace, 'protocol.error')[0]?.error).toContain('ctx.storage.get was called after its handler returned');
  });

  it('counts storage writes toward the per-handler effect limit', () => {
    const result = runSimulation(
      config(
        protocol({
          init: (ctx) => {
            for (let i = 0; i < 20; i++) ctx.storage.set(`k${i}`, i);
            return {};
          },
        }),
        { limits: { maxPendingEvents: 10 } },
      ),
    );
    expect(result.reason).toBe('protocol-error');
  });
});
