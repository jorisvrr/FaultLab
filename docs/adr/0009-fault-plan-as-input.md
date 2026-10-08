# ADR-0009: Faults are scheduled input data (the fault plan)

**Status:** Accepted (CP1)

**Problem.** Fault injection must be reproducible. A fault that is triggered by anything other than the experiment's inputs (wall-clock time, a UI click outside the record, a random draw that depends on rendering) breaks determinism.

**Decision.** Faults are plain data in the configuration: `faults: [{ at, type, ... }]` with types `crash`, `recover`, `partition`, `heal`, `link`, `link-restore`. They are validated at the config boundary (unknown fields rejected), assigned ids `f1…fn` in plan order, recorded in full in `run.start`, and scheduled as ordinary events **at construction time, right after the node starts**.

Because sequence numbers grow monotonically, every fault has a lower `seq` than any event scheduled during the run. This gives a simple, explainable rule with no special case in the scheduler:

> At equal virtual time, fault-plan events take effect **before** any message delivery or timer, in plan order among themselves.

So a crash at t=10 always beats a timer due at t=10, and a recovery at t=10 always precedes a delivery at t=10. Crash and recover are **idempotent**: crashing a crashed node, or recovering a running one, is recorded as `fault.skipped` with a reason. That makes randomly generated plans always valid, which property testing relies on.

**Alternatives.**
- *Priority classes in the scheduler key* (time, class, seq): would keep "faults first" even for faults injected later in a run (interactive UI). Rejected for now: it changes ADR-0003's ordering rule for a scenario that doesn't exist yet. When interactive injection arrives, those faults will be recorded as inputs too, and this decision will be revisited.
- *Rejecting non-alternating crash/recover plans statically:* stricter, but makes fault-plan generators much harder to write and gives the UI nothing to explain.
- *Faults triggered by protocol conditions* ("crash the leader"): powerful, but they are adaptive adversaries and belong to a later checkpoint.

**Trade-off.** Plan faults are fixed before the run starts; there is no adaptive adversary yet.

**Invariant.** The trace is a pure function of (config + fault plan). Every applied or skipped fault produces exactly one trace entry, whose `cause` is `run.start`.

**Tested by.** Fault replay determinism properties (random plans, two runs, identical traces), same-tick ordering tests, idempotency tests, and 30+ invalid-plan cases in `test/faults.config.test.ts`.
