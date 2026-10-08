# FaultLab: Visual Design Direction

> **Status:** approved direction, not implementation. No visual code exists yet, and none will be written before the frontend checkpoint. Visual work starts once the Worker boundary and minimal UI shell prove that the interface consumes real engine output. Everything here is subordinate to [DETERMINISM.md](DETERMINISM.md): visuals read the trace; they never feed into it.

### Approved decisions (2026-10-08)

| Topic | Decision |
|---|---|
| Direction | Experimental digital minimalism × cinematic art direction × premium futuristic engineering interfaces |
| Typography | **Geist** for interface typography; **Geist Mono** for technical information, identifiers, traces, timestamps and debugging data |
| Colour | Primarily monochromatic: deep blacks, charcoal, off-white, silver. **Red-orange ("ember") is reserved for faults, crashes, failures and warnings.** Neutral silver/white marks normal activity and selected elements. Critical status is never communicated by colour alone |
| Theme | **Dark first.** Light mode is a future enhancement (§5.3 keeps its direction) |
| Assets | Reference images are research material, not production assets. They are never committed (§1.1) |

**Target impression:** *an experimental digital laboratory where distributed systems become tangible, observable, and understandable.* The craft of a high-end interactive portfolio, with the credibility of a serious developer tool.

---

## 1. Reference inventory

`inspo.zip` contains **11 images**, each inspected individually. Labels R1–R11 follow the zip's filenames (`1.jpg` … `10.jpg`, `cursor idea.png`).

*Verification note:* the first analysis received 10 of these as direct attachments. `5.avif` (R5) was missing and has since been added. The other ten were matched to the zip's files by checksum. Because the earlier analysis numbered them without R5, its R5–R10 are this document's R6–R11.

| # | Reference | Category | What it contributes | Mode |
|---|---|---|---|---|
| R1 | "Take a deep breath…" stress-relief player over dark rock photography | Tactile controls · cinematic atmosphere | Pill-shaped glass sliders with dot-step tracks and a hairline value cursor; **circular transport cluster** (−10 / play / +10) with a bright white primary disc between dark metallic ones; a **vertical time rail** with mono timestamps (4:15 → 15:10); small pill tag ("Stress Relief"); a light large headline over tiny numeric sub-text | Dark |
| R2 | "Style Board": planner, calendar, clock, tag, photography | Component/material board | Frosted glass card with defocused edge; **dot-matrix calendar** (filled vs. hollow vs. accent dots); segmented/scanline digital numerals ("11:12"); warm pale-yellow pill tag; a list fading by depth (opacity encodes distance); faint vertical column hairlines across the page; wide-letterspaced caption | Dark, warm-tinted |
| R3 | "20% processing" radial indicator | Data indicator | ~70 radial ticks forming a ring, grey→white gradient by angle, the **progress segment in a single warm red-orange**; huge numerals; calm two-line explanatory copy | Dark |
| R4 | Navigation variants v.1 / v.2 / v.3 | Interaction states | Inset matte pill bars; active item as a raised pill, hover as a softer pill; **active indicator as a small glowing dot** (v.3); monospace version labels; generous internal padding | Charcoal |
| R5 | "Mega UI V1": a commercial Photoshop UI-kit preview of rotary knobs and dials | Hardware controls · materials | Brushed-aluminium knob (conic gradient), soft-glow halos, **tick scales around dials**, segmented arc gauges ("3 / 4 DEFINITION"), large numerals inside a dial ("1563 AB-VALUE"), single white indicator dots, a fully white disc as the strongest element. Monochrome with light as the only accent | Dark |
| R6 | "A/ ●● 1 — LETTER "A" FORWARD SLASH ZERO ZERO ONE" | Editorial typography · identifier systems | A symbolic identifier spelled out in tiny caps beside its glyph form; **dot glyphs as code**; heavy film grain over a defocused face; strict horizontal baseline | Dark mono |
| R7 | "SENSUAL" poster | Editorial composition | A single centred headline; micro-text fragments placed on an invisible grid at deliberate distances; grain and motion blur as atmosphere; extreme negative space | Dark mono |
| R8 | Portfolio with frosted discs and dark spheres (谢奕臣, "designer + maker") | Light sculptural 3D | Off-white/neutral grey field; translucent frosted ellipses and **blurred dark spheres** as abstract objects; tiny name/role text; vertical icon column | Light |
| R9 | "Halo." internship case study | Light editorial portfolio | Grainy, defocused metallic ring as hero object; giant ghosted index numeral "01."; **numeric pagination 01–04**; small red square and bar as the only colour; tiny caps navigation | Light |
| R10 | HF0 residency page | Dark editorial landing + data panel | Stippled, sliced sphere (grain-as-texture 3D); a dark rounded panel with hairline dividers and **very large thin numerals** ("1", "18") paired with small labels; one light full-width action bar; footer micro-text ("Mute") | Dark |
| R11 | Cursor idea | Cursor | Soft, puffy, white 3D arrow with rounded geometry, gentle inner shading and a soft drop shadow | Neutral |

