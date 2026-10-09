import { runSimulation } from '@faultlab/engine';
import { PRESETS, resolveExperiment } from '@faultlab/experiments';
import { TraceIndex } from '@faultlab/trace';
import { Session } from '../state/session';

/**
 * CP5 measurement page (bench.html), driven by e2e/performance.spec.ts in each browser. Uses the
 * same Session / Worker / TraceIndex pipeline as the app, without React, so pipeline costs can be
 * measured in isolation. Results are plain JSON.
 */
/** Workers created and terminated, so the leak check can prove every run released its Worker. */
const workers = { created: 0, terminated: 0 };
const createWorker = () => {
  workers.created++;
  const worker = new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), { type: 'module' });
  const terminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    workers.terminated++;
    terminate();
  };
  return worker as never;
};
const spec = (id: string) => PRESETS.find((p) => p.id === id)!.spec;

/** Animation-frame gaps while `work` runs: what a user would perceive as jank. */
async function framesDuring<T>(work: () => Promise<T>): Promise<{ result: T; frames: number; maxGapMs: number; gapsOver50: number; longTasks: number[] | null }> {
  const gaps: number[] = [];
  let last = performance.now();
  let running = true;
  // performance.now() INSIDE the callback: the rAF timestamp argument is the frame's scheduled
  // time, which hid a 350 ms main-thread block in the first version of this measurement.
  const loop = () => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    if (running) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  let longTasks: number[] | null = null;
  let observer: PerformanceObserver | null = null;
  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longTasks = [];
    observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks!.push(Math.round(e.duration))));
    observer.observe({ entryTypes: ['longtask'] });
  }
  // Let the event loop turn first, so synchronous work cannot start before the first frame is requested.
  await new Promise((r) => setTimeout(r, 0));
  const result = await work();
  await new Promise((r) => requestAnimationFrame(r));
  running = false;
  // Long-task entries are delivered asynchronously: collect pending ones before disconnecting.
  observer?.takeRecords().forEach((e) => longTasks!.push(Math.round(e.duration)));
  observer?.disconnect();
  return { result, frames: gaps.length, maxGapMs: Math.round(Math.max(0, ...gaps)), gapsOver50: gaps.filter((g) => g > 50).length, longTasks };
}

function settle(session: Session, states: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (states.includes(session.view.run.lifecycle)) {
        off();
        resolve();
      }
    };
    const off = session.subscribe(check);
    check();
  });
}

/**
 * JS heap after the heap has settled (Chromium with --expose-gc only; null elsewhere: there is
 * no standard API). One `gc()` is not enough: objects released through finalization — a
 * terminated Worker among them — can need a turn of the event loop and a second pass, which is
 * what made single-sample readings jump by a few MB.
 */
const heapMB = async (): Promise<number | null> => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const gc = (globalThis as { gc?: () => void }).gc;
  if (memory === undefined || gc === undefined) return null;
  for (let i = 0; i < 3; i++) {
    gc();
    await new Promise((r) => setTimeout(r, 25));
  }
  return Math.round(memory.usedJSHeapSize / 1e5) / 10;
};

/** Seeking on the main thread: frameAt at random positions (timeline navigation). */
function measureSeeks(session: Session): number[] {
  const index = session.trace.index!;
  const seeks: number[] = [];
  let x = 12345;
  for (let i = 0; i < 300; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const t0 = performance.now();
    index.frameAt(x % index.length);
    seeks.push(performance.now() - t0);
  }
  return seeks.sort((a, b) => a - b);
}

/** Seeking in the Worker: engine snapshots at random earlier steps (keyframe + re-execution). */
async function measureWorkerSnapshots(session: Session, steps: number): Promise<number[]> {
  const snapshots: number[] = [];
  let x = 54321;
  for (let i = 0; i < 20; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const t0 = performance.now();
    await session.client.snapshot(x % (steps + 1));
    snapshots.push(performance.now() - t0);
  }
  return snapshots.sort((a, b) => a - b);
}

