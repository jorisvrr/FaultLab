# Study Guide: Code You Should Be Able to Explain

AI-assisted code is only portfolio-worthy if you can defend every line in an interview. For each item: **read it, modify it as the exercise asks, predict which tests fail, run them, and explain the result out loud.** Each item should take 30–90 minutes.

## 1. The binary heap — `src/priority-queue.ts`

**Know:** array representation (children at 2i+1/2i+2, parent at ⌊(i−1)/2⌋), sift-up and sift-down, why push/pop are O(log n), why a heap is *not stable*.

**Exercises**
1. Draw the array and the tree after pushing 5, 3, 8, 1, 4 by hand. Then verify with a quick test.
2. Make `#siftDown` pick the *larger* child. Which property test catches it, and what minimal counterexample does fast-check shrink to?
3. Interview question: "Why don't you need a stable heap to get deterministic output?" (Answer: the comparator is a strict total order thanks to `seq`. See ADR-0003.)

## 2. Scheduler semantics — `src/scheduler.ts`

**Know:** (time, seq) ordering; lazy cancellation and why `pendingCount` uses the live set, not the heap size; why the clock lives inside the scheduler.

**Exercises**
1. Change ties to LIFO (`b.seq - a.seq`). Read the failing simulation test about simultaneous deliveries and explain why the expected order is what it is.
2. Implement heap compaction: rebuild when dead entries exceed live ones. Write a test that proves no live event is lost.

## 3. The PRNG — `src/random.ts`

**Know:** what PRNG "state" is; why xoshiro128\*\* fits JavaScript (32-bit ops); what `Math.imul` and `>>> 0` do; modulo bias and rejection sampling; why `fromSeed` can never produce the all-zero state.

**Exercises**
1. Compute `limit` in `nextInt(0, 9)` by hand. How many raw values are rejected? Then do the same for range 3·2³⁰.
2. Delete the rejection loop and confirm which two tests fail. Explain why the chi-squared test did *not* catch it.
3. Compile and run `test/reference/xoshiro128.c`. Change one constant in both implementations and watch the vector tests fail.

## 4. The main loop — `src/simulation.ts` (`step`, `#invoke`, `#applyEffects`)

**Know:** the order of limit checks and why it matters at the boundaries; why effects are buffered; how `cause` links form the happens-before graph; why only the handler call is inside `try`.

**Exercises**
1. Write down, without running anything, the first 13 trace entries of the CP0 ping experiment (3 nodes, latency 5). Compare with `runSimulation(...).trace`.
2. Write a function `happensBefore(trace, i, j)` that follows `cause` links. Test it on the ping trace (is n2's pong to n1 causally after n1's ping?).
3. Move the `maxEvents` check after the dispatch. Which boundary test fails, and why is the original order the better specification?

## 5. The JSON trust boundary — `src/json.ts`

**Know:** why copy *and* freeze; the `WeakSet` structural-sharing trick and why it's safe (validated objects are frozen, so they can't change after validation); the `__proto__` pitfall.

**Exercises**
1. Replace `Object.defineProperty` with `out[key] = …`. What does the `__proto__` test show?
2. Explain why the `validated` WeakSet does not threaten determinism.

## 6. Determinism as an argument — `docs/DETERMINISM.md`

Be able to give the 2-minute version: *enumerate all sources of ambient information, close each, then prove by induction over steps.* Then name the three things it does **not** cover (cheating protocols, non-terminating handlers, engine version changes).

## 7. Node lifecycle and incarnations (CP1) — `src/node.ts`, `#applyFault` and `timer.fire` in `src/simulation.ts`

**Know:** the four state categories and what a crash does to each; why timers are cancelled eagerly *and* asserted at dispatch; why the incarnation is not exposed to protocols.

**Exercises**
1. Without running anything, write the trace entries at t=10 for: a timer due at 10, `crash` at 10, `recover` at 10, where the recovered `init` sets a 0-delay timer. Compare with the test "crash, recover and the old timer at one tick".
2. Delete the eager cancellation in the `crash` case. Which error appears, and from where? Then also disable the incarnation assertion and see which oracle rule catches it (mutants M1/M1b in TEST_STRATEGY).

## 8. Persistence — `src/context.ts` (storage overlay) and `#commitStorage`

**Know:** read-your-writes via an overlay map; why storage writes are committed before the step's messages; why "crashes only between steps" makes `sync-on-commit` sound.

**Exercise:** design (on paper) an explicit-`sync()` persistence mode. What new state does `NodeRuntime` need, what does a crash discard, and which new trace entry would make it explainable?

## 9. Network faults — `src/network.ts` (`route`, `blockedAtDelivery`)