### 1.1 Licensing of references

All eleven images are third-party work, and R5 is a commercial product (a paid Photoshop kit). None of them, and nothing traced or extracted from them, may enter the repository or the product. FaultLab's visuals are drawn from scratch from the principles below. The only third-party design assets planned are the Geist and Geist Mono fonts, licensed under the SIL Open Font License 1.1, which permits bundling with MIT-licensed software as long as the OFL text ships with the font files.

## 2. Shared design language

1. **Monochrome first, one voice of colour.** Every reference is essentially greyscale; colour appears once, sparingly, to mean something (R3 progress, R2 selected days, R4 active, R9 index).
2. **Light as a material.** Depth comes from glow, inner highlights, blur and grain, not from borders and drop-shadow stacks.
3. **Extreme scale contrast.** Huge, light-weight numerals or headlines next to 10–12 px annotations (R1, R3, R9, R10). Hierarchy through size and weight, not colour.
4. **Time and numbers are heroes.** Timestamps, percentages, dates, counts. This is a gift for FaultLab, where virtual time *is* the subject.
5. **Round geometry.** Pills, discs, rings, circular controls; large, concentric radii.
6. **Hairlines and invisible grids.** Thin dividers, column lines, precise baselines (R2, R6, R7, R10).
7. **Focus and defocus as hierarchy.** What matters is sharp; context is blurred or grained (R6–R10).
8. **Tactility without skeuomorphic kitsch.** Controls look pressable (R1, R4, R5) but stay flat enough to read as software.

## 3. Noteworthy differences

| Axis | One end | Other end | FaultLab's position |
|---|---|---|---|
| Luminance | Dark cinematic (R1, R3, R6, R7, R10) | Light sculptural (R8, R9) | Dark primary; light as a deliberate second environment |
| Accent hue | Red-orange (R3), red (R9) | Pale yellow (R2), green (R4) | One hue, ember (§5.2) |
| Imagery | Photography (R1, R2) | Abstract 3D objects (R8–R10) / pure UI (R3, R4) | **No photography.** Abstract forms derived from data |
| Density | Component board (R2) | Near-empty poster (R7) | Sparse stage, dense-but-quiet instrument panels |
| Texture | Clean vector UI (R3, R4) | Heavy grain (R6, R7, R10) | Grain only in the atmosphere layer, never on data |

## 4. Adapt, don't copy

| Reference element | Do **not** copy | Adapt as (FaultLab-specific, data-driven) |
|---|---|---|
| R3 radial tick ring | The loader as a loader | **Node glyph:** each node is a disc ringed by ticks. Ticks show real per-node data (pending timers as arcs counting down; recent handler activity). Also the **run gauge**: `eventsProcessed / maxEvents` |
| R2 dot-matrix calendar | Calendar | **Activity matrix:** node × virtual-time bucket, a dot per bucket (filled = events handled, hollow = idle, accent = fault/error). Derived from the trace |
| R1 vertical time rail and transport | The meditation layout and rock photography | **Virtual-time rail** with mono timestamps; transport cluster: step back · play/pause (bright white disc) · step forward |
| R10 giant thin numerals | The HF0 layout, sphere, copy | **Virtual clock readout** (`t 1 840`) and key counts (term, events) as giant light numerals with small labels |
| R6 identifier spelled beside its glyph | The face, the "A/●●1" mark | **Run signature:** the 32-bit trace fingerprint rendered as a 4×8 dot glyph next to its hex (`62159051`). Identical runs produce identical glyphs, a visual proof of determinism |
| R2 list fading by depth | Planner content | **Trace list relative to the playhead:** past entries at full contrast, future entries (already computed, not yet "reached") dimmed |
| R4 v.3 glowing dot | The exact bar | **Mode switcher** (Lab · Trace · Faults · Invariants) with a luminance dot, not the accent |
| R7/R6 micro-annotations | The poster typography | Tiny mono annotations at the stage edges: seed, engine version, protocol@version, node count |
| R8/R9 sculptural objects, ghost numerals | The specific objects and compositions | Light mode's identity: matte porcelain node discs, ghosted step/term numerals |
| R5 knobs, tick-scaled dials, glow arcs | The kit's knobs, textures and layer styles (commercial asset) | **Fault parameter controls** (loss probability, extra latency, partition timing) drawn as a dial: a tick scale plus a value arc, with a large numeral inside. Interaction is never rotate-to-drag only: each dial is a `role="slider"` operated by arrow keys and wheel, and always paired with a direct numeric input. Brushed metal stays reserved for the primary transport disc and node discs |
| R11 puffy cursor | Pixel-for-pixel | A FaultLab cursor with the same soft, dimensional quality (§9) |

