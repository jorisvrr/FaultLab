# Raft Leader Election in FaultLab (CP4)

**Scope.** CP4 implements Raft's **leader election**: terms, durable voting, majority elections, randomized election timeouts, and heartbeats as empty AppendEntries. It does **not** implement log replication, commitment or state-machine replication (CP8). Nothing in CP4 tests committed-entry safety. Implementation: `packages/protocols/src/raft/`.

**Authoritative source.** Ongaro & Ousterhout, *In Search of an Understandable Consensus Algorithm (Extended Version)*, Figure 2 and §5.1, §5.2, §5.4, §5.6. Quotes below are from the paper.

## 1. Rules from the paper (election-relevant part of Figure 2)

| Paper | Rule |
|---|---|
| Persistent state, Fig. 2 | `currentTerm`: "latest term server has seen (initialized to 0 on first boot, increases monotonically)"; `votedFor`: "candidateId that received vote in current term (or null if none)"; "Updated on stable storage before responding to RPCs" |
| RequestVote receiver, Fig. 2 | "1. Reply false if term < currentTerm. 2. If votedFor is null or candidateId, and candidate's log is at least as up-to-date as receiver's log, grant vote" |
| AppendEntries receiver, Fig. 2 | "1. Reply false if term < currentTerm" (steps 2–5 concern the log: CP8) |
| All servers, Fig. 2 | "If RPC request or response contains term T > currentTerm: set currentTerm = T, convert to follower" |
| Followers, Fig. 2 | "If election timeout elapses without receiving AppendEntries RPC from current leader or granting vote to candidate: convert to candidate" |
| Candidates, Fig. 2 | "On conversion to candidate, start election: Increment currentTerm · Vote for self · Reset election timer · Send RequestVote RPCs to all other servers"; "If votes received from majority of servers: become leader"; "If AppendEntries RPC received from new leader: convert to follower"; "If election timeout elapses: start new election" |
| Leaders, Fig. 2 | "Upon election: send initial empty AppendEntries RPCs (heartbeat) to each server; repeat during idle periods to prevent election timeouts" |
| §5.2 | "A candidate wins an election if it receives votes from a majority of the servers in the full cluster for the same term. Each server will vote for at most one candidate in a given term, on a first-come-first-served basis." "If the leader's term (included in its RPC) is at least as large as the candidate's current term, then the candidate recognizes the leader as legitimate and returns to follower state. If the term in the RPC is smaller than the candidate's current term, then the candidate rejects the RPC and continues in candidate state." "election timeouts are chosen randomly from a fixed interval (e.g., 150–300ms)" |
| §5.1 | "If a candidate or leader discovers that its term is out of date, it immediately reverts to follower state. If a server receives a request with a stale term number, it rejects the request." |
| §5.4.1 | The vote additionally requires the candidate's log to be "at least as up-to-date". **With an empty log (CP4) this condition is always true**; the message fields `lastLogIndex` / `lastLogTerm` are carried (as 0) so CP8 can implement it. CP4 does not claim to test it. |
| §5.6 | "broadcastTime ≪ electionTimeout ≪ MTBF" (timing requirement for a steady leader) |

## 2. FaultLab parameters

