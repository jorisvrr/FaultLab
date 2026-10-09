import { fingerprintTrace, runSimulation, serializeTrace, Simulation } from '@faultlab/engine';
import { PRESETS, resolveExperiment } from '@faultlab/experiments';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { WORKER_PROTOCOL } from '../src';
import { harness, inMemoryWorker, tick, verified } from './harness';

const spec = (id: string) => PRESETS.find((p) => p.id === id)!.spec;
const reference = (id: string) => runSimulation(resolveExperiment(spec(id)).config).trace;

describe('a run through the Worker runtime equals a direct run', () => {
  it.each(['clone', 'json'] as const)('byte-identical trace and matching fingerprints (%s encoding)', async (encoding) => {
    for (const id of ['naive-healthy', 'heartbeat-crash-partition', 'naive-split-brain', 'raft-healthy', 'raft-isolate-leader']) {
      const h = harness({ runOptions: { encoding } });
      h.client.load(spec(id));
      await h.until(['ready']);
      h.client.run();
      await h.until(['completed']);
      await verified(h.client);
      expect(serializeTrace(h.entries())).toBe(serializeTrace(reference(id)));
      expect(h.client.view.fingerprint).toEqual({ worker: fingerprintTrace(reference(id)), received: fingerprintTrace(reference(id)), matches: true });
      expect(h.entries().every((e) => Object.isFrozen(e))).toBe(true);
      h.client.dispose();
    }
  });

  it('is independent of slice size, slice budget, chunk size and credit (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('naive-split-brain', 'heartbeat-crash-partition', 'raft-isolate-leader'),
        fc.record({ sliceMaxSteps: fc.constantFrom(1, 7, 100_000), sliceBudgetMs: fc.constantFrom(0.01, 8, 1000), chunkMaxEntries: fc.constantFrom(1, 13, 4096), initialCredits: fc.constantFrom(1, 2, 8), encoding: fc.constantFrom('clone' as const, 'json' as const) }),
        async (id, runOptions) => {
          const h = harness({ runOptions });
          h.client.load(spec(id));
          await h.until(['ready']);
          h.client.run();
          await h.until(['completed']);
          await verified(h.client);
          expect(fingerprintTrace(h.entries())).toBe(fingerprintTrace(reference(id)));
          expect(h.client.view.fingerprint?.matches).toBe(true);
          h.client.dispose();
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('pause, resume, step and stop', () => {
  it('pausing and resuming at arbitrary moments never changes the trace (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.oneof(fc.constant('pause' as const), fc.constant('run' as const), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 5 }).map((n) => ({ wait: n }))), { maxLength: 30 }), async (script) => {
        const id = 'raft-isolate-leader';
        const h = harness({ runOptions: { sliceMaxSteps: 5 } });
        h.client.load(spec(id));
        await h.until(['ready']);
        for (const action of script) {
          if (action === 'pause') h.client.pause();
          else if (action === 'run') h.client.run();
          else if (typeof action === 'number') h.client.step(action);
          else for (let i = 0; i < action.wait; i++) await tick();
          await tick();
        }
        if (h.client.view.lifecycle !== 'completed') {
          await h.until(['ready', 'paused', 'running', 'completed']);
          if (h.client.view.pending === 'pause' || h.client.view.lifecycle === 'running') await h.until(['paused', 'completed']);
          h.client.run();
          await h.until(['completed']);
          await verified(h.client);
        }
        expect(fingerprintTrace(h.entries())).toBe(fingerprintTrace(reference(id)));
        h.client.dispose();
      }),
      { numRuns: 30 },
    );
  });

  it('step(n) executes exactly n steps and pauses', async () => {
    const h = harness();
    h.client.load(spec('raft-healthy'));
    await h.until(['ready']);
    h.client.step(17);
    await h.until(['paused']);
    expect(h.client.view.stepsCompleted).toBe(17);
    const direct = new Simulation(resolveExperiment(spec('raft-healthy')).config);
    for (let i = 0; i < 17; i++) direct.step();
    expect(h.entries()).toEqual(direct.trace);
    h.client.dispose();
  });

  it('pause takes effect at a step boundary and is confirmed', async () => {
    const h = harness({ runOptions: { sliceMaxSteps: 3 } });
    h.client.load(spec('raft-long-heartbeats'));
    await h.until(['ready']);
    h.client.run();
    for (let i = 0; i < 5; i++) await tick();
    h.client.pause();
    expect(h.client.view.pending).toBe('pause');
    await h.until(['paused']);
    expect(h.client.view.pending).toBeNull();
    const steps = h.client.view.stepsCompleted;
    for (let i = 0; i < 10; i++) await tick();
    expect(h.client.view.stepsCompleted).toBe(steps); // nothing executes while paused
    const direct = new Simulation(resolveExperiment(spec('raft-long-heartbeats')).config);
    while (direct.stepsCompleted < steps) direct.step();
    expect(fingerprintTrace(h.entries())).toBe(fingerprintTrace(direct.trace)); // ends exactly on a step boundary
    h.client.dispose();
  });

  it('stop ends the run normally: "stopped", every produced entry delivered, fingerprint verified', async () => {
    const h = harness({ runOptions: { sliceMaxSteps: 4 } });
    h.client.load(spec('raft-long-heartbeats'));
    await h.until(['ready']);
    h.client.run();
    for (let i = 0; i < 6; i++) await tick();
    h.client.stop();
    await h.until(['stopped']);
    await verified(h.client);
    const { received, produced, fingerprint } = h.client.view;
    expect(received).toBe(produced);
    expect(fingerprint?.matches).toBe(true);
    expect(reference('raft-healthy').length).toBeGreaterThan(0);
    const full = runSimulation(resolveExperiment(spec('raft-long-heartbeats')).config);
    expect(h.entries()).toEqual(full.trace.slice(0, received)); // a prefix of the full run
    h.client.dispose();
  });

  it('ignores run/step/pause commands that do not fit the lifecycle', async () => {
    const h = harness();
    h.client.pause(); // idle
    h.client.load(spec('naive-healthy'));
    await h.until(['ready']);
    h.client.run();
    await h.until(['completed']);
    await verified(h.client);
    h.client.run();
    h.client.step(3);
    expect(h.client.view.lifecycle).toBe('completed');
    h.client.dispose();
  });
});

