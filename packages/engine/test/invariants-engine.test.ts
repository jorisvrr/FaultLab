import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { ConfigError } from '../src/errors';
import { createHeartbeatProtocol, createPingProtocol } from '../src/fixtures';
import { defineInvariant, type Invariant, type InvariantPolicy, type InvariantVerdict } from '../src/invariants';
import type { JsonValue } from '../src/json';
import { runSimulation, Simulation } from '../src/simulation';
import { serializeTrace, type TraceEntry } from '../src/trace';
import { config, mutabilityProblems, ofKind } from './helpers';

const always = (verdict: () => InvariantVerdict<null>, id = 'probe'): Invariant =>
  defineInvariant({ id, version: '1', name: `Probe ${id}`, initialHistory: null, check: verdict });

/** Fails exactly when `failing(time)` is true. */
const failingWhen = (failing: (time: number) => boolean, id = 'window', nodes: string[] = ['n1']): Invariant =>
  defineInvariant({
    id,
    version: '1',
    name: `Window ${id}`,
    initialHistory: null,
    check: ({ view }) =>
      failing(view.time) ? { ok: false, violation: { nodes, expected: 'quiet', observed: `noisy at ${view.time}` } } : { ok: true },
  });

const heartbeat = (overrides: Parameters<typeof config>[1] = {}) =>
  config(createHeartbeatProtocol({ interval: 20, timeout: 60 }), { limits: { maxTime: 300 }, ...overrides });

const pathOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.path;
    throw error;
  }
  return undefined;
};

describe('evaluation', () => {
  it('runs after every committed step, including fault-only and drop-only steps', () => {
    const counter = defineInvariant({
      id: 'counter',
      version: '1',
      name: 'Step counter',
      initialHistory: { steps: 0, covered: [] as number[] },
      check: ({ step, view, history }) => {
        // Every step's entries are contiguous and start with its trigger.
        if (step.entries[0] !== step.trigger) throw new Error('trigger must be the first entry');
        if (view.eventNumber !== history.steps + 1) throw new Error('eventNumber must count steps');
        if (view.time !== step.trigger.time) throw new Error('view time must equal the trigger time');
        return { ok: true, history: { steps: history.steps + 1, covered: [...history.covered, ...step.entries.map((e) => e.index)] } };
      },
    });
    const sim = new Simulation(
      heartbeat({
        invariants: [counter],
        faults: [
          { at: 40, type: 'crash', node: 'n2' },
          { at: 90, type: 'partition', groups: [['n1']] },
          { at: 150, type: 'recover', node: 'n2' },
          { at: 200, type: 'heal' },
        ],
      }),
    );
    const result = sim.run();
    const history = sim.invariantHistory('counter') as { steps: number; covered: number[] };
    expect(result.reason).toBe('time-limit');
    expect(history.steps).toBe(result.eventsProcessed);
    // Steps cover every entry between run.start and run.end exactly once, in order.
    expect(history.covered).toEqual(result.trace.slice(1, -1).map((e) => e.index));
    expect(ofKind(result.trace, 'message.drop').length).toBeGreaterThan(0);
  });

  it('does not change the run: identical trace to an unchecked run apart from run.start metadata', () => {
    const benign = always(() => ({ ok: true }));
    const checked = runSimulation(heartbeat({ invariants: [benign], faults: [{ at: 50, type: 'crash', node: 'n3' }] })).trace;
    const unchecked = runSimulation(heartbeat({ faults: [{ at: 50, type: 'crash', node: 'n3' }] })).trace;
    expect(serializeTrace(checked.slice(1))).toBe(serializeTrace(unchecked.slice(1)));
  });

  it('is deterministic: the same invariants give the same trace on every run', () => {
    const inv = failingWhen((t) => t >= 100 && t < 150);
    const cfg = heartbeat({ invariants: [inv], invariantPolicy: 'record-and-continue' });
    expect(serializeTrace(runSimulation(cfg).trace)).toBe(serializeTrace(runSimulation(cfg).trace));
  });
});

