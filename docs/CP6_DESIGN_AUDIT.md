# CP6 Phase 0 — Design audit, inventory and implementation plan

**Inputs:** the three approved PNGs (stored privately in `references/cp6/`, git-ignored) and `FAULTLAB_UI_IMPLEMENTATION_SPEC.md` (the "spec"; section numbers below refer to it). **Status:** for approval (Gate 0). Nothing in this document is implemented yet.

| Reference | File (private copy) | Size | Mode |
|---|---|---|---|
| Configure | `references/cp6/01-configure.png` | 1586 × 992 | Run setup · topology preview · invariant set |
| Simulate | `references/cp6/02-simulate.png` | 1585 × 992 | Trace context · topology · experiment status · replay dock |
| Investigate | `references/cp6/03-investigate.png` | 1586 × 992 | Node rail · focused node · derived state · timeline |

The references are **1586 × 992 (aspect 1.6)**, not the ≈ 1536 × 1024 the spec mentions; all coordinates below are reference pixels and are converted to proportions (`fr`, `clamp()`) during implementation, never hard-coded.

---

## 1. Measured design tokens (sampled from the PNGs)

Measured with PIL (median / 98th-percentile of defined regions; hue of the most saturated pixels). These replace the spec's approximate starter values (spec §4.2).

| Role | Sample (median → highlight) | Note |
|---|---|---|
| Page void | `#030405` (margins), `#020203` (gutters), `#090a0d` (lower edge) | Darker than the spec's `#080a0d` |
| Panel body (glass) | `#0b0d0f` – `#0d1010`, highlights to `#585755` on the inner edge | Smoked, very low contrast |
| Stage (centre panel) | `#080909` – `#0b0d0f` | Slightly darker than side panels |
| Dock / timeline panel | `#0a0c0d` | |
| Panel border | `#2c2b2a` (≈ rgba(255, 248, 240, 0.12)) up to `#5d5c5b` on lit corners | Warm-neutral hairline |
| Header hairline | ≈ `#68655f` peak, mostly faded | Fades towards both ends |
| Text, primary | `#eaebe9` – `#fefefe` | Slightly warm white |
| Text, labels (facts keys) | `#c4cfd9` | Cool blue-grey |
| Accent blue (toggle on, markers, focus) | `#adc8fe` / `#afc9fe`, glow up to `#dbf1fd` | Hue ≈ 220° |
| CTA fill | `#9cb6eb` → `#d0e0fc` (gradient), disc `#272f3f` | Pale icy blue, dark label |
| Fault-plan markers (crash, partition, heal), crown icon | `#f8c781` / `#fed998` | **Amber, hue ≈ 36°** (see Q1) |
| Node rim light (Configure, Investigate) | `#e2b089` / `#fbe5d2` | Warm, hue ≈ 27° |
| Node rim light (Simulate) | `#bab6b3` / `#fcfbfa` | Neutral-cool |
| Node body | `#0d0d0d` – `#121212` | Near-black graphite |
| Link lines | up to `#c2d1e3` | Cool-white hairlines |

**Typography (from zoomed crops).** Geist Mono for panel titles ("Run setup", "Trace context"), labels, keys, values, CTA label, uppercase card titles and timeline labels; Geist (proportional) for the wordmark "FaultLab", select values ("Healthy network") and node labels inside spheres. Approximate sizes at the reference: wordmark ≈ 22 px; panel titles ≈ 20 px; labels / values ≈ 15–16 px; card titles ≈ 15 px uppercase with tracking; micro labels ("STATE ORIGIN") ≈ 11 px uppercase; timeline labels ≈ 14 px.

**Geometry.** Header hairline at y ≈ 57. Panel corner radius ≈ 14–16 px; inner cards ≈ 12 px; CTA ≈ 20 px; gutters 16–17 px; outer margin ≈ 30 px left/right. Panels show a 1 px warm-neutral border, a faint inner top-left highlight and soft vignette; decorative "bubble" spheres overlap panel corners.

---

## 2. A. Visual inventory

### 2.1 Configure (`01-configure.png`)