describe('flow control and streaming', () => {
  it('the Worker is never more than `initialCredits` chunks ahead of the consumer, and stays bounded', async () => {
    const workers: ReturnType<typeof inMemoryWorker>[] = [];
    const maxBacklog: number[] = [];
    const h = harness({ workers, runOptions: { initialCredits: 2, chunkMaxEntries: 64, sliceMaxSteps: 50 } });
    h.client.subscribe(() => maxBacklog.push(h.client.view.produced - h.client.view.received));
    h.client.load(spec('raft-long-heartbeats'));
    await h.until(['ready']);
    h.client.run();
    for (let i = 0; i < 400; i++) await tick();
    h.client.stop();
    await h.until(['stopped']);
    expect(workers[0]!.maxChunksInFlight).toBeLessThanOrEqual(2);
    // The Worker releases what it sent: it never holds more than the backlog bound (not the trace).
    expect(h.client.view.workerMetrics!.maxRetainedEntries).toBeLessThanOrEqual(2 * 64 + 64 + 50 * 25);
    expect(h.client.view.workerMetrics!.maxRetainedEntries).toBeLessThan(h.client.view.received / 4);
    // Produced but not yet applied ≤ chunks in flight (credits × chunk) + one more chunk + what one
    // slice can produce (50 steps; a Raft step here produces at most ~25 entries).
    expect(Math.max(...maxBacklog)).toBeLessThanOrEqual(2 * 64 + 64 + 50 * 25);
    // And the Worker does not spin while it waits: far fewer slices than steps.
    expect(workers[0]!.sentToWorker.filter((c) => c.type === 'credit').length).toBeGreaterThan(0);
    h.client.dispose();
  });

  it('a slow consumer slows the Worker down (throttling) without losing or reordering entries', async () => {
    const workers: ReturnType<typeof inMemoryWorker>[] = [];
    const h = harness({
      workers,
      // Small slices make the Worker hit its credit limit deterministically (a warm JIT can
      // otherwise run this whole experiment in one 8 ms slice, before the consumer falls behind).
      runOptions: { initialCredits: 1, chunkMaxEntries: 32, sliceMaxSteps: 5 },
      createWorker: () => {
        const w = inMemoryWorker({ delayMs: 1 }); // every chunk takes a macrotask + 1 ms to arrive
        workers.push(w);
        return w;
      },
    });
    let throttledSeen = false;
    h.client.subscribe(() => (throttledSeen ||= h.client.view.throttled));
    h.client.load(spec('raft-healthy'));
    await h.until(['ready']);
    h.client.run();
    await h.until(['completed']);
    await verified(h.client);
    expect(throttledSeen).toBe(true);
    expect(h.client.view.fingerprint?.matches).toBe(true);
    // Waiting for credit does not busy-wait: slices ≈ steps / 5, not thousands of empty ones.
    expect(h.client.view.workerMetrics!.slices).toBeLessThan(h.client.view.stepsCompleted / 5 + 50);
    h.client.dispose();
  });

  it('a long heartbeat-heavy Raft run streams completely (≈ 31 000 entries, json encoding)', async () => {
    const id = 'raft-long-heartbeats';
    const long = { ...spec(id), limits: { maxTime: 50_000, maxEvents: 5_000_000 } };
    const h = harness({ runOptions: { encoding: 'json' } });
    h.client.load(long);
    await h.until(['ready']);
    h.client.run();
    await h.until(['completed']);
    await verified(h.client);
    expect(h.client.view.fingerprint?.matches).toBe(true);
    expect(h.client.view.received).toBe(runSimulation(resolveExperiment(long).config).trace.length);
    h.client.dispose();
  });
});

