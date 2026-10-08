import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defineInvariant, fingerprintTrace, runSimulation, serializeTrace, type FaultSpec, type JsonValue, type SimulationConfig } from '@faultlab/engine';
import { createHeartbeatProtocol } from '@faultlab/engine/fixtures';
import { buildModel, frameAt, lastIndexAtOrBefore } from '../src/derive';
import { experiments } from '../src/experiments';

/**
 * The viewer may only show what the trace can prove. This test captures what the ENGINE sees
 * after every step (through the public invariant API, which receives the authoritative frozen
 * view) and requires frameAt() to reconstruct exactly that from the trace alone.
 */
interface Captured {
  readonly lastIndex: number;
  readonly nodes: readonly { id: string; status: string; incarnation: number; state: JsonValue | undefined; stateEntry: number | null; storage: Record<string, JsonValue> }[];
  readonly inFlight: readonly string[];
  readonly partition: JsonValue;
  readonly links: JsonValue;
}

function runCapturing(config: SimulationConfig) {
  const captured: Captured[] = [];
  const observer = defineInvariant({
    id: 'demo-observer',
    version: '1',
    name: 'Demo observer',
    initialHistory: null,
    check: ({ view, step }) => {
      captured.push({
        lastIndex: step.entries.at(-1)!.index,
        nodes: view.nodes.map((n) => ({ id: n.id, status: n.status, incarnation: n.incarnation, state: n.state, stateEntry: n.stateEntry, storage: { ...n.storage } })),
        inFlight: view.inFlight.map((m) => m.id),
        partition: view.network.partition as JsonValue,
        links: view.network.links as unknown as JsonValue,
      });
      return { ok: true };
    },
  });
  const result = runSimulation({ ...config, invariants: [...(config.invariants ?? []), observer], invariantPolicy: 'record-and-continue' });
  return { result, captured };
}

function expectDerivationMatches(config: SimulationConfig) {
  const { result, captured } = runCapturing(config);
  const model = buildModel(result.trace);
  expect(captured.length).toBe(result.eventsProcessed);
  for (const c of captured) {
    const frame = frameAt(model, c.lastIndex);
    expect(frame.nodes.map(({ id, status, incarnation, state, stateEntry, storage }) => ({ id, status, incarnation, state, stateEntry, storage }))).toEqual(c.nodes);
    expect(frame.inFlight.map((m) => m.record.id)).toEqual(c.inFlight);
    expect(frame.partition).toEqual(c.partition);
    expect(frame.links).toEqual(c.links);
  }
}

describe('trace derivation matches the live engine after every step', () => {
  it.each(experiments.filter((e) => e.problem === undefined).map((e) => [e.id, e] as const))('%s', (_id, experiment) => {
    expectDerivationMatches(experiment.build());
  });

  it('for random fault plans (heartbeat, incl. link faults)', () => {
    const nodes = ['n1', 'n2', 'n3', 'n4'];
    const node = fc.constantFrom(...nodes);
    const at = fc.integer({ min: 0, max: 400 });
    const fault: fc.Arbitrary<FaultSpec> = fc.oneof(
      fc.record({ at, type: fc.constant('crash' as const), node }),
      fc.record({ at, type: fc.constant('recover' as const), node }),
      fc.record({ at, type: fc.constant('partition' as const), groups: fc.subarray(nodes, { minLength: 1, maxLength: 3 }).map((g) => [g]) }),
      fc.record({ at, type: fc.constant('heal' as const) }),
      fc.record({ at, link: fc.tuple(node, node).filter(([a, b]) => a !== b), loss: fc.integer({ min: 0, max: 100 }) }).map(({ at, link: [from, to], loss }) => ({ at, type: 'link' as const, from, to, loss: loss / 100, delay: { min: 0, max: 15 } })),
      fc.record({ at, link: fc.tuple(node, node).filter(([a, b]) => a !== b) }).map(({ at, link: [from, to] }) => ({ at, type: 'link-restore' as const, from, to })),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.array(fault, { maxLength: 15 }), (seed, faults) => {
        expectDerivationMatches({ seed, nodes, protocol: createHeartbeatProtocol({ interval: 20, timeout: 60 }) as never, network: { latency: { min: 1, max: 12 } }, limits: { maxTime: 450 }, faults });
      }),
      { numRuns: 40, seed: 20261008 },
    );
  });
});

describe('derived playback helpers', () => {
  const model = buildModel(runSimulation(experiments[0]!.build()).trace);

  it('moves messages linearly in virtual time between their send and delivery', () => {
    const record = model.messages.find((m) => m.deliverAt !== null && m.deliverAt - m.sentAt >= 4)!;
    const span = record.deliverAt! - record.sentAt;
    const mid = record.sentAt + span / 2;
    const frame = frameAt(model, lastIndexAtOrBefore(model, mid), mid);
    expect(frame.inFlight.find((m) => m.record.id === record.id)?.progress).toBeCloseTo(0.5, 5);
  });

  it('finds the last entry at or before a virtual time', () => {
    for (const t of [0, 1, 59, 60, 333, model.duration, model.duration + 10]) {
      const i = lastIndexAtOrBefore(model, t);
      expect(model.trace[i]!.time).toBeLessThanOrEqual(Math.max(t, 0));
      if (i + 1 < model.trace.length) expect(model.trace[i + 1]!.time).toBeGreaterThan(t);
    }
  });
});

describe('experiments', () => {
  it('stored counterexamples load without version problems and reproduce their recorded outcome', () => {
    for (const e of experiments.filter((x) => x.source === 'stored counterexample')) {
      expect(e.problem).toBeUndefined();
      const result = runSimulation(e.build());
      const violation = buildModel(result.trace).violations[0]!;
      expect({ time: violation.time, nodes: violation.nodes, eventNumber: violation.eventNumber, fingerprint: fingerprintTrace(result.trace) }).toEqual({
        time: e.expected!.violationTime,
        nodes: e.expected!.nodes,
        eventNumber: e.expected!.eventNumber,
        fingerprint: e.expected!.fingerprint,
      });
    }
  });

  it('every experiment is bounded and deterministic', () => {
    for (const e of experiments) {
      const a = runSimulation(e.build());
      expect(a.eventsProcessed).toBeLessThan(20_000);
      expect(serializeTrace(runSimulation(e.build()).trace)).toBe(serializeTrace(a.trace));
    }
  });
});
