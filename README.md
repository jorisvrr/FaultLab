# FaultLab

**A deterministic distributed-systems simulator and debugger that runs in the browser.**

FaultLab runs networks of virtual computers executing distributed protocols under controlled latency, crashes, message loss and partitions. Every run is reproducible from its seed. Every message, timer and state change is recorded in an append-only, causally linked trace that you can inspect, replay and share.

> **Status: CP5, Web Worker runtime and React application foundation (awaiting review).** The deterministic engine (crashes, partitions, loss, invariants, snapshots, bounded liveness, Raft leader election) now runs in a Web Worker per run, streams its trace with flow control to the main thread, and is inspected through an incremental TraceIndex in a functional React shell (Configure / Simulate / Investigate). The final visual design is CP6. See the [roadmap](docs/ROADMAP.md).

## What works today

```ts
import { runSimulation, fingerprintTrace } from '@faultlab/engine';
import { createPingProtocol } from '@faultlab/engine/fixtures';

const result = runSimulation({
  seed: 42,
  nodes: ['n1', 'n2', 'n3'],
  protocol: createPingProtocol({ rounds: 3, interval: 40, jitter: 25 }),
  network: { latency: { min: 1, max: 30 } },
});

result.reason;                    // 'quiescent'
result.eventsProcessed;           // 45
fingerprintTrace(result.trace);   // '7fda34b3' (engine 0.4.0-cp4), identical on every run and machine
```

Faults are part of the experiment's input:

```ts
import { createHeartbeatProtocol } from '@faultlab/engine/fixtures';

runSimulation({
  seed: 2026,
  nodes: ['n1', 'n2', 'n3', 'n4'],
  protocol: createHeartbeatProtocol({ interval: 20, timeout: 60 }),
  network: { latency: { min: 1, max: 15 } },
  limits: { maxTime: 500 },
  faults: [
    { at: 50,  type: 'link', from: 'n3', to: 'n4', loss: 0.3, delay: { min: 10, max: 40 } },
    { at: 100, type: 'crash', node: 'n2' },
    { at: 150, type: 'partition', groups: [['n1']] },
    { at: 220, type: 'recover', node: 'n2' },   // incarnation 2; storage survived, state did not
    { at: 300, type: 'heal' },
  ],
});
```

Raft leader election (CP4), with its safety invariants and a bounded liveness check:

```ts
import { createRaftElection, raftInvariants, raftLeaderLiveness } from '@faultlab/protocols';

runSimulation({
  seed: 1,
  nodes: ['n1', 'n2', 'n3', 'n4', 'n5'],
  protocol: createRaftElection(),               // timeouts 150–300, heartbeat 50
  network: { latency: { min: 1, max: 10 } },
  limits: { maxTime: 2000 },
  faults: [{ at: 400, type: 'partition', groups: [['n5'], ['n1', 'n2', 'n3', 'n4']] }, { at: 900, type: 'heal' }],
  invariants: raftInvariants,                    // Election Safety and four more, from real events
  liveness: [raftLeaderLiveness({ deadline: 1500 })], // a test bound under stated assumptions
});
```

Safety properties are executable specifications, checked after every step:

```ts
import { createNaiveLeaderProtocol, singleLeader } from '@faultlab/engine/fixtures';

const result = runSimulation({
  seed: 7,
  nodes: ['n1', 'n2', 'n3', 'n4'],
  protocol: createNaiveLeaderProtocol(),       // deliberately unsafe leader election
  network: { latency: { min: 1, max: 10 } },
  limits: { maxTime: 1000 },
  faults: [{ at: 300, type: 'partition', groups: [['n4']] }],
  invariants: [singleLeader],                  // stop-on-first by default
});
// result.reason === 'invariant-violation'; the trace ends with an explainable record:
// { invariant: { id: 'single-leader', … }, time: 347, nodes: ['n3', 'n4'],
//   expected: 'At most one running node is leader', observed: '2 running nodes are leader: n3, n4',
//   trigger, step, nodeStates, activeFaults: { partition: <entry of the partition>, … }, eventNumber }
```

- Discrete-event scheduler with a strict total order on (virtual time, sequence number)
- Integer virtual clock; no wall-clock time anywhere in the engine
- xoshiro128\*\* PRNG, bit-exact with the C reference, with an independent stream per node and for the network
- Protocol API with immutable JSON state, atomic handler steps and buffered effects
- Append-only trace with `cause` links (happens-before), canonical serialisation and fingerprints
- Termination guarantees: `maxEvents`, `maxTime`, `maxPendingEvents`; contained protocol errors
- **Fault plan** as reproducible input: crash, recover, partition, heal, directed link loss/delay, restore
- **Node lifecycle** with incarnations: stale timers can never fire; volatile state is lost, persistent storage (`sync-on-commit`) survives
- Precise in-flight semantics: partitions cut messages in flight; every drop links to the fault that caused it
- Scheduler heap compaction (Floyd heapify), so long-running timer-reset workloads use bounded memory
- **Invariants** (state and historical) evaluated after every step over deeply frozen views; stop-on-first or record-and-continue; explainable violation records that separate facts from claims
- **Fault exploration**: fast-check generates fault plans, shrinks failures to 1-minimal counterexamples, and stores them as replayable fixtures
- In-flight message index, property-tested against the scheduler and the trace
- **Bounded liveness** (CP4): conditional checks with recorded assumptions and real deadline events, reported separately from safety
- **`@faultlab/protocols`** (CP4): Raft leader election per Figure 2 of the paper, five historical safety invariants, six deliberately broken variants with stored counterexamples, and a reproducible naive-vs-Raft comparison
- **Snapshots** at step boundaries (versioned JSON, validated as untrusted), **keyframe time travel** (seek in < K steps, regenerate any trace range with absolute indices, memory-bounded runs)
- **`@faultlab/trace`**: a framework-independent TraceIndex for fast, exact inspection of any trace entry, steps, markers and causal chains
- 747 unit/property tests across seven workspaces, plus Playwright suites (demo: 6 in Chrome; app: 14 tests × Chromium, Firefox and WebKit): unit, property-based (deterministic seeds), an independent trace oracle, reference vectors, golden traces with legacy projections, stored counterexamples, architecture fitness, mutation-checked

