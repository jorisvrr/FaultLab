# CP6 Gate 4 — Simulate (implementation plan)

For review before any code is written. Gate 3 is committed (`a613872`) and published; Simulate and
Investigate still wear their CP5 presentation, so the application is never broken between gates.

Reference: `references/cp6/02-simulate.png` (1585 × 992), measured in `docs/CP6_DESIGN_AUDIT.md`
§2.2, with the behavioural contract in `docs/FAULTLAB_UI_IMPLEMENTATION_SPEC.md`.

---

## 1 · What Simulate is, in one sentence

The screen where a deterministic run is **watched**: the topology as it was at a chosen moment, the
experiment's real status at that moment, and a dock that moves the moment.

Everything on it is derived from the trace. Nothing is invented to match the reference, and nothing
claims a guarantee the protocols do not provide.

## 2 · The four quantities, kept apart

This is the plan's central discipline, because conflating any two of them produces a screen that
lies in a way that looks right.

| | What it is | Where it comes from | Shown as |
|---|---|---|---|
| **Trace entry** | An index into the recorded trace, `0 … length−1`. The finest unit; several entries can share one tick. | `SessionView.cursor` | "Event #829" |
| **Simulation step** | One dispatched event and everything it caused. Entries map to a step; a `run.end` belongs to none. | `TraceIndex.stepOf`, `step()` | "Step 412" |
| **Virtual time** | The engine's tick. Many entries share a tick; time never goes backwards. | `Frame.time` | "t = 15201" |
| **Playback cursor** | Where the *viewer* is. Driven either by time (play/scrub) or by entries (step/next marker). | new `PlaybackClock` | the dock's position |

Two navigation modes, both required, never silently swapped:

- **Time navigation** — play and scrub move virtual time; the displayed entry is
  `lastIndexAtOrBefore(t)`. This is what makes playback feel continuous.
- **Entry navigation** — step forward/back and jump-to-marker move exactly one entry, so
  same-tick entries are individually reachable. The reference's transport implies time; the
  keyboard and the event log must still give exact entries.

`frameAt(index, displayTime?)` already takes both, which is why this costs no engine change.

## 3 · Layout, from the measurements

Three columns over a docked replay bar, at the reference's own geometry:

| Region | Reference box | Content |
|---|---|---|
| Left · Trace context | 30–357 × 76–728 | experiment select, 7-row fact table, chapter rail |
| Centre · stage | 373–1190 × 76–729 | topology at playback position |
| Right · Experiment status | 1206–1558 × 77–729 | result line, status table, three chips |
| Dock · Replay trace | 30–1558 × 744–971 | transport, timeline, markers, selected label |

The dock is always visible (UX-002, already covered by a CP5 test).

## 4 · What each region shows, and where the data comes from

**Trace context (left).** Experiment title and summary, seed, spec fingerprint, engine version,
protocol, node count, entry count, stop reason. All from `SessionView.spec`/`experiment` and the
index — the same facts Configure's signature shows, so the two screens cannot disagree.

The "mini timeline" is a **chapter rail**: the run's major markers (first leader, each fault, each
violation, stop), not a second timeline. Clicking a chapter seeks to that entry. This resolves Q12.

**Stage (centre).** The Gate 1 renderer with `Frame` as its only input:

- role and term per node from `Frame.nodes`; a crown glyph plus "leader · term N" (Q15), stale
  leaders showing their older term
- crashed, partitioned and link-degraded states from the existing visual channels
- in-flight messages from `Frame.inFlight`, drawn along the links, uniform size — size encodes
  nothing (Q14); in-flight, delivered and dropped differ by shape and fill, not size
- labels inside the spheres, as the reference shows (Q16)

**Experiment status (right).** `Frame.openViolations`, `Frame.liveness`, `Frame.nodes`:

- the result line reads **"NO VIOLATIONS DETECTED"** with "in this run" (Q9) — never "all
  invariants satisfied", which claims proof the system does not have
- status table: lifecycle, violations so far, nodes alive **at the viewed position**
- three chips (Q10): messages delivered · messages dropped and faults applied · liveness result
  for Raft, or timers fired otherwise — all counted at the viewed position, all real

**Replay dock.** Transport (start · back · play/pause · forward · end), a linear virtual-time axis
with equal spacing (Q12), marker dots from `nextMarker`, and the selected position labelled
"t = … · Event #…" so both quantities are visible at once.

## 5 · New pieces to build