/** `keep`: only the leak check's fault-injection mode passes this, to retain each run on purpose. */
async function workerRun(presetId: string, runOptions: Record<string, unknown> = {}, pauseResumeCycles = 0, keep: unknown[] | null = null) {
  const session = new Session({ createWorker, schedule: (fn) => requestAnimationFrame(fn), runOptions });
  const measured = await framesDuring(async () => {
    const t0 = performance.now();
    session.load(spec(presetId), { id: presetId, title: presetId, summary: '', category: 'bench' });
    await settle(session, ['ready', 'error']);
    session.run();
    for (let i = 0; i < pauseResumeCycles; i++) {
      await new Promise((r) => setTimeout(r, 5));
      session.pause();
      await settle(session, ['paused', 'completed']);
      if (session.view.run.lifecycle === 'completed') break;
      session.run();
    }
    await settle(session, ['completed', 'stopped', 'aborted', 'error']);
    const executed = performance.now() - t0;
    // Wait for the (non-blocking) verification of the received trace; frames keep being measured.
    await new Promise<void>((resolve) => {
      const check = () => (session.view.run.fingerprint === null || session.view.run.fingerprint.matches !== null) && (off(), resolve());
      const off = session.subscribe(check);
      check();
    });
    return executed;
  });
  const v = session.view.run;
  // Separate functions: a local `index` here would keep the TraceIndex reachable during the
  // "dropped" heap measurement below (the first version measured noise because of that).
  const seeks = measureSeeks(session);
  const snapshots = await measureWorkerSnapshots(session, v.stepsCompleted);
  session.dispose();
  if (keep !== null) keep.push(session); // deliberate retention; see leakCheck({ retain: true })
  return {
    presetId,
    runOptions,
    lifecycle: v.lifecycle,
    matches: v.fingerprint?.matches ?? false,
    entries: v.received,
    steps: v.stepsCompleted,
    chunks: v.chunks,
    wallMs: Math.round(measured.result),
    entriesPerSecond: Math.round(v.received / (measured.result / 1000)),
    worker: v.workerMetrics,
    mainAppendMs: Math.round(session.trace.appendMs),
    mainMaxAppendMs: +session.trace.maxAppendMs.toFixed(2),
    mainChunkMs: Math.round(v.chunkMs),
    mainMaxChunkMs: +v.maxChunkMs.toFixed(2),
    frames: measured.frames,
    maxFrameGapMs: measured.maxGapMs,
    frameGapsOver50ms: measured.gapsOver50,
    longTasks: measured.longTasks,
    frameAtMedianMs: +seeks[150]!.toFixed(3),
    frameAtMaxMs: +seeks.at(-1)!.toFixed(3),
    workerSnapshotMedianMs: +snapshots[10]!.toFixed(1),
    workerSnapshotMaxMs: +snapshots.at(-1)!.toFixed(1),
  };
}

/** Baseline: the same experiment executed ON THE MAIN THREAD (what CP2.5 did). */
async function mainThreadRun(presetId: string) {
  const measured = await framesDuring(async () => {
    const t0 = performance.now();
    const { trace } = runSimulation(resolveExperiment(spec(presetId)).config);
    const t1 = performance.now();
    TraceIndex.build(trace);
    return { runMs: t1 - t0, indexMs: performance.now() - t1, entries: trace.length };
  });
  return { presetId, ...measured.result, runMs: Math.round(measured.result.runMs), indexMs: Math.round(measured.result.indexMs), maxFrameGapMs: measured.maxGapMs, frameGapsOver50ms: measured.gapsOver50, longTasks: measured.longTasks };
}

/**
 * Leak check (Chromium only, needs --expose-gc).
 *
 * The CP5 version compared the heap after the last of three runs against a sample taken BEFORE
 * any run, i.e. against a cold page. That difference is dominated by one-off warm-up (code that
 * V8 compiles on first execution, Worker module instantiation, the engine's constant data), so
 * for identical code it reported 16–20 MB of "growth" from a cold start and 2 MB from a warm
 * one. It measured warm-up, not retention, and failed intermittently for that reason.
 *
 * This version measures only the steady state:
 * - `warmup` runs first, whose measurements are discarded;
 * - then `samples` measurements, each taken after a further run that was disposed;
 * - growth is the least-squares slope over those samples scaled to the whole window, so a run
 *   that is high or low by chance cannot decide the result and continuous growth cannot hide
 *   between two end points;
 * - `workersLeaked` proves every run released its Worker.
 *
 * With `retain: true` each disposed Session is kept alive on purpose. That is the fault
 * injection the revised check is verified against (e2e/memory.spec.ts): a check that cannot
 * fail is worthless.
 */
async function leakCheck({ warmup = 2, samples = 5, retain = false }: { warmup?: number; samples?: number; retain?: boolean } = {}) {
  const retained: unknown[] = [];
  const workersBefore = { ...workers };
  for (let i = 0; i < warmup; i++) await workerRun('raft-long-heartbeats');
  const warmBaseline = await heapMB();
  const heaps: number[] = [];
  for (let i = 0; i < samples; i++) {
    await workerRun('raft-long-heartbeats', {}, 0, retain ? retained : null);
    const heap = await heapMB();
    if (heap === null) return { supported: false as const };
    heaps.push(heap);
  }
  // Least squares over (index, heap): slope in MB per run, then across the measured window.
  const n = heaps.length;
  const meanX = (n - 1) / 2;
  const meanY = heaps.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - meanX) * (heaps[i]! - meanY);
    sxx += (i - meanX) ** 2;
  }
  const perRunMB = sxx === 0 ? 0 : sxy / sxx;
  return {
    supported: true as const,
    warmup,
    warmBaselineMB: warmBaseline,
    heapsMB: heaps,
    perRunMB: +perRunMB.toFixed(2),
    growthMB: +(perRunMB * (n - 1)).toFixed(2),
    spreadMB: +(Math.max(...heaps) - Math.min(...heaps)).toFixed(1),
    workersCreated: workers.created - workersBefore.created,
    workersLeaked: workers.created - workersBefore.created - (workers.terminated - workersBefore.terminated),
    retainedForFaultInjection: retained.length,
  };
}

(globalThis as { faultlabBench?: unknown }).faultlabBench = { workerRun, mainThreadRun, leakCheck };