**Know:** the send-time order (partition → loss → latency) and the delivery-time order (partition → crashed receiver); why link conditions are fixed at send but partitions are re-checked at delivery; what `conditionIndex` points to.

**Exercise:** make partitions send-only (remove the delivery check). Which tests fail? Write a paragraph arguing which semantics models a real cable cut better.

## 10. Floyd's heapify and compaction — `BinaryHeap.retain`, `EventScheduler.cancel`

**Know:** why bottom-up heapify is O(n) (most nodes are near the leaves); why compaction is amortised O(1) per cancel; why it cannot change the trace.

**Exercise:** derive the bound `heapEntries ≤ 2·live + threshold`. Then set the threshold to 1 and measure the benchmark. What does compaction cost when it runs too often?

## 11. The trace oracle — `test/invariants.ts`

**Know:** why an independent re-implementation of the rules catches bugs the engine's own assertions can't; how property tests feed it random fault plans; why generator diversity had to be measured.

**Exercise:** add a rule: "a `message.drop` with reason `lost` happens at its send time". Run the property tests.

## 12. Invariants as executable specifications (CP2) — `src/invariants.ts`, `#checkInvariants` and `#view` in `src/simulation.ts`

**Know:** state vs. historical invariants; why history must be explicit JSON (snapshots, determinism); why evaluation order and the stop rules are part of the spec; why `readonly` types are not runtime immutability, and how the graph-walk test proves it.

**Exercises**
1. Write a state invariant for the heartbeat protocol: "no node suspects itself". Make it fail on purpose with a buggy protocol.
2. Write a historical invariant: "a node's `boots` counter never decreases". What goes into `history`, and why must it be JSON?
3. Under `record-and-continue`, what entries does a failure that lasts 50 steps produce? Why?

## 13. Split brain and the naive leader protocol — `src/fixtures/naive-leader.ts`

**Know:** why "leader = highest node I can hear" is safe on a healthy network and unsafe under partitions; why the startup delay prevents false positives; why persisting the epoch fixed one bug but not the second (no quorum).

**Exercise:** sketch how a majority quorum would prevent both the partition counterexample and the crash-only epoch reuse (the essence of Raft, CP4).

## 14. Exploration and shrinking — `test/explore.ts`

**Know:** what fast-check's shrinking does and why shrunk plans stay valid; what 1-minimal means and why it is not "smallest"; why fixtures pin the replay, not the search.

**Exercise:** change the exploration's earliest fault time from 150 to 0 and rerun. Is the counterexample still a meaningful demonstration? Why did we choose 150?

## 15. Snapshots and restore (CP3) — `src/snapshot.ts`, `snapshot()` / `restore()` / `#load` in `src/simulation.ts`

**Know:** the difference between a step, a scheduled event, a trace entry and a virtual time (SEMANTICS §13); why a snapshot can only exist at a step boundary; which state is stored and which is *derived* on restore (in-flight index, heap layout); why insertion order must survive; what validation can and cannot protect against.

**Exercises**
1. Remove `messagesSent` from the restore and predict which property fails, and why (hint: message ids).
2. Explain why the snapshot keeps the complete `run.start` entry instead of only its fingerprint.

## 16. Keyframes and seeking — `src/time-travel.ts`

**Know:** binary search over keyframes; why the bound is "< K steps" and not "< K entries"; how absolute entry indices let a regenerated segment slot into the original trace.

**Exercise:** with the CP3 benchmark table, choose K for a UI that must seek in < 5 ms and use < 10 MB for keyframes. Justify it.

## 17. TraceIndex — `packages/trace/src/trace-index.ts`

**Know:** checkpointing (copy the state every C entries, replay at most C − 1); why the index cannot reconstruct PRNG states or invariant histories; how step boundaries are derived from entry kinds; how consequences invert `cause`.

**Exercise:** sketch how compressed-sparse-row arrays would replace the per-entry child arrays (PERF-3), and how you would prove frames stay identical.

## 18. Raft leader election (CP4) — `packages/protocols/src/raft/election.ts`, `docs/RAFT.md`

**Know:** why `ignore-higher-term` cannot demonstrate a missing step-down (nobody is ever elected), and how `no-step-down` does; the three roles and every transition in Figure 2; why `currentTerm` and `votedFor` must be durable *before* the reply leaves (and how `sync-on-commit` gives that for free); why ⌊n/2⌋+1 and not ⌈n/2⌉; why a rejected vote does not reset the election timer; what happens to a leader that sees a higher term.

**Exercise:** for each of the six broken variants, name the Figure 2 rule it breaks, then open its stored counterexample in `test/counterexamples/` and explain the fault plan event by event.

