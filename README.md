# FaultLab

**A deterministic distributed-systems simulator and debugger that runs in the browser.**

FaultLab runs networks of virtual computers executing distributed protocols under controlled latency, crashes, message loss and partitions. Every run is reproducible from its seed. Every message, timer and state change is recorded in an append-only, causally linked trace that you can inspect, replay and share.

> **Status: CP2, invariant checking and fault exploration.** The simulation engine exists and is tested, including crashes, recovery, persistence, partitions, loss and delay, plus online safety invariants with explainable violations and automatic search for minimal failing fault plans. There is no UI yet, by design: the engine's contracts come first. See the [roadmap](docs/ROADMAP.md).

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
fingerprintTrace(result.trace);   // '09f7b23f', identical on every run and machine
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
- 313 tests: unit, property-based (deterministic seeds), an independent trace oracle, reference vectors, golden traces with legacy projections, stored counterexamples, architecture fitness, mutation-checked

## Getting started

Requires Node ≥ 22.12.

```bash
npm install
npm run check      # typecheck + all tests + demo build
npm run coverage
```

### See it in a browser (CP2.5 prototype)

```bash
npm run dev        # then open http://127.0.0.1:5173/
npm run test:e2e   # Playwright checks against the locally installed Chrome
```

`apps/demo` is a temporary, deliberately plain trace viewer (Vite + TypeScript + SVG). It **executes** an experiment with the real engine in the page, then **replays** the completed trace. Every node state, message, crash, partition and violation on screen is derived from trace entries (`apps/demo/src/derive.ts`, cross-checked against the live engine after every step). It is not the final interface.

## Repository layout

```
packages/engine/        @faultlab/engine: zero runtime dependencies, no DOM, no Node
  src/                  scheduler, clock, PRNG, network, protocol API, trace, simulation
  src/fixtures/         example protocols (ping, echo-forever)
  test/                 Vitest + fast-check suites; test/reference/ holds the C PRNG oracle
docs/                   architecture, semantics, determinism, roadmap, ADRs, design direction
apps/demo/              CP2.5 throwaway trace viewer (Vite + TS + SVG); derive.ts is the reusable part
apps/web/               (CP5) React + Vite app, simulation in a Web Worker
```

## Documentation

| Document | What it answers |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | How the system is layered; simulation state vs. UI state |
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
