# CP6 Gate 1 — regression fixes and the sculptural node prototype

For review. Two parts: the CP5 defects found in Phase 0 are fixed and covered by tests, and the single sculptural node exists as a prototype (`node-lab.html`), measured against the approved references in Chromium, Firefox and WebKit. Nothing is committed yet; Configure, Simulate and Investigate are untouched.

---

## 1. The Investigate freeze

**Root cause.** `EntryDetail` rendered the *entire* cause chain of the selected entry. Heartbeat timers re-arm themselves, so in a long Raft run the chain grows linearly with the trace: 70 ancestors at entry 1 000, 3 230 at 50 000, **8 001** at 123 930. With "follow live" the selected entry is the newest one, so Investigate re-rendered thousands of `<li>` elements per animation frame, each with a button. Computing the chain was never the problem (measured: **0.20 ms** for 8 001 entries in Node); rendering it was.

A micro-benchmark confirms it is a DOM cost, not a React cost — and shows why WebKit suffered most. Time to prepend 5 rows to an existing list (ms):

| list | 2 000 rows | 4 000 rows | 8 000 rows |
|---|---|---|---|
| `<ol>` Chromium | 38 | 97 | 191 |
| `<ol>` Firefox | 45 | 87 | 160 |
| `<ol>` WebKit | 86 | 160 | **334** |
| `<ul>` Chromium | 1 | 3 | 8 |

An ordered list renumbers every item on each change (hence `<ol>` ≫ `<ul>`), and WebKit is slowest at both. So this was never a "WebKit bug": every engine degraded, WebKit just hit the wall first.

**Fix.** A windowed list ([WindowedList.tsx](apps/web/src/components/WindowedList.tsx)): a fixed-height scroll container that renders only the visible rows plus four of overscan. The cause chain, the consequences and the markers list all use it.

- **No trace data is truncated, hidden or falsified.** The chain's full length is stated (`8001 entries`), every entry is reachable by scrolling, `aria-setsize` / `aria-posinset` report the real position, and "Nearest cause" and "Root" jump directly. Exact event navigation is unchanged.
- The cause chain is still computed in full on every cursor change; only the DOM is bounded.

**Regression test** ([investigate-live.spec.ts](apps/web/e2e/investigate-live.spec.ts)), in all three engines: load `raft-long-heartbeats` (123 932 entries), open Investigate **and stay there for the whole run** with follow live on; turn follow off mid-run, click into an earlier cause, verify the inspected entry stays put while the run continues, turn follow back on; after completion, replay through the deepest region so the shown entry — and its ≈ 8 000-entry chain — changes on every tick; then 30 × ← through the deepest entries. It asserts the chain really reached ≈ 8 000 (`deepest > 7900`, and that the UI displayed chains that long), that the full chain stays reachable (count, root jump to `#0` = `run.start`, and `#0` visible after scrolling the window to its end), and the responsiveness budgets.

**Measurements** (same scenario, same machine; "block" = main-thread blocking measured with a `MessageChannel` ping loop):

| | Chromium before → after | Firefox before → after | WebKit before → after |
|---|---|---|---|
| Frame gap p95, live | 46 → **18** ms | 46 → **11** ms | 93 → **18** ms |
| Frame gap max, live | 52 → **20** ms | 73 → **15** ms | **8 853** → **20** ms |
| Frame gap p50, replaying deep chains | 72 → **18** ms | 91 → **10** ms | 137 → **18** ms |
| Frame gap max, replaying deep chains | 141 → **18** ms | 165 → **12** ms | **507** → **19** ms |
| Main-thread block max | 104 → **4** ms | 103 → **5** ms | **508** → **13** ms |
| ← key → paint, max | 101 → **18** ms | 126 → **10** ms | 453 → **18** ms |
| Click → paint ("follow live") | 19 → **12** ms | 49 → **3** ms | 96 → **8** ms |
| Frames > 250 ms | 0 → 0 | 0 → 0 | 1 (8.9 s) → **0** |

The WebKit freeze (**8.9 s** in one frame, and a separate 44 s block in the Phase 0 probe) is gone; no engine now exceeds 20 ms. Raw results: `references/cp6/measurements/{before,after-*}-investigate-live-*.json`.

The existing CP5 performance test improved as a side effect (it passes through Investigate during a run): WebKit's p95 frame gap went from 27–48 ms to **18 ms** (max 20), Chromium to 19 ms, Firefox to 11 ms, with no frame over 50 ms in any engine.

