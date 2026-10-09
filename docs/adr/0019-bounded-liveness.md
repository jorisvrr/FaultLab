# ADR-0019: Bounded, conditional liveness checks with real deadline events

**Status:** Accepted (CP4)

**Problem.** "A leader is eventually elected" cannot be decided in a finite run, and Raft guarantees no time bound. Yet a simulator should detect protocols that never make progress, without (a) confusing that with safety, (b) reporting false failures when progress is impossible (permanent minority partition), or (c) depending on whether other events happen to occur near the deadline.

**Decision.** An engine-level `LivenessCheck { id, version, name, deadline, assumptions, assumptionsHold(view), progress(view) }`, configured as `liveness: [...]` (max 16), evaluated after the invariants of every committed step on the same frozen view.

- **Meaning:** whenever the assumptions hold and progress is false, progress must (again) become true within `deadline` ticks. The deadline is a **test bound** documented with its assumptions, never a protocol guarantee.
- **Phases** idle → waiting → met / missed, with `liveness.armed`, `.met` (`late` flag), `.missed`, `.disarmed`, `.error` trace entries (SEMANTICS §17). Losing progress while the assumptions hold starts a new period.
- **Real deadline events.** Arming schedules a `liveness.deadline` scheduler event at `since + deadline`; its dispatch is the only source of `liveness.missed`, which is the trigger of its own step. Progress or broken assumptions cancel it. So a quiet scheduler cannot skip a deadline, and a cancelled deadline never keeps a run alive.
- **Never safety.** Liveness results never stop a run and never appear as `invariant.violation`. Only a faulty check stops the run (`liveness-error`).
- **Assumptions in the trace.** `run.start.liveness` records each check with its deadline and plain-language assumptions; `liveness.missed` repeats them.
- **Snapshots** carry the phase and pending deadline (`faultlab-snapshot/2`), validated like the rest.
- **Versioning.** New entries and a `run.start` field → engine `0.4.0-cp4`; older goldens reproduced via `projectTrace`.

**Raft's check** lives in `@faultlab/protocols` (`raftLeaderLiveness`): healthy group = running, same partition group, not an endpoint of any degraded link; assumptions = healthy group is a majority; progress = one running leader in that partition group acknowledged in its term by every healthy node. D = 1500 ticks, from measured election durations.

**Alternatives.**
- *Check deadlines only when other events happen:* simple, but a quiet run would never report a miss, and the reported time would be wrong. Rejected (the brief requires a quiet scheduler not to prevent evaluation).
- *"After the last fault" windows:* needs to know the future of the fault plan and misses progress lost mid-run. The assumption predicate generalises it.
- *Report misses as invariant violations:* conflates safety and liveness. Rejected.
- *Stop the run on a miss:* hides what happens next (late election). Rejected; `late` is recorded instead.

**Trade-offs.** Assumptions are predicates over one view, so assumptions about the configuration (base latency ≪ election timeout) are documented in text, not checked. The first version of Raft's healthy group dropped one endpoint of each degraded link greedily; exploration showed it could drop the actual leader and report misses although one leader was serving the healthy nodes. The rule now excludes both endpoints and lets the leader itself sit on a degraded link.

**Invariant.** For every run, every `liveness.missed` is at exactly `since + deadline`, caused by its `liveness.armed`, while the assumptions held throughout; no liveness entry appears while they never hold.

**Tested by.** `packages/engine/test/liveness.test.ts` (config validation, exact deadlines, quiet scheduler, cancellation, disarm/re-arm, lost-progress re-arming, time-only conditions seen at the next step, faulty checks, snapshots with pending deadlines and tampering), `packages/protocols/test/raft-liveness.test.ts`, the exploration's liveness tally, the TraceIndex cross-check of liveness phases, and mutants S1–S5, L1–L3.