## 5. Colour system

### 5.1 Principle

Neutral greys carry ~95% of the interface. **Neutral silver/white encodes normal activity and selection** (brighter = more important, selected, or "now"). **Red-orange (ember) is reserved for faults, crashes, failures and warnings**: crashes, drops, partitions, invariant violations, protocol errors, limit warnings, and user-authored fault injections. Healthy is the neutral default, so a calm system looks calm. Every ember state also has a shape and a text label (§5.4).

### 5.2 Dark environment (primary)

| Token | Value | Use | Contrast (measured, WCAG) |
|---|---|---|---|
| `--bg-0` | `#0A0A0B` | Page, stage | — |
| `--surface-1` | `#17171A` | Matte panels | — |
| `--surface-2` | `#202024` | Raised controls | — |
| `--glass` | `rgb(23 23 26 / 0.62)` + `blur(20px)` + inner top highlight `rgb(255 255 255 / 0.06)` | Floating panels over the stage (see §10 for constraints) | — |
| `--line` | `rgb(255 255 255 / 0.07)` | Decorative hairlines, grid | decorative |
| `--line-control` | `#64646C` | Boundaries users must perceive (inputs, focus-less toggles) | 3.37 on bg, 3.05 on surface-1 (≥3:1). Not on surface-2 |
| `--text-1` | `#EDEDEA` | Primary text, numerals | 16.9 / 15.3 / 13.8 |
| `--text-2` | `#A1A1A6` | Secondary text | 7.7 / 7.0 / 6.3 |
| `--text-3` | `#8A8A91` | Annotations, labels | 5.8 / 5.2 / 4.7 (≥4.5:1 everywhere) |
| `--metal` | `linear-gradient(180deg, #ECECEE, #8E8E95)` | Node discs, transport buttons | low stop 6.1:1 on bg |
| `--signal` | `#FFFFFF` with soft glow | Messages in flight, playhead | — |
| `--ember` | `#FF6B3D` | Faults, crashes, failures, warnings | 7.0 / 6.3 / 5.7 (usable for text) |

### 5.3 Light environment: future enhancement (art-directed, not inverted)

Not part of the first visual release. This direction is kept so the token structure supports it later without a redesign.

| Token | Value | Notes |
|---|---|---|
| `--bg-0` | `#E7E6E2` | Warm neutral, as in R8 |
| `--surface-1` | `#F4F3F0` | Porcelain panels |
| `--surface-2` | `#FBFBF9` | |
| `--text-1` | `#121214` | 15.0–18.1 |
| `--text-2` | `#4B4B51` | 6.9–8.4 |
| `--text-3` | `#66666C` | 4.6–5.5 |
| `--line-control` | `#84837E` | 3.0–3.7 |
| `--ember` | `#B83A12` | Darkened for light grounds: 4.6–5.6 |
| Node discs | matte porcelain with soft contact shadow; dark "core" when active | Echoes R8/R9 objects |

### 5.4 State encoding: never colour alone