## 2. The follow-live checkbox

**Root cause.** `Session` deferred *all* notifications to the next animation frame (to coalesce Worker chunks). React restores a controlled input at the end of the event, so for one frame the checkbox showed the opposite of what the user had just clicked.

**Fix** ([session.ts](apps/web/src/state/session.ts)): `#set` now takes a source. **User** changes (load, cursor, follow, node selection, replay) notify synchronously; **data** changes (Worker events, replay ticks) stay coalesced to at most one notification per frame. No visual workaround, no change to the architecture — the Worker still cannot flood React.

**Regression tests.** A unit test ([session.test.ts](apps/web/test/session.test.ts)) with a deferred scheduler proves both halves: user changes arrive in the same task, in order, while many client updates collapse into one notification per flushed frame. A browser test ([follow-control.spec.ts](apps/web/e2e/follow-control.spec.ts)) samples the checkbox's real `checked` property synchronously after the click, after microtasks and over six frames, covering: ready, during streaming, seven rapid toggles in one task (×7 rounds), the `F` shortcut, paused, resumed, after switching views, after clicking a historical event, after dragging the cursor slider, and after loading a different run. Any single sample showing the opposite state fails the test.

Both tests were verified to **fail on the pre-fix code** and pass after.

---

## 3. The sculptural node (Gate 1)

Dependencies installed, pinned exactly: `three@0.186.1`, `@react-three/fiber@9.8.1` (+ `@types/three`). Nothing else.

**Prototype page** `node-lab.html` — a controlled gallery, separate from the application. Scenes: the three reference compositions at their measured geometry, a state sheet (warm and neutral lighting), an interactive scene, and 1 / 5 / 20-node scalability scenes. URL parameters `scene`, `tier`, `motion=reduce`, `chrome=0`.

> Every protocol state on that page is **set by hand** and labelled as such on screen. None of it is a simulation result. Real reconstructed frames arrive at Gate 4.

**How the node is built** ([src/stage](apps/web/src/stage)). Two instanced draw calls per scene, whatever the node count:

1. **Body** — a real sphere mesh (64 × 48, shared), shaded as smoked graphite glass: a near-black base, a broad frosted reflection of a large light behind and above the left (exponential falloff fitted to the measured ramp, modulated by two-octave value noise so it is smoky rather than a clean crescent), procedural cellular veins in object space (no textures, no UV seams, only on large spheres, as in the references), a Fresnel glow inside the rim, and fine grain against banding.
2. **Aura** — a camera-facing quad drawn with premultiplied additive-over blending, which draws everything *on and around* the silhouette analytically in pixel space: the thin luminous rim (asymmetric falloff, angular profile measured from the hero), the two-exponential halo, the top spark, the link ports, and the state rings. Analytic lines stay crisp at any size and DPR, and the rim doubles as anti-aliasing for the mesh edge.

Colours are authored in display space (`linear` + `flat`), because the references are 2D composites.

**Measured and fitted to the references**, not guessed: node centres and radii (least-squares circle fit on the rim), the rim's angular profile (upper left 1.0, lower left 0.81, lower right 0.73, upper right 0.52), the halo falloff, the inner-glow ramp, warm (hue 27°) versus neutral rims, and the page/panel background values.

### 3.1 States

[node-visual.ts](apps/web/src/stage/node-visual.ts) is a pure function from node facts to ten independent animation channels, with no Three.js in it, so it is unit-tested without WebGL and shared by all three tiers. Protocol states and interaction states are deliberately separate:

| | How it reads (never colour alone) |
|---|---|
| Idle (not started) | Dimmer rim and halo, no role |
| Follower | The resting appearance of the references |
| Candidate | Rim broken into 32 short gaps (unsettled, asking for votes) |
| Leader | Brighter rim and halo + crown glyph in the DOM label |
| Active (an event here at this position) | Stronger inner glow, slightly brighter rim |
| Crashed | Rim in 14 long dashes, light out, amber |
| Partitioned | Dotted amber fence at 1.22 R |
| Recovering | Open blue arc (300°) |
| Hovered | Halo ×1.2, rim ×1.1 (interaction) |
| Selected | Blue ring at 1.4 R with a soft field (interaction) |
| Focused | Blue DOM outline outside the ring (`:focus-visible`) |