| Component | Position (x₀–x₁ × y₀–y₁, ref px) | Typography / colour / material | States & notes |
|---|---|---|---|
| Logo sphere + wordmark | 40–82 × 15–55; text from x 101 | Sculptural glass/graphite mark; Geist ≈ 22 px `#eaebe9` | Hover/focus; links to app entry |
| Header hairline | 100–1400 × 57 | Fading warm-neutral line; a vertical grid hairline crosses at x ≈ 1005 | Decorative |
| Top-right status pill | 1398–1558 × 13–53 | Pill border; dots: one grey filled, three hollow, one blue glowing | **Meaning unknown (Q11)** |
| Left panel "Run setup" | 31–400 × 78–935 | Glass panel; header sphere icon + mono title; divider at y ≈ 145 | |
| Protocol select | 50–383 × 183–253 (radius ≈ 12) | Node-triangle icon, mono value, chevron | Open/closed/focus; real protocol list |
| Settings card | 49–384 × 275–713, rows separated by hairlines, icon column x ≈ 50–127 | Mono labels + values | |
| · Nodes row | y ≈ 295–350 | "Nodes 4" + four small graphite spheres (r ≈ 17) | **Interaction undefined (Q4)** |
| · Random seed row | y ≈ 388–435 | "Random seed 2026" + dual-thumb dashed slider | **A seed is an integer, not a range (Q3)** |
| · Network latency row | y ≈ 470–520 | "1–10 ticks" + dual-thumb slider (blue thumbs) | Real min/max range slider |
| · Fault injection row | y ≈ 559 | Icon box + "Fault injection Enabled" | Toggle → fault schedule editor (Q5) |
| · Regenerate seed row | y ≈ 614 | Icon box + label | Action |
| · Invariant policy row | y ≈ 665–690 | "Stop on first violation" | Select (stop-on-first / record-and-continue) |
| Decorative bubbles | ≈ 30–240 × 700–800 | Translucent circles + small sphere | Decorative (A) |
| **Run Experiment CTA** | 50–384 × 820–917 (radius ≈ 20) | Pale blue gradient, dark disc with play glyph, mono label | Hover sheen, press, busy, disabled |
| Centre stage | 417–1170 × 79–935 | Dark stage, vertical grid hairlines, faint orbit circle centred ≈ (795, 383) | |
| Topology (4 spheres, K4 links) | centres ≈ (795, 215), (598, 383), (1000, 383), (795, 549); r ≈ 53–55 | Graphite spheres with **warm rim light**, cool-white link hairlines with junction dots | Preview only: no simulated behaviour |
| Decorative orbs | e.g. (480, 205) r ≈ 14 with arc, (491, 513), (1103, 238) | Small spheres, thin circles | Decorative (A) |
| Fault-plan timeline | axis 437–1152 × 783; markers at x ≈ 540 / 720 / 902 / 1075; icon rings r ≈ 24 at y ≈ 698 | Amber rings + icons (crash ⚡, partition, heal) and one blue (recover); dashed drop lines; mono labels | Real plan only (Q6) |
| Right panel "Invariant set" | 1187–1558 × 78–935 | Glass; mono title | Scrolls when > 3 cards (Q7) |
| Invariant cards | x 1205–1540; y 173–304, 325–456, 479–609 (h ≈ 131, gap ≈ 21) | Icon zone, vertical divider, uppercase mono title, two-line mono description, pill switch (on: blue knob right; off: grey knob left) | On/off/hover/focus/unsupported |
| "Deterministic" card | 1203–1543 × 679–921 | Check-circle + title; inner box with ring diagram, three blue dots, placeholder bars | **Content undefined (Q8)** |

### 2.2 Simulate (`02-simulate.png`)