describe('runtime immutability (TypeScript readonly is not enough)', () => {
  const audit = mutabilityProblems;

  it('exposes only deeply frozen plain data and frozen functions to invariants', () => {
    const problems: string[] = [];
    const auditor = always(() => ({ ok: true }));
    const wrapped = defineInvariant({
      ...auditor,
      check: (input) => {
        problems.push(...audit(input));
        return { ok: true };
      },
    });
    runSimulation(
      heartbeat({
        invariants: [wrapped],
        faults: [
          { at: 30, type: 'link', from: 'n1', to: 'n2', loss: 0.5, delay: { min: 1, max: 5 } },
          { at: 60, type: 'partition', groups: [['n3']] },
          { at: 70, type: 'crash', node: 'n2' },
        ],
      }),
    );
    expect([...new Set(problems)]).toEqual([]);
  });

  const attempts: Array<[string, (input: Parameters<Invariant['check']>[0]) => void]> = [
    ['protocol state', ({ view }) => ((view.nodes[0]!.state as Record<string, unknown>)['boot'] = 99)],
    ['a node view field', ({ view }) => ((view.nodes[0] as { status: string }).status = 'crashed')],
    ['the node list', ({ view }) => (view.nodes as unknown[]).pop()],
    ['storage', ({ view }) => ((view.nodes[0]!.storage as Record<string, unknown>)['boots'] = 0)],
    ['the in-flight list', ({ view }) => (view.inFlight as unknown[]).splice(0)],
    ['an in-flight message', ({ view }) => (view.inFlight[0] as unknown as { deliverAt: number }).deliverAt++],
    ['the view itself', ({ view }) => ((view as { time: number }).time = -1)],
    ['the lookup function', ({ view }) => Object.defineProperty(view.node, 'hijacked', { value: true })],
    ['network conditions', ({ view }) => (view.network.links as unknown[]).push({})],
    ['a trace entry', ({ step }) => ((step.trigger as { time: number }).time = 0)],
    ['the step entries', ({ step }) => (step.entries as unknown[]).push(null)],
  ];

  it.each(attempts)('contains an attempt to mutate %s: invariant.error, nothing changed', (_label, mutate) => {
    const benign = always(() => ({ ok: true }), 'same-id');
    const attacker = always(() => ({ ok: true }), 'same-id');
    const hostile = defineInvariant({
      ...attacker,
      check: (input) => {
        // Attack in the first step where every target exists (a message in flight, n1 has state).
        if (input.view.time >= 45 && input.view.inFlight.length > 0 && input.view.nodes[0]?.state !== undefined) mutate(input);
        return { ok: true };
      },
    });
    const cfg = heartbeat({ invariants: [hostile] });
    const attacked = runSimulation(cfg);
    const [error] = ofKind(attacked.trace, 'invariant.error');
    expect(attacked.reason).toBe('invariant-error');
    // A genuine write refusal, not "cannot read property of undefined".
    expect(error?.error).toMatch(/^TypeError: /);
    expect(error?.error).not.toMatch(/undefined|null/);
    // Everything before the error entry is identical to a run with a benign invariant.
    const reference = runSimulation({ ...cfg, invariants: [benign] }).trace;
    expect(serializeTrace(attacked.trace.slice(0, error!.index))).toBe(serializeTrace(reference.slice(0, error!.index)));
  });

  it('ignores silent mutation attempts (Reflect.set returns false on frozen data)', () => {
    const silent = defineInvariant({
      ...always(() => ({ ok: true }), 'same-id'),
      check: ({ view }) => {
        const results = [
          Reflect.set((view.nodes[0]?.state ?? {}) as object, 'boot', 42),
          Reflect.set(view, 'time', 0),
          Reflect.deleteProperty(view.nodes as object, '0'),
        ];
        return results.some(Boolean) ? { ok: false, violation: { nodes: [], expected: 'frozen', observed: 'mutated' } } : { ok: true };
      },
    });
    const cfg = heartbeat({ invariants: [silent] });
    const result = runSimulation(cfg);
    expect(result.reason).toBe('time-limit');
    expect(serializeTrace(result.trace)).toBe(serializeTrace(runSimulation({ ...cfg, invariants: [always(() => ({ ok: true }), 'same-id')] }).trace));
  });
});

