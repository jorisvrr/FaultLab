# ADR-0018: Raft leader election as a protocol package with historical safety invariants

**Status:** Accepted (CP4)

**Problem.** CP4 needs a real consensus protocol (Raft's leader election) that can be verified against the paper, broken on purpose, and compared with the naive protocol, without the engine learning anything about Raft.

**Decision.**

- **Package `@faultlab/protocols`** (`packages/protocols`). It imports only engine **types** (`import type`, enforced by `architecture.test.ts`), has no runtime dependencies and no ambient nondeterminism. All randomness and time come from the `NodeContext`.
- **Scope = Figure 2's election rules** (§5.1, §5.2, §5.4.1, §5.6), mapped rule by rule in [RAFT.md](../RAFT.md). Log fields are carried as 0 so CP8 extends the same messages. No log replication, commitment or state-machine safety is implemented or claimed.
- **Durable state** `currentTerm` and `votedFor` in node storage. Persist-before-respond needs no extra mechanism: `sync-on-commit` (ADR-0008) commits a step's writes before its messages leave.
- **Majority** = ⌊n/2⌋+1 of the full configured cluster. **Votes** are counted as a set of distinct voters, current term only.
- **Defaults** timeout uniform in [150, 300] per reset from the node's own stream; heartbeat 50.
- **Broken variants** `createBrokenRaftElection(bug)`, each differing in exactly one rule, with distinct protocol names `raft-election/bug:<bug>`: `volatile-voted-for`, `volatile-term`, `double-vote`, `ceil-half-majority`, `no-step-down` (adopts a higher term but does not convert to follower), `ignore-higher-term` (ignores higher terms entirely). The last two were one variant in the first CP4 draft; that variant could never elect a leader, so the missing step-down was never exercised in a real run. It was split before the first commit (see TEST_STRATEGY, CP4).
- **Five historical invariants**, each built from real trace events (sends, deliveries, durable storage, state updates), never from the protocol's own counters:
  - `raft-election-safety`: at most one leader **elected** per term over the whole run (history: first leader per term; also the highest term observed, kept separate).
  - `raft-term-monotonic`: `currentTerm` never decreases on a node, across crashes.
  - `raft-one-vote-per-term`: from granted `RequestVoteResponse` sends and the candidate's own `RequestVote` broadcast (self-vote).
  - `raft-leader-has-quorum`: when a node first leads term T, its durable storage must show `currentTerm = T, votedFor = itself`, and granted responses for T must have been **delivered** to it from enough distinct members to reach ⌊n/2⌋+1. No counted voter may have granted another candidate in T.
  - `raft-term-adoption`: after delivering a message with term T to a running node, its term is ≥ T (a rule-conformance check, not Election Safety).
- **Deliberately not an invariant:** "at most one node believes it is leader at any moment". A stale leader in a minority keeps believing it leads an older term; that is allowed.

**Alternatives.**
- *Raft inside the engine's `fixtures`:* simpler wiring, but mixes a real protocol with test fixtures and would make the engine package grow with every protocol.
- *Quorum from the leader's `votesGranted`:* trivial, but trusts the code under test. A broken counter would pass.
- *Self-vote evidence = a `storage.write votedFor = self` in the same step:* the first draft. A probe found it gives a **false positive** for a correct split-vote retry: the candidate keeps an earlier durable `votedFor = self` and writes only the new term. The durable state at election time is the right evidence.
- *One-leader-at-a-time invariant:* wrong for Raft (see above).

**Trade-offs.** Requiring a durable self-vote makes `leader-has-quorum` fail at the first election of any persistence bug, before a crash: that is "evidence missing" (stated in the violation text), distinct from an observed double vote (`one-vote-per-term`).

**Invariant.** The correct protocol violates none of the five invariants in any explored experiment; each broken variant is caught by the invariant protecting the rule it breaks.

**Tested by.** `raft-transitions.test.ts` (every Figure 2 rule as an explicit state-machine transition with a recording context), `raft-invariants.test.ts` (hand-made views: positive and negative cases, the split-vote regression, 4-node majority), `raft-exploration.test.ts`, `raft-broken-variants.test.ts`, `raft-counterexample-replay.test.ts`, mutation pass (TEST_STRATEGY).
