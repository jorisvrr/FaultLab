# ADR-0015: Engine snapshots — complete execution state at step boundaries, as versioned JSON

**Status:** Accepted (CP3)

**Problem.** Replay, time travel and memory-bounded long runs all need to capture a running simulation and later continue it so that the rest of the run is *exactly* the same as if it had never stopped. A single forgotten piece of state silently changes the future.

**Decision.** `sim.snapshot()` returns a `faultlab-snapshot/1` object: deeply frozen, plain JSON, taken **only at a step boundary** (the API is synchronous, so a half-finished step cannot be observed). It contains:

| Part | Contents |
|---|---|
| `inputs` | The complete `run.start` entry (seed, nodes, protocol name/version, latency, limits, fault plan, invariant ids/versions, policy, persistence, engine version) |
| `position` | `stepsCompleted`, absolute `traceLength`, virtual `time`, fingerprint of the last entry |
| `scheduler` | `nextSeq` and every live event in dispatch order **with its original sequence number**; faults by id |
| `network` | random-stream state, active partition and link conditions (insertion order) with the entries that established them |
| `nodes` | status, incarnation, `crashedAt`, `stateEntry`, volatile state, storage (insertion order), id counters, pending timers (insertion order), random-stream state |
| `invariants` | violation counter, and per invariant: history and open episode |
| `stopReason` | so a finished run restores as finished |

Derived structures are **not** stored but rebuilt: the in-flight index (from queued deliveries) and the heap layout (Floyd heapify). Diagnostics (`heapEntries`, `compactions`) are not state.

`Simulation.restore(config, snapshot, { tracePrefix? })` treats the snapshot as **untrusted** (`validateSnapshot`):
1. iterative bounds check (depth ≤ 200, ≤ 5 M values, strings ≤ 1 M characters) before any recursion;
2. plain JSON, format, engine version;
3. **exact** equality of `inputs` with the configuration's own `run.start` (canonical JSON, not a hash);
4. structure and internal consistency: node order and lifecycle rules, counters vs. message/timer ids, timers ↔ queued `timer.fire` events (both directions), strict (time, seq) order, unique seqs below `nextSeq`, events not before the clock, valid partitions and links, invariant states matching the configured invariants;
5. with a trace prefix: length, last-entry fingerprint, and that every referenced index points at an entry of the expected kind (`crashedAt` → `node.crash` of that node, `stateEntry` → the matching `state.update`, delivery cause → its `message.send`, …).

Errors are `SnapshotError(path, reason)`.

**What validation does *not* do.** Fingerprints and consistency checks catch accidents, version drift and mix-ups. They are **not** a defence against a deliberately forged snapshot: whoever controls a snapshot can make it consistent. Without a prefix, entry references can only be range-checked. A snapshot is input, like a configuration, and is as trustworthy as its source.

**Engine version.** CP3 changes no trace from identical inputs, so `ENGINE_VERSION` stays `0.3.0-cp2` and all golden fingerprints are unchanged. The new artefact is versioned separately (`SNAPSHOT_FORMAT`).

**Alternatives.**
- *Snapshot = replay from the start to step N:* trivially correct and tiny, but O(N) per use. That defeats time travel.
- *Binary format:* smaller and faster, but opaque. Not justified by measurements (see TEST_STRATEGY, CP3).
- *Copying all state:* simpler to reason about, but unnecessary: states and payloads are deeply frozen, so sharing them is safe.

**Invariant.** For every step boundary k: `restore(snapshot@k) + run` ≡ uninterrupted run (byte-identical trace, stop reason, final states, invariant histories), and `snapshot(restore(s)) = s`.

**Tested by.** `test/snapshot.test.ts`: metamorphic properties over random protocols, fault plans, policies and k; idempotence; JSON round trips; snapshot-every-step; independence; 34 rejection cases; counterexample replay from mid-run snapshots; field-ablation mutation tests (S1–S17).
