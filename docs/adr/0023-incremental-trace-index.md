# ADR-0023: Incremental TraceIndex with compact causality (supersedes parts of ADR-0017)

**Status:** Accepted (CP5)

**Problem.** Streaming needs an index that grows with each chunk; `TraceIndex.build` required the complete trace. PERF-3: the index roughly doubled memory (64–83 MB on top of a 78 MB trace), mostly per-entry child arrays (41.9 MB measured).

**Decision.**

- `TraceIndex.build(firstChunk)` + `append(chunk)`. Chunks must continue the trace exactly (next index, no gaps, nothing after `run.end`); otherwise nothing is added and an error is thrown. Chunk boundaries may fall anywhere, including inside a step.
- **Message records** are created at send time and replaced when the delivery or drop arrives. The working state (and checkpoints) store **message ids**, resolved to the current record when a frame is built — otherwise a checkpoint taken before an outcome was known would keep an outdated record and `append` would differ from `build`.
- **Causal children** are linked lists in growable `Int32Array`s (first child, last child, next sibling): 12 bytes per entry instead of an array per entry. Step numbers and step ranges are also typed columns. Public arrays (`messages`, `markers`, `violations`, `steps`) are frozen views rebuilt only after appends.
- Equivalence definition unchanged (ADR-0017 / S22): the return values of all public methods; `apply` stays idempotent per entry.

**Measured (Node, same V8 as Chrome).** Index memory for the 287 526-entry reference: 65.5–84.7 MB → **33.0–52.5 MB** (C = 4096…64); at the default C = 256: 70.4 → 38.1 MB = **49 % of the trace** (was 90 %); 124 k-entry Raft: 23.0 → 11.9 MB (44 %). Build/append time unchanged (≈ 34 ms per 124 k entries). Message records (16.3 MB) remain the largest part; compacting them is possible but not needed by the acceptance criterion.

**Alternatives.** *Rebuild the index on every chunk*: O(n²) over a run. *CSR arrays*: smaller still but need all counts up front, incompatible with appending. *Keep the index in a second Worker*: frames would become asynchronous; measurements show main-thread cost is low (largest chunk ≤ 8 ms incl. decode), so not justified.

**Tested by.** `packages/trace/test/incremental.test.ts` (every single split point of a 150+ entry trace, random multi-splits × checkpoint intervals × protocols, prefix equality after every append, record resolution across checkpoints, rejection, cost bound) plus all CP3 TraceIndex tests unchanged.