describe('historical state', () => {
  it('is validated, frozen, passed back on the next step, and inspectable', () => {
    const seen: boolean[] = [];
    const inv = defineInvariant({
      id: 'history',
      version: '1',
      name: 'History probe',
      initialHistory: { maxBoots: {} as Record<string, number> },
      check: ({ view, history }) => {
        seen.push(Object.isFrozen(history) && Object.isFrozen(history.maxBoots));
        const maxBoots = { ...history.maxBoots };
        for (const node of view.nodes) {
          const boots = node.storage['boots'] as number | undefined;
          if (boots !== undefined) maxBoots[node.id] = Math.max(maxBoots[node.id] ?? 0, boots);
        }
        return { ok: true, history: { maxBoots } };
      },
    });
    const sim = new Simulation(
      heartbeat({
        invariants: [inv],
        faults: [
          { at: 50, type: 'crash', node: 'n1' },
          { at: 80, type: 'recover', node: 'n1' },
        ],
      }),
    );
    sim.run();
    expect(seen.every(Boolean)).toBe(true);
    expect(sim.invariantHistory('history')).toEqual({ maxBoots: { n1: 2, n2: 1, n3: 1 } });
    expect(Object.isFrozen(sim.invariantHistory('history'))).toBe(true);
    expect(sim.invariantHistory('nope')).toBeUndefined();
  });

  it('rejects non-JSON history as an invariant error, keeping the previous history', () => {
    const inv = defineInvariant({
      id: 'bad-history',
      version: '1',
      name: 'Bad history',
      initialHistory: 0,
      check: ({ history }) => ({ ok: true, history: (history < 3 ? history + 1 : new Map()) as never }),
    });
    const sim = new Simulation(heartbeat({ invariants: [inv] }));
    const result = sim.run();
    expect(result.reason).toBe('invariant-error');
    expect(ofKind(result.trace, 'invariant.error')[0]?.error).toContain('Map is not a plain object');
    expect(sim.invariantHistory('bad-history')).toBe(3);
  });
});

describe('violation policies and ordering (ADR-0013)', () => {
  it('stop-on-first: records the violation and stops after that step', () => {
    const result = runSimulation(heartbeat({ invariants: [failingWhen((t) => t >= 100)] }));
    const [violation] = ofKind(result.trace, 'invariant.violation');
    expect(result.reason).toBe('invariant-violation');
    expect(violation).toMatchObject({ violationId: 'v1', invariant: { id: 'window', version: '1', name: 'Window window' } });
    // Detected after the first step at or after t=100; the step before it was still earlier.
    expect(violation!.time).toBeGreaterThanOrEqual(100);
    expect(result.trace[violation!.trigger - 1]!.time).toBeLessThan(100);
    expect(result.trace.at(-1)).toMatchObject({ kind: 'run.end', reason: 'invariant-violation', time: violation!.time });
    expect(result.trace.at(-2)).toBe(violation);
  });

  it('records every outcome of one step in configuration order, then applies the stop rules', () => {
    const fails = (id: string) => failingWhen((t) => t >= 100, id);
    const passes = always(() => ({ ok: true }), 'passes');
    const result = runSimulation(heartbeat({ invariants: [fails('b-second'), passes, fails('a-first')] }));
    expect(ofKind(result.trace, 'invariant.violation').map((v) => [v.invariant.id, v.violationId])).toEqual([
      ['b-second', 'v1'],
      ['a-first', 'v2'],
    ]);
  });

  it('a checker error outranks violations in the same step and always stops', () => {
    const throwing = always(() => {
      throw new RangeError('checker bug');
    }, 'broken');
    const result = runSimulation(
      heartbeat({ invariants: [failingWhen(() => true), throwing], invariantPolicy: 'record-and-continue' }),
    );
    expect(result.reason).toBe('invariant-error');
    expect(result.trace.slice(-3).map((e) => e.kind)).toEqual(['invariant.violation', 'invariant.error', 'run.end']);
    expect(ofKind(result.trace, 'invariant.error')[0]?.error).toBe('RangeError: checker bug');
  });

  it('record-and-continue: one entry per episode, closed by invariant.cleared, never one per step', () => {
    const inv = failingWhen((t) => (t >= 100 && t < 150) || (t >= 200 && t < 220));
    const result = runSimulation(heartbeat({ invariants: [inv], invariantPolicy: 'record-and-continue' }));
    expect(result.reason).toBe('time-limit');
    const events = result.trace.filter((e) => e.kind === 'invariant.violation' || e.kind === 'invariant.cleared');
    expect(events.map((e) => [e.kind, (e as { violationId: string }).violationId])).toEqual([
      ['invariant.violation', 'v1'],
      ['invariant.cleared', 'v1'],
      ['invariant.violation', 'v2'],
      ['invariant.cleared', 'v2'],
    ]);
    // The first episode spans many steps but produced a single entry.
    const stepsInEpisode = result.trace.filter((e) => e.time >= 100 && e.time < 150 && e.kind === 'timer.fire').length;
    expect(stepsInEpisode).toBeGreaterThan(5);
  });

  it('maxViolations bounds a flapping invariant under record-and-continue', () => {
    const flapping = failingWhen((t) => Math.floor(t / 10) % 2 === 0);
    const result = runSimulation(heartbeat({ invariants: [flapping], invariantPolicy: 'record-and-continue', limits: { maxTime: 300, maxViolations: 3 } }));
    expect(result.reason).toBe('violation-limit');
    expect(ofKind(result.trace, 'invariant.violation')).toHaveLength(3);
  });

  it.each<[string, () => unknown, string]>([
    ['a non-object verdict', () => 'ok', 'verdict must be an object'],
    ['a missing ok flag', () => ({ fine: true }), 'verdict must be an object'],
    ['a failure without a report', () => ({ ok: false }), 'needs a `violation` report'],
    ['an unknown node', () => ({ ok: false, violation: { nodes: ['zz'], expected: 'e', observed: 'o' } }), 'violation.nodes'],
    ['a duplicate node', () => ({ ok: false, violation: { nodes: ['n1', 'n1'], expected: 'e', observed: 'o' } }), 'violation.nodes'],
    ['an empty expectation', () => ({ ok: false, violation: { nodes: [], expected: '', observed: 'o' } }), 'violation.expected'],
    ['an oversized observation', () => ({ ok: false, violation: { nodes: [], expected: 'e', observed: 'o'.repeat(501) } }), 'violation.observed'],
    ['a future reference', () => ({ ok: false, violation: { nodes: [], expected: 'e', observed: 'o', references: [1e9] } }), 'violation.references'],
    ['a negative reference', () => ({ ok: false, violation: { nodes: [], expected: 'e', observed: 'o', references: [-1] } }), 'violation.references'],
    ['non-JSON evidence', () => ({ ok: false, violation: { nodes: [], expected: 'e', observed: 'o', evidence: { f: () => 1 } } }), 'InvalidJsonError'],
  ])('turns %s into an invariant.error', (_label, verdict, message) => {
    const result = runSimulation(heartbeat({ invariants: [always(verdict as never)] }));
    expect(result.reason).toBe('invariant-error');
    expect(ofKind(result.trace, 'invariant.error')[0]?.error).toContain(message);
  });
});

