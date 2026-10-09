import { runSimulation } from '@faultlab/engine';
import { PRESETS, resolveExperiment } from '@faultlab/experiments';
import { TraceIndex } from '@faultlab/trace';
import { Session } from '../state/session';

/**
 * CP5 measurement page (bench.html), driven by e2e/performance.spec.ts in each browser. Uses the
 * same Session / Worker / TraceIndex pipeline as the app, without React, so pipeline costs can be
 * measured in isolation. Results are plain JSON.
 */
const createWorker = () => new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), { type: 'module' }) as never;
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

/** JS heap after a forced GC (Chromium with --expose-gc only; null elsewhere: no standard API). */
const heapMB = (): number | null => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const gc = (globalThis as { gc?: () => void }).gc;
  if (memory === undefined || gc === undefined) return null;
  gc();
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

async function workerRun(presetId: string, runOptions: Record<string, unknown> = {}, pauseResumeCycles = 0) {
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
 * Leak check (Chromium only, needs --expose-gc): the heap after a forced GC, before and after
 * several long runs that were each disposed. Per-structure sizes are measured in Node (identical
 * V8); in the browser, attributing heap to one structure proved unreliable (see TEST_STRATEGY).
 */
async function leakCheck(runs = 3) {
  const heaps = [heapMB()];
  for (let i = 0; i < runs; i++) {
    await workerRun('raft-long-heartbeats');
    heaps.push(heapMB());
  }
  return heaps;
}

(globalThis as { faultlabBench?: unknown }).faultlabBench = { workerRun, mainThreadRun, leakCheck };
