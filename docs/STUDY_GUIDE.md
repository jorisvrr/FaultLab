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

## Interview-style questions to practise

- Why integer ticks instead of float milliseconds? What would break first with floats?
- What is the difference between a queue event and a trace entry?
- How would you implement "step backwards"? (Today: re-derive from the trace. CP4: snapshot + re-execute.)
- Why are links not FIFO, and which real protocols care?
- If two runs with the same seed differ, how would you find the cause? (Hint: diff the canonical traces, look at the first differing index, follow its `cause` chain.)