describe('explainable violation records', () => {
  /** Fails when n1 suspects anyone, naming n1 and the suspects; cites n1's latest state entry. */
  const noSuspicion = defineInvariant({
    id: 'no-suspicion',
    version: '2',
    name: 'Nobody is suspected',
    initialHistory: null,
    check: ({ view }) => {
      const n1 = view.node('n1');
      const suspected = ((n1.state as { suspected?: string[] } | undefined)?.suspected ?? []) as string[];
      if (suspected.length === 0) return { ok: true };
      return {
        ok: false,
        violation: {
          nodes: ['n1', ...suspected],
          expected: 'n1 suspects no peer',
          observed: `n1 suspects ${suspected.join(', ')}`,
          evidence: { suspected },
          references: n1.stateEntry === null ? [] : [n1.stateEntry],
        },
      };
    },
  });
  const faults = [
    { at: 20, type: 'link', from: 'n2', to: 'n1', delay: { min: 1, max: 2 } },
    { at: 50, type: 'crash', node: 'n3' },
  ] as const;
  const cfg = heartbeat({ invariants: [noSuspicion], faults: [...faults] });
  const sim = new Simulation(cfg);
  const result = sim.run();
  const violation = ofKind(result.trace, 'invariant.violation')[0]!;
  const at = (i: number | null): TraceEntry | undefined => (i === null ? undefined : result.trace[i]);

  it('names the rule, the nodes, expected vs observed, and structured evidence', () => {
    expect(violation).toMatchObject({
      invariant: { id: 'no-suspicion', version: '2', name: 'Nobody is suspected' },
      nodes: ['n1', 'n3'],
      expected: 'n1 suspects no peer',
      observed: 'n1 suspects n3',
      evidence: { suspected: ['n3'] },
    });
  });

  it('locates the trigger and the step, and links the trigger as its cause', () => {
    expect(violation.cause).toBe(violation.trigger);
    expect(violation.step.first).toBe(violation.trigger);
    expect(violation.step.last).toBe(violation.index - 1);
    expect(at(violation.trigger)).toMatchObject({ kind: 'timer.fire', node: 'n1', tag: 'suspect:n3' });
  });

  it('records state provenance for each cited node (facts, not inferences)', () => {
    const [n1, n3] = violation.nodeStates;
    expect(n1).toMatchObject({ node: 'n1', status: 'running', incarnation: 1 });
    expect(at(n1!.stateEntry)).toMatchObject({ kind: 'state.update', node: 'n1' });
    expect(n3).toEqual({ node: 'n3', status: 'crashed', incarnation: 1, stateEntry: null });
    expect(violation.references).toEqual([n1!.stateEntry]);
  });

  it('lists the faults active at that moment by their trace entries', () => {
    expect(at(violation.activeFaults.links[0]!)).toMatchObject({ kind: 'link.fault', faultId: 'f1' });
    expect(at(violation.activeFaults.crashed[0]!)).toMatchObject({ kind: 'node.crash', node: 'n3' });
    expect(violation.activeFaults.partition).toBeNull();
  });

  it('reproduces: replaying run.start inputs for eventNumber events yields the same states', () => {
    expect(violation.eventNumber).toBe(result.eventsProcessed);
    const replay = new Simulation({ ...cfg, invariants: [], limits: { ...cfg.limits, maxEvents: violation.eventNumber } });
    replay.run();
    for (const id of ['n1', 'n2', 'n3']) expect(replay.nodeState(id)).toEqual(sim.nodeState(id));
  });
});

