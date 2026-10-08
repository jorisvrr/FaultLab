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