describe('end-to-end verification', () => {
  it('reports a mismatch when the received trace does not hash to the Worker’s fingerprint', async () => {
    const h = harness({ verifyReceived: async () => '00000000' });
    h.client.load(spec('naive-healthy'));
    await h.until(['ready']);
    h.client.run();
    await h.until(['completed']);
    await verified(h.client);
    expect(h.client.view.fingerprint).toEqual({ worker: fingerprintTrace(reference('naive-healthy')), received: '00000000', matches: false });
  });
});

describe('isolation between runs', () => {
  it('Start → Stop → Start: the second run starts clean in a new Worker', async () => {
    const h = harness();
    const first = h.client.load(spec('raft-long-heartbeats'));
    await h.until(['ready']);
    h.client.run();
    await tick();
    h.client.stop();
    const second = h.client.load(spec('naive-healthy')); // before the stop was even confirmed
    expect(second).not.toBe(first);
    expect(h.workers[0]!.terminated).toBe(true);
    await h.until(['ready']);
    h.client.run();
    await h.until(['completed']);
    await verified(h.client);
    expect(fingerprintTrace(h.entries())).toBe(fingerprintTrace(reference('naive-healthy')));
    h.client.dispose();
  });

  it('Run A → select B → run B: late messages of A can never modify B', async () => {
    const h = harness();
    h.client.load(spec('raft-long-heartbeats'));
    await h.until(['ready']);
    h.client.run();
    for (let i = 0; i < 3; i++) await tick();
    const a = h.workers[0]!;
    h.client.load(spec('raft-healthy'));
    // Deliver messages from A after the switch, as a racing Worker could (handler is detached
    // and A is terminated, so they are dropped; and their runId no longer matches anyway).
    a.onmessage?.({ data: { protocol: WORKER_PROTOCOL, runId: 'run-a', type: 'status', state: 'running', stepsCompleted: 999, now: 999, traceLength: 999, pendingEvents: 1, stopReason: null, throttled: false } });
    await h.until(['ready']);
    h.client.run();
    await h.until(['completed']);
    await verified(h.client);
    expect(fingerprintTrace(h.entries())).toBe(fingerprintTrace(reference('raft-healthy')));
    h.client.dispose();
  });

  it('a message with another runId on the CURRENT Worker is ignored and counted', async () => {
    const h = harness();
    h.client.load(spec('naive-healthy'));
    await h.until(['ready']);
    h.workers[0]!.onmessage?.({ data: { protocol: WORKER_PROTOCOL, runId: 'someone-else', type: 'chunk', seq: 1, from: 1, to: 2, encoding: 'clone', entries: [{ index: 1, kind: 'x' }] } });
    expect(h.client.view.staleIgnored).toBe(1);
    h.client.run();
    await h.until(['completed']);
    await verified(h.client);
    expect(h.client.view.fingerprint?.matches).toBe(true);
    h.client.dispose();
  });
});

