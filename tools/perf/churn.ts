import { Simulation, type FaultSpec } from '@faultlab/engine';
import { createRaftElection, raftInvariants } from '@faultlab/protocols';

/** PERF-5 workload: 5-node Raft, leader isolated every 1 000 ticks (a new term every ~350 ticks). */
const ticks = Number(process.argv[2] ?? 160_000);
const withInvariants = process.argv[3] !== 'none';
const churn: FaultSpec[] = Array.from({ length: Math.floor(ticks / 1000) }, (_, k) => [
  { at: 1000 * k + 400, type: 'partition', groups: [[`n${(k % 5) + 1}`]] } as FaultSpec,
  { at: 1000 * k + 900, type: 'heal' } as FaultSpec,
]).flat();
const t0 = performance.now();
const sim = new Simulation({
  seed: 1,
  nodes: ['n1', 'n2', 'n3', 'n4', 'n5'],
  protocol: createRaftElection() as never,
  network: { latency: { min: 1, max: 10 } },
  limits: { maxTime: ticks, maxEvents: 50_000_000 },
  faults: churn,
  invariants: withInvariants ? raftInvariants : [],
  invariantPolicy: 'record-and-continue',
});
sim.run();
const ms = performance.now() - t0;
console.log(JSON.stringify({ ticks, withInvariants, steps: sim.stepsCompleted, ms: Math.round(ms), usPerStep: +((ms * 1000) / sim.stepsCompleted).toFixed(2) }));
