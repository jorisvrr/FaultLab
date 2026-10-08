# ADR-0013: Violation policies and explainable violation records

**Status:** Accepted (CP2)

**Problem.** When an invariant fails, the engine must (1) stop or continue deterministically, (2) not flood the trace with the same persistent failure, and (3) record enough structured, evidence-backed information that a future UI can highlight nodes, find the triggering event, walk the causal chain, explain expected vs. observed, and replay the failure exactly.

**Decision.**

*Policies* (`invariantPolicy` in the config):
- `stop-on-first` (**default**): after the step in which one or more invariants first fail, record every violation of that step and stop with `invariant-violation`.
- `record-and-continue`: keep running. Violations are recorded per **episode**: an entry when an invariant goes from holding to failing, and an `invariant.cleared` entry when it holds again. A failure that persists over many steps yields one entry, not one per step. `limits.maxViolations` (default 100) bounds the total; reaching it stops the run with `violation-limit`.

*Evaluation and ordering within one step:* all invariants are evaluated in configuration order. Their outcomes (violation, cleared, error) are appended in that same order. Then:
1. any checker error → stop with `invariant-error`, whatever the policy (a broken checker cannot be trusted);
2. `stop-on-first` and at least one new violation → stop with `invariant-violation`;
3. `record-and-continue` and `maxViolations` reached → stop with `violation-limit`;
4. finally the existing `pending-limit` check.

A checker that throws, or returns a malformed verdict or history, is recorded as `invariant.error`; it never escapes as an exception.

*Explainable violation record* (`invariant.violation`). Fields are split into what the **invariant asserts** and what the **engine observed**; the engine never states an inferred cause.

| Field | Source | Purpose |
|---|---|---|
| `violationId` (`v1`, `v2`, …) | engine | Stable reference |
| `invariant: { id, version, name }` | invariant | What rule failed |
| `nodes` | invariant (validated against known ids) | Nodes to highlight |
| `expected`, `observed` | invariant | Plain-language comparison |
| `evidence` | invariant (JSON) | Structured data, e.g. the leaders and their epochs |
| `references` | invariant (validated trace indices) | Entries the invariant cites as evidence |
| `trigger` (= `cause`) | engine | The event whose step produced the failure |
| `step: { first, last }` | engine | Trace range of that step |
| `nodeStates` | engine | Per cited node: status, incarnation, and the trace index that produced its current state |
| `activeFaults` | engine | Trace indices of the partition, link faults and crashes **active at that moment**: facts, not causes |
| `eventNumber` | engine | Replaying `run.start`'s inputs for exactly this many events reproduces the failure |

Reproduction needs nothing beyond the trace: `run.start` holds every input (seed, nodes, protocol and engine versions, latency, limits, fault plan, invariants and policy).

**Alternatives.**
- *Record every failing step:* simple, but unbounded duplicates for persistent failures.
- *De-duplicate per (invariant, node set):* finer-grained, but a changing node set would split one incident into many. Rejected for CP2; can be revisited when the UI shows violation intervals.
- *Engine-inferred causes ("caused by partition f2"):* tempting, but not provable from the trace in general. The UI can *suggest* candidates from `activeFaults` and the causal chain, labelled as inference.

**Invariant.** Same inputs ⇒ same violations, in the same order, with the same fields. No violation entry refers to a trace index at or after itself.

**Tested by.** Policy tests (stop, record, episode de-duplication, clearing, `maxViolations`), multi-invariant same-step ordering, checker-error containment, and explainability tests on the split-brain scenario.
