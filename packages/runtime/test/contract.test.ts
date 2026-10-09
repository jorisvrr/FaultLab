import { describe, expect, it } from 'vitest';
import { ContractError, DEFAULT_RUN_OPTIONS, parseCommand, parseEvent, WORKER_PROTOCOL } from '../src';

const cmd = (extra: object) => ({ protocol: WORKER_PROTOCOL, runId: 'r1', ...extra });

describe('message contract', () => {
  it('accepts every well-formed command', () => {
    for (const c of [
      { type: 'load', spec: {}, options: DEFAULT_RUN_OPTIONS },
      { type: 'run' },
      { type: 'pause' },
      { type: 'stop' },
      { type: 'step', steps: 3 },
      { type: 'credit', chunks: 1 },
      { type: 'snapshot', requestId: 0, atStep: null },
      { type: 'snapshot', requestId: 1, atStep: 5 },
    ]) expect(() => parseCommand(cmd(c))).not.toThrow();
  });

  it.each([
    ['not an object', 'run'],
    ['another protocol version', { protocol: 'faultlab-worker/2', runId: 'r1', type: 'run' }],
    ['no runId', { protocol: WORKER_PROTOCOL, type: 'run' }],
    ['an unknown command', cmd({ type: 'reboot' })],
    ['step 0', cmd({ type: 'step', steps: 0 })],
    ['fractional credit', cmd({ type: 'credit', chunks: 1.5 })],
    ['bad run options', cmd({ type: 'load', spec: {}, options: { ...DEFAULT_RUN_OPTIONS, encoding: 'xml' } })],
    ['negative atStep', cmd({ type: 'snapshot', requestId: 0, atStep: -1 })],
  ])('rejects a command with %s', (_label, raw) => {
    expect(() => parseCommand(raw)).toThrow(ContractError);
  });

  it.each([
    ['an empty chunk range', cmd({ type: 'chunk', seq: 0, from: 3, to: 3, encoding: 'clone', entries: [] })],
    ['a clone chunk whose length differs from its range', cmd({ type: 'chunk', seq: 0, from: 0, to: 2, encoding: 'clone', entries: [{}] })],
    ['a json chunk without a buffer', cmd({ type: 'chunk', seq: 0, from: 0, to: 2, encoding: 'json', data: 'text' })],
    ['an invalid status state', cmd({ type: 'status', state: 'flying', stepsCompleted: 0, now: 0, traceLength: 0, pendingEvents: 0, stopReason: null, throttled: false })],
    ['finished without fingerprint', cmd({ type: 'finished', state: 'completed', stepsCompleted: 1, traceLength: 1 })],
  ])('rejects an event with %s', (_label, raw) => {
    expect(() => parseEvent(raw)).toThrow(ContractError);
  });
});
