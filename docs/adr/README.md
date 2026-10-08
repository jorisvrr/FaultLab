# Architecture Decision Records

Each record answers: **problem · decision · alternatives · trade-off · invariant · how it is tested**. Records are immutable once accepted. A changed decision gets a new record that supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-repository-layout.md) | npm workspaces; one zero-dependency engine package; modules as files | Accepted (CP0) |
| [0002](0002-integer-virtual-time.md) | Virtual time is integer ticks | Accepted (CP0) |
| [0003](0003-scheduler-total-order.md) | Binary heap ordered by (time, seq); lazy cancellation | Accepted (CP0) |
| [0004](0004-prng-xoshiro128-named-streams.md) | xoshiro128\*\* with SplitMix32 seeding and named streams | Accepted (CP0) |
| [0005](0005-protocol-api-immutable-state-buffered-effects.md) | Protocol API: immutable JSON state, buffered effects, expiring context | Accepted (CP0) |
| [0006](0006-json-payloads-validate-copy-freeze.md) | Payloads and state are JSON, validated, copied and frozen | Accepted (CP0) |
| [0007](0007-determinism-guards-without-eslint.md) | Determinism guards via tsconfig libs + fitness tests, no ESLint yet | Accepted (CP0) |
| [0008](0008-node-lifecycle-persistence-incarnations.md) | Node lifecycle, `sync-on-commit` persistence, incarnations | Accepted (CP1) |
| [0009](0009-fault-plan-as-input.md) | Faults are scheduled input data; fault-plan events precede same-tick protocol events | Accepted (CP1) |
| [0010](0010-network-fault-semantics.md) | Directed link faults decided at send; partitions checked at send and delivery | Accepted (CP1) |
| [0011](0011-scheduler-heap-compaction.md) | Heap compaction with Floyd heapify (amends 0003) | Accepted (CP1) |
| [0012](0012-invariant-model.md) | Invariants: pure online checkers over frozen views, explicit JSON history | Accepted (CP2) |
| [0013](0013-violation-policies.md) | Stop-on-first by default, episode de-duplication, explainable violation records | Accepted (CP2) |
| [0014](0014-fault-exploration-and-shrinking.md) | fast-check fault exploration, 1-minimal shrinking, stored counterexample fixtures | Accepted (CP2) |