| State | Shape / pattern | Motion | Colour | Text |
|---|---|---|---|---|
| Not started | Outline disc, 40% opacity | none | neutral | "idle" |
| Running / healthy | Solid metal disc, tick ring | ticks respond to handled events | neutral | "running" |
| Timer pending | Arc on the ring shrinking toward fire time | linear in virtual time | neutral | timer tag on hover |
| Delayed link (CP2) | Dashed link; signals elongate | slower signals (true latency) | neutral | latency value |
| Crashed (CP1) | Hollow disc, ring removed, ✕ mark | ring collapses once | ember | "crashed" |
| Recovering (CP1) | Ring redraws progressively | — | neutral | "recovering" |
| Partitioned (CP2) | Link broken with a visible gap and end caps; far side defocused relative to selection | — | ember gap caps | "partitioned" |
| Message dropped (CP2) | Signal stops and disperses into dots; persistent marker on timeline | short dispersal | ember | "dropped: reason" |
| Invariant violated (CP3) | Full-height timeline marker; run halts; banner | none | ember | violation name and detail |
| Protocol error (CP0 ✅) | Node ✕ mark; error panel with mono message | none | ember | `ErrorName: message` |

## 6. Typography

**Approved:** **Geist** for interface typography, **Geist Mono** for technical information, identifiers, traces, timestamps and debugging data. Both are variable, designed as a pair, and licensed under the SIL OFL 1.1 (self-host the files and ship the OFL text next to them). Their grotesque proportions sit close to the Helvetica/Neue Haas feel of R1 and R10.

| Role | Face | Size / weight | Use |
|---|---|---|---|
| Display numerals | Geist | 72–160 px, weight 200–300, `tabular-nums`, tracking −0.03em | Virtual clock, term, event count |
| Headline | Geist | 32–48 px, 300–400 | Section and mode titles (rare) |
| Body | Geist | 14–16 px, 400 | Explanations, empty states |
| Label | Geist | 12–13 px, 500 | Control labels |
| Annotation | Geist Mono | 11 px, uppercase, tracking 0.08–0.14em | Edge annotations, units. **Never below 11 px for real information** |
| Data | Geist Mono | 12–13 px, `tabular-nums` | Timestamps, ids (`n1:m3`), trace rows, JSON |

Rules: timestamps always mono with tabular figures, so columns never jitter during playback. Ids are never truncated mid-token. Letterspaced caps are for annotations only, never for sentences.

## 7. Space, grid, layout

- **Spacing scale (4 px base):** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128.
- **Radii:** pills = full; panels 24; controls 14; inner radius = outer radius − padding (concentric, as in R1/R4).
- **Grid:** 12 columns, 24 px gutters, 32 px outer margin at ≥ 1280 px. An optional atmospheric column-line layer (R2) at ≤ 4% opacity aligns with the real grid.
- **Composition:** the **stage** (graph) is full-bleed and central. Panels float over its edges and never tile the screen:
  - top-left: wordmark + mode switcher;
  - left: experiment panel (seed, protocol, nodes, network, faults, limits);
  - right: inspector (selected node/message/entry);
  - bottom: time rail + transport + activity matrix;
  - edges: micro-annotations and the run signature glyph.
- **Trace mode** inverts the balance: the trace table takes the stage; the graph shrinks to a minimap. Precision mode: no blur, native cursor, maximal legibility.
- **Responsive:** desktop-first instrument (≥ 1024 px). Below that, a stacked read-only viewer: run signature, clock, trace list, node list. No horizontal page scroll.

## 8. Materials and motion

### 8.1 Materials (used sparingly)

- **Matte** (default for panels): solid surface, 1 px inner top highlight, ambient shadow `0 24px 64px rgb(0 0 0 / 0.45)`.
- **Glass** (max. 2–3 surfaces on screen): only where context behind a panel helps; see the performance constraint in §10.
- **Metal** (nodes, transport discs): vertical gradient + specular highlight; the primary action is a bright white disc (R1).
- **Grain:** a static, pre-rendered noise texture on the atmosphere layer only (`mix-blend-mode: overlay`, ~3–5%). Never on text, data, or the graph.

### 8.2 Two clocks, never mixed

| Clock | Drives | Rules |
|---|---|---|
| **UI clock** (wall time) | Panel transitions, hover/press feedback, reveals, atmosphere | Springs and eases allowed; durations 120–220 ms (micro), 280–480 ms (panels); stagger 30–40 ms; interruptible |
| **Playback clock** (virtual time) | Message signals, timer arcs, playhead, node ring activity | `position += wallDelta × speed` (ticks/s), clamped to the computed trace. Rendering is a pure function of `(trace, position)`. **Signals move linearly in virtual time:** easing would misrepresent latency |