Defaults: election timeout drawn uniformly from **[150, 300]** ticks per reset (the node's own random stream), heartbeat interval **50** ticks, network latency typically 1–10 ticks. So broadcastTime (≈ 2 × 10) ≪ electionTimeout (≥ 150), and MTBF is set by the fault plan.

## 3. State

| Durable (`ctx.storage`, sync-on-commit) | Volatile (lost on crash) |
|---|---|
| `currentTerm`, `votedFor` | `role` (follower / candidate / leader), `leaderId`, `votesGranted` (distinct voters incl. self, current term only), election and heartbeat timer ids |

Persist-before-respond holds automatically: storage writes of a step are committed **before** that step's messages leave (ADR-0008). Every handler that changes `currentTerm` or `votedFor` writes them in the same step as the reply that depends on them.

## 4. Transitions and FaultLab's precise handling

Let `T` be the term in an incoming message, `cur` the node's `currentTerm`.

1. **Any message with `T > cur`** (request or response): set `cur = T`, `votedFor = null` (persisted), become follower, forget `leaderId` and votes. A leader that steps down stops its heartbeat timer and starts an election timer. Then the message is handled under the new term.
2. **RequestVote(T, c):** if `T < cur` → reply `voteGranted = false` (with `cur`). Else grant iff `votedFor ∈ {null, c}` (log condition trivially true); on grant: persist `votedFor = c` and **reset the election timer** (Fig. 2, followers). A rejected request does **not** reset the timer.
3. **RequestVoteResponse(T, granted) from v:** counted only if the node is a **candidate**, `T = cur` and `granted`. Votes are a **set** of distinct voters, so a duplicated or re-sent response counts once. On reaching **⌊n/2⌋ + 1** (n = full configured cluster), the candidate becomes leader and immediately sends heartbeats. Stale responses (`T < cur`) are ignored.
4. **AppendEntries(T, L):** if `T < cur` → reply `success = false` (stale leader learns the newer term from the reply). Else: a **candidate** returns to follower (§5.2); a follower records `leaderId = L` and **resets its election timer**. Reply `success = true` (empty log: nothing to check).
   - **Equal-term AppendEntries to a leader** would mean two leaders in one term, which Election Safety forbids. FaultLab does not hide it: the node steps down to follower, and the `election-safety` invariant independently reports the violation.
5. **AppendEntriesResponse(T):** only rule 1 applies (higher term → step down); otherwise ignored (no log in CP4).
6. **Election timeout** (follower or candidate): start an election: `cur + 1`, persist `votedFor = self`, `votesGranted = {self}`, new random timeout, RequestVote to all others. A single-node cluster wins immediately.
7. **Heartbeat timer** (leader only): AppendEntries to every other node; re-arm.
8. **Delayed messages from earlier elections** are handled entirely by the term rules: requests with old terms are rejected; responses with old terms are ignored; anything with a newer term causes a step-down first.
9. **Duplicates:** the network does not duplicate messages in CP4, but handlers are idempotent anyway (vote re-grant to the same candidate; vote sets).
10. **Crash recovery:** `init` reads `currentTerm` and `votedFor` from storage and starts as a follower with a fresh election timer. A node therefore never votes twice in a term it already voted in.

## 5. Safety properties (what is and is not claimed)

- **Election Safety (primary):** *at most one leader is elected in a given term, across the complete execution history* (Figure 3 of the paper).
- **Not claimed:** "at most one node believes it is leader at any moment". After a partition, an old leader in the minority can still believe it leads in an **older** term. That is **not** an Election Safety violation. (Raft prevents such a stale leader from committing, but that is a log property for CP8.)

The five invariants (Election Safety, term monotonicity, one vote per term, leader-has-quorum, term adoption) and the evidence each uses are described in [ADR-0018](adr/0018-raft-election-model.md) and implemented in `packages/protocols/src/raft/invariants.ts`.

## 6. Liveness (what is and is not claimed)

Raft has **no deterministic upper bound** on election time: randomized timeouts make repeated split votes increasingly unlikely, not impossible. FaultLab's check `raft-leader-elected` (SEMANTICS §17, ADR-0019) is a **test bound D = 1500 ticks under documented assumptions**, not a property of Raft:

- *Assumption:* a majority of the configured cluster is **healthy**: running, in one partition group, and not an endpoint of any lossy or delayed link. Base latency stays well below the election timeout (§5.6; a configuration assumption, documented, not checked per step).
- *Progress:* exactly one running leader in that partition group, acknowledged in its own term by every healthy node. Losing it while the assumption holds starts a new waiting period.
- *Choice of D:* measured over 6 000 runs (3/4/5/7 nodes × 500 seeds × healthy start / leader crash / leader isolation): worst case 885 ticks, p99 ≤ 656. D = 5 × the maximum timeout ≈ 1.7 × the worst case. With deliberately **tight** timeouts ([150, 155]) the bound is missed regularly; that is the paper's §9.3 observation (too little randomness → repeated split votes), reported, not asserted.
- A permanent minority partition (e.g. 2|2|1 or 2|2 in a 4-node cluster) disarms the check: Raft is then safe but unavailable, and no liveness result is produced.

## 7. Known behaviour worth knowing (observed, not bugs)

- **Disruptive server.** An isolated follower keeps timing out and raising its term. After the heal its higher term forces the healthy leader to step down (comparison scenario B2). Raft without PreVote (Ongaro's thesis §9.6) behaves exactly like this; FaultLab does not implement PreVote.
- **Even clusters are slower to elect.** 4 nodes need 3 votes (as many as 5 nodes); measured election durations have the longest tail at n = 4.
- **Persistence bugs are caught before any crash** by `raft-leader-has-quorum`, because a self-vote that is not durable is missing evidence. The double vote they eventually cause is caught by `raft-one-vote-per-term`, and with the right fault plan by `raft-election-safety`.

## 8. Deliberately broken variants (tests only)

Each differs from the correct protocol in exactly one rule (`createBrokenRaftElection(bug)`, protocol name `raft-election/bug:<bug>`). Every one is found by exploration, minimised and stored as a counterexample (TEST_STRATEGY, CP4).

| Variant | Rule broken | Detected by |
|---|---|---|
| `volatile-voted-for` | Persistent state: `votedFor` not written to storage | `raft-one-vote-per-term`; with the right crash, `raft-election-safety` |
| `volatile-term` | Persistent state: `currentTerm` not written | `raft-term-monotonic`; also `raft-election-safety` |
| `double-vote` | RequestVote rule 2: grants regardless of `votedFor` | `raft-one-vote-per-term`, `raft-election-safety` (no faults needed) |
| `ceil-half-majority` | §5.2 majority: ⌈n/2⌉ instead of ⌊n/2⌋+1 (wrong for even n) | `raft-leader-has-quorum`; 2\|2 split → `raft-election-safety` |
| `no-step-down` | All Servers: on T > currentTerm, adopts T but does **not** convert to follower | `raft-election-safety` after a stale leader meets a higher term (focused regression: n5 elected, isolated, healed, keeps leading term 2 next to n4) |
| `ignore-higher-term` | All Servers, entirely: ignores higher-term messages | `raft-term-adoption`; it never elects a leader, so it cannot show an Election Safety violation |

Why two step-down variants: the first draft's "no step-down" ignored higher terms entirely. That bug prevents every election, so the step-down path was never reached in a real run and the intended defect was not demonstrated. Splitting it made the defect observable without weakening any invariant.
