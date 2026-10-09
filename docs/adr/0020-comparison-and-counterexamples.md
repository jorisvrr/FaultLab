# ADR-0020: Naive-vs-Raft comparison method and counterexample format 2

**Status:** Accepted (CP4)

**Problem.** CP4 must show what Raft fixes compared with the naive protocol, and that each of its rules matters, in a way that is fair, reproducible and does not invent results.

**Decision.**

- **Same external conditions, free internal behaviour.** A comparison scenario fixes the cluster, seed, base latency, fault plan and run length. Each protocol keeps its own timers, messages and leader choice; nothing is tuned to make them look alike. Where a scenario depends on *which* node leads (B: "isolate the established leader"), the seed is chosen so both protocols' leader is that node, and a test asserts it. The other seed (B2) is kept as a scenario too, because it shows a different real behaviour.
- **Metrics from the trace only**, through a two-line adapter per protocol ("does this node believe it leads, and in which term/epoch?"): Election Safety (naive: `unique-leader-per-epoch`; Raft: `raft-election-safety`), voting and quorum invariants (Raft only; naive has no votes), leaderships, first leader time, concurrent leader beliefs (informational, not safety), longest leaderless stretch, majority-side availability during a partition, recovery after heal, and liveness results (a protocol-agnostic "one leader believed" check for both; Raft's stricter `raft-leader-elected` too).
- **Pinned results.** Every metric and trace fingerprint is stored in `test/comparison/results.json` (written only if missing) and compared exactly.
- **Stored CP2 counterexamples as scenarios** (C, D). The crash-only CP2 finding existed only as an inline test, so CP4 rediscovered it by exploring crash/recover-only plans and stored it as a `/1` fixture with real discovery data.
- **Broken variants are found, not constructed.** For each variant and target invariant, fast-check explores generated experiments; the counterexample is shrunk, made 1-minimal by greedy fault removal, replayed byte-identically, and run with the correct protocol under the identical experiment. If exploration finds nothing, the test fails; nothing is hand-written.
- **Counterexample format 2** (`faultlab-counterexample/2`): adds `protocol.variant` and options (a small protocol registry) and `correctProtocol {reason, violations, fingerprint}`. Format 1 fixtures are untouched and still replayed. Fixtures are never overwritten.

**Alternatives.**
- *Hand-written counterexamples:* faster, but they demonstrate what the author expected rather than what the system does. Rejected (also by the brief).
- *Comparing internal events (e.g. elections per minute):* the protocols have different internals; only externally meaningful metrics are compared.
- *Forcing the same leader by configuration:* would alter the protocols.

**Trade-offs.** A scenario's outcome depends on the seed; the pinned results make that explicit rather than implying a general rate. Exploration statistics give frequencies.

**Invariant.** Re-running any scenario reproduces every metric and fingerprint exactly; every stored counterexample replays to its recorded violation and its recorded correct-protocol outcome (0 violations).

**Tested by.** `packages/protocols/test/comparison.test.ts`, `raft-broken-variants.test.ts`, `raft-counterexample-replay.test.ts`, `packages/engine/test/exploration.test.ts` (crash-only rediscovery), `counterexamples.test.ts`.