| Component | Position | Typography / colour / material | States & notes |
|---|---|---|---|
| Header | as Configure | | |
| "Trace locked" pill | ≈ 1400–1557 × 13–53 | Blue dot + mono label | True lifecycle state (Q11) |
| Left panel "Trace context" | 30–357 × 76–728 | Glass | |
| Experiment select | 50–338 × 177–220 | Geist value "Healthy network", chevron | Select a different run/preset |
| Facts table | y 245–400, 7 rows (≈ 23 px pitch) | Keys `#c4cfd9` mono, values white mono | Real metadata |
| Mini timeline ("t 300") | rail y ≈ 458, 5 dots, selected ring at x ≈ 193; label y ≈ 512 | Blue selected ring | **Meaning: chapter rail (Q12)** |
| Centre stage | 373–1190 × 76–729 | | |
| Topology | centres ≈ (814, 190) n1, (1039, 366) n2, (813, 543) n3, (591, 369) n4; r ≈ 57; K4 links | **Neutral-cool rim**, labels inside spheres (Geist) | Real roles, status, messages, faults |
| Right panel "Experiment status" | 1206–1558 × 77–729 | | |
| Result line | y ≈ 187 | "ALL INVARIANTS SATISFIED" mono uppercase + blue check circle | **Must become "NO VIOLATIONS DETECTED" (spec §6.1, Q9)** |
| Status table | 1221–1545 × 252–410 | Status / Violations / Active nodes | Real values at the viewed position |
| Three chips | y 490–537, x 1221–1320 / 1334–1432 / 1447–1545 | Blue, amber, blue sphere icons + placeholder bars | **Meaning undefined (Q10)** |
| Replay dock "Replay trace" | 30–1558 × 744–971 | Glass dock; title with sphere icon | Always visible (UX-002) |
| Transport | buttons centred x ≈ 656 / 722 / 792 / 861 / 928, y ≈ 788 | Rounded squares; play is a circle with blue ring | Start · back · play/pause · forward · end |
| Timeline | axis 50–1543 × 863; tick labels "t 0" … "t 600" every 50; blue/grey marker dots; selected ring at x ≈ 792 with label "t 300" below | Mono 14 px grey; selected label white, larger | **Spacing around the selection is irregular in the PNG (Q12)** |

### 2.3 Investigate (`03-investigate.png`)

| Component | Position | Typography / colour / material | States & notes |
|---|---|---|---|
| Header + status pill | as Configure (5-dot pill) | | |
| Node rail | 31–188 × 79–788 | Four spheres r ≈ 30 at x 109, y 148 / 288 / 428 / 570, mono labels below, vertical connector; n4 selected with blue ring r ≈ 42 | Select, focus, crashed, scroll for many nodes |
| Rail footer | 31–188 × 675–788 | ◀ ● — ▶ and "Topology" with icon | Previous/next node; back to Simulate |
| Centre stage | 204–1137 × 79–787 | Vertical hairlines, decorative circles | |
| Node card | 552–878 × 124–272 | "Node n4" title; icon + "follower / incarnation 1" (mono) | Real role, incarnation (+ term) |
| Hero sphere | centre ≈ (711, 447), r ≈ 97 | Graphite with micro-texture and **strong warm rim**; vertical connector to the card and down to the panel edge | The focused node |
| Message lanes | left 295–610, right 812–1080 at y ≈ 447 | Small spheres of varying size and chevrons pointing right (left lane → node, node → right lane) | Real incoming/outgoing messages (Q14) |
| Inspector "Derived state" | 1153–1557 × 79–793 | Chip "Trace derived" (blue dot) at 1390–1537 × 100–133 | |
| Volatile state card | 1171–1542 × 167–453 | Rows at y ≈ 261 / 310 / 360 / 412: mono key, lock icon, value cell (x 1336–1475, h ≈ 34), blue dot at x ≈ 1502 | Read-only; real keys (Q13) |
| Persistent storage card | 1171–1542 × 472–742 | Same row anatomy | |
| State origin | y ≈ 748–769 | "STATE ORIGIN" micro label; "Updated at Event #829"; underlined "View event →" | Real provenance |
| Timeline | 30–1557 × 807–935; axis y ≈ 868, x 55–1530; selected marker x ≈ 695 | Label "t=15201 · Event #829" mono | Shares the Simulate timeline model |

---

## 3. B. Functional inventory

Legend: **CP5** = exists functionally in `apps/web` (unstyled); **New** = must be built; **Visual** = presentation only; **Anim** = animation (A atmospheric / B interaction / C simulation); **Nav** = navigation; **Later** = future checkpoint.

