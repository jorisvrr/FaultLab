# ADR-0006: Payloads and state are JSON — validated, copied, frozen

**Status:** Accepted (CP0)

**Problem.** Messages and node state cross a trust boundary (protocol code → engine) and must be storable in traces, snapshots, IndexedDB and share links. Mutable shared objects make history rewritable: a sender that mutates a payload after `send()` changes what the receiver gets.

**Decision.** `toFrozenJson` validates plain JSON data (finite numbers, no `undefined`, functions, symbols, bigints, cycles, accessors, sparse arrays or non-plain prototypes), copies it, and deep-freezes the copy. Already-validated frozen subtrees are recognised through a `WeakSet` and reused, so structurally shared updates cost O(changed part). `-0` is normalised to `0`. A `"__proto__"` key is copied as an own property.

**Alternatives.**
- `structuredClone`: copies, but accepts Map/Date/etc. that JSON traces can't hold, and doesn't freeze.
- *Freeze without copying:* cheaper, but freezes the caller's own objects as a side effect and still allows a mutation before the call.
- *No validation:* fastest, but the failure shows up much later as a lossy trace.
- *Schema per protocol (zod):* stronger typing of messages; a possible later layer *on top of* this one.

**Trade-off.** Validation cost is linear in the new data per step, which is acceptable at measured throughput (~440k events/s). Protocols must use plain objects/arrays: no `Map`, no class instances in state.

**Invariant.** Everything reachable from a trace entry is immutable JSON; a value observed at time t can never change afterwards.

**Tested by.** `json.test.ts` (15 rejection cases, paths, round-trip property, structural sharing, `__proto__`); simulation tests for the payload-aliasing and frozen-state scenarios.