Changing speed, frame rate, or motion settings changes only how often pixels update, never which events exist or their order. The engine runs ahead in the Worker; playback is a view of what has already been computed.

### 8.3 Reduced motion and transparency

- `prefers-reduced-motion`: no camera moves, parallax, grain animation or springs; playback still works but signals are drawn as static markers updated per step; crossfades ≤ 120 ms.
- `prefers-reduced-transparency`: glass becomes matte.
- `forced-colors`: system colours; state remains distinguishable through shape and text.

## 9. Cursor

A sculptural arrow inspired by R11: rounded tip, soft inner shading, gentle shadow, and smaller than the reference (≤ 32 CSS px, hotspot exactly at the visual tip).

| Context | Cursor |
|---|---|
| Stage background, panels' non-text areas | FaultLab cursor (default) |
| Hover over node / signal (selectable) | FaultLab cursor, "lifted" variant (slightly larger shadow) |
| Draggable node | Native `grab` / `grabbing` |
| Text, inputs, trace table, JSON viewer | Native `text` / `default`. **Precision beats style** |
| Timeline scrubbing | Native `ew-resize` |
| Reduced motion / coarse pointers / forced colours | Native everywhere |

Implementation: CSS `cursor: url(cursor.svg) x y, auto` (rendered by the OS: zero latency, no JS). **Not** a JS-following DOM element, which lags behind the pointer and costs a layer.

## 10. Rendering approaches and trade-offs

| Approach | Strengths | Weaknesses | Fit |
|---|---|---|---|
| **SVG (React-rendered)** | Crisp, styleable, inspectable, focusable, accessible; trivial hit-testing | DOM cost grows with element count; per-frame updates of hundreds of signals get expensive | **Phase 1 graph** (≤ ~50 nodes, a few hundred signals). Prove the visual language cheaply |
| **Canvas 2D** | Thousands of moving signals at 60 fps; full control | Manual hit-testing; needs a parallel DOM/ARIA layer for accessibility; re-implement text layout | **Signal layer** once profiling shows SVG exceeding the frame budget. Nodes can stay SVG/DOM for focus and a11y |
| **WebGL (Pixi / raw)** | Massive scale, shader effects (glow, grain) | Complexity, a11y mirror needed, context loss handling | Only if Canvas 2D is measured insufficient (CP10) |
| **Three.js / React Three Fiber** | True 3D, sculptural materials like R8–R10 | Heavy bundle, camera/a11y complexity, temptation to decorate | **Not for the core instrument.** Possibly a landing-page hero or optional "sculpture view" after V5, if measured and maintainable |
| **DOM + CSS** | Best for panels, tables, text, controls | Not for the graph | All chrome; virtualised trace table |

**Motion libraries.** CSS transitions for most chrome; **Motion** (motion.dev) for springs/layout transitions in React; GSAP only for a choreographed landing sequence. **No animation library ever owns the playback clock:** a single `requestAnimationFrame` loop reads the playback position and redraws.

**Performance constraints recorded now.**
- `backdrop-filter` over a continuously repainting canvas re-blurs every frame. Glass panels over the live stage must fall back to matte during playback, or sit over static regions.
- Budget: 16 ms per frame at 60 Hz, render ≤ 8 ms. Measure with the Performance panel before choosing an approach.
- LOD at scale: bundle signals per link into a count badge above a threshold; hide decorative ticks when zoomed out.

## 11. Simulation graph behaviour

- **Layout is deterministic too:** ≤ 12 nodes on a circle in config order; larger graphs use a force layout seeded from the experiment seed via its own `layout` stream, so screenshots and shared links look identical. User drags are saved with the experiment.
- **Nodes:** metal discs with tick rings (§4), mono id label, state per §5.4.
- **Links:** hairlines at low contrast; a link brightens only while it carries signals. Full meshes stay legible because idle links fade back.
- **Messages:** luminous points moving linearly from `send.time` to `deliverAt`; a selected message reveals its payload in the inspector and its **causal chain** (ancestors via `cause` links) as a highlighted path across the graph and timeline.
- **Timeline:** horizontal virtual-time axis with event density per node; a second view, the **space-time diagram** (one lane per node, messages as diagonal arrows), is the classic distributed-systems visualisation and directly renders trace entries.
- **Truthfulness:** everything drawn is derived from trace entries at the current playback position. If the engine didn't record it, it isn't drawn.