| Area | Function | Status |
|---|---|---|
| Shell | Wordmark → app entry; mode switching Configure / Simulate / Investigate | CP5 (hash routes) → **New**: real routes, app switcher, breadcrumbs (spec §2) |
| Shell | True status pill (lifecycle, "trace locked" = completed & immutable) | CP5 data (lifecycle) → **New** visual |
| Configure | Protocol select (registry) | CP5 (preset-based) → **New**: direct protocol choice + description/version |
| Configure | Node count (valid per protocol), seed (integer + regenerate + copy), latency min/max, invariant policy, limits (advanced) | **New** (spec builder over `ExperimentSpec`; engine validation via `resolveExperiment`) |
| Configure | Fault schedule editor (crash, recover, partition, heal, link loss/delay/restore) with validation and timeline preview | **New** (engine supports all; UI absent) |
| Configure | Invariant cards from the registry for the selected protocol; liveness check (Raft) | CP5 data (registry) → **New** UI |
| Configure | Deterministic summary (seed, versions, spec fingerprint) | CP5 data (`specFingerprint`) → **New** UI |
| Configure | Run Experiment (validate → load → run → go to Simulate) | CP5 (load + run) → **New**: single-flight, busy state, transition |
| Configure | Topology preview (planned graph, deterministic layout) | **New** (3D/2.5D) |
| Simulate | Trace context facts, experiment select | CP5 data → **New** UI |
| Simulate | Experiment status (result wording, stop reason, violations, nodes alive at viewed time, enabled invariants, liveness) | CP5 data → **New** UI, wording fix |
| Simulate | Network stage: roles, terms, status, crash, partitions, links, in-flight messages at playback time | CP5 data (frames) → **New** (view models, stage, playback interpolation) |
| Simulate | Replay dock: transport, timeline, markers, selected position | CP5 (functional bar) → **New** visual + **PlaybackClock** (virtual-time playback) |
| Simulate | Time navigation (play/scrub virtual time) **and** event navigation (exact entries incl. same-tick) | CP5 (entry cursor + markers) → **New** time navigation |
| Simulate | Event log drawer (search, filter, group, virtualized, click-to-seek) | **New** (spec §6.1, required) |
| Simulate | Verify determinism (re-run, compare fingerprints) | **New** (second Worker run; contract exists) |
| Investigate | Node rail, previous/next, back to topology preserving position | CP5 (node table, selection) → **New** |
| Investigate | Focused node (role, incarnation, term) + message lanes | CP5 data → **New** (lane derivation from `index.messages`) |
| Investigate | Derived state inspector with per-field provenance ("updated at entry", "View event") and "not recorded" states | CP5 (state/storage/timers JSON) → **New** provenance derivation |
| Investigate | Causal navigation (cause chain, consequences, explained drops) | CP5 → **New** visual, **bounded** (see §7) |
| Investigate | Violation focus (rule, expected/observed, involved nodes, evidence references, active faults) | CP5 data → **New** UI |
| All | Keyboard model, accessible names | CP5 → extend (`?`, `J`, `E`, `F`, Esc per spec §10.3) |
| All | Reduced motion / transparency, WebGL fallback tiers | **New** |
| Later | Save / export / import / local history | **Later (CP7 in ROADMAP)** |
| Later | Compare runs, Learn, Protocols catalogue, workspaces, sharing | **Later** |

**Integration requirements (no engine changes).** New, additive, framework-free pieces: a `PlaybackClock` (wall time → virtual time → entry); view-model mappers (frame → nodes/links/signals/markers); per-field provenance (last `state.update` / `storage.write` that changed a key at or before the cursor; candidate for `@faultlab/trace`); message-lane derivation; marker clustering; a spec builder for Configure; a "verify determinism" client helper. A router (Q18). The Session, RuntimeClient, TraceStore, TraceIndex and the engine stay as they are.

---

## 4. C. Missing states (not visible in the PNGs)

