import { describe, expect, it } from 'vitest';
import type { FaultSpec } from '../src/faults';
import { createPingProtocol } from '../src/fixtures';
import { runSimulation } from '../src/simulation';
import type { TraceEntry } from '../src/trace';
import { config, ofKind, protocol } from './helpers';
import { checkTraceInvariants } from './invariants';

/** Every node broadcasts `count` messages at each of the given times. Base latency is 5. */
const burst = (times: number[], count = 1) =>
  protocol({
    init: (ctx) => {
      for (const t of times) ctx.setTimer(t, 'go');
      return {};
    },
    onTimer: (state, _timer, ctx) => {
      for (let i = 0; i < count; i++) ctx.broadcast({ i });
      return state;
    },
  });

const run = (p: ReturnType<typeof protocol>, faults: FaultSpec[], nodes = ['n1', 'n2', 'n3']) => {
  const result = runSimulation(config(p, { nodes, faults }));
  expect(checkTraceInvariants(result.trace)).toEqual([]);
  return result.trace;
};
const pairs = (entries: readonly TraceEntry[]) =>
  entries.map((e) => (e.kind === 'message.deliver' ? `${e.from}>${e.node}` : e.kind === 'message.drop' ? `${e.from}>${e.node}` : '?'));
const indexOf = (trace: readonly TraceEntry[], kind: TraceEntry['kind']) => trace.find((e) => e.kind === kind)?.index;

describe('partitions', () => {
  it('cut messages already in flight; traffic inside a group still flows', () => {
    // Pings are sent at t=0 and arrive at t=5; the partition starts at t=2.
    const trace = run(createPingProtocol(), [{ at: 2, type: 'partition', groups: [['n1']] }]);
    const drops = ofKind(trace, 'message.drop');
    expect(drops.every((d) => d.reason === 'partitioned-in-flight' && d.time === 5)).toBe(true);
    expect(drops.every((d) => d.conditionIndex === indexOf(trace, 'network.partition'))).toBe(true);
    expect(pairs(drops).sort()).toEqual(['n1>n2', 'n1>n3', 'n2>n1', 'n3>n1']);
    expect(pairs(ofKind(trace, 'message.deliver').filter((d) => d.time === 5))).toEqual(['n2>n3', 'n3>n2']);
  });

  it('drop messages sent across an active partition at send time (deliverAt null)', () => {
    const trace = run(burst([10]), [{ at: 1, type: 'partition', groups: [['n1']] }]);
    const sends = ofKind(trace, 'message.send');
    expect(sends.filter((s) => s.deliverAt === null).map((s) => `${s.node}>${s.to}`).sort()).toEqual(['n1>n2', 'n1>n3', 'n2>n1', 'n3>n1']);
    expect(ofKind(trace, 'message.drop').every((d) => d.reason === 'partitioned' && d.time === 10)).toBe(true);
    expect(pairs(ofKind(trace, 'message.deliver'))).toEqual(['n2>n3', 'n3>n2']);
  });

  it('do not drop in-flight messages if the partition heals before they arrive', () => {
    const trace = run(burst([10]), [
      { at: 12, type: 'partition', groups: [['n1']] },
      { at: 14, type: 'heal' },
    ]);
    expect(ofKind(trace, 'message.drop')).toEqual([]);
    expect(ofKind(trace, 'message.deliver')).toHaveLength(6);
  });

  it('heal restores communication for later sends', () => {
    const trace = run(burst([10, 30]), [
      { at: 1, type: 'partition', groups: [['n1']] },
      { at: 20, type: 'heal' },
    ]);
    expect(ofKind(trace, 'message.drop').every((d) => d.time === 10)).toBe(true);
    expect(ofKind(trace, 'message.deliver').filter((d) => d.time === 35)).toHaveLength(6);
  });

  it('a new partition replaces the previous one', () => {
    const trace = run(burst([10]), [
      { at: 1, type: 'partition', groups: [['n1']] },
      { at: 2, type: 'partition', groups: [['n3']] },
    ]);
    expect(pairs(ofKind(trace, 'message.deliver'))).toEqual(['n1>n2', 'n2>n1']);
    expect(ofKind(trace, 'message.drop').every((d) => d.node === 'n3' || d.from === 'n3')).toBe(true);
  });

  it('records normalised groups, with unlisted nodes as one implicit group', () => {
    const trace = run(burst([]), [{ at: 1, type: 'partition', groups: [['n3', 'n1']] }], ['n1', 'n2', 'n3', 'n4']);
    expect(ofKind(trace, 'network.partition')[0]?.groups).toEqual([
      ['n1', 'n3'],
      ['n2', 'n4'],
    ]);
  });

  it('take precedence over a crashed receiver when explaining a drop', () => {
    const trace = run(createPingProtocol(), [
      { at: 2, type: 'partition', groups: [['n2']] },
      { at: 3, type: 'crash', node: 'n2' },
    ]);
    const toN2 = ofKind(trace, 'message.drop').filter((d) => d.node === 'n2');
    expect(toN2.length).toBeGreaterThan(0);
    expect(toN2.every((d) => d.reason === 'partitioned-in-flight')).toBe(true);
  });
});