## 12. Component requirements (from real engine capabilities)

| Component | Engine data consumed | Available |
|---|---|---|
| Run header + signature glyph | `run.start` (seed, engine/protocol versions, nodes, limits), `fingerprintTrace` | CP0 ✅ |
| Virtual clock readout | playback position; `run.end.time` | CP0 ✅ |
| Transport (step, play/pause, step back, scrub) | `Simulation.step()`, trace indices (step back = view of an earlier index; no re-run needed) | CP0 ✅ |
| Run gauge + stop banner | `eventsProcessed`, `limits.maxEvents`, `run.end.reason` | CP0 ✅ |
| Node glyphs and inspector | `node.start`, latest `state.update` ≤ position, pending timers from `timer.set/fire/cancel` | CP0 ✅ |
| Message signals | `message.send` (time, deliverAt, payload), `message.deliver` | CP0 ✅ |
| Trace table (filter by node/kind, jump to cause) | All entries; `cause` | CP0 ✅ |
| Causal highlight | `cause` graph | CP0 ✅ |
| Activity matrix | Entries bucketed by node × time | CP0 ✅ |
| Protocol error panel | `protocol.error` | CP0 ✅ |
| Fault editor / crash controls | `FaultPlan` | CP1–CP2 |
| Partition view, drop markers | `message.drop`, partition entries | CP2 |
| Invariant panel | violation entries | CP3 |
| Deep time travel (beyond streamed trace) | Snapshots | CP4 |
| Protocol overlays (Raft role/term) | Protocol `describe(state)` view adapter | CP5 |

Accessibility baseline for all of them: full keyboard operation (Space play/pause, ←/→ step, Shift ×10, `[`/`]` previous/next event of the selected node); visible focus rings in `--text-1`; a live region announcing stop reasons and violations; the graph always has a textual equivalent (node list + trace table).

## 13. Phased visual implementation plan

| Phase | After | Scope | Acceptance |
|---|---|---|---|
| **V0 Foundations** | CP6 | Tokens as CSS custom properties (both themes defined, dark shipped), type scale, spacing, radii, matte panel, pill button, metal disc button, focus styles | Contrast ratios re-verified in-browser; Storybook-free gallery page |
| **V1 Precision tools** | V0 | Trace table (virtualised), inspector with JSON viewer, transport, clock readout, stop banner | Keyboard-only walkthrough; 100k-entry trace scrolls at 60 fps |
| **V2 Graph (SVG)** | V1 | Circle layout, node glyphs, links, linear signals from the playback clock, selection, causal highlight | Rendering is a pure function of (trace, position): a test renders twice at the same position and compares the DOM. Frame budget measured |
| **V3 Time** | V2 | Time rail, activity matrix, space-time diagram, run signature glyph | Scrubbing never triggers engine calls; glyph identical for identical runs |
| **V4 Atmosphere** | V3 | Glass (constrained), grain layer, cursor, panel springs, staggered reveals; reduced-motion/transparency variants | Lighthouse a11y ≥ 95; no regression in V2 frame budget; reduced-motion audit |
| **V5 Scale** | CP10 | Canvas signal layer, LOD, bundling | 100 nodes / 10⁴ signals within budget |
| **V6 Light environment** (future enhancement) | V4 | Art-directed light theme (§5.3) | Side-by-side review; contrast verified |
| **V7 Optional 3D** | V6 | Landing hero or sculpture view, only if measured and maintainable | Lazy-loaded; zero cost to the instrument |

## 14. Decision log

| Date | Question | Decision |
|---|---|---|
| 2026-10-08 | Missing 11th reference | Received in `inspo.zip`: R5 (Mega UI knobs/dials). Inventory and adaptations updated |
| 2026-10-08 | Typeface | Geist + Geist Mono |
| 2026-10-08 | Accent | Red-orange for faults, crashes, failures and warnings; silver/white for normal activity and selection |
| 2026-10-08 | Light mode | Future enhancement; dark first |
| 2026-10-08 | Reference images in the repo | Never; research material only |