| State | Configure | Simulate | Investigate |
|---|---|---|---|
| Idle / no experiment | Defaults or preset prompt | "No run loaded" + go to Configure / Experiments | Same |
| Loading (app, fonts, Worker, 3D chunk) | Skeleton matching panel geometry; 2.5D nodes until 3D is ready | Same | Same |
| Ready (loaded, not started) | — | Nodes "not started" at entry #0, "Ready · press Run" (UX-001) | Inspector "not started" |
| Running | — | Live, follow toggle, "+N in transfer", throttled hint | Live updates (bounded rendering, §7) |
| Paused / pausing | — | Paused at step boundary; pending indicator | Same |
| Completed (by stop reason) | — | Distinct wording per reason: quiescent / time-limit / event-limit / violation / protocol error | Same |
| Stopped (user) | — | "Stopped by you — trace complete up to here" | Same |
| Aborted | — | "Aborted — Worker terminated; incomplete, not reproducible" | Same |
| Error (spec, protocol violation, engine, Worker) | Field errors + summary | Error panel with source | Same |
| Healthy experiment | — | "NO VIOLATIONS DETECTED IN THIS RUN" | — |
| No invariants enabled | Warning on the cards | "NOT CHECKED — no invariants enabled" (never "safe") | — |
| Violation detected | — | Status turns to fault state; marker; "Inspect violation" | Violation focus (multi-node) |
| Selected node / message / marker | Planned node tooltip | Selection ring, quick inspector | Focus |
| Crashed node | — | Dashed broken rim + "CRASHED" + icon (not colour alone) | Inspector "crashed", storage still shown |
| Partition / link fault | — | Broken/dashed links per direction, group labels | Lanes show blocked messages |
| Stale leader (older term) | — | Leader badge with its term; **not** styled as a violation | Role + term shown |
| Missing data | — | "Not recorded by this trace" | Same |
| Empty trace / entry #0 | — | "Nodes initialise at entry #…" + jump | Same |
| WebGL unavailable / context lost | 2.5D/SVG tier, short notice | Same | Same |
| Reduced motion / transparency | Instant, matte | Static signal markers per position | Instant focus change |
| Invalid deep link / unknown run | Recovery page | Recovery page | Recovery page |

---

## 5. D. Page inventory (from spec §2, §15)

| Page / surface | Purpose | Entry point | Key components | Data | Interactions | Depends on | Phase | Priority |
|---|---|---|---|---|---|---|---|---|
| `/lab/new` Configure | Build and validate an experiment | Lab, Experiments, "Edit configuration" | Run setup, topology preview, fault timeline, invariant set, CTA | Registry, presets, `ExperimentSpec` | Edit, validate, run | Gate 1–2 | **Gate 3** | P0 core |
| `/lab/run/:runId` Simulate | Observe a run | Run, Back to topology | Trace context, stage, status, replay dock, event log | Session, frames, PlaybackClock | Play/scrub/step, select, inspect | Gate 3 | **Gate 4** | P0 core |
| `/lab/run/:runId/investigate` Investigate | Inspect node/event/violation | Inspect node / violation | Rail, hero node, lanes, inspector, timeline | Frames, provenance, messages | Select, navigate causes, back | Gate 4 | **Gate 5** | P0 core |
| Event log drawer | Detailed event inspection | `E`, "Events" control | Virtualized list, filters, search | Trace | Click-to-seek | Gate 4 | Gate 4 | P0 (spec "required") |
| Violation focus | Explain a violation | "Inspect violation", `J` | Rule, evidence, involved nodes | Violation entries | Jump to evidence | Gate 5 | Gate 5 | P0 |
| Run details sheet | Source-of-truth metadata | Info control | Versions, seed, fingerprint, limits, stop reason | run.start, RunView | Copy | Gate 4 | Gate 4 | P1 (cheap: data exists) |
| `/` Introduction | Explain + get into a demo | Root URL | Hero (real example trace), CTAs | A real preset run | Launch, try split brain | Gates 1–4 | Gate 6 | P0 |
| `/lab` Workbench entry | Start new / presets / recent (session) | Global nav | Lists | Presets, current session | Open | Gate 3 | Gate 6 | P0 |
| `/experiments` gallery | Pick a reproducible experiment | Global nav | Laboratory cards, filters | Presets + counterexamples | Open / run | Gate 3 | Gate 6 | P0 |
| `/experiments/:id` details | Understand inputs before running | Gallery | Scenario, protocol, lesson, faults | Preset metadata | Run, open setup | Gallery | Gate 6 | P0 |
| `/help` basics | Teach controls and concepts | Global nav, `?` | Editorial docs | Static + real glossary | Links to presets | — | Gate 6 | P0 |
| Keyboard shortcuts dialog | Discoverability | `?` | Dialog | Static | Esc | Gate 2 | Gate 6 | P1 |
| Preferences modal | Motion, speed, labels, density, shortcuts on/off | Global menu | Dialog | localStorage (preferences only) | Toggle | Gate 2 | Gate 6 | P1 |
| 404 / invalid run recovery | Recover | Any bad URL | Recovery text + actions | — | Go to Lab | — | Gate 6 | P0 |
| WebGL-unavailable notice | Explain reduced tier | Automatic | Non-blocking notice | Capability | Dismiss | Gate 1 | Gate 1 | P0 |
| Save / export / import | Reproducibility | Run menu | Dialog | Versioned JSON | Validate | **CP7** | Later | P1 → CP7 |
| Compare experiments | Naive vs Raft | Experiments | Paired stages | Two runs | Synchronised view | Two-run Session support | Later (post-CP6) | P1 → later |
| `/learn`, `/protocols`, `/about`, `/changelog`, `/contributing`, `/license`, `/privacy`, `/terms`, `/workspaces`, `/share` | Expansion | Global nav | Editorial / account features | Various | — | Content, accounts, backend | Later | P2 |

