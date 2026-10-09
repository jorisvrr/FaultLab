import { Simulation, type SimulationConfig } from '@faultlab/engine';
import { WORKLOADS } from './workloads';

/** PERF-2: per-step cost of invariants / liveness on heartbeat-heavy Raft (interleaved, median of 7). */
const ticks = Number(process.argv[2] ?? 100_000);
const base = WORKLOADS['raft5']!(ticks);
const variants: Record<string, Partial<SimulationConfig>> = {
  none: { invariants: [], liveness: [] },
  noopInvariant: { invariants: [{ id: 'noop', version: '1', name: 'noop', initialHistory: null, check: () => ({ ok: true }) }] as never, liveness: [] },
  noopViewTouch: { invariants: [{ id: 'touch', version: '1', name: 'touch nodes', initialHistory: null, check: ({ view }: { view: { nodes: readonly { state: unknown }[] } }) => (void view.nodes[0]!.state, { ok: true }) }] as never, liveness: [] },
  raftInvariants: { liveness: [] },
  liveness: { invariants: [] },
  both: {},
};
const ms: Record<string, number[]> = {};
let steps = 0;
for (let r = 0; r < 8; r++) {
  for (const [name, v] of Object.entries(variants)) {
    const t0 = performance.now();
    const sim = new Simulation({ ...base, ...v } as SimulationConfig);
    sim.run();
    steps = sim.stepsCompleted;
    if (r > 0) (ms[name] ??= []).push(performance.now() - t0);
  }
}
const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
console.log(JSON.stringify({ ticks, steps, usPerStep: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, +((med(v) * 1000) / steps).toFixed(2)])) }));
