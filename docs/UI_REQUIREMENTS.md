# UI Requirements (for the frontend checkpoints CP5–CP6)

Requirements gathered from real use, to be satisfied by the **final** frontend. The CP2.5 prototype (`apps/demo`) is deliberately not being changed to meet them. Visual treatment follows [DESIGN_DIRECTION.md](DESIGN_DIRECTION.md); engine contracts follow [SEMANTICS.md](SEMANTICS.md).

**Ground rule for every item below:** every state, marker and label originates from real simulation data (engine output or exact derivation from the trace). Nothing is fabricated, and no real event is skipped without saying so.

## UX findings from manual testing

### UX-001 — Confusing initial experiment state

*Found:* 2026-10-08, manual test of the CP2.5 prototype ("Crash, recovery and partition").
*Observed:* after selecting an experiment, the description already talks about the upcoming crash and partition, while every node shows "not started", because playback starts at trace entry #0 (`run.start`). Technically correct, but confusing for a first-time user.

Requirements:

1. Visibly separate **experiment configuration** (inputs: seed, nodes, protocol, fault plan, invariants) from **current simulation state** (what is true at the playhead).
2. Always show the run's lifecycle state explicitly: *ready* (configured, not executed), *running* (executing), *paused*, *completed* (with stop reason), *replaying*.
3. Consider opening at an **initialized network state**, e.g. after the t=0 start steps. Any such default position must be a real trace position, shown as such ("showing t=0 after node starts, entry #12"); earlier entries remain reachable.
4. Never invent node states and never silently skip events. If the view starts later than entry #0, say so.
5. Make the relationship between the selected experiment and the playhead obvious: where the planned faults sit on the timeline, and whether they are past or future relative to the playhead.

### UX-002 — Playback controls below the viewport

*Found:* 2026-10-08, manual test of the CP2.5 prototype.
*Observed:* the network visualisation is too tall; users must scroll to reach the playback controls and timeline, and the upper nodes scroll out of view while using them.

Requirements:

1. Essential playback controls stay **visible while inspecting** the simulation: a persistent, docked or sticky timeline inside the application viewport.
2. Important events appear as **clickable timeline markers**, at minimum: node crash, node recovery, network partition, network heal, invariant violation (later: link faults, protocol errors).
3. Clicking a marker navigates to **the exact corresponding trace entry**, not just to its timestamp, because many entries can share one virtual time.
4. The network stays visible while navigating the timeline.
5. No page scrolling is needed during an experiment at common desktop sizes; define responsive behaviour for smaller screens (the read-only fallback in DESIGN_DIRECTION §7).

## Timeline requirements

The final timeline must eventually support:

| Requirement | Engine data it relies on | Available |
|---|---|---|
| Persistent playback controls | — (layout) | — |
| Clickable event markers (crash, recovery, partition, heal, violation, …) | fault entries, `invariant.violation` | CP2 ✅ |
| Clearly visible current virtual timestamp | entry `time` | CP0 ✅ |
| Run, pause, restart, step (per entry *and* per simulation step) | trace; step boundaries derivable from entry kinds | CP0 ✅ (step index: CP3) |
| Jump to important faults and violations | `faultId`, `conditionIndex`, violation `trigger` / `step` | CP2 ✅ |
| Inspect node states at the selected moment | state reconstruction from the trace | CP2.5 (O(n)); efficient: CP3 |
| Snapshot-based seeking | snapshots / keyframes | CP3 |
| Clear distinction between live execution and replay of a completed trace | run lifecycle state (UI) + engine `stopReason` | CP5 |

## Lessons from the CP2.5 prototype (engineering)

- **Entry vs. step cursor.** At `node.recover` the recovered node's storage is not yet updated; the `storage.write` is the next entry. A timeline must decide whether "step" means one trace entry or one simulation step, and make that choice visible.
- **Reconstruction cost.** Rebuilding state by scanning from entry #0 for every frame does not scale beyond small traces. CP3 provides indexed reconstruction.
- **Log volume.** 1 168 entries for 421 events in a small run: the log needs grouping per step and filtering by node and kind.
- **Execute vs. replay.** The prototype shows that separating "the engine computed this" from "you are watching a recording" is both possible and important. Keep it explicit.

## Raft visualisation data (CP4 → CP5/CP6)

CP4 implements no UI, and covers Raft **leader election only**: there is no log, no commitment and no replicated state machine to visualise until CP8. These are the **data** requirements a future leader-election view must be built on. Every item is derivable from a real trace (engine output) with the `TraceIndex`; no protocol event may exist only in the UI, and every visual element must keep a link to the trace entry it comes from (`index`, plus `cause` / `conditionIndex` for explanations).