Because the channels are independent, combinations compose without conflicting: *leader + selected* is exactly *leader* plus the selection ring; *crashed + partitioned + selected* shows the broken rim, the fence and the ring at once. Unit tests assert this, and that a crashed node shows no role and no activity (its protocol is not running).

Scene lighting is separate from state: `exposure` dims the rail nodes you are not inspecting, as the reference does. It is a composition value, not a protocol fact.

### 3.2 Interaction

Hover, selection and focus are real; a transition is an exponential approach per channel (time constant 0.09 s), so a new target simply redirects the motion from wherever it is — **interruptible by construction, never a jump**. No scaling, no rotation, no continuous animation: when nothing changes, nothing renders. `prefers-reduced-motion` (and the page's own toggle) sets the time constant to zero, so state changes are instantaneous; the test confirms at most a couple of frames.

### 3.3 Architecture (ADR-0025) — verified by tests

| Condition | How it is verified |
|---|---|
| At most one WebGL context | Exactly one `<canvas>`; scene changes reuse it; a test counts canvases |
| Lazy-loaded | The application never requests the chunk; the prototype requests it once; the flat tier never requests it |
| Text and controls in the DOM | Labels, captions and controls are DOM; the canvas is `aria-hidden` |
| Accessible equivalents | One focusable button per node with a real name ("n3, follower", "s13, crashed, partitioned"), `aria-pressed`, keyboard selection |
| Shared geometry and materials | 2 programs, 2 geometries, 0 textures — after 15 scene switches too |
| Controlled DPR | Full tier ≤ 2, reduced tier 1 |
| Resource disposal | Geometries and materials disposed on unmount; the old context is lost after switching to flat |
| Context loss | `preventDefault` + flat tier while lost; restores and renders again; counted |
| Reduced quality | Reduced tier: DPR 1, no veins or grain |
| Non-WebGL | Flat tier: SVG with the same channels and the same DOM layer |
| Not coupled to the engine | `src/stage` imports nothing from the engine, runtime, trace or Session; it draws the sprites it is handed |

### 3.4 Performance and bundle

Measured per browser; the numbers after the material revision are in §6. Shader compilation happens once, before the first frame (`compileAsync`), never during interaction, and instancing keeps the scene at two draw calls from 1 to 20 nodes. **WebKit was measured independently, not assumed fixed** by the Investigate repair: it is on par with Chromium (CPU ≤ 1 ms, no long frames, idle silent), and it is the one engine using DPR 2.

**Bundle.** The 3D chunk is 925 KB raw / **244 KB gzip**, loaded only where a stage is shown. The app shell is unchanged (main 9.3 KB gzip + React 68 KB gzip); the application does not download three.js today.

---

## 4. Material and lighting revision (Gate 1b)

The first Gate 1 result was geometrically close but read as "a dark disc with a glowing outline". Diagnosis and fixes:

**Root cause of the flatness.** I had shaded the reflection with the *reflection vector* (`reflect(V, n) · L`). For a sphere that doubles the angular rate, so the lit region collapsed into a crescent hugging the rim and the interior stayed black. The references do not behave that way. I sampled the full interior of all six reference nodes (≈ 80 000 points each) and fitted

> brightness = base + A · exp(k · (**n** · **L** − 1)) · (1 + F · (1 − **n**·**V**)^p)

by least squares, which is the surface *normal*, not the reflection. The fits agree across every node: **L ≈ (−0.61, 0.67, −0.40)** (a large light behind, above and to the left), k ≈ 2.4–3.3, F ≈ 2.2–2.8, p ≈ 0.5–1.1, residual 10–26 of 255. The amplitude differs per node, which is now the `exposure` channel: hero 235, Simulate 183–205, Configure 134, selected rail node 290, unselected rail node 97 — the reference really does light the node you are inspecting more brightly, and dim the ones you are not.

**Changes to the body shader.**
1. The broad reflection follows `n · L` with the fitted falloff, so it is a wash across the whole upper-left surface that fades smoothly toward the centre. A soft knee keeps the peak at the reference's ≈ 246/255 instead of clipping to white.
2. The inner rim glow is now the *complement* of the reflection (`1 − smoothstep(highlight)`): the fit already describes the lit side completely, so adding the glow there was double-counting — that was the second cause of the rim-heavy look. It still fills the unlit edge, which the fit cannot represent.
3. **Warm spill.** Measured as red-minus-blue at 0.85 R, the hero reaches **+36** at the top while the reflection's own direction is faintly *cool* (−9 … −11 on Simulate and Configure). So the warm cast is the luminous rim lighting the surface beside it, not the main light. It is a hue shift at roughly constant luminance, so it is applied as a tint, concentrated near the top, gated by the angle to the light (not by brightness, so it does not depend on exposure). Result at 0.85 R, red-minus-blue: hero 135° ref +9 / mine +11, 90° ref +36 / +41, 0° ref +11 / +10, 250° ref +4 / +12.
4. **Body tint**, measured on the lit surfaces: Simulate and Configure are faintly cool (0.968, 1.011, 1.021), the hero faintly warm (1.021, 0.998, 0.980). A few percent — not a tan or blue cast.

**Surface material: procedural, no texture introduced.** I evaluated a baked mask and rejected it on evidence, not on principle: the nodes are drawn from 29 px to 95 px radius and a single baked map would either blur on the hero or alias on the rail, and it would add an asset, a fetch and GPU memory to every tier. The procedural web now has what it was missing:
- **Continuity.** The old fragmenting modulation was removed; the seams form one connected web across the whole sphere, as in the reference.
- **Ridges, not painted lines.** A Worley cell-border field returns its own gradient (from the two nearest feature points), and the surface normal is tilted down the seam's flanks — zero on the crest, steepest halfway down. The light then catches the ridge by itself. Uniform darkening is down to 6 %; previously the veins were drawn as dark lines, which is what made them read as cracks.
- **No sparkle.** Seam width never falls below ≈ 2 pixels (`fwidth`), so fine veins fade out instead of aliasing. The earlier version visibly sparkled.
- **Irregularity.** A domain warp before the lattice lookup gives cells of varying size and shape, and a slow noise varies how pronounced each seam is, so it is not a tidy honeycomb.
- **Visible in shadow.** A small constant term keeps the web faintly present in the dark half, as the reference has it.

Measured texture contrast (standard deviation of the high-pass signal in the lit band): reference 25.9, prototype 22.7 (was 16.0 before this revision). Mean brightness there: reference 174, prototype 161.

**Rim.** Thickness and brightness now vary slowly around the circle (static 1-D noise, 16 periods, wrapping seamlessly — no flicker and no animation), the peak sits just inside the silhouette with a short outer shoulder, and the amplitude is lower so the rim no longer dominates the body. Fitted to the hero's measured crossing (0.95 R → 112, 0.98 R → 161, 1.02 R → 113, 1.04 R → 61).

**Small nodes (the Investigate rail).** Looking at the rail at full size showed what the mean error was hiding: my 29 px nodes were far too dim and too warm. Measured in the lit band, the reference reaches 179 at 0.8 R and 71 at 0.55 R — nearly as bright as the 95 px hero, but falling off much more steeply, and essentially neutral in colour (+1 … +4 red-minus-blue, against the hero's +36). So the grazing-angle boost is stronger on a small sphere; its exponent is now size-dependent (fitted 0.33 small, 0.6 large), the warm spill fades out with size, and the rail's lighting is set from that measurement rather than from the error metric: 173 / 72 against the reference's 179 / 71. I first tried a narrower *falloff* for small nodes instead, from the per-node fits; it made them far worse (52 against 179) because the reference's small-node highlight is broad in angle and merely concentrated near the rim. That attempt is discarded.

**Selected node.** Measured on the reference: a blue field that rises from the silhouette, peaks around the ring at ≈ +49 luminance over the background, and fades by ≈ 1.9 R — and it is *more saturated* than the ring itself, which is pale and close to white. It is now an asymmetric Gaussian atmosphere centred on the ring radius (reaching further inward than outward) in a deeper blue (0.38, 0.62, 1.0), with a thinner, paler ring inside it, and the node's own warm halo gives way to it. Blue excess at 1.15 / 1.24 / 1.33 R: reference 33 / 39 / 44, prototype 22 / 35 / 41 (previously 12 / 20 / 29, which read as two separate outlined circles). The state-channel architecture is unchanged: leader, crashed, partitioned and recovering still compose with selection exactly as before.

**Bloom: tested, not adopted.** Before considering a postprocessing pass I measured the far field around the hero, where any bloom would show. Reference versus prototype at 1.2 / 1.4 / 1.6 / 2.0 / 2.6 / 3.0 R: 29/29, 20/20, 16/16, 12/12, 10/12, 10/12 — within 2 of 255, and the residual is the panel's background value, not a glow. The localized shader halo already reproduces the reference's falloff, so a full-screen pass would cost a second render target for no measurable gain. Simulate's nodes were 4–7 too dim in the near field; that was the halo amplitude for neutral lighting, now corrected. **No postprocessing library installed.**

## 5. Visual comparison and what still differs

Sheets in `references/cp6/compare/`:
- `fullsize-hero.png`, `fullsize-selected-rail.png`, `fullsize-rail.png` — reference | prototype at full size, **no difference overlay**;
- `<browser>-<scene>-<node>.png` — reference | prototype | 4× difference, for all seven node regions in all three engines (A hero, B selected rail node, C Simulate, D Configure);
- `page-{investigate,simulate,configure}.png` — the whole page beside the reference. Screenshots at the reference viewport 1586 × 992.

Mean absolute error per node region (0–255 grey):

| Region | before | **after** | Firefox | WebKit |
|---|---|---|---|---|
| Investigate hero (R 95) | 8.3 | **6.5** | 6.5 | 6.6 |
| · of which body (< 0.9 R) | 11.3 | **7.4** | | |
| · of which halo (1.05–1.5 R) | 8.8 | **6.1** | | |
| Investigate rail, selected | 15.9 | **14.3** | 14.3 | 14.3 |
| Investigate rail, unselected | 11.9 | **13.8** | 13.8 | 13.6 |
| Simulate n1 / n4 | 11.9 / 9.7 | **12.7 / 11.3** | 12.6 / 11.3 | 12.5 / 11.1 |
| Configure n3 / n1 | 10.2 / 11.9 | **10.9 / 14.1** | 10.9 / 14.1 | 10.9 / 14.1 |

The three engines still agree to within 0.3. Note the honest part: **Simulate, Configure and the rail nodes went slightly up on this metric while looking considerably better.** The rail nodes are the clearest case: the dim version scored 11.8 and the correctly-lit one scores 13.3, while its measured brightness went from 107 to 173 against the reference's 179. Their error is now concentrated in the one-pixel rim band (where a sub-pixel placement difference produces a large number) and in the veining, which is new signal the flat version simply did not have. This is exactly the trap you warned about, which is why the decisions above were driven by region-wise measurements — highlight ramp, colour temperature by angle, texture contrast, blue-field profile — rather than by the mean.

**I am not claiming 1:1 fidelity.** What still differs:

1. **Seam crispness.** The reference's veins have a thin bright core, like fine cracks; mine are slightly softer rounded ridges. Same family of pattern and the same cell size, not the same line quality.
2. **The exact vein pattern** is procedural and will never be the reference's unique hand-made one. Visible in the hero's difference image as a web-shaped residue.
3. **Rim band.** Still the largest residue (26–48 MAE in that thin ring); it is where almost all of the remaining error lives. My rim is a computed line with slow variation; the reference's is painted, with small local irregularities a noise function does not reproduce.
4. **Small rail nodes.** Brightness, colour temperature and reach across the surface now match closely. What remains is the *angular* shape: the reference's specular is a distinct patch with a clear terminator (241 at 140°, 58 at 100°), mine wraps more evenly (183 at 140°, 126 at 100°). Correcting that costs mid-surface reach with a single-lobe model, as §6.3 describes; a two-lobe specular would be needed, which is more than a polish pass.
5. **The 70° direction** on the hero is warmer in my render (+38) than the reference (+20); the spill's angular profile is a cosine-squared lobe, the reference's is slightly narrower.
6. **Decorative elements** (orbit arcs, bubble spheres, panel geometry, the arrow marker) belong to Gate 2 and 3 and are not in the prototype.

## 6. Final polish pass (Gate 1c) and performance

Four narrowly scoped changes after your review, each measured:

1. **Surface material.** I first did exactly what you asked — reduced the ridge intensity by ~28 % (texture contrast 25.9 → 18.6 against the reference's 25.9). It did *not* fix the perception: the surface still read as stone, because the problem was the ridges' **shape**, not their strength. They were broad, soft bumps; the reference's are thin, crisp etched lines. Narrowing the seam profile and its width (and dropping the uniform darkening) produces the polished look you described, at contrast **24.0** — very close to the reference. Going further down in intensity on top of that (a second variant at 23.6, kept for comparison) moves visibly *away* from the reference, which is denser than my render, not sparser. So: pattern and procedural approach preserved, perceived roughness down, intensity itself **not** reduced by 25–35 % in the end, because the measurement says the reference is not a smoother surface than mine. Say the word if you prefer the softer variant anyway.
2. **Reflection.** My first attempt at "extends further into the sphere" overshot badly — mine became brighter than the reference at every radius *and* angle. Measured, the reference is in fact **more** concentrated than my render was, so widening it was the wrong direction and is reverted. The real defect was the **overexposed peak**: my soft knee had no ceiling, so the body plus the rim's inward tail clipped at 253–254 where the reference measures 242. That is now a soft clip that stays linear through the mid-tones and rolls off to a fixed ceiling, plus a tighter inner rim tail. Upper-left ramp at 0.20 / 0.50 / 0.75 / 0.85 / 0.92 / 0.97 / 1.00 R — reference **20 / 48 / 135 / 206 / 232 / 242 / 247**, prototype **21 / 46 / 136 / 214 / 240 / 246 / 241**. No overexposure anywhere, and the normal-based model is untouched.
3. **Small node material.** The reflection now reaches much further across the surface. Rail node ramp at 0.35 / 0.50 / 0.65 / 0.75 / 0.85 R — reference **36 / 67 / 112 / 163 / 232**, prototype **32 / 52 / 96 / 149 / 220** (before: 30 / 48 / 86 / 133 / 203). Achieved by lifting the ceiling that was clipping them and raising their scene exposure; the size-dependent term is one `mix()` inside the same shader, so there is still **one material, one geometry, one instanced draw** — no separate system for small nodes. I also tested a narrower specular lobe for them, which matches the reference's angular *shape* better and scores better on mean error, but it costs exactly the mid-surface reach you asked for (0.5 R drops from 52 to 32). I rejected it on your stated goal rather than on the metric.
4. **Selected ring.** The ring's crisp core and its soft atmosphere are now separate terms: the line is narrower and brighter (half-width 0.012 R, core 0.62) while its bloom is weaker (0.055), so the ring is better defined without the selection becoming brighter overall. The atmospheric field is unchanged.

**Performance.** GPU time is measured with `EXT_disjoint_timer_query_webgl2` on a laptop GPU, where the p95 is dominated by scheduling noise (a 1-node reduced-tier frame measured a 4.78 ms p95 in one run), so the **median over three runs** is the honest figure:

| GPU p50 (Chromium) | Gate 1 | Gate 1b | **Gate 1c** |
|---|---|---|---|
| Full tier, 1 node | 0.98 ms | 1.05 ms | **0.78–0.82 ms** |
| Full tier, 5 nodes | 1.23 ms | 1.31 ms | **1.32–2.05 ms** |
| Full tier, 20 nodes | 1.18 ms | 2.33 ms | **2.26–2.83 ms** |
| Reduced tier, 20 nodes | 1.05 ms | 1.08 ms | **1.06–1.21 ms** |

So the material costs roughly **1 ms of extra GPU time** in the densest full-tier case, not the 3 ms I reported from a noisy p95 at Gate 1b — that figure was wrong and this table corrects it. Everything else is unchanged: CPU p95 ≤ 0.5 ms, first render including shader compilation 12–15 ms, **2 draw calls / 2 programs / 2 geometries / 0 textures** after 15 scene switches, 0 frames while idle, 8.5 MB JS heap, 244 KB gzip for the lazy 3D chunk. No library was added.

**Regressions.** `npm run typecheck` clean; 756 unit tests pass; the 18 prototype browser tests pass in Chromium, Firefox and WebKit, as do the CP0–CP5 and CP6 regression tests.

**The intermittent CP5 memory check: diagnosed, corrected and verified (approved at Gate 1).**

*Validating the diagnosis.* The old check took one heap sample before any run and one after each of three runs, then asserted `last − first < 10 MB`. Measured series, identical code, three consecutive invocations:

| Invocation | heap after forced GC (MB) | reported "growth" |
|---|---|---|
| 1 | 32.7 → 46.9 → 50.6 → 49.1 | 16.4 |
| 2 | 30.8 → 42.4 → 50.6 → 50.6 | 19.8 |
| 3 | 51.2 → 46.2 → 49.6 → 53.0 | 1.8 |

The heap plateaus at ≈ 50 MB in all three; the series is flat from the second sample on. The verdict depended only on how cold the *first* sample happened to be, so the check measured one-off warm-up (code V8 compiles on first execution, Worker module instantiation), not retention. Reproduced identically with the committed CP5 `session.ts`, and the check runs on `bench.html`, which never loads the stage — so it was unrelated to the 3D work. It failed 2 of 5 full-suite runs.

*The correction* (`leakCheck` in `src/bench/bench.ts`, asserted by `e2e/memory.spec.ts`), to your six conditions:

1. **Tolerance unchanged** at 10 MB.
2. **Explicit warm-up:** two full runs first, their measurements discarded.
3. **Multiple subsequent runs:** five further runs, each measured.
4. **Growth across the steady state:** the least-squares slope over those five samples, scaled to the window — not a difference between two end points.
5. **Resources released:** the bench counts Workers created and terminated; the test asserts 7 created, **0 leaked**, per invocation.
6. **Continuous growth cannot hide:** the slope uses every sample, and a second assertion bounds the spread (max − min) of the whole series by the same tolerance.
7. **Verified against a deliberate bug:** `leakCheck({ retain: true })` keeps each disposed Session alive. The test asserts the check *fails* there.

A second correction came out of the measurements: one `gc()` was not enough. Objects released through finalization — a terminated Worker among them — need a turn of the event loop and a further pass, which is what made single readings jump by a few MB. The bench now forces GC three times with 25 ms between, then reads.

*Results.* Nine steady-state invocations (three repeats × three attempts):

| | growth (MB) | spread (MB) |
|---|---|---|
| Before settling the heap | 0, 0, −0.16, **4.0**, 0.08, −0.12, −0.08, −0.12, −0.04 | 0.1, 0, 0.2, **5.0**, 0.1, 0.1, 0.1, 0.1, 0.1 |
| After settling the heap | 0, 0, 0, 0, 0, 0, 0, 0, −0.04 | 0.1, 0, 0, 0.1, 0, 0, 0.1, 0, 0.1 |

A typical series is `47.5, 47.5, 47.5, 47.5, 47.5`. **There is no leak, and there never was**; the old check was measuring warm-up.

*Sensitivity.* With one Session retained per run the series is `47.4 → 69.2 → 91.0 → 103.8 → 125.6`: **19–20 MB per run, 76–81 MB of growth**, far outside the tolerance — the check is decisive, not merely green. Against a measured noise floor of ≤ 0.1 MB, the 10 MB window over four intervals detects any retention of about 2.5 MB per run or more. The tolerance was kept as instructed; it could be tightened a long way on this evidence, which is a decision for you.

The old assertion was removed from the CP5 performance gate and the subject now has its own spec, which skips on Firefox and WebKit because neither exposes a heap size — rather than pretending to measure there.

## 7. Recommended next refinements

1. **Two-lobe specular** (difference 4 above): a narrow core plus a broad skirt would give the small nodes the reference's terminator without losing reach. Worth doing only if the rail nodes bother you at full size.
2. **Investigate the bundle composition** (not a custom fork, per your instruction): check what three.js modules are actually reachable and whether the build is tree-shaking them. Report before changing anything.
3. **Lower the sphere tessellation** for small nodes (a second shared geometry at 32 × 24): the silhouette is drawn by the aura, so the mesh only needs to be smooth enough for the shading. This also recovers part of the GPU cost at 20 nodes.
4. Finalise **Q10, Q11, Q13** (status chips, five-dot pill, inspector dots) before the dashboards that contain them, as you asked; I will bring each one with its quoted proposal, data source, interactions and states.
5. Gate 2: the design system (tokens from the audit, Geist, panels, controls) and the component gallery.

---

## 8. State of the repository

- Unit tests: **756 passed**, 13 skipped, across all seven packages; `npm run typecheck` clean. Browser tests: **66 passed** (22 tests × Chromium, Firefox and WebKit), including the two CP6 regression tests and the six prototype tests. All CP0–CP5 tests pass unchanged; no fingerprint, fixture or golden file was touched; no simulation semantics changed.
- New: `apps/web/src/stage/*`, `apps/web/src/prototype/*`, `node-lab.html`, `WindowedList.tsx`, two new browser specs, one unit spec.
- Changed: `EntryDetail.tsx`, `InvestigateView.tsx`, `session.ts`, `styles.css`, `vite.config.ts`, `package.json` (two runtime dependencies plus types). No texture, image or postprocessing library was added.
- Not committed. The legacy demo, Configure, Simulate and Investigate are otherwise untouched.