## Getting started

Requires Node ≥ 22.12.

```bash
npm install
npm run check      # typecheck + all tests + both production builds
npm run coverage
```

### See it in a browser

```bash
npm run dev        # the CP5 application: http://127.0.0.1:5180/
npm run dev:demo   # the CP2.5 prototype viewer: http://127.0.0.1:5173/
npm run test:e2e   # Playwright: demo (Chrome) + app (Chrome, Firefox, WebKit; run `npx playwright install firefox webkit` once)
```

`apps/web` (CP5) runs every experiment in its own **Web Worker** (time-sliced, pausable, flow-controlled, with a watchdog), streams the trace to the main thread, indexes it incrementally, and lets you configure, run and investigate it. It is functional and deliberately unstyled; the approved visual design arrives in CP6.


`apps/demo` is a temporary, deliberately plain trace viewer (Vite + TypeScript + SVG). It **executes** an experiment with the real engine in the page, then **replays** the completed trace. Every node state, message, crash, partition and violation on screen is derived from trace entries (`apps/demo/src/derive.ts`, cross-checked against the live engine after every step). It is not the final interface.

## Repository layout

```
packages/engine/        @faultlab/engine: zero runtime dependencies, no DOM, no Node
packages/trace/         @faultlab/trace: read-only TraceIndex over completed traces (engine types only)
packages/protocols/     @faultlab/protocols: Raft leader election, its invariants and liveness check (engine types only)
packages/experiments/   @faultlab/experiments: JSON experiment specs, versioned registry, presets (CP5)
packages/runtime/       @faultlab/runtime: Worker protocol, time-sliced Worker core, client with flow control and watchdog (CP5)
apps/web/               @faultlab/web: React application foundation (Configure / Simulate / Investigate) (CP5)
tools/perf/             measurement scripts (Node + V8 profilers), not part of the build
  src/                  scheduler, clock, PRNG, network, protocol API, trace, simulation
  src/fixtures/         example protocols (ping, echo-forever)
  test/                 Vitest + fast-check suites; test/reference/ holds the C PRNG oracle
docs/                   architecture, semantics, determinism, roadmap, ADRs, design direction
apps/demo/              CP2.5 throwaway trace viewer (Vite + TS + SVG); derive.ts is the reusable part
```

## Documentation

| Document | What it answers |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | How the system is layered; simulation state vs. UI state |
| [RAFT](docs/RAFT.md) | Raft leader election rule by rule against the paper; what is and is not claimed |
| [SEMANTICS](docs/SEMANTICS.md) | Core types, event contracts, scheduler and termination rules (the spec) |
| [DETERMINISM](docs/DETERMINISM.md) | Why identical inputs give identical traces, and what that does not cover |
| [FAILURE_MODES](docs/FAILURE_MODES.md) | Subtle ways simulators go wrong, and how each is handled |
| [TEST_STRATEGY](docs/TEST_STRATEGY.md) | Test layers, golden-trace rule, mutation sanity checks |
| [ROADMAP](docs/ROADMAP.md) | Checkpoints CP0–CP10 with acceptance criteria |
| [DEPENDENCIES](docs/DEPENDENCIES.md) | Every dependency, justified; planned and rejected ones |
| [ADRs](docs/adr/README.md) | Architecture decisions with alternatives and trade-offs |
| [STUDY_GUIDE](docs/STUDY_GUIDE.md) | The algorithms to understand and exercises for each |
| [DESIGN_DIRECTION](docs/DESIGN_DIRECTION.md) | Visual language for the future interface |
| [UI_REQUIREMENTS](docs/UI_REQUIREMENTS.md) | Usability findings (UX-001, UX-002) and timeline requirements for the final frontend |

## Principles

1. **The trace is the truth.** The UI renders the trace; it never invents events or animates fake activity.
2. **Determinism is enforced, not hoped for:** by the compiler, by tests, and by documented argument.
3. **The engine is framework-independent.** React, rendering and Workers sit on the outside.
4. **No backend.** Experiments are shared as inputs and re-derived, not as stored results.

## License

[MIT](LICENSE) © 2026 Joris van Rijn. The engineering journal is [ENGINEERLOG.md](ENGINEERLOG.md) (Dutch).
