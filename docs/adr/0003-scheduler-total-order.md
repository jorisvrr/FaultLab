# ADR-0003: Scheduler — binary heap ordered by (time, seq), lazy cancellation

**Status:** Accepted (CP0)

**Problem.** The engine repeatedly needs "the next event", while new events keep arriving. Events at the same virtual time must come out in an order that is (a) deterministic and (b) explainable.

**Decision.** A binary min-heap keyed by `(time, seq)`, where `seq` is a strictly increasing counter assigned at scheduling time. Ties at equal time therefore resolve FIFO by scheduling order. Cancellation is lazy: a live-set membership check, with dead entries skipped when they surface.

**Alternatives.**
- *Sorted array with binary-search insertion:* O(n) insert; fine for tiny runs, poor for 10⁵+ pending events.
- *Calendar queue / timing wheel:* O(1) amortised and excellent for dense, uniformly distributed times; more complex, and its performance depends on bucket tuning. Revisit in CP9 if profiling demands it.
- *Tie-breaking by priority class* (e.g. deliveries before timers) or by node id: encodes policy into the scheduler and surprises protocol authors.
- *Seeded random tie-breaking:* explores more interleavings (valuable for bug-finding!) but makes "simultaneous" ordering harder to explain. **Planned as an opt-in policy** ("tie-break: fifo | seeded") once invariants exist (CP2+), since it is still deterministic per seed.
- *Eager cancellation with an indexed heap:* exact memory, but needs position tracking on every swap.

**Trade-off.** FIFO ties are simple and predictable but explore only one interleaving per configuration. Lazy cancellation trades memory (dead entries) for O(1) cancel and simpler code; compaction is deferred until measured (Raft resets timers often).

**Invariant.** `compareScheduled` is a strict total order: for distinct events it never returns 0. A heap with a strict total order yields a unique pop sequence regardless of stability.

**Tested by.** Heap ≡ sorted-array model (property, interleaved push/pop); scheduler ≡ stable sort by time (property); FIFO ties; cancellation edge cases; a mutation check (LIFO ties) fails 10 tests.
