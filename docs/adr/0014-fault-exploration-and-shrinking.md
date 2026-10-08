# ADR-0014: Fault-space exploration, shrinking and stored counterexamples

**Status:** Accepted (CP2)

**Problem.** Hand-written fault scenarios find only the bugs we already imagine. We want the full loop: generate fault plans → run → detect violations → shrink to a minimal failing plan → store it → replay it exactly forever.

**Decision.**
- **Exploration lives in test code** (`test/explore.ts`), built on fast-check's `fc.check`. fast-check stays a dev dependency; the engine stays dependency-free.
- **Fault plans are generated valid by construction** (known nodes, distinct link endpoints, legal probabilities). Shrinking only produces values inside the arbitrary's space (filters and maps are respected while shrinking), so shrunk plans remain valid. Every counterexample is still re-validated with `resolveFaults`.
- **"Meaningfully minimal" is defined, not assumed**: a counterexample is **1-minimal** if removing any single fault makes the violation disappear. Tests check this property; they do *not* assume a particular number or kind of faults.
- **Fault times start after convergence** in the leader-election exploration, so counterexamples show a fault breaking an established leader, not a startup artefact.
- **Counterexamples are stored as JSON fixtures** (`test/counterexamples/*.json`, format `faultlab-counterexample/1`): engine version, protocol name/version/options, full config including the fault plan, the invariant, how it was found (fast-check seed, runs, shrink steps, original plan size), and the expected outcome (violation time, nodes, event number, trace fingerprint). A replay test runs every fixture and asserts an identical outcome.
- **Old fixtures are never silently invalidated**: if a fixture's engine version differs from `ENGINE_VERSION`, the replay test fails with an explicit message asking for re-verification.

**Alternatives.**
- *Exhaustive enumeration of small fault plans:* complete for tiny spaces, but explodes combinatorially with times and node sets.
- *Custom delta-debugging shrinker:* more control, but re-implements what fast-check already does well.
- *Pinning the exploration's exact output:* brittle, because shrinking paths can change between fast-check versions. Pinned instead: the stored counterexample's *replay*, which depends only on FaultLab.

**Trade-off.** Exploration is randomized search: not finding a violation is evidence, not proof.

**Invariant.** A stored counterexample replays to the same violation and the same trace fingerprint on the same engine version.

**Tested by.** `test/exploration.test.ts` (finds, shrinks, 1-minimality, validity, replay) and `test/counterexamples.test.ts` (fixture replay).
