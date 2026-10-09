import { canonicalJson, runSimulation, type JsonValue } from '@faultlab/engine';
import { PRESETS, resolveExperiment } from '@faultlab/experiments';

const trace = runSimulation(resolveExperiment(PRESETS.find((p) => p.id === 'raft-long-heartbeats')!.spec).config).trace;
const time = (fn: () => unknown) => { const ms: number[] = []; for (let r = 0; r < 5; r++) { const t0 = performance.now(); fn(); ms.push(performance.now() - t0); } return Math.round(ms.sort((a, b) => a - b)[2]!); };
let text = '';
const canonical = time(() => { text = canonicalJson(trace as unknown as JsonValue); });
// The engine's FNV-1a over UTF-8 (for..of + codePointAt), copied for timing.
const fnvCodePoints = (s: string) => { let h = 0x811c9dc5; const mix = (b: number) => { h ^= b; h = Math.imul(h, 0x01000193); }; for (const ch of s) { const cp = ch.codePointAt(0)!; if (cp < 0x80) mix(cp); else if (cp < 0x800) { mix(0xc0 | (cp >> 6)); mix(0x80 | (cp & 0x3f)); } else if (cp < 0x10000) { mix(0xe0 | (cp >> 12)); mix(0x80 | ((cp >> 6) & 0x3f)); mix(0x80 | (cp & 0x3f)); } else { mix(0xf0 | (cp >> 18)); mix(0x80 | ((cp >> 12) & 0x3f)); mix(0x80 | ((cp >> 6) & 0x3f)); mix(0x80 | (cp & 0x3f)); } } return h >>> 0; };
const fnv = time(() => fnvCodePoints(text));
console.log(JSON.stringify({ chars: text.length, canonicalMs: canonical, fnvMs: fnv }));
