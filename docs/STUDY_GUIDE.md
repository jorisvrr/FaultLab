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