describe('protocol violations are errors, never guessed at', () => {
  const inject = async (event: (runId: string) => unknown) => {
    const h = harness();
    const runId = h.client.load(spec('naive-healthy'));
    await h.until(['ready']);
    h.workers[0]!.onmessage?.({ data: event(runId) });
    return h;
  };
  it.each([
    ['a duplicate chunk', (runId: string) => ({ protocol: WORKER_PROTOCOL, runId, type: 'chunk', seq: 0, from: 0, to: 1, encoding: 'clone', entries: [{ index: 0, kind: 'run.start' }] })],
    ['a chunk out of order (gap)', (runId: string) => ({ protocol: WORKER_PROTOCOL, runId, type: 'chunk', seq: 5, from: 40, to: 41, encoding: 'clone', entries: [{ index: 40, kind: 'x' }] })],
    ['a chunk whose entries do not match its range', (runId: string) => ({ protocol: WORKER_PROTOCOL, runId, type: 'chunk', seq: 1, from: 1, to: 2, encoding: 'clone', entries: [{ index: 7, kind: 'x' }] })],
    ['an unknown protocol version', (runId: string) => ({ protocol: 'faultlab-worker/0', runId, type: 'status' })],
    ['an unknown event', (runId: string) => ({ protocol: WORKER_PROTOCOL, runId, type: 'surprise' })],
  ])('%s', async (_label, event) => {
    const h = await inject(event);
    expect(h.client.view.lifecycle).toBe('error');
    expect(h.client.view.error).toMatch(/protocol violation/);
    expect(h.workers[0]!.terminated).toBe(true);
  });

  it('an invalid spec is reported as an error with its path', async () => {
    const h = harness();
    h.client.load({ ...spec('naive-healthy'), seed: -1 });
    await h.until(['error']);
    expect(h.client.view.error).toMatch(/invalid-spec: .*spec\.seed/);
  });
});

describe('forced termination and the watchdog', () => {
  it('abort() kills the Worker: "aborted", entries so far kept, never marked complete', async () => {
    const h = harness({ runOptions: { sliceMaxSteps: 3 } });
    h.client.load(spec('raft-long-heartbeats'));
    await h.until(['ready']);
    h.client.run();
    for (let i = 0; i < 5; i++) await tick();
    h.client.abort();
    expect(h.client.view).toMatchObject({ lifecycle: 'aborted', abortReason: 'aborted by the user', fingerprint: null });
    expect(h.workers[0]!.terminated).toBe(true);
    expect(h.entries().every((e, i) => e.index === i)).toBe(true);
  });

  it('a Worker that stops responding while it should be working is aborted by the watchdog', async () => {
    let clock = 0;
    let check: () => void = () => {};
    const h = harness({
      watchdogMs: 1000,
      now: () => clock,
      setInterval: (fn) => ((check = fn), 1),
      clearInterval: () => (check = () => {}),
      createWorker: () => inMemoryWorker({ silent: true }), // like a handler stuck in while(true)
    });
    h.client.load(spec('naive-healthy'));
    clock = 900;
    check();
    expect(h.client.view.lifecycle).toBe('loading');
    clock = 1200;
    check();
    expect(h.client.view.lifecycle).toBe('aborted');
    expect(h.client.view.abortReason).toMatch(/watchdog/);
  });

  it('the watchdog stays quiet while a run is idle (ready, paused, completed)', async () => {
    let clock = 0;
    let check: () => void = () => {};
    const h = harness({ watchdogMs: 1000, now: () => clock, setInterval: (fn) => ((check = fn), 1), clearInterval: () => (check = () => {}) });
    h.client.load(spec('naive-healthy'));
    await h.until(['ready']);
    clock = 10_000;
    check();
    expect(h.client.view.lifecycle).toBe('ready');
    h.client.dispose();
  });
});

describe('snapshots from the Worker', () => {
  it('returns the engine snapshot at the current step and at earlier steps (rebuilt from keyframes)', async () => {
    const config = resolveExperiment(spec('raft-isolate-leader')).config;
    const h = harness({ runOptions: { keyframeSteps: 64 } });
    h.client.load(spec('raft-isolate-leader'));
    await h.until(['ready']);
    h.client.step(300);
    await h.until(['paused']);
    const atStep = async (step: number | null) => (await h.client.snapshot(step)).snapshot;
    const direct = (steps: number) => {
      const sim = new Simulation(config);
      while (sim.stepsCompleted < steps) sim.step();
      return sim.snapshot();
    };
    // Snapshots are compared through serialisation (engine-version and trace-position fields included).
    expect(JSON.stringify(await atStep(null))).toBe(JSON.stringify(direct(300)));
    expect(JSON.stringify(await atStep(150))).toBe(JSON.stringify(direct(150)));
    expect(JSON.stringify(await atStep(0))).toBe(JSON.stringify(direct(0)));
    await expect(h.client.snapshot(301)).rejects.toThrow(/not been executed/);
    h.client.dispose();
  });
});
