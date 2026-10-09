import { fingerprintTrace, runSimulation, TraceFingerprint, type TraceEntry } from '@faultlab/engine';
import { PRESETS, resolveExperiment } from '@faultlab/experiments';
import { guardConfig } from '@faultlab/runtime';
import { TraceIndex } from '@faultlab/trace';

/** Where does the Worker pipeline spend its time? Each stage measured separately (median of 5). */
const spec = PRESETS.find((p) => p.id === 'raft-long-heartbeats')!.spec;
const config = resolveExperiment(spec).config;
const time = (fn: () => void) => { const ms: number[] = []; for (let r = 0; r < 5; r++) { const t0 = performance.now(); fn(); ms.push(performance.now() - t0); } return Math.round(ms.sort((a, b) => a - b)[2]!); };
let trace: readonly TraceEntry[] = [];
const out: Record<string, number> = {};
out['run'] = time(() => { trace = runSimulation(config).trace; });
out['runGuarded'] = time(() => runSimulation(guardConfig(config)));
out['fingerprintTrace'] = time(() => fingerprintTrace(trace));
out['TraceFingerprint_2048chunks'] = time(() => { const h = new TraceFingerprint(); for (let i = 0; i < trace.length; i += 2048) h.update(trace.slice(i, i + 2048)); h.digest(); });
out['TraceIndex_build'] = time(() => TraceIndex.build(trace));
out['TraceIndex_append_2048'] = time(() => { const ix = TraceIndex.build(trace.slice(0, 2048)); for (let i = 2048; i < trace.length; i += 2048) ix.append(trace.slice(i, i + 2048)); });
out['structuredClone_2048chunks'] = time(() => { for (let i = 0; i < trace.length; i += 2048) structuredClone(trace.slice(i, i + 2048)); });
out['json_roundtrip_2048chunks'] = time(() => { const enc = new TextEncoder(); const dec = new TextDecoder(); for (let i = 0; i < trace.length; i += 2048) JSON.parse(dec.decode(enc.encode(JSON.stringify(trace.slice(i, i + 2048))))); });
console.log(JSON.stringify({ entries: trace.length, ms: out }));