Nothing in the P2 rows is shown in navigation until it exists (spec rule 9).

---

## 6. E. Open questions and recommended interpretations

| # | Question | Recommendation |
|---|---|---|
| Q1 | **Fault colour.** The PNGs use **amber (hue ≈ 36°, `#f8c781`)** for crash/partition/heal markers and warm rims; the approved DESIGN_DIRECTION reserves **red-orange** for faults. | Follow the PNGs: amber for fault-plan markers and fault events; reserve a deeper ember red-orange (≈ `#ef7451`) **only for invariant violations and errors**, which no PNG shows. Record as a DESIGN_DIRECTION amendment. |
| Q2 | In the PNG, **heal is amber** while **recover is blue**. | Encode meaning: disruptive (crash, partition, link fault) amber; restorative (recover, heal, link restore) blue. This differs from the PNG for heal. Alternatively keep the PNG literally. |
| Q3 | "Random seed 2026" is drawn as a **dual-thumb slider**. | Integer field styled into the same row (value, copy, regenerate); no slider (spec §5.1). |
| Q4 | "Nodes 4" + four spheres. | Count selector: the sphere row shows the valid range for the protocol (e.g. 2–8, Raft 3–7); clicking a sphere sets the count; plus an accessible numeric stepper. |
| Q5 | "Fault injection Enabled". | Switch; enabled opens the fault-schedule editor (drawer); disabled = empty plan. |
| Q6 | Configure's timeline shows four faults, but the healthy preset has none. | Show the real plan; empty state when none. For visual comparison use a real **reference spec** (naive-leader, 4 nodes, seed 2026, crash → partition → recover → heal), so the screenshot matches with real data. |
| Q7 | Three invariant cards; naive-leader and Raft each register **five**. | Scrollable card list (all registered invariants of the protocol; the first three match the PNG: single-leader ↔ SINGLE LEADER, unique-leader-per-epoch ↔ UNIQUE EPOCH, epoch-monotonic ↔ EPOCH MONOTONICITY). Custom icons for each, in the same style. |
| Q8 | "Deterministic" card has placeholder bars. | Rows: seed, spec fingerprint, engine version, protocol version (blue dots = present / verified). |
| Q9 | "ALL INVARIANTS SATISFIED". | "NO VIOLATIONS DETECTED" (+ "in this run"), per spec §6.1. |
| Q10 | Three status chips (blue, amber, blue). | Messages delivered · messages dropped / faults applied (amber) · liveness result (Raft) or timers — counts at the viewed position. |
| Q11 | Top-right 5-dot pill (Configure, Investigate) vs "Trace locked" (Simulate). | One status component: compact dots show the run lifecycle position; label/tooltip states the true status ("Ready", "Running", "Trace locked" = completed and immutable); click opens the global menu (Lab, Experiments, Help, Preferences). |
| Q12 | Simulate's timeline labels are unevenly spaced around "t 300"; left mini timeline "t 300". | Linear virtual-time axis (equal spacing); the selected label is emphasised in place. Left mini rail = "chapters" (major markers) of the run. |
| Q13 | Inspector rows look like inputs with lock icons and blue dots; PNG keys (currentTerm, lastHeartbeat, savedTerm …) are illustrative. | Read-only value cells (copyable); lock = "read-only historical state"; blue dot filled = field changed at this entry (else hollow), linking to the entry that last set it. Keys from the real protocol state (Raft: role, currentTerm, votedFor, leaderId, votesGranted, timers; storage: currentTerm, votedFor). |
| Q14 | Packets in the lanes vary in size. | Uniform size (size encodes nothing) or recency only; in-flight vs delivered vs dropped distinguished by shape/fill. |
| Q15 | Leader is not visibly marked in the Simulate PNG, but runs have leaders. | A small crown glyph (as on the SINGLE LEADER card) + "leader · term N" label; stale leaders show their older term. |
| Q16 | Node labels: inside spheres (Simulate), none (Configure), below (Investigate rail). | Keep per mode. |
| Q17 | Reference viewport 1586 × 992. | Use it for fidelity comparisons, plus 1440 × 900, 1280 × 800, 768 × 1024, 390 × 844 (spec §4.4). |
| Q18 | Routing. | Add **React Router** (one dependency) for nested routes, deep links and history; or a small in-house history router. Runs are in memory: a reloaded `/lab/run/:id` shows a recovery page until CP7 persistence. |
| Q19 | Shared-element morph Simulate → Investigate. | One persistent stage canvas in the shell (also satisfies "one WebGL context"); the same sphere object moves into the hero position. |
| Q20 | The spec file is not in the repository. | Commit it as `docs/FAULTLAB_UI_IMPLEMENTATION_SPEC.md` (your own document), so later gates can cite it. |
| Q21 | Event log drawer placement. | Above the dock, toggled by `E` / an "Events" control; does not cover the stage centre. |
| Q22 | Fix the two CP5 UI bugs found in Phase 0 (§7) now or in Gate 2? | Fix at the start of Gate 1 (small, with regression tests). |

