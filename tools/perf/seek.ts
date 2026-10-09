import { PerformanceObserver } from 'node:perf_hooks';
import { TimeTravel } from '@faultlab/engine';
import { WORKLOADS } from './workloads';

/**
 * PERF-4: seek latency per keyframe interval, with every GC pause that overlaps each seek
 * (PerformanceObserver 'gc'), to test the CP3 hypothesis "outliers are GC pauses".
 */
const gcs: { start: number; duration: number; kind: number }[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) gcs.push({ start: e.startTime, duration: e.duration, kind: (e as unknown as { detail?: { kind?: number } }).detail?.kind ?? -1 });
}).observe({ entryTypes: ['gc'] });

const name = process.argv[2] ?? 'naive8';
const config = WORKLOADS[name]!();
const rows = [];
for (const K of [256, 1024, 4096]) {
  const travel = TimeTravel.record(config, { keyframeSteps: K, retainTrace: process.argv[3] === 'retain' });
  let x = 12345;
  const rand = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) % travel.totalSteps);
  const seeks: { ms: number; gcMs: number; reexecuted: number }[] = [];
  for (let i = 0; i < 200; i++) {
    const target = rand();
    const t0 = performance.now();
    const { reexecutedSteps } = travel.seek(target);
    const t1 = performance.now();
    seeks.push({ ms: t1 - t0, gcMs: 0, reexecuted: reexecutedSteps });
    (seeks.at(-1) as { t0: number; t1: number } & object as never as { t0: number })['t0'] = t0;
    (seeks.at(-1) as never as { t1: number })['t1'] = t1;
  }
  await new Promise((r) => setTimeout(r, 50)); // let the observer deliver GC entries
  for (const s of seeks as ({ t0: number; t1: number } & (typeof seeks)[number])[]) {
    s.gcMs = gcs.filter((g) => g.start < s.t1 && g.start + g.duration > s.t0).reduce((sum, g) => sum + g.duration, 0);
  }
  const ms = seeks.map((s) => s.ms).sort((a, b) => a - b);
  const slow = seeks.filter((s) => s.ms > 50);
  rows.push({
    K,
    median: +ms[100]!.toFixed(2),
    p95: +ms[190]!.toFixed(2),
    max: +ms[199]!.toFixed(2),
    over50ms: slow.length,
    slowAt: seeks.map((s, i) => [i, +s.ms.toFixed(1), s.reexecuted]).filter(([, ms]) => (ms as number) > 25),
    over50msWithGC: slow.filter((s) => s.gcMs > 0).length,
    gcShareOfSlow: +(slow.reduce((a, s) => a + s.gcMs, 0) / Math.max(1, slow.reduce((a, s) => a + s.ms, 0))).toFixed(2),
    medianWithoutGC: +((seeks.filter((s) => s.gcMs === 0).map((s) => s.ms).sort((a, b) => a - b)[Math.floor(seeks.filter((s) => s.gcMs === 0).length / 2)] ?? 0)).toFixed(2),
    maxWithoutGC: +Math.max(0, ...seeks.filter((s) => s.gcMs === 0).map((s) => s.ms)).toFixed(2),
  });
}
console.log(JSON.stringify(rows));
