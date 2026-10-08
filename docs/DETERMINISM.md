# Why FaultLab Simulations Are Deterministic

**Claim.** For a fixed `ENGINE_VERSION`, protocol `name` + `version`, and configuration (seed, nodes, latency, limits), every run produces the same trace, entry for entry, byte for byte after canonical serialisation. That holds on every machine and in every standards-compliant JavaScript engine.

**Evidence.** `test/determinism.test.ts`: repeated runs compare equal; a property test over arbitrary seeds, latencies and node counts; stepping one event at a time equals `run()`; a golden fingerprint pins the reference experiment; and the engine is shown not to touch `Math.random`, `Date.now`, or `performance.now`.

## The argument

A program is deterministic if every value it computes is a function of its inputs alone. So the job is to enumerate every way *ambient* information could leak into the simulation, and close each one.

| # | Source of nondeterminism | How FaultLab closes it | Enforced by |
|---|---|---|---|
| 1 | **Wall-clock time** (`Date`, `performance.now`) | Simulated time is an integer counter advanced only by the scheduler. Nothing reads real time. | Engine tsconfig has no DOM/Node libs (`performance` doesn't exist); architecture test forbids `Date`; spy test |
| 2 | **Real timers / event loop** (`setTimeout`, promises, microtasks) | The main loop is a synchronous `while`. Handlers are synchronous; a returned Promise is rejected as non-JSON state. | tsconfig (no `setTimeout`); architecture test forbids `async`/`await`/`Promise`; test "rejects async handler" |
| 3 | **Uncontrolled randomness** (`Math.random`, `crypto`) | All randomness comes from xoshiro128\*\* streams derived from the root seed. | Architecture test; spy test; reference vectors |
| 4 | **Ordering of simultaneous events** | Strict total order on (time, seq); seq assigned at scheduling time. No reliance on heap stability. | Scheduler property test vs. a stable-sort reference |
| 5 | **Cross-consumer random coupling** | Separate streams for `network` and each `node:<id>`; one consumer's draws never shift another's. Not strictly needed for determinism, but needed for *useful* determinism: small changes have local effects. | Test "isolates random streams" |
| 6 | **Floating-point** | Time and latency are integers. The PRNG uses only 32-bit integer ops (`Math.imul`, `>>>`, `^`). `nextFloat` is one correctly rounded IEEE-754 division, which the spec makes identical everywhere. | PRNG output equals the C reference bit-for-bit |
| 7 | **Aliasing / shared mutation** | Payloads and states are validated, copied and deep-frozen at the boundary. A sender cannot change a message in flight; a receiver cannot alter the sender's data or the trace. | `json.test.ts`; "does not let a sender mutate a payload after send()" |
| 8 | **Iteration order** | Only arrays and insertion-ordered `Map`/`Set` are iterated. Canonical serialisation sorts object keys. | `canonicalJson` tests |
| 9 | **Machine-specific error text** | `protocol.error` records `name: message` only, never stack traces (they contain file paths). | Error tests assert exact strings |
| 10 | **UI/rendering influence** | The engine imports nothing outside itself; frame rate, playback speed, and React state have no path into it. | Architecture test ("imports only its own modules") |
| 11 | **Configuration aliasing** | `resolveConfig` copies and freezes the config; mutating the caller's arrays after construction has no effect. | `config.test.ts` |

Given rows 1–11, each step is a pure function of (scheduler state, node states, PRNG states, counters). The initial values of those are pure functions of the configuration. By induction over steps, the whole trace is a pure function of the configuration.

## What determinism does *not* cover (yet)

- **Protocol code that cheats.** In CP0 a protocol is trusted TypeScript. If it calls `Math.random()` or keeps a module-level counter, determinism is lost, and the engine cannot stop it in-process. Mitigations: the documented contract, the "run twice and compare" test pattern, and later the Worker sandbox (CP6 can stub `Math.random`/`Date` inside the worker; CP11 is a real sandbox).
- **Non-terminating handlers.** A handler stuck in an infinite loop never returns, so the run produces no result at all. This is a liveness problem, not a determinism problem, and it is solved by a wall-clock watchdog *outside* the simulation (CP6). Such aborts are reported as "aborted", never recorded as a reproducible outcome.
- **Engine changes.** Reproducibility is promised only for identical `ENGINE_VERSION`. The golden-fingerprint test fails whenever observable semantics change. The fix is to bump the version deliberately, not to update the hash quietly.
- **Transcendental math in protocols.** `Math.sin`, `Math.exp` and friends are *not* required by the spec to be correctly rounded and can differ between engines. Protocols should keep decisions integer-based. (The engine itself uses none.)

## How to check it yourself

```bash
npm test                                   # includes the determinism suite
npx vitest run test/determinism.test.ts    # from packages/engine
```

Then break it on purpose: change `a.seq - b.seq` to `b.seq - a.seq` in `scheduler.ts`, or add an extra `nextUint32()` call in `network.ts`, and watch which tests fail and why.