---

## 7. WebKit rendering tail: investigated

Experiments (each 4–5 repetitions of the 124 k-entry Raft run, frame gaps measured with `performance.now()` inside `requestAnimationFrame`):

| Condition | Chromium | WebKit |
|---|---|---|
| Streaming, Simulate, follow live | max 19–21 ms, 0 gaps > 50 ms | max 18–25 ms, 0 gaps > 50 ms |
| Streaming, not following / on Configure / bench page without React | max ≤ 22 ms, 0 > 50 ms | max ≤ 22 ms, 0 > 50 ms |
| Mode switch away and back via **Configure** during the run | — | 0 long frames |
| **Staying on Investigate** during the run (follow live) | 15 long frames, max 94 ms | frame time grows 38 → 173 ms, then one **≈ 44–48 s** block near completion |
| Investigate → Simulate quickly during the run (the CP5 test) | 0 > 34 ms | 2–7 frames of 36–86 ms |

**Root cause (not WebKit-specific):** `EntryDetail` renders the **entire cause chain** of the selected entry. With "follow live" the selected entry is the newest one, and in heartbeat-heavy Raft the chain grows linearly with the run (measured: 70 ancestors at entry 1 000, 3 230 at 50 000, **8 001** at 123 930). Investigate therefore re-renders thousands of list items per frame. Chromium degrades too; WebKit degrades more. The CP5 performance test only passed through Investigate for one frame.

**Second CP5 bug found:** controlled inputs (the "follow live" checkbox, the cursor slider) revert for one frame after a click, because Session notifications are deferred to the next animation frame while React restores controlled inputs immediately.

**Proposed fixes (Gate 1 start):** cause chain shown nearest-first and bounded (e.g. 12, "show all" windowed); Investigate detail not re-rendered per frame while following; user-initiated Session changes notify synchronously (Worker-driven updates stay frame-coalesced); regression tests for both, including a Playwright test that stays on Investigate during a long run in all three browsers.

---

## 8. Performance budgets (from CP5 measurements; validated per gate)