| Piece | Why |
|---|---|
| `PlaybackClock` | Plays virtual time at a chosen rate, independent of entry density, rAF-driven, pausable, reduced-motion aware. Today's `replaySpeed` advances *entries per second*, which makes a dense tick crawl and a sparse one jump. |
| `Timeline` (dock) | Virtual-time axis, markers, selection, scrub. Virtualized: a 200 000-tick run must not mount 200 000 nodes. |
| `EventLog` drawer | Search, filter by kind, group by step, click-to-seek. Virtualized with the existing `WindowedList`. Toggled by `E` (Q21), never covering the stage centre. |
| `ChapterRail` | The left rail's markers. |
| Status/chips components | Built from the Gate 2 design system; no new primitives expected. |

## 6 · Performance plan

The constraints are known from CP5 and Gate 1 measurements:

- **Long traces.** `raft-long-heartbeats` is 123 932 entries. The timeline and event log are
  virtualized; the chapter rail holds only markers. Nothing renders per-entry DOM.
- **Streaming.** While running, the trace grows every frame. Session already coalesces DATA
  notifications to one rAF; the dock must read `length`/`traceVersion`, never re-derive per entry.
- **Frame cost.** `frameAt` reconstructs from the nearest checkpoint. For playback we move forward
  in small increments, so the cost is bounded; this must be **measured**, and a budget test added
  alongside the existing `performance.spec.ts`.
- **GPU.** One WebGL context, two draw calls, unchanged from Gate 1. Message particles must not
  become a third draw call per message — they go into the existing instanced pass or an overlay.
- **Reduced motion.** Playback still advances; transitions become instantaneous, as in Gate 1.

## 7 · Accessibility

- Transport buttons are native `<button>`s with accessible names; the timeline is a native
  `<input type="range">` over virtual time, so keyboard scrubbing is free.
- The viewed position is announced through a polite live region, throttled — not every entry.
- Every stage state has a DOM equivalent, as in Gate 1 and Gate 3.
- The event log is a list with `aria-setsize`/`aria-posinset`, which `WindowedList` already does.
- Status never depends on colour alone.

## 8 · Responsive

1586 (reference) → 1440 / 1280 fluid → below ~1100 the side panels move under the stage → below
760 one column with the dock still docked. Verified at the five viewports in Q17.

## 9 · Testing

Unit: `PlaybackClock` (rate, pause, bounds, reduced motion), the time ↔ entry mapping including
same-tick entries, chapter derivation, status counts at a position.

Browser, all three engines: playback reaches the end and stops; scrubbing lands on the correct
entry; step navigation reaches same-tick entries that time navigation skips; markers seek exactly;
the event log seeks; a long run stays responsive while streaming; the stage shows no state the
frame does not contain; **the displayed status equals the engine's own at that step boundary**
(the existing inspection test pattern); fallbacks and reduced motion.

No existing golden is regenerated. If a new fixture is needed it is added through the established
workflow, as `configure-reference` was.

## 10 · Unresolved decisions — these need your call

| # | Question | My recommendation |
|---|---|---|
| **A** | **Routing (Q18).** Simulate wants deep links (`/lab/run/:id`) and browser history. Add React Router, or keep hash routes and defer? | **Keep hash routes for Gate 4.** Runs live in memory, so a deep link cannot be restored until CP7 persistence — a route that always lands on a recovery page is worse than no route. Revisit with persistence. |
| **B** | **Q11 status pill.** Configure shows the 5-dot decorative motif; the Simulate PNG shows "Trace locked". Q8 settled the motif as decoration with no data source. | Keep the motif decorative, and add a **separate, real** lifecycle chip reading "Ready / Running / Trace locked". Do not make the dots meaningful — that would contradict the approved Q8 decision. |
| **C** | **Playback rate units.** Ticks per second, or a multiplier of a nominal rate? | **Ticks per second**, shown as such. A "2×" with no baseline means nothing in virtual time. |
| **D** | **Q19 shared-element morph** Simulate → Investigate. Attractive, but it couples two gates' layouts. | **Defer to Gate 5.** Implement Simulate's stage so the morph remains possible (one persistent canvas), but do not build it now. |
| **E** | **Event log default state.** Open or closed on arrival? | **Closed**, opened by `E` or the Events control. The reference shows no log; an open drawer would change the approved composition. |
| **F** | **Which experiment Simulate opens with** when reached directly, with no run loaded. | An empty state pointing to Configure. Never auto-run something the user did not ask for. |

## 11 · Out of scope for Gate 4

Investigate's presentation (Gate 5), persistence and sharing (CP7), the determinism re-run
("Verify determinism" needs a second Worker run — proposed for Gate 6), and the decorative bubble
spheres deferred from Gate 3.
