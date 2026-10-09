import { writeFileSync } from 'node:fs';
import { serializeTrace, Simulation, type FaultSpec, type SimulationConfig, type TraceEntry } from '@faultlab/engine';
import { describe, it } from 'vitest';
import { createRaftElection, raftInvariants, raftLeaderLiveness, type RaftState } from '../src';

/**
 * CP4 measurements (opt-in: `npm run bench --workspace @faultlab/protocols`). Wall-clock numbers
 * are machine-dependent; the trace-derived numbers (entries, timers, history sizes) are exact
 * and deterministic. Results are written as JSON to FAULTLAB_BENCH_OUT (if set) and documented in
 * docs/TEST_STRATEGY.md (CP4 results).
 */
const ENABLED = process.env['FAULTLAB_BENCH'] === '1';
const nodes = (n: number) => Array.from({ length: n }, (_, i) => `n${i + 1}`);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const config = (n: number, maxTime: number, opts: { invariants?: boolean; liveness?: boolean; faults?: FaultSpec[]; seed?: number } = {}): SimulationConfig => ({
  seed: opts.seed ?? 1,
  nodes: nodes(n),
  protocol: createRaftElection() as never,
  network: { latency: { min: 1, max: 10 } },
  limits: { maxTime, maxEvents: 50_000_000 },
  faults: opts.faults ?? [],
  invariants: opts.invariants ? raftInvariants : [],
  invariantPolicy: 'record-and-continue',
  liveness: opts.liveness ? [raftLeaderLiveness({ deadline: 1500 })] : [],
});
const time = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};
/** Leader isolated every 1 000 ticks (round robin), healed 500 ticks later: forces new terms. */
const churn = (n: number, until: number): FaultSpec[] =>
  Array.from({ length: Math.floor(until / 1000) }, (_, k) => [
    { at: 1000 * k + 400, type: 'partition', groups: [[`n${(k % n) + 1}`]] } as FaultSpec,
    { at: 1000 * k + 900, type: 'heal' } as FaultSpec,
  ]).flat();

describe.runIf(ENABLED)('CP4 Raft measurements', () => {
  const out: Record<string, unknown> = {};

  it('election performance and heartbeat trace volume across cluster sizes (healthy, 20 000 ticks)', () => {
    const rows = [];
    for (const n of [3, 5, 7, 9, 15, 25]) {
      const firstLeader: number[] = [];
      for (let seed = 1; seed <= 50; seed++) {
        const sim = new Simulation(config(n, 2000, { seed }));
        sim.run();
        firstLeader.push(sim.trace.find((e) => e.kind === 'state.update' && (e.state as unknown as RaftState).role === 'leader')?.time ?? -1);
      }
      const ms: number[] = [];
      let sim!: Simulation;
      for (let r = 0; r < 5; r++) ms.push(time(() => { sim = new Simulation(config(n, 20_000)); sim.run(); }));
      const trace = sim.trace;
      const kinds: Record<string, number> = {};
      for (const e of trace) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      rows.push({
        n,
        firstLeaderMedian: median(firstLeader),
        firstLeaderMax: Math.max(...firstLeader),
        noLeaderRuns: firstLeader.filter((t) => t < 0).length,
        runMsMedian: Math.round(median(ms)),
        steps: sim.stepsCompleted,
        entries: trace.length,
        entriesPerTick: +(trace.length / 20_000).toFixed(2),
        serializedMB: +(serializeTrace(trace).length / 1e6).toFixed(1),
        stateUpdates: kinds['state.update'],
        timerSet: kinds['timer.set'],
        timerCancel: kinds['timer.cancel'],
        timerFire: kinds['timer.fire'],
        sends: kinds['message.send'],
        scheduler: sim.schedulerStats,
      });
    }
    out['clusterSizes'] = rows;
  });

  it('timer cancellation and scheduler compaction over a long run (5 nodes, 200 000 ticks)', () => {
    const sim = new Simulation(config(5, 200_000));
    let maxHeap = 0;
    let maxPending = 0;
    while (sim.step()) {
      const s = sim.schedulerStats;
      maxHeap = Math.max(maxHeap, s.heapEntries);
      maxPending = Math.max(maxPending, s.pending);
    }
    const cancels = sim.trace.filter((e) => e.kind === 'timer.cancel').length;
    out['compaction'] = { steps: sim.stepsCompleted, timerCancels: cancels, maxHeapEntries: maxHeap, maxPending, final: sim.schedulerStats };
  });

  it('invariant and liveness overhead (5 nodes, 20 000 ticks, interleaved, 9 runs each)', () => {
    const variants = { none: {}, invariants: { invariants: true }, liveness: { liveness: true }, both: { invariants: true, liveness: true } } as const;
    const ms: Record<string, number[]> = { none: [], invariants: [], liveness: [], both: [] };
    for (let r = 0; r < 10; r++) {
      for (const [name, opts] of Object.entries(variants)) {
        const t = time(() => new Simulation(config(5, 20_000, opts)).run());
        if (r > 0) ms[name]!.push(t); // first round = warm-up
      }
    }
    const steps = new Simulation(config(5, 20_000)).run().eventsProcessed;
    out['overhead'] = { steps, ...Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, { median: Math.round(median(v)), min: Math.round(Math.min(...v)), max: Math.round(Math.max(...v)) }])) };
  });

  it('invariant history growth (5 nodes; healthy vs leader churn every 1 000 ticks)', () => {
    const rows = [];
    for (const [label, faults] of [['healthy', (t: number) => []], ['churn', (t: number) => churn(5, t)]] as const) {
      for (const ticks of [10_000, 40_000, 160_000]) {
        const sim = new Simulation(config(5, ticks, { invariants: true, faults: faults(ticks) }));
        sim.run();
        const sizes = Object.fromEntries(raftInvariants.map((i) => [i.id, JSON.stringify(sim.invariantHistory(i.id) ?? null).length]));
        const maxTerm = Math.max(...sim.trace.filter((e): e is Extract<TraceEntry, { kind: 'state.update' }> => e.kind === 'state.update').map((e) => (e.state as unknown as RaftState).currentTerm));
        rows.push({ label, ticks, maxTerm, violations: sim.trace.filter((e) => e.kind === 'invariant.violation').length, historyBytes: sizes });
      }
    }
    out['history'] = rows;
  });

  it('writes the results', () => {
    const path = process.env['FAULTLAB_BENCH_OUT'];
    if (path !== undefined) writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  });
});
