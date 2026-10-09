import { TimeTravel } from '@faultlab/engine';
import { WORKLOADS } from './workloads';

/** PERF-4 follow-up: repeat the same seek targets (are outliers target-dependent?); log wall time per seek with a marker for --trace-gc correlation. */
const K = Number(process.argv[2] ?? 4096);
const travel = TimeTravel.record(WORKLOADS['naive8']!(), { keyframeSteps: K, retainTrace: true });
let x = 12345;
const rand = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) % travel.totalSteps);
const targets = Array.from({ length: 200 }, rand);
const time = (t: number) => { const t0 = performance.now(); travel.seek(t); return performance.now() - t0; };
const first = targets.map((t) => ({ t, ms: time(t) }));
const slow = first.filter((s) => s.ms > 25);
const repeat = slow.map((s) => ({ ...s, again: [time(s.t), time(s.t), time(s.t)].map((v) => +v.toFixed(1)) }));
console.log(JSON.stringify({ K, slow: repeat.map((r) => ({ target: r.t, first: +r.ms.toFixed(1), again: r.again })) }));
