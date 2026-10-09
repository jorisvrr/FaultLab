# ADR-0021: Experiments as JSON specs, resolved against a versioned registry

**Status:** Accepted (CP5)

**Problem.** A `SimulationConfig` contains functions (protocol, invariants, liveness checks). It cannot cross a Worker boundary (functions are not structured-cloneable), cannot be stored or shared (CP7), and the app must not import experiment data from test fixture directories.

**Decision.** A new package `@faultlab/experiments`:

- **`ExperimentSpec`** (`faultlab-experiment/1`): plain JSON. Protocol, invariants and liveness checks are named by **(id, version)** plus JSON options/params. `parseSpec` validates the shape (unknown fields rejected, frozen copy); `resolveExperiment` resolves names in the **registry** and then runs the engine's own `resolveConfig`, mapping its `ConfigError`s to `SpecError`s with spec paths. Validation rules therefore exist once.
- **Registry**: `PROTOCOLS` (with `parseOptions`, `create`, `category` = protocol / broken-variant / diagnostic, and a pure `describe(state)` view adapter for the UI), `INVARIANTS`, `LIVENESS`. A spec naming an unregistered version is rejected, never reinterpreted.
- **Presets** for the app (education, Raft, diagnostics) and **counterexamples** copied from the stored fixtures as specs. The fixture files stay the source of truth: a test reads each fixture and requires the copy to be identical and to replay to the recorded fingerprint (CP2 fixtures through `projectTrace`).
- A **diagnostic** protocol (`diagnostic-spin`, an infinite loop) exists only to test the Worker watchdog; it is labelled as such.

**Alternatives.** *Send the config with functions serialised as source text*: would execute arbitrary text in the Worker and break determinism guarantees. *Import fixtures from `test/` in the app*: rejected by the brief; couples the product to test layout. *A schema library (zod/valibot)*: unnecessary for this small shape; the engine already validates values.

**Invariant.** `resolveExperiment(JSON.parse(JSON.stringify(spec)))` builds a configuration whose trace is identical to the hand-written equivalent; every counterexample preset replays to its fixture's recorded outcome.

**Tested by.** `packages/experiments/test/` (registry identity, 12 rejections with paths, JSON round trip, presets behave as described, 13 counterexample copies vs fixtures, architecture).