| Budget | Target | Basis |
|---|---|---|
| React commits | ≤ 1 per animation frame (user input may commit immediately) | CP5 Session coalescing |
| Main-thread script per frame while streaming | ≤ 8 ms (largest chunk today: 1.5–8 ms) | CP5 |
| Frame gaps during a 124 k-entry run with the final UI | p95 ≤ 20 ms, max ≤ 50 ms in all three browsers; 0 gaps > 100 ms | CP5 pipeline: max 15–22 ms |
| GPU frame time (stage) | ≤ 8 ms on the reference machine at the reference viewport | Gate 1 measurement |
| Idle | No continuous rendering (on-demand); ≈ 0 % GPU when nothing changes | — |
| Shader compilation | Before first interaction (warm-up), never during scrubbing | — |
| Scrub / seek | `frameAt` ≤ 1 ms today; pointer → updated stage within 1 frame | CP5 |
| Initial JS | Shell ≤ 250 KB gzip; 3D chunk lazy, budget set in Gate 1 | — |
| Memory | Repeated runs return to baseline (CP5 leak check); GPU resources released on mode/page change | CP5 |

Reference hardware: the development Mac (Apple silicon) for all three browsers; a lower-tier test via Chromium CPU throttling and reduced DPR. Other target devices to be named by you.

---

## 9. Implementation plan (gates)

| Gate | Scope | Evidence for review | Complexity |
|---|---|---|---|
| **0** (this) | Audit, tokens, inventories, questions, WebKit investigation, ADR-0025 | This document | — |
| **1** | Fix the two CP5 bugs; install `three` + `@react-three/fiber`; **one sculptural node** at the reference angle: geometry, graphite material, warm/neutral rim, environment reflections, Fresnel, highlights, contact shadow, hover / selected / active / crashed states, reduced motion; 1 vs 4 vs 20 instances sharing geometry/material; fallback tiers (reduced 3D, 2.5D image); measurements (CPU, GPU frame time, draw calls, memory, shader compile, bundle) | Side-by-side and overlay with the PNG crops; numbers | M–L |
| **2** | Design system: tokens from §1, Geist/Geist Mono, glass panel, header + status pill, buttons (CTA, transport, icon), select, switch, range slider, numeric field, cards, chips, value cells, timeline primitives, tooltip, dialog, focus styles; gallery page; router decision | Gallery screenshots vs PNG details; axe | M |
| **3** | Configure at full fidelity with real spec building, validation, fault editor, invariant cards, deterministic card, topology preview, Run → Simulate | Screenshot vs PNG (reference spec Q6); functional tests | M |
| **4** | Simulate: stage with real roles/terms/status/links, PlaybackClock, message signals, faults, replay dock with time and event navigation, event log drawer, status semantics, run details | Screenshot vs PNG (naive-leader healthy, seed 7 — the PNG's own facts); performance run | L–XL |
| **5** | Investigate: rail, hero morph, lanes, provenance inspector, bounded causal navigation, violation focus | Screenshot vs PNG; scenario tests (spec §17.4) | L |
| **6** | Supporting pages (`/`, `/lab`, `/experiments`, details, `/help`, 404, shortcuts, preferences), motion polish, custom cursor (conditional) | Screens + interaction videos/stills | L |
| **Final** | Accessibility (WCAG 2.2 AA, axe + manual), responsive sizes, performance gate in three browsers, visual regression baselines, demo retirement decision, docs + ENGINEERLOG | Report | M |

**Visual regression.** Playwright screenshots at 1586 × 992 with deterministic inputs (fixed spec, fixed cursor, motion off), compared to the PNG crops as side-by-side and overlay images for **human review** (the PNGs contain illustrative data, so pixel equality is not the goal); after each approval, our own screenshots become `toHaveScreenshot` baselines per browser on the same machine.

**Functional regression.** All CP5 suites keep passing; new: rendering is a pure function of (trace, position); scrubbing never sends Worker commands; Raft semantics (two leaders in different terms ≠ violation; no log replication claims); Completed / Stopped / Aborted distinct; the spec §17.4 scenarios.

**Legacy demo.** Retire at the final gate, once the web app's tests cover the demo's six browser scenarios (healthy leader, crash/recovery/partition, split-brain fixture explanation and fingerprint, determinism across reloads, playback without re-execution). Retirement is a normal commit, so the demo stays in history.