describe('invariant configuration', () => {
  const base = () => heartbeat();
  const valid = always(() => ({ ok: true }));
  it.each<[string, Record<string, unknown>, string]>([
    ['a non-array list', { invariants: valid }, 'invariants'],
    ['a non-object entry', { invariants: [null] }, 'invariants[0]'],
    ['a bad id', { invariants: [{ ...valid, id: 'Has Spaces' }] }, 'invariants[0].id'],
    ['a duplicate id', { invariants: [valid, valid] }, 'invariants[1].id'],
    ['a missing version', { invariants: [{ ...valid, version: '' }] }, 'invariants[0].version'],
    ['a missing name', { invariants: [{ ...valid, name: undefined }] }, 'invariants[0].name'],
    ['a non-function check', { invariants: [{ ...valid, check: true }] }, 'invariants[0].check'],
    ['a missing initialHistory', { invariants: [{ id: 'x', version: '1', name: 'X', check: () => ({ ok: true }) }] }, 'invariants[0].initialHistory'],
    ['a non-JSON initialHistory', { invariants: [{ ...valid, initialHistory: new Set() }] }, 'invariants[0].initialHistory'],
    ['too many invariants', { invariants: Array.from({ length: 65 }, (_, i) => ({ ...valid, id: `i${i}` })) }, 'invariants'],
    ['an unknown policy', { invariantPolicy: 'ignore' }, 'invariantPolicy'],
    ['zero maxViolations', { limits: { maxViolations: 0 } }, 'limits.maxViolations'],
  ])('rejects %s', (_label, patch, path) => {
    expect(pathOf(() => resolveConfig({ ...base(), ...patch } as never))).toBe(path);
  });

  it('records ids, versions, names and the policy in run.start', () => {
    const policies: InvariantPolicy[] = ['stop-on-first', 'record-and-continue'];
    for (const invariantPolicy of policies) {
      const [start] = ofKind(runSimulation(heartbeat({ invariants: [valid], invariantPolicy })).trace, 'run.start');
      expect(start).toMatchObject({ invariants: [{ id: 'probe', version: '1', name: 'Probe probe' }], invariantPolicy, limits: { maxViolations: 100 } });
    }
    const [plain] = ofKind(runSimulation(createPingConfig()).trace, 'run.start');
    expect(plain).toMatchObject({ invariants: [], invariantPolicy: 'stop-on-first' });
  });
});

const createPingConfig = () => config(createPingProtocol());

// Silence "unused" for JsonValue in some TS configurations.
export type _Json = JsonValue;