## 19. Historical invariants for Raft — `packages/protocols/src/raft/invariants.ts`

**Know:** Election Safety (per term, whole history) versus "one leader at a time"; why `leader-has-quorum` counts *delivered* grants plus a *durable* self-vote and ignores `votesGranted`; the split-vote false positive and why the durable state is the right evidence.

**Exercise:** write a hand-made view in which correct Raft has two nodes in `role: 'leader'` at once, and explain why no invariant should fire.

## 20. Bounded liveness — `packages/engine/src/liveness.ts`, `#checkLiveness` in `simulation.ts`, `packages/protocols/src/raft/liveness.ts`

**Know:** the phase machine (idle → waiting → met / missed, disarmed); why deadlines are real scheduler events; why D is a test bound and not a Raft property; how the healthy-group assumption avoids false misses in a 2|2 split.

**Exercise:** construct a run where a check is met late, and say exactly which trace entries appear and what each `cause` points to.

## 21. Fair comparison — `packages/protocols/test/comparison.ts`

**Know:** what is held equal between the protocols (external conditions) and what is not (their internals); how every metric is derived from the trace; why scenario B uses seed 1 and what B2 (seed 3) shows.

## 22. The Worker runtime (CP5) — `packages/runtime/src/worker-core.ts`, `client.ts`, `contract.ts`

**Know:** why slices end only at step boundaries and why that makes pausing harmless; the credit loop (who sends what, when, and why the Worker can never be more than `initialCredits` chunks ahead); why a throttled slice must not reschedule itself; the three ways a run ends (pause, stop, terminate) and why only the last is not reproducible; why each run gets a new Worker AND a runId.

**Exercise:** draw the message sequence for "run, then the user switches experiment while chunk #7 is in flight". Mark which messages are dropped, by which check.

## 23. Determinism guards — `packages/runtime/src/guard.ts`, `host.ts`

**Know:** how an own property shadows a prototype method (`performance.now`) and how it is restored; why the guard is installed per slice and not per handler call (measured cost); why the Worker's clock must be captured at load; why this is not a sandbox.

## 24. Incremental TraceIndex — `packages/trace/src/trace-index.ts`

**Know:** why checkpoints store message IDS (not records); how three Int32Arrays represent "children of i" in insertion order; what `append` rejects and why nothing is half-added.

**Exercise:** prove that `append(a); append(b)` equals `build(a ++ b)` for the step ranges when `b` starts in the middle of a step.

## Interview-style questions to practise

- Why integer ticks instead of float milliseconds? What would break first with floats?
- What is the difference between a queue event and a trace entry?
- How would you implement "step backwards"? (Today: re-derive from the trace. CP3: snapshot + re-execute.)
- Why are links not FIFO, and which real protocols care?
- If two runs with the same seed differ, how would you find the cause? (Hint: diff the canonical traces, look at the first differing index, follow its `cause` chain.)
- What survives a crash in FaultLab, and why is the node's random stream *not* reset?
- A crash and a timer are both due at t=10. Which happens first, and which rule guarantees it?
- Why is a message in flight lost when a partition starts, but not when a link's loss rate changes?
- Lazy deletion leaked memory in one workload. How did you measure it, and why can compaction not change the simulation's outcome?
- What is the difference between a safety and a liveness property, and why does FaultLab only check safety (so far)?
- How do you prevent an invariant from changing the simulation it checks? Why are `readonly` types not enough?
- Your property tests passed immediately. What did you do to make sure they were actually testing something?
- A stored counterexample stopped reproducing after an engine change. What does the test do, and what should you do?
- What exactly is in a FaultLab snapshot, and how did you prove nothing is missing?
- Why can the UI inspect entry #386 but never resume execution from it?
- Your memory benchmark reported negative numbers. What was wrong with the method, and how did you fix it?
- Two nodes both believe they are Raft leader right now. Is that a bug? What would you check first?
- Why can Raft not elect a leader in a 4-node cluster split 2|2, and why is that the correct behaviour?
- Your liveness check reported 13 misses although every run had a working leader. How did you find out the check was wrong, not Raft?
- Why does a deliberately broken variant need to be *found* by exploration rather than written by hand?
- A correct split-vote retry was flagged as "leader without quorum". What was the invariant's wrong assumption?
- Your app streams 124 000 trace entries. Where does the main thread spend its time, and why did you move the fingerprint out of the per-chunk path?
- How do you prove that pausing a simulation does not change its outcome?
- Your benchmark said a 351 ms main-thread block caused a 7 ms frame gap. What was wrong with the measurement?
- Why can a Web Worker not protect you from a malicious protocol, and what would?