describe('link faults (directed, decided at send time)', () => {
  it('loss 1 drops every message in one direction only', () => {
    const trace = run(burst([10]), [{ at: 1, type: 'link', from: 'n1', to: 'n2', loss: 1 }]);
    const drops = ofKind(trace, 'message.drop');
    expect(pairs(drops)).toEqual(['n1>n2']);
    expect(drops[0]).toMatchObject({ reason: 'lost', time: 10, conditionIndex: indexOf(trace, 'link.fault') });
    expect(pairs(ofKind(trace, 'message.deliver'))).toContain('n2>n1');
  });

  it('loss p drops about p of the messages (fixed seed)', () => {
    const trace = run(burst([10], 4000), [{ at: 1, type: 'link', from: 'n1', to: 'n2', loss: 0.25 }], ['n1', 'n2']);
    const lost = ofKind(trace, 'message.drop').length;
    const sent = ofKind(trace, 'message.send').filter((s) => s.node === 'n1').length;
    expect(sent).toBe(4000);
    expect(lost / sent).toBeGreaterThan(0.22);
    expect(lost / sent).toBeLessThan(0.28);
  });

  it('delay adds extra latency on the faulted direction', () => {
    const trace = run(burst([10]), [
      { at: 1, type: 'link', from: 'n1', to: 'n2', delay: { min: 100, max: 100 } },
      { at: 1, type: 'link', from: 'n3', to: 'n1', delay: { min: 10, max: 20 } },
    ]);
    const deliverAt = (from: string, to: string) => ofKind(trace, 'message.send').find((s) => s.node === from && s.to === to)?.deliverAt;
    expect(deliverAt('n1', 'n2')).toBe(115);
    expect(deliverAt('n2', 'n1')).toBe(15);
    expect(deliverAt('n3', 'n1')).toBeGreaterThanOrEqual(25);
    expect(deliverAt('n3', 'n1')).toBeLessThanOrEqual(35);
  });

  it('restore affects later sends but not messages already in flight', () => {
    const trace = run(burst([10, 20]), [
      { at: 1, type: 'link', from: 'n1', to: 'n2', delay: { min: 100, max: 100 } },
      { at: 12, type: 'link-restore', from: 'n1', to: 'n2' },
    ]);
    const n1ToN2 = ofKind(trace, 'message.deliver').filter((d) => d.from === 'n1' && d.node === 'n2');
    expect(n1ToN2.map((d) => d.time)).toEqual([25, 115]);
  });

  it('a later link fault replaces the earlier condition on that link', () => {
    const trace = run(burst([10]), [
      { at: 1, type: 'link', from: 'n1', to: 'n2', loss: 1 },
      { at: 2, type: 'link', from: 'n1', to: 'n2', delay: { min: 50, max: 50 } },
    ]);
    expect(ofKind(trace, 'message.drop')).toEqual([]);
    expect(ofKind(trace, 'message.send').find((s) => s.node === 'n1' && s.to === 'n2')?.deliverAt).toBe(65);
  });
});

describe('fault trace entries', () => {
  it('produce exactly one entry per fault, each caused by run.start and naming its fault id', () => {
    const trace = run(createPingProtocol(), [
      { at: 1, type: 'link', from: 'n1', to: 'n2', loss: 0.5, delay: { min: 1, max: 2 } },
      { at: 2, type: 'partition', groups: [['n1']] },
      { at: 3, type: 'crash', node: 'n3' },
      { at: 4, type: 'heal' },
      { at: 5, type: 'recover', node: 'n3' },
      { at: 6, type: 'link-restore', from: 'n1', to: 'n2' },
    ]);
    const faultEntries = trace.filter((e) => 'faultId' in e);
    expect(faultEntries.map((e) => [e.kind, (e as { faultId: string }).faultId, e.time, e.cause])).toEqual([
      ['link.fault', 'f1', 1, 0],
      ['network.partition', 'f2', 2, 0],
      ['node.crash', 'f3', 3, 0],
      ['network.heal', 'f4', 4, 0],
      ['node.recover', 'f5', 5, 0],
      ['link.restore', 'f6', 6, 0],
    ]);
    expect(faultEntries[0]).toMatchObject({ from: 'n1', to: 'n2', loss: 0.5, delay: { min: 1, max: 2 } });
  });
});
