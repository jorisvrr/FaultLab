# ADR-0011: Scheduler heap compaction (amends ADR-0003)

**Status:** Accepted (CP1). Amends the lazy-cancellation trade-off of ADR-0003; the ordering rule is unchanged.

**Problem.** Lazy cancellation leaves cancelled events in the heap until they reach the top. CP0 flagged this as a possible memory leak, and CP1 adds bulk cancellation (a crash cancels every timer a node owns).

**Investigation.** A dead entry is only discarded when its *scheduled time* is reached. So the number of dead entries is bounded by *the number of cancellations within one timer horizon*. With short timers (a heartbeat timeout of a few hundred ticks) that is small and self-limiting. With long timers that are reset frequently, it grows with run length. Measured before the fix (one message per tick resets a timer of length D; 200 000 steps; always 2 live events):

| D | Largest heap |
|---|---|
| 300 | 301 entries |
| 10 000 | 10 001 entries |
| 1 000 000 | 200 002 entries |

After the fix, the same workload stays at ≤ 1 029 entries (regression test in `scheduler.test.ts`).

**Decision.** Compact when dead entries outnumber live ones *and* there are at least `compactionThreshold` (default 1024) of them: filter the heap array down to live entries and rebuild it with Floyd's bottom-up heapify (O(n)). Each compaction removes at least half the array, so its cost is amortised O(1) per cancellation, and the heap never holds more than about twice the live events plus the threshold.

**Why ordering is unaffected.** The comparator is a strict total order (ADR-0003). Any valid heap over the same set of live events pops them in the same sequence, so compaction is invisible to the trace.

**Alternatives.**
- *Indexed heap with eager removal* (track each event's array position and remove in O(log n)): exact memory, but every swap must update an index map, which adds a lot of bookkeeping to the hottest code path.
- *Do nothing:* acceptable for short timers, but a known unbounded case is a correctness risk for long experiments (CP9 targets 10⁶ events).

**Invariant.** Compaction never changes the dispatch order or the live set. `heapEntries ≤ 2·live + threshold` after every cancellation.

**Tested by.** A model-based property test (scheduler with an aggressive threshold vs. a reference model under random schedule/cancel/next sequences), a regression test with a long-horizon timer-reset workload asserting bounded heap size, and the golden traces (unchanged by compaction).