| What to show | Source in the trace (exact) | Causal reference to keep |
|---|---|---|
| **Node role** (follower / candidate / leader) | `state.update.state.role` of the node; `frameAt(i).nodes[k].state` | the `state.update` entry (`stateEntry`) |
| **Current term** per node | `state.update.state.currentTerm`; durable value in `storage.write.set.currentTerm` / frame `storage` | the `storage.write` that made it durable |
| **Election attempt** (term T started by n) | `state.update` with `role: 'candidate'`, `currentTerm: T`, triggered by an election `timer.fire` | `cause` → the `timer.fire` → its `timer.set` |
| **Vote request** | `message.send` with `payload.type: 'RequestVote'` (`term`, `candidateId`); its `message.deliver` or `message.drop` | send ↔ deliver/drop via `messageId`; drops via `conditionIndex` to the fault |
| **Vote granted / rejected** | `message.send` of `RequestVoteResponse` with `voteGranted` true/false and `term`; for a grant, the voter's `storage.write votedFor` in the same step | `cause` → the `RequestVote` delivery |
| **Majority formation** | the candidate's delivered granted responses for its term (distinct senders) + its durable self-vote; majority = ⌊n/2⌋+1 of the configured nodes (`run.start.nodes`) | each counted `message.deliver`; never the protocol's `votesGranted` alone |
| **Leader transition** | `state.update` with `role: 'leader'` (first one per node and term); step-down = `state.update` from leader to follower with a higher term | `cause` → the deciding vote delivery, or the higher-term message |
| **Heartbeats** | `message.send` / `message.deliver` of `AppendEntries` with `entries: []`; follower timer resets as `timer.cancel` + `timer.set` | `cause` → the leader's heartbeat `timer.fire` |
| **Stale leader** (believes it leads an older term) | a running node in `role: 'leader'` whose `currentTerm` is lower than another leader's term | both `state.update` entries; must NOT be drawn as an Election Safety violation |
| **Partitions / link faults** | `network.partition`, `network.heal`, `link.fault`, `link.restore`; frame `partition`, `links` | the fault entry (`faultId`), drops' `conditionIndex` |
| **Safety violations** | `invariant.violation` (ids `raft-election-safety`, `raft-term-monotonic`, `raft-one-vote-per-term`, `raft-leader-has-quorum`, `raft-term-adoption`) with `expected`, `observed`, `evidence`, `references`, `step`, `activeFaults` | `references` (e.g. both leaders' entries), `trigger` |
| **Conditional liveness results** | `liveness.armed` / `.met` / `.missed` / `.disarmed` with `check`, `since`, `deadlineAt`, `duration`, `late`; frame `liveness[]` phases; assumptions in `run.start.liveness` | `liveness.missed.cause` → its `liveness.armed`; must be visually distinct from safety violations and must show the assumptions and that D is a test bound |

Presentation rules that follow from CP4's semantics:

1. **Election Safety is per term over the whole history**, not "one leader on screen". Two leader badges in *different* terms at the same moment is legal and should be explained (stale leader), not flagged red.
2. **Liveness ≠ safety.** A missed deadline is a bounded-test result under stated assumptions; a disarmed check means "no expectation" (e.g. no majority), which must not look like success or failure.
3. **Term lanes**: a per-term view (who campaigned, who voted for whom, who won, how long without a leader) is derivable from the entries above; it needs no extra engine data.
4. Vote arrows and majority counters must be built from **delivered** responses, matching `raft-leader-has-quorum`, so the UI and the invariant never disagree.

## CP6 Gate 1 corrections to the CP5 application

Two defects found by the Gate 0 investigation, fixed and covered by tests ([CP6_GATE1_NODE.md](CP6_GATE1_NODE.md)):

- **UX-003 — Investigate froze during live inspection.** The cause chain of the newest entry was rendered in full; with heartbeat-heavy Raft it reaches ≈ 8 000 entries and grows with the run. All engines degraded, WebKit worst (one 8.9 s frame). Cause chains, consequences and the markers list are now windowed: the full chain is always reachable (length shown, scrolling, jumps to the nearest cause and to `run.start`), only the visible rows are in the DOM. **Requirement for every CP6 surface: no list may render an unbounded number of rows.**
- **UX-004 — Controls reverted for one frame.** Controlled inputs showed the previous value until the next animation frame. `Session` now notifies user-initiated changes synchronously and keeps coalescing Worker data. **Requirement: a control must show the user's intended state within the same event.**

## CP5 status and constraints for the final frontend (CP6)

**Implemented functionally in CP5** (`apps/web`, minimal styling, not the final design): the three modes (Configure, Simulate, Investigate); UX-001 (explicit lifecycle badge incl. pending pause/stop, "live" vs "replay" wording, configuration shown separately from current state); UX-002 (docked playback bar that never scrolls away, verified at 1200×600); marker navigation to exact entries; node inspection verified against the Worker engine's own snapshots; keyboard operation (Space, ←/→, Shift+←/→, [ ], Home/End, F) with accessible names on every control.

**Technical constraints the visual implementation must respect** (from CP5 contracts and measurements):

1. **Data source.** Visual components read `Frame`s (`TraceIndex.frameAt`) and the `Session` view only. No engine access from rendering code; no visual-only events. Every drawn element must map to a trace entry index (for causal navigation).
2. **Render budget.** While a heavy run streams, the main thread spends ≤ ~8 ms per chunk applying it (largest measured chunk: 1.4–8 ms across engines). To keep 60 fps, per-frame rendering must stay well below ~8 ms; React updates are coalesced to one per animation frame.
3. **3D / R3F.** The R3F scene should subscribe to the Session and read the current frame inside its own render loop (no React state update per animation frame), and must degrade gracefully (reduced motion, no WebGL).
4. **Interpolation is display-only.** Message positions between send and delivery use `displayTime`; they are never state.
5. **Lifecycle semantics are part of the UX contract.** `completed` (reproducible), `stopped` (by the user, complete up to there), `aborted` (Worker terminated; incomplete, not reproducible), `error`. Visual treatment must not blur them.
6. **Live vs inspection.** "Follow live" vs a user-chosen cursor must stay visible; the run continues in the Worker while the user inspects the past.
7. **Large traces.** 124 k-entry runs are normal (Raft with heartbeats ≈ 0.6 entries/tick for 5 nodes). Lists must be windowed; the timeline must not create a DOM node per entry.
8. **Accessibility.** Keep the keyboard model and accessible names established in CP5; every visual state needs a text equivalent.

