import { TraceIndex } from '@faultlab/trace';
import { traceOf } from './workloads';

/**
 * PERF-3: retained memory of a trace and of its TraceIndex, and of the index's components built
 * separately (same data structures as trace-index.ts), measured with the drop-delta method:
 * heap after GC with the object alive minus heap after GC with it dropped (median of 3).
 */
declare const gc: () => void;
// Typed arrays live outside the JS heap (ArrayBuffer backing stores), so both are counted.
const heap = () => { gc(); gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
const retained = (make: () => unknown): number => {
  const samples: number[] = [];
  for (let r = 0; r < 3; r++) {
    // Held through a global so V8 cannot collect it early (a local that is never read again can
    // be collected before the "alive" measurement: the first version of this script measured 0).
    (globalThis as { held?: unknown }).held = make();
    const alive = heap();
    (globalThis as { held?: unknown }).held = null;
    samples.push(alive - heap());
  }
  return samples.sort((a, b) => a - b)[1]! / 1e6;
};

const name = process.argv[2] ?? 'naive8';
const size = process.argv[3] ? Number(process.argv[3]) : undefined;
const trace = traceOf(name, size);
const n = trace.length;
const out: Record<string, number | string> = { workload: name, entries: n };
out['traceMB'] = +retained(() => traceOf(name, size)).toFixed(1);
for (const c of [64, 256, 1024, 4096]) out[`indexMB_C${c}`] = +retained(() => TraceIndex.build(trace, { checkpointEntries: c })).toFixed(1);
// Components (mirroring trace-index.ts):
out['children_arrays_MB'] = +retained(() => { const ch: number[][] = trace.map(() => []); for (const e of trace) if (e.cause !== null) ch[e.cause]!.push(e.index); return ch; }).toFixed(1);
out['children_CSR_MB'] = +retained(() => { const counts = new Int32Array(n + 1); for (const e of trace) if (e.cause !== null) counts[e.cause + 1]!++; for (let i = 0; i < n; i++) counts[i + 1]! += counts[i]!; const data = new Int32Array(counts[n]!); const fill = counts.slice(0, n); for (const e of trace) if (e.cause !== null) data[fill[e.cause]!++] = e.index; return [counts, data]; }).toFixed(1);
out['stepOf_Int32_MB'] = +retained(() => new Int32Array(n)).toFixed(1);
out['message_records_MB'] = +retained(() => { const m = new Map<string, object>(); for (const e of trace) if (e.kind === 'message.send') m.set(e.messageId, Object.freeze({ id: e.messageId, from: e.node, to: e.to, sendIndex: e.index, sentAt: e.time, deliverAt: e.deliverAt, payload: e.payload, resolvedIndex: null, outcome: 'in-flight', dropReason: null })); return [m, [...m.values()]]; }).toFixed(1);
console.log(JSON.stringify(out));
