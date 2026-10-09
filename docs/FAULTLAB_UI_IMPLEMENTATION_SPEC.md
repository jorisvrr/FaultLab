# FaultLab — Complete UI/UX & Creative Engineering Implementation Specification

**Companion to:** `faultlab-design-references.zip` (three approved PNGs)  
**Status:** Target specification for the dedicated frontend checkpoints, **not** an instruction to interrupt unfinished engine checkpoints  
**Audience:** Claude Code / frontend, graphics, accessibility and distributed-systems engineers  
**Document language:** English for implementation. Keep the project's personal `ENGINEERLOG.md` in Dutch.  
**Product:** FaultLab — *Simulate failures. Discover bugs. Understand why.*

> **Read this first.** The three PNGs are the **visual source of truth** for the approved application modes. This document is the **behavioral, architectural and product source of truth for everything a PNG cannot communicate**. Reproduce the visual design faithfully while implementing real features, real states, keyboard/touch access, responsive layouts and correct connections to the simulation engine. Never fake execution data to match a screenshot.

## 0. Non-negotiable rules

1. **Preserve the approved art direction.** No unsolicited redesign. Do not substitute a generic SaaS dashboard, card library, gradient template, neon sci-fi UI or unrelated aesthetic. Keep the dark charcoal canvas, sculptural graphite/silver nodes, glass/metal surfaces, precise thin lines, atmospheric orbital geometry, fine technical grid and cool-blue focus treatments.
2. **Interpret the images as reference frames, not web page backgrounds.** Reconstruct real, selectable, accessible and responsive components. Do not ship a large screenshot with invisible clickable regions on top.
3. **The simulation engine is authoritative.** Node roles, links, messages, time, protocol state, faults, invariant evidence, run stop reasons and fingerprints must originate from actual engine output / indexed traces. Decorative lighting may be art-directed; semantic animation may not invent data.
4. **Simulation time is not wall-clock time.** `t=300` means virtual ticks; `#829` means trace entry number; an execution step may generate multiple trace entries. Do not conflate these units.
5. **No UI → engine coupling.** React, WebGL, cursor movement, playback speed and rendering frame rate must never alter simulation results, seeded randomness or event ordering.
6. **Runtime correctness before polish.** Keep CP0–CP2.5 guarantees, CP3 snapshot/TraceIndex semantics and CP4 protocol correctness intact. Implement visually intensive work only when the actual `ROADMAP.md` allows it.
7. **Privacy/safety.** Never execute arbitrary untrusted protocol JavaScript in the browser main thread; the eventual worker is a performance boundary, *not* a secure sandbox. Do not claim enterprise-grade sandboxing or production infrastructure testing without implementing and validating it.
8. **Accessibility and reduced motion are features, not optional clean-up.** Every hover behavior needs keyboard and touch equivalents; focus must be visible and status cannot depend only on color.
9. **Do not assume unavailable capabilities.** Mark upcoming functionality as unavailable, remove it from navigation until ready, or implement the required engine support in its planned checkpoint. No fake working UI.
10. **Build incrementally, test each milestone and record significant learning in Dutch `ENGINEERLOG.md`.** Do not implement the entire spec in a single pass.

### Reference ZIP manifest

The ZIP should contain the **three approved, final** designs, named clearly:

| Required reference | Approved image and purpose | Fidelity priority |
|---|---|---|
| `01-configure.png` | Large left **Run setup**, central four-sphere topology, right **Invariant set**, blue-silver **Run Experiment** CTA | Layout, controls, material, event markers |
| `02-simulate.png` | Left **Trace context**, central four-node topology, right **Experiment status**, wide **Replay trace** panel | Network prominence, hierarchy, persistent timeline |
| `03-investigate.png` | Narrow left node rail, giant focused sphere and signal paths, right **Derived state** inspector, wide bottom timeline | Node-focus composition, state provenance, selected marker |

The user's ZIP may have different filenames. **Inspect its actual contents and map each to its intended mode by appearance**; do not blindly expect these names or alter the source assets without permission. Preserve reference copies under a **private/reference-only** directory if licensing is unknown. Do not push copyrighted third-party images or the original inspiration ZIP to a public repository.

### Approval boundary

**Approved:** visual identity, these three principal application layouts, Configure → Simulate → Investigate user journey, and the requirement that all meaningful visualization reflects real simulation data.  
**Implementation decisions still open:** exact render technology, actual design-token values, final route names, exact animation easing/timing, whether WebGL materially improves the nodes, and how the complete navigation adapts to smaller viewports. Validate choices with prototypes rather than claiming the PNG supplies these answers.

---

## 1. Product definition and real user goals

**FaultLab** is a deterministic laboratory for studying distributed-system protocols through simulation, fault injection, invariant checking, counterexample search, trace inspection and exact replay. The core user story is:

> As a learner or engineer, I want to configure a distributed protocol, run a reproducible scenario, see if its safety rules are violated, identify the relevant events and node states, and replay or share the exact failure.

**Primary users:** software-engineering students, distributed-systems learners, educators and backend/infrastructure engineers exploring protocol models. **Secondary:** technical interviewers, open-source contributors and later teams investigating their own supported protocol models. This is **not** a general infrastructure observability dashboard, commercial business KPI product, or direct test runner for arbitrary real production clusters.

### Golden user journey

1. **Discover** → grasp the purpose, open a sample experiment, or start a new one.
2. **Configure** → choose an available protocol, node count/topology, seed, network conditions, fault schedule and supported invariants.
3. **Validate** → show conflicts, unsafe settings and exact scenario semantics; never hide defaults.
4. **Execute** → run a real bounded simulation (or later execute through a worker). Distinguish running from trace playback.
5. **Simulate** → inspect network state, status, trace-derived markers and outcomes; view a clear result, not just a decorative graph.
6. **Investigate** → select a node, message, edge, fault or violation; see exact state, evidence, provenance and cause/consequence links.
7. **Replay** → pause, step, seek, jump to violation, inspect earlier state and reproduce the scenario using the actual seed/config/versions.
8. **Save / export / share** → store locally first, export/import validated versioned experiments. Shareable URLs and accounts are future features until backend support exists.
9. **Learn / compare** → later compare naive leader election with Raft and explain safety vs. liveness using engine-backed scenarios.

### Three distinct, coordinated modes

- **CONFIGURE** — reference `01-configure.png`; deliberate, tactile experiment preparation.
- **SIMULATE** — reference `02-simulate.png`; complete topology and high-level outcome during playback.
- **INVESTIGATE** — reference `03-investigate.png`; one node / message / failure and its history in depth.

Users must be able to move between these modes **without losing selected run, virtual time or current context**. The same run/trace identity persists across views; controls and labels cannot contradict one another.

---

## 2. All screens and pages — INCLUDING those not shown in PNGs

The three images are **workbench views**, **not the entire product**. Add the surrounding product structure while keeping the approved workbench layouts intact. Route names below are suggested; adapt to the existing repo and router and document the final mapping.

### 2.1 Required for a coherent public V1 (P0)

| Page / route candidate | Purpose | Essential content, behavior and states | PNG coverage |
|---|---|---|---|
| `/` — Introduction / entry | Explain what FaultLab does in one screen and get users into a real demo | Strong one-line value proposition; animated but restrained live **illustration derived from a real example trace**; **Launch Lab**, **Try Split Brain**, **How it works**; no fictitious performance claims | Not shown |
| `/lab` — Workbench entry | Choose whether to create a new run or open a preset/recent experiment | Start new, presets, locally saved runs, last viewed; empty state; no false account prompts | Not shown |
| `/lab/new` — **Configure** | Specify and validate an experiment | Full run setup, fault plan, invariant selection, expected bounds, run action | **PNG 1** |
| `/lab/run/:runId` — **Simulate** | Examine the complete network and results | Run status + viewing position, interactive topology, replay controls, timeline markers, event drawer, error/violation summary | **PNG 2** |
| `/lab/run/:runId/investigate` — **Investigate** | Examine selected node or event and its provenance | Node rail, focus graph, state inspector, history, trace links, timeline, topology return | **PNG 3** |
| `/experiments` — Preset gallery | Pick a useful reproducible experiment | Healthy cluster, crash/recovery, partition/heal, stored split-brain counterexample, later Raft cases; describe what is expected vs. observed | Not shown |
| `/experiments/:id` — Preset details | Understand inputs before running | Scenario description, protocol, expected lesson, seed/version, supported faults, run button | Not shown |
| `/help` or `/docs` — Basics | Teach controls and concepts | Virtual time vs. wall time, node vs. message, traces, fault meanings, invariant terminology, keyboard shortcuts, reproducibility | Not shown |
| `/*` — 404 / recovery | Recover from invalid links | Clear not-found text, go to Lab; for invalid run link offer import/choose experiment | Not shown |

**Deep links:** URL search params should preserve applicable `node`, `entry` (trace entry number), `event`, `violation`, `tab`, and `view` when practical; load safely if the referenced trace is available. For local-only runs, explain that the link works only in the same browser until export/cloud sync exists. Avoid encoding large untrusted trace JSON directly into URLs.

### 2.2 Recommended V1 enhancements (P1; add when supporting engine work is ready)

| Page / surface | Function | Requirements |
|---|---|---|
| **Run Details** side sheet | Source-of-truth metadata | Engine/protocol/invariant versions, run ID, seed, input summary, stop reason, fingerprint, limits, actual execution time vs. virtual duration |
| **Violation Explorer** within Investigate | Investigation entry point | Rule name/version, expected vs. observed, involved nodes, triggering step/entry, supporting trace references; never infer unsupported root cause |
| **Event Log drawer** | Detailed inspection without crowding central network | Search; group by event type, node or step; toggle messages/timers/faults/violations; virtualization for large traces; click-to-seek |
| **Save / Export / Import dialog** | Preserve reproducibility | Versioned validated JSON; import error messages; file size caps; user-controlled local storage; warn on incompatible engine versions |
| **Preferences modal** | Tweak interaction, not protocol | Theme (dark by default), reduced motion, playback speed, message density, graph labels, sound off by default, panel visibility, shortcuts |
| **Keyboard Shortcuts dialog** | Fast expert use | Accessible full list; context-sensitive key handling; discoverable `?` action |
| **Empty / Loading / Error / Result states** | Reliable polished UX | Run ready, executing, viewing, paused, complete, violated, run limit reached, invalid inputs, corrupt import, unsupported snapshot, WebGL fallback, worker error |
| **Compare experiments** | Show why algorithms differ | Side-by-side traces driven by two real runs; synchronized ticks optional; accurately label differences; wait for CP4 protocol support |

### 2.3 Later / optional product expansion (P2 — **not** implied as launch requirements)

- `/learn` and `/learn/:lesson` — guided interactive distributed-systems lessons, teacher-created exercises, progress tracked locally first.
- `/protocols` and `/protocols/:id` — protocol catalog, semantics, supported invariants, references, example traces.
- `/workspaces` — team collaboration, only when accounts/authorization/backend exist.
- `/share/:id` — public shared experiments, requires storage, permissions, abuse limits and privacy review.
- `/compare` — richer run diff of event sequences, outcomes and invariant checks; do not imply different protocols will have identical traces.
- `/settings` — expanded preferences and data management; no mandatory sign-up.
- `/about`, `/changelog`, `/contributing`, `/license` — project transparency, open-source contribution details and MIT attribution.
- `/privacy` and `/terms` where applicable, especially if analytics/accounts/cloud storage are introduced.
- Documentation for a future programmable-protocol SDK and integration API **only after such execution is safe and supported**.

### Navigation structure not in images

- Keep the approved **compact logo/top-left identity** and understated top-right status indicator.
- Add **minimal global navigation** via a discreet app switcher / dropdown (`Lab`, `Experiments`, `Learn`, `Docs`) rather than a bulky new sidebar in the three reference screens.
- Contextual breadcrumbs or discreet text labels communicate **Configure / Simulate / Investigate** without stealing space from nodes.
- Preserve mode transitions and route history. **Back to Topology** from Investigate must return to the same run and timeline position.
- Status indicator (`Trace locked`, `Running`, `Replay`, etc.) is **true state**, not decoration; tooltip explains its meaning.
- Provide Help, shortcuts and settings from global accessible menus.

---

## 3. Proposed technical stack and exact division of responsibilities

**First inspect** `package.json`, all workspaces, existing `apps/demo`, `packages/engine`, `packages/trace`, current `ROADMAP.md`, TypeScript config and browser tests. Prefer compatibility with the repo over introducing the newest package for its own sake.

| Concern | Recommended choice | Responsibility / guardrails | Priority |
|---|---|---|---|
| App framework | **React + strict TypeScript** | Accessible views, component ownership, interaction states. No simulation logic in React. | P0 |
| Build / local server | **Vite** | Current demo already uses Vite; reuse workspace assumptions; separate final app (`apps/web` recommended) from CP2.5 demo. | P0 |
| Routing | **React Router** or compatible existing router | Nested workbench modes, deep links, error routes. One router only. | P0 |
| Styling | **CSS variables + CSS Modules** or project-approved Tailwind approach | Exact design tokens, responsive layouts, pseudo-elements, glow and layered glass; do not use a default UI-kit visual theme. | P0 |
| Fonts | **Geist + Geist Mono** from license-compatible distribution | Headings/UI and technical data respectively; preload/subset only where permitted; no unlicensed font files. | P0 |
| State | Local React state + **Zustand** *if justified* | Separate ephemeral viewport/selection state from run/trace state. Avoid duplicating engine state as writable UI state. | P0 |
| Simulation execution | Existing **`@faultlab/engine`** | Runs protocols/faults/invariants. No React, Three.js, GSAP, or DOM imports. | P0 |
| Trace observations | Existing/planned **`@faultlab/trace`**, `TraceIndex` | Accurate `frameAt(entry)`, provenance, markers, grouping and cause/consequence graph. | P0 when CP3 available |
| Execution isolation | **Web Worker** with structured protocol | Keep UI responsive; bounded workloads; worker cancellation via termination where necessary; not a security sandbox. Check current roadmap checkpoint. | P0 before unbounded runs |
| 3D nodes & camera | **Three.js + React Three Fiber** (conditional) | Sculptural node spheres, physically inspired lighting, controlled focus/camera. Spike first; only adopt if image fidelity/perf justify it. | P1 visual |
| 3D helpers | **@react-three/drei** (conditional) | Camera, controls, primitives/shader utilities; selectively import. | P1 visual |
| Postprocessing | `@react-three/postprocessing` (conditional) | Subtle **selective** bloom / glow, only if necessary and profiled. | P2 polish |
| 2D topology overlays | **SVG** and/or **Canvas 2D** | Precise edges, click targets, status strokes, event paths, markers. Decide whether to project node coordinates from 3D. | P0 |
| Interface motion | **Motion for React** or a small CSS/WAAPI layer | Mode/panel transitions, focus and hover microinteractions. Choose one primary UI animation approach. | P1 |
| Cinematic sequences | **GSAP** only when justified | Optional precisely choreographed transitions; avoid duplicate animation control with Motion. Never animate simulation truth with decorative timelines. | P2 |
| Icons | Small consistent custom SVG set (or selectively Lucide) | Use icons with explicit technical meaning, matching reference artwork; no generic oversized UI icons. | P0 |
| Accessible primitives | **Radix primitives / React Aria**, selectively | Menu, dialog, tooltip, select, slider, switch, popover; customize styling completely. Choose based on accessibility and existing deps. | P0 |
| Long log lists | **@tanstack/react-virtual** if needed | Event-log virtualization; keep exact event identity/ordering. | P1 scale |
| Data validation | Existing schema validation tooling (e.g. **Zod**) where already in use | Import/export, settings, deep-link and worker message boundaries. Do not duplicate engine validation. | P0 |
| Local persistence | **IndexedDB** for sizeable experiments, localStorage only for tiny preferences | Version-aware stores, explicit clearing/import/export, bounded quotas. | P1 |
| Unit/integration tests | **Vitest** + React Testing Library if React test surface warrants it | Mappers, playback state, keyboard and accessibility behavior. | P0 |
| Browser/E2E | **Playwright** | Real Chrome, Firefox/WebKit smoke where available, screenshot visual regression and interaction tests. | P0 |
| Accessibility checks | **axe-core** / `@axe-core/playwright` where compatible | Automatic checks plus manual keyboard, zoom, contrast and reduced-motion testing. | P0 |
| Backend / cloud | **None required for initial public V1** | No unnecessary auth/database/cloud costs; defer accounts/sharing/teams until use case validated. | P2 |

**Avoid:** prematurely adding Next.js, Supabase, Clerk, Redux, XState, multiple icon libraries, Framer/Motion **and** GSAP everywhere, React Three Fiber **and** Pixi for the same graph, or a large design-system library merely to reproduce three screenshots.

### Suggested repository organization

```text
faultlab/
  apps/
    demo/                     # CP2.5 prototype; preserve while new UI is validated
    web/                      # final React application
      src/
        app/                  # routes, providers, shell, error boundaries
        modes/
          configure/
          simulate/
          investigate/
        features/
          experiments/
          timeline/
          topology/
          event-log/
          invariants/
          violations/
          persistence/
          onboarding/
        components/
          ui/                 # accessible primitives and branded controls
          visual/             # glass panels, node visuals, technical background
        graphics/             # optional Three.js scene, shaders, camera
        workers/              # execution adapter/worker messages
        state/                # selection, view and playback only
        styles/               # tokens, typography, surfaces, motion
        test/
  packages/
    engine/                   # existing, authoritative, framework-independent
    trace/                    # CP3 or existing; observer package
    ui-model/                 # OPTIONAL: pure event→view-model mapping
  docs/
    DESIGN_DIRECTION.md
    UI_REQUIREMENTS.md
    ROADMAP.md
    ENGINEERLOG.md           # actually at repository root if that's current convention
    ...
```

**Rendering data flow** (one-way):

```text
ExperimentConfig (validated)
     ↓
Simulation Worker → @faultlab/engine → Engine Trace / Snapshots
                                             ↓
                                    @faultlab/trace / TraceIndex
                                             ↓
                               Immutable display view model
                                             ↓
              ┌────────────────┬────────────────────┐
              React DOM          SVG/Canvas           R3F (if adopted)
              controls/log       links/timeline       sculptural nodes
```

Input commands travel from React **into a dedicated controller/worker protocol**; the engine returns results. View animation never determines when an engine event occurs.

---

## 4. Visual fidelity: materials, typography, spatial system

### 4.1 Overall composition

- Reference target is approximately **1536 × 1024**, but **do not hardcode that viewport**. Use responsive `minmax()`, `clamp()`, logical gaps and dynamic viewport height (`100dvh`) so timeline/controls remain in view.
- Top: restrained identity row, thin horizontal guide line, minimal status/control cluster at right.
- Background: nearly black technical void, nuanced charcoal gradients, ultra-thin structural grid, concentric/orbital vector outlines, occasional small sculptural accents. Background effects are static/passive, with no false network meaning.
- Surfaces: low-opacity smoked/frosted panels, thin metallic inner edge, subtle top-left highlight, low-frequency grain and very restrained corner glow. Avoid saturated gradients.
- Graph: **dominant visual focal point**. Spheres are dark, dimensional, softly rough/material-like with concentrated rim illumination. Straight, thin, bright connection lines with precise junctions and tiny luminous signals.
- Color: white/silver for neutral, icy blue for selected/focused/interactive, **red-orange for actual faults/violations**, muted grey for secondary/disabled. The **warm neutral edge highlights already in Configure's PNG are decorative and may remain**, but must not be confused with warning/fault signals.
- Sizing: original layout proportions and negative space matter more than an arbitrary 8px-only rule. Use an underlying **8px layout rhythm**, with optical adjustments for hairline strokes and sphere placement.

### 4.2 Design tokens (starter roles, not invented exact samples)

**Claude must sample actual reference PNGs before finalizing numeric tokens.** Treat the following as roles and approximate starting bands, not official extracted color values:

```css
:root {
  color-scheme: dark;
  --fl-bg: #080a0d;
  --fl-bg-raised: #111418;
  --fl-surface: rgba(25, 27, 31, 0.72);
  --fl-surface-focus: rgba(34, 39, 47, 0.79);
  --fl-line: rgba(227, 232, 240, 0.18);
  --fl-line-strong: rgba(235, 240, 250, 0.35);
  --fl-text: #e7e9ee;
  --fl-text-muted: #a4a9b3;
  --fl-text-subtle: #7e8490;
  --fl-focus: #a5c4ff;
  --fl-fault: #ef7451; /* tune from references; reserved for real faults */
  --fl-radius-panel: 15px;
  --fl-radius-control: 12px;
  --fl-grid: 8px;
  --fl-header-height: 58px;
}
```

- Do **not** make text illegibly dim just to match the PNG; readable technical data is a hard requirement.
- Define layers: background → grid → decorative orbits → link network → nodes → panels → tooltips/modals → focus indicators.
- Blur (`backdrop-filter`) must degrade gracefully on weaker devices. Prefer compositor-friendly opacity/transform animations to animating blur/box shadow continuously.
- Metallic highlights should be deliberate gradients + borders and/or baked material reflection, not indiscriminate full-screen bloom.

### 4.3 Typography

- **Geist:** primary headings, navigation, button labels, narrative text.
- **Geist Mono:** timestamps, node IDs, state keys/values, event IDs, protocol versions, fingerprints, seeds, machine-facing labels and technical annotations.
- The reference is compact/editorial. Preserve that, but use a sensible minimum size on normal-density screens for critical information. Minimum comfortable interactive target is typically around **44 × 44 CSS pixels**; visible lettering may be smaller only where readable and accessible.
- True typographic hierarchy: `screen title > result/status > selected object name > labels > supporting explanation > micro-metadata`. Do not give all text similar contrast/weight.
- Avoid stylized symbols that obscure copy/paste, such as replacing actual hyphens or variable names in debug data.

### 4.4 Visual source extraction and quality control

1. Open each PNG at original resolution and document grid lines, panel bounding boxes, node coordinates, corner radii, highlights, backgrounds and typography. Make an **overlay comparison** and difference screenshots.
2. Reconstruct layout in real CSS. Build node/material prototypes in isolation. Keep PNG open during review.
3. Prepare fixed states matching each reference: selected n4 at specified trace entry, configured four-node experiment, healthy complete run.
4. Compare in-browser screenshots at exact reference viewport and at 1440×900, 1280×800, 768×1024, 390×844. Track visual regressions. Use human review; a pixel diff alone is not meaningful for WebGL antialiasing/noise.
5. Do not change layout simply because a UI framework's defaults are easier. Preserve overall visual identity while allowing necessary responsive adaptations and accessibility.

---
## 5. Page 1 — CONFIGURE: exact composition, complete behavior

**Approved reference:** large three-column workbench with **Run setup** on the left, a central four-sphere network, **Invariant set** on the right, and a prominent pale icy-blue **Run Experiment** CTA in the bottom-left of the left column.

### 5.1 Regions and content contract

**Top bar**
- Left: sculptural FaultLab mark + wordmark. Logo links to app entry; requires accessible name.
- Right: discreet multi-dot run/mode indicator. Give it a truthful label/tooltip; if dots indicate workflow stages, label them, don't imply unimplemented pages.

**Left / Run setup panel**
- `Protocol` — accessible searchable select if catalog grows; only supported protocols; show short description and version.
- `Nodes` — exact numeric count. The sculptural row of sphere selectors must map to real supported discrete values. Keep adjacent/hidden accessible numeric input as necessary. On change, the preview topology updates; never run an experiment implicitly.
- `Random seed` — **integer input with explicit value**, not a continuous slider; provide `Regenerate` using real non-deterministic UI choice before the run, then record the selected seed in input config. Offer copy seed.
- `Network latency` — explicit min/max tick values; if a double-ended slider is used, both thumbs have labeled values, keyboard semantics and validated ordering. If the engine uses distribution types, show them honestly (do not flatten into a false single range).
- `Fault injection` — enabled/disabled overview; enabling means faults may be configured, not that undocumented faults automatically occur.
- `Fault schedule` (**required but not visible in PNG**) — compact drawer/popover or secondary setup section where the user can add/remove **supported** time-scheduled `crash`, `recover`, `partition`, `heal`, per-link loss/delay/restore. Each fault needs timestamp, target(s), relevant parameters, conflict validation and a readable summary. Draw matching reference-like event badges on the visual schedule preview.
- `Invariant policy` — actual choices exposed by engine (`stop-on-first`, `record-and-continue`) with explanatory text.
- `Limits` (**not visible**) — max virtual time, max processed steps/events, max pending events; display defaults and validation, with advanced drawer to prevent clutter.
- `Seed regenerate` — a separate action with meaningful feedback; no duplicate 'Seed 2026' information.
- **Primary button** `Run Experiment` — large tactile polished pale-blue CTA; disabled for invalid config; accessible busy label during start; do not simultaneously create multiple runs on double click.
- **Configuration actions not shown in PNG:** Reset to preset, Save as draft locally, Import config, View advanced inputs. Put secondary actions in an unobtrusive menu; avoid extra main-page cards.

**Center / Topology setup preview**
- Four sculptural nodes in exact diamond arrangement when `nodes=4`; thin, meticulously joined bright link segments; atmospheric background, orbital geometry and ambient parallax.
- Diagram visualizes **planned** topology only, not a simulated run. At this stage node spheres must not animate fake messages, failures or leadership.
- Changes in node count/topology update graph deterministically from config. Set a layout algorithm for common counts: 3–6 orbit/ring or authored positions; 7–20 predictable concentric/force-assisted arrangement (layout determinism), higher counts simplified.
- Nodes, edges are inspectable on pointer/focus: small tooltip with ID and planned connection details. No claims about leader before execution.
- Bottom illustrated schedule: actual planned faults labeled **crash / partition / recover / heal** from config. Blue can mark selection, fault colors have explicit semantics. Clicking opens corresponding fault editor; drag to change tick only if supported and committed to the config.
- Never show fault icons just to fill the PNG when the current setup has `faults: none`. In that case preserve the layout but use honest empty placeholders or optional sample preset guidance.

**Right / Invariant set panel**
- Cards keep their supplied sculptural icons, compact borders and physical switches.
- Each card shows **real invariant ID/name, version where appropriate, one-sentence meaning, enabled state**. Tooltips include whether it is a safety property and which protocol supports it.
- Cards such as `SINGLE LEADER`, `UNIQUE EPOCH`, `EPOCH MONOTONICITY` in PNG are **conceptual references only**. Do not hardcode unsupported invariants. If a rule is not supported for the selected protocol, explain and disable/omit it; no silently inactive switches.
- `Deterministic` summary at bottom describes reproducibility of the actual inputs/version, not a guarantee of correctness. Show selected seed + engine/protocol version behind 'Details'.

### 5.2 Config validation and interaction

- Validate before execution and inline on field edit/blur, with errors beside actual fields and a global focusable error summary on submit.
- Define legal node count by protocol and graph/render budget. Don't offer invalid counts.
- Fault chronology: recovery should not claim to act on nodes never crashed; partitions must have legal disjoint groups; link directionality and the exact behavior of in-flight messages should be explained as in engine semantics.
- Multiple faults at the same tick must retain documented engine priority/order. Preview timeline must not imply a different order.
- Users should be able to load preset → tweak seed/targets → run, while preserving the full input configuration in resulting run metadata.
- If no invariant selected, show `No invariants enabled — violations will not be checked`, not `Safe` or a green success indicator.
- If the protocol is intentionally unsafe, label it: `Educational / deliberately unsafe model`, not production-grade consensus.

### 5.3 Configure hover, focus and micro-motion

- Main CTA: rim light follows pointer subtly within the button (decorative only), slight inner illumination and press-depth on pointer-down. Do not shift text horizontally.
- Metallic knobs/dials (if used): hover increases rim contrast, shows exact current value and accessible tooltip; drag changes value with pointer capture; keyboard arrows fine adjustment, PageUp/PageDown coarse, Home/End bounds. Touch must work. Never use a rotary visual control without an accompanying value/input.
- Protocol select: border brightens modestly, chevron rotates 180° on open, menu appears anchored without clipping; escape closes and focus returns.
- Invariant card: 1–2px perceived lift or highlight; switch thumb moves with spring on state change; `off` cards remain readable; tooltip on help icon, not all text.
- Network nodes: very subtle 1.02 scale / rim emphasis on hover; tooltip appears after ~200–350 ms with keyboard focus equivalent. Selected/config-targeted node gets cool-blue thin ring.
- Fault markers: tiny hover bloom + label with tick/action; keyboard Enter opens edit popover. Marker movement while editing must not be confused with execution-time movement.
- Confirm state transitions: clicking Run causes one deliberate compress/release interaction, validates, shows preparing/executing label, then transitions into Simulate with same graph geometry whenever possible.

---

## 6. Page 2 — SIMULATE: overview, topology and replay

**Approved reference:** three primary panels with **Trace context** on the left, central topology, **Experiment status** on the right, and full-width low-profile **Replay trace** dock below.

### 6.1 Layout contract

**Left / Trace context**
- Experiment/preset selector or experiment title (selected run must remain fixed when only scrubbing the trace).
- Protocol, seed, node IDs, network latency, fault schedule summary, invariants enabled, engine version, input limits, run fingerprint and the actual stop reason.
- Clear **run state vs. playback/view state**, e.g. `Execution: completed · Viewing t=300 of t=600`. A finished trace can be replayed; it is not currently executing.
- A compact run progress / chapter rail is allowed; markers must correspond to real steps/events; do not show arbitrary blue dots for decorative purposes.
- Actions: Run again, Edit configuration, Verify determinism, Export trace. Place secondary items in contextual actions so the reference's clean left panel survives.

**Center / Network topology**
- Diamond layout for the canonical 4-node example (n1 top, n2 right, n3 bottom, n4 left), preserving sphere scale, spacing and subtle orbit guides.
- At a given selected trace entry, render actual node status (not started/idle/follower/candidate/leader/crashed/recovering where the protocol exposes it), connections, in-flight messages and fault overlays.
- Render messages only when the trace proves send/arrival path and time. See simulation-visualization semantics §11.
- Pointer/focus on node opens contextual quick inspector; click/Enter selects; double-click or `Inspect node` enters Investigate with the **same node, time, trace entry and run ID**.
- Hover on edge reveals source/target, direction, link health, latency/loss configuration; click focuses connection details if supported.
- Wheel/pinch zoom and drag pan supported when needed; never hijack normal page scroll unexpectedly. Expose `Fit network` / `Reset view` controls if zoom is active.

**Right / Experiment status**
- Compact but prominent result: `NO VIOLATIONS DETECTED` when the enabled rules have not failed **on this execution**. **Never use “ALL INVARIANTS SATISFIED” to imply a mathematical proof over every possible execution.**
- Show `Execution: Completed / Stopped on violation / Limit reached / Failed`, detected violation count, nodes alive at **viewed time**, and count of **enabled** invariants. If no checks selected, explicitly say `No invariants configured`.
- If a violation occurred, top region shifts to decisive fault state: invariant name, virtual tick + entry, expected vs. observed, affected nodes and `Inspect violation →`.
- Mini summary chips can show messages delivered/dropped, faults or invariant status **only if calculated from real trace**; give meaning to every colored circle.
- If a selected node exists, optionally show summary inline without replacing main result entirely; separate Node Inspector remains within Investigate.
- On `run-limit` stopping, show `Stopped at maxTime/maxEvents`, not `Completed successfully`.

**Bottom / Persistent replay timeline**
- Entire width inside viewport, visible without vertical page scrolling at reference size. Responsive on smaller screens.
- Controls visible in reference: jump start, step back, Play/Pause, step forward, jump end. Add `Replay from start` and speed when appropriate without overcrowding.
- Timeline tick labels show **virtual tick** (`t=300`), selected trace entry (`#829`), and optionally step count in a subordinate line. Provide zoom window and `Fit all` for long runs.
- Markers show actual major events: crash/recovery, partition/heal, message loss (group dense incidents), invariant violation, snapshot/keyframe (when CP3 exists). Clicking marker selects **exact relevant trace entry** and opens a readable popover.
- Correct semantic zoom for dense runs: cluster markers at coarse zoom, expand at fine zoom. Do not render every 100k event as an overlapping independent DOM node.
- The current cursor is always visible in the dock; selected marker style matches the selected frame.
- Timeline scrubbing previews frames at performance-safe rate, commits exact selection on release and supports keyboard steps.
- **Event log drawer** is required despite not being present in revised PNG. Implement as a collapsible overlay/pane invoked via small `Events` control, preferably docked above the timeline, not a permanent giant section. Include event type, ID, tick, involved nodes, short summary; grouping, filtering, search, virtualization; click-to-seek. Remember previous CP2.5 verbose log feedback.

### 6.2 Run → Replay distinction

These are different operations and must be labeled precisely:

- **Execute/Run:** engine processes events and produces trace/output. Under worker, show real execution progress if available; report bounded resource limits and errors.
- **Replay:** the UI consumes an already completed or currently accumulated immutable trace. Playback speed controls visualization only; it cannot modify saved trace data.
- **Restore/Resume:** future CP3 capability to resume actual engine execution from valid simulation-step snapshot. Not identical to moving playback cursor to a trace entry.
- **Reset viewer:** return cursor and selection to start; does not regenerate a random seed or re-run engine.
- **Verify determinism:** execute same configuration/version two times, compare **full traces/fingerprints according to engine guarantees**, report actual result. Do not merely show a blue indicator from static metadata.

---

## 7. Page 3 — INVESTIGATE: focused node / event / violation

**Approved reference:** narrow left column with vertically stacked sculptural nodes; a monumental focused node with real signal paths in center; right read-only `Derived state` inspector; bottom full-width timeline with selected event.

### 7.1 Layout regions

**Left / Node rail**
- A small scrollable/keyboard-navigable list of nodes, each rendered as a lighter-weight sphere/thumbnail with ID and status. Four visible in reference; for 20+ nodes, list virtualization/scroll and search required.
- Current node receives cool-blue accessible selection ring + ID. Node keyboard navigation (arrows) must not conflict with timeline keys when focus is elsewhere.
- Bottom `← / →` previous/next node controls and explicit **Topology** action return to same run's Simulate view; preserve selected tick/entry.
- Crashed status must be visible as more than red fill: broken ring, X/icon, textual tooltip/label.

**Center / Node focus visualization**
- Giant selected sphere in prominent center exactly as reference. Scene is a **focused view**, NOT a claim that the network is now a star topology or that messages only flow left-to-right globally.
- Label with selected node ID and protocol-exposed role (e.g. `follower`, `incarnation 1`) at chosen trace entry; never hardcode role.
- Real inbound/outbound messages can project onto left/right lanes while focusing on node. Show direction and any ambiguity with arrowheads or source/target labels. The scope of the lane (`incoming`, `outgoing`, `selected time window`) should be explicit and accessible.
- Signal particles may be shown only for actual relevant messages from the trace with correct send/arrival virtual times. Default abstract rings/orbs are static decorative geometry and must not resemble network packets.
- Interactive packet: click/focus shows message ID, sender, recipient, send/arrival tick, payload summary if safe, drop/deliver status and causal trace refs; clicking opens details drawer.
- Contextual floating node card remains near upper center; same material/glass as reference; selected role/status/provenance accurate at cursor position.
- Zoom/focus behavior should be controlled and not disorient the user; `Back to Topology` clearly restores original camera / graph.

**Right / Derived state inspector**
- Source explicitly tagged `TRACE-DERIVED`. This indicates reconstructed observable state, **not** internal private state that traces do not expose.
- Sections: `Node status / Incarnation`, `Volatile state`, `Persistent storage`, `Timers` (when observable), `Recent relevant messages`, `State origin`, and **Invariant evidence** when applicable. Use disclosure groups to avoid overlong permanent columns.
- Keys and values are rendered read-only in copyable, selectable monospace rows. Reference lock icon may remain, but **do not imply cryptographic security**; use tooltip `Read-only historical state`.
- Field names depend on actual protocol definitions. PNG sample keys (`currentTerm`, `leaderId`, `savedTerm`, etc.) may be inaccurate; use actual state shape, with clear display names where verified. In particular, if Raft `currentTerm` is durable, do not misclassify it as volatile because the PNG did.
- Each changed field can display **last updated at Event #...** if provenance is available. `View event →` jumps to exact entry and selects trace row/evidence.
- If data is absent: `Not recorded by this trace` / `Not applicable`, not a fabricated zero, false or empty object.
- Large objects/arrays: collapsed JSON-like tree with expand, copy value/path, diff vs. previous entry. Avoid input-like editable styling.
- Add a small read-only `State changed` badge/outline for fields modified at current event; do not pulse unrelated fields.

**Bottom / Investigate timeline**
- Shares the SAME underlying timeline model as Simulate, skinned to the reference's long delicate line with blue selected marker.
- Supports focus filters (`Only n4`, `Messages to n4`, `Faults affecting n4`, `Violations involving n4`) but toggling filters must not alter the actual run or omit available truth without indicating a filter.
- Time selection across mode changes remains exact. Event number and tick both shown (`t=15201 · Event #829` only as an illustration).
- Add causal trail navigation (previous cause / next consequence) where supported by TraceIndex, not guessed relationships.

### 7.2 Violation-investigation state not shown in PNG

When the user clicks `Inspect violation`, Investigate should open in **Violation Focus** rather than arbitrarily choosing a single node:

- Show **invariant ID/name/version**, expected condition, observed counterexample, triggering event, virtual time and affected nodes.
- Highlight all involved nodes simultaneously using correct failure emphasis and node labels. For split brain, keep both leaders visible, perhaps with split-focused lens or paired inspector subviews, not a misleading single leader hero.
- Show observed evidence (trace IDs, stateEntry IDs, active faults). Provide an evidence chain explorer or event drawer.
- **Do not claim a root cause inferred by the UI**; distinguish `Fault active when violation occurred` from `Proven cause`.
- Actions: `Jump to triggering event`, `Previous related event`, `Next consequence`, `Replay this segment`, `Open minimized counterexample` (only if there is an actual saved fixture).
- Violation without enough observable evidence should show an honest limitation rather than inventing explanatory narrative.

---

## 8. Every significant motion & interaction — interaction matrix

Use this matrix as the **minimum behavioral specification**. Timing figures are **starting targets** to calibrate against the PNG aesthetic and real-device tests; they are not immutable exact timings.

| Element | Pointer hover | Active / selected / pressed | Keyboard / touch equivalent | Duration / notes |
|---|---|---|---|---|
| Logo / brand | Small ambient silver rim increase, cursor remains unobtrusive | Subtle press compression; navigate Lab/home | Focus ring, Enter/Space; touch tap | 140–220ms; no gratuitous spin |
| Top-level navigation item | Underline/hairline brightens; no sliding page | Active section indicated by small blue point and label | `Tab`, Enter, Escape | 120–180ms |
| Glass panel | **Usually no motion**; only border highlight around actionable panels | No generic card bounce | Focus only where interactive | Avoid every panel glowing on mouse movement |
| Main CTA | Inner pale-blue shine tracks pointer ~3–6px; subtle elevation | Press compress `scale(.985)` or inset edge, working busy state | Native focus + keyboard/touch activation | 120–220ms, reduced-motion instant |
| Secondary action | Thin border becomes brighter, slight label emphasis | Blue/silver selected outline | Focus-visible, Space/Enter | 120–180ms |
| Metallic dial | Increased rim specular, value tooltip | Pointer drag & numeric update; animated thumb angle | Arrow keys, Home/End + numeric input | ≤180ms display, value itself updates immediately |
| Slider / seed field | Track and value highlight | Exact numeric value; preview updates safely | Keyboard input + valid bounds, touch | No delayed/stale configuration |
| Toggle / invariant card | Background and edge lift 1–2px in perception | Thumb spring, enabled/disabled legend | Space/Enter, screen reader status | 180–260ms; respect reduced-motion |
| Topology node | Sculptural rim glow and subtle scale **≤1.025**, optional label tooltip | Blue selection ring + ID; click opens inspector | Tab/focus; Enter selects; long-press/tap on touch | Hover 160–240ms; focus never blur-like |
| Graph edge | Increase line opacity/width modestly | Edge detail popover, affected-fault overlay | Reachable as accessible list of connections | No visually confusing thickness jump |
| Real message / packet | Path highlight + tooltip with ID | Freeze/inspect message only in replay viewer | Keyboard-selectable via event log alternative | Geometry driven by virtual time, **never CSS travel duration** |
| Crash event | N/A before actual tick | Edge/rim breaks, status badge, drop marks based on trace | Screen reader event announcement and log | 120–240ms purely cosmetic transition |
| Partition event | N/A | Affected links switch to dashed/broken/fault state | Log/filter announces affected groups | Event at exact virtual tick |
| Recovery event | N/A | Rim reconnect / cold-neutral re-entry, `incarnation` updated | Event log and accessible status | 160–260ms cosmetic only |
| Invariant violation | Hover of violation chip shows concise evidence | Brief **red-orange** rim pulse, stop policy handled by engine, inspect CTA | Clear text and alert region (non-spam) | Short ≤450ms; no strobing |
| Timeline marker | Halo and vertical guide line, popover with event type/tick | Blue selected ring; exact seek to trace entry | Focus, Enter, arrows when timeline focused | Selection ≤180ms, seek results immediate |
| Timeline scrubber | Slight emphasis | Pointer drag or keyboard stepping; accurately update selected frame | Slider ARIA with tick/entry description | Never render false intermediate engine states |
| Event log row | Background/left stroke brightens, linked graph elements highlighted | Selected row with event ID, jump in timeline | Keyboard row navigation; Enter seeks | 100–160ms |
| State inspector row | Key + value readable highlight, provenance tooltip | Copy path/value, jump to stateEntry | Focusable copy/link actions | No value-editing interaction |
| Tooltip / popover | Enter fade + 4px travel | Remains for focus, pointer transfer where necessary | Dismiss Escape; not hover-only | 100–160ms |
| Dialog / drawer | Background does not animate reactively | Layer fades + slides ≤12px, focus trapped and restored | Escape, tab trap, close button | 180–280ms |
| Mode switch Configure→Simulate | Slightly quieter surrounding surfaces | Graph sphere positions persist/shared geometry when feasible; panels transition | Route semantic heading/focus updates | ~280–500ms; don't obscure run results |
| Mode switch Simulate→Investigate | Hover previews selectability | Selected node grows to focus hero; other nodes recede/convert to rail; camera eases gently | Accessible immediate mode change & focus target | ~350–650ms; user can skip |
| Mode switch Investigate→Simulate | None | Reverses selected node focus, retains time and run | `Back to Topology` keyboard/touch | ~300–550ms |
| Run loading / parsing | No fake sparkles | Honest progress/indeterminate status, cancel when supported | Announced busy state | Prevent duplicate execution |
| Copy / export | Standard hover | Short `Copied`/`Exported` toast | Screen reader polite live region | Avoid data-loss claims |
| Interactive cursor (optional) | Very subtle soft focus ring *only in canvas region* | Changes for draggable/selectable points | Native focus remains independently visible | Disable on touch, reduced motion and precise text controls |

### 8.1 Easing and spring design language

- **Default UI reveal:** `cubic-bezier(.2,.75,.2,1)` or equivalent; avoid generic bouncy startup effects.
- **Micro-interaction:** slight `ease-out`, 120–220ms, distance ≤8px.
- **Panel transition:** ~180–320ms opacity/translate, no exaggerated scale.
- **Node/camera focus:** critically damped or lightly spring-damped, ≈350–650ms; no overshoot that misplaces target or suggests inaccurate coordinates.
- **Failure pulse:** single brief signal, not continuous red blinking. No flashes >3/second.
- **Atmospheric ambient animation:** optional slow <1° rotation / subtle light drift across several seconds *only when not semantically misleading*, paused or greatly reduced under reduced-motion and low power.
- **No decorative continuous spin of protocol nodes**, unless explicitly identified as a non-semantic visual effect; leadership cannot be indicated by decorative motion alone.

### 8.2 Transitions, morphs and shared-element choreography (detailed)

**A. Configure → Simulate — topology continuity**
1. User validates and starts the run. Show accurate busy state. If execution is fast, avoid a fake 2-second loading animation.
2. Keep the same displayed node IDs and positions as the topology preview. Use layout/shared-element transition where practical; sidebar panel content changes from Run setup / Invariant set to Trace context / Experiment status.
3. Transition graph focus from warm setup illumination to cooler neutral trace state without implying a fault; active semantic fault overlays appear only at selected trace time.
4. Bring up the persistent bottom playback dock (fits viewport). Start viewer at explicit `t=0 / Entry #0` or a well-communicated post-initialization entry, not a deceptive mixture of both.
5. Respect browser back/forward preserving run identity and cursor when feasible.

**B. Simulate → Investigate — selected node grows into focused subject**
1. Record selected node ID, trace entry and current view transform.
2. The selected sphere appears to move/scale from its topology position into the large center focus; use a tracked **shared 3D object** if possible, or a convincing FLIP/portal-style transition. Do not duplicate two independent glowing spheres visibly mid-transition.
3. Other nodes fade/reposition into the left rail. Actual topology lines may fade to the node-specific communication lanes; **clearly label this as a focus projection**, not a change in graph connectivity.
4. Inspector slides/fades in with actual trace-derived state at the same entry. If selected node has never started, show that honestly.
5. Timeline travels from Simulate dock style to Investigate dock style while keeping the selected tick/entry precisely the same.
6. Announce mode/heading to screen readers and move focus sensibly (typically new heading or node inspector, not arbitrary canvas DOM).

**C. Investigate → Simulate**
- Reverse the above gracefully; same event, same node selection (or show selection ring), camera returns to last topology pan/zoom, inspector closes.

**D. Timeline movement and 'time travel'**
- The **replay cursor** can move backward or forward through a finished trace without changing its validity.
- Selecting a trace entry should update node/material states atomically from the same `TraceIndex.frameAt(entry)` result. Do not have node colors on one tick and inspector data from another.
- On seeking backward, disable or restart an in-progress cosmetic interpolation. Never animate messages *backward* without clear replay direction; stepping backward may snap cleanly to the earlier state.
- Under CP3, a saved engine snapshot is only restorable at valid simulation-step boundaries. A frame at an individual trace entry is an **observer view**, not necessarily resumable engine state.
- Use a bounded state/cache strategy; do not store every rendered DOM/3D scene snapshot.

**E. Violation found**
- Engine invariant result controls stop policy. UI reacts to exact violation entry: highlight relevant nodes, change status panel, place an unmistakable marker, optionally focus causal path.
- No 'AI explanation' that asserts root causes beyond actual evidence. Make unsupported interpretations visually distinct from verified facts.
- Provide `Inspect violation` and `Replay from earlier event` without destroying the full trace.

**F. Mode transition interruptions**
- If user seeks while a node-focus morph is playing, resolve to the correct newest cursor state and cancel/retarget animation. Never strand panels in mixed state.
- Every transition supports route changes, browser back, rapid clicking and reduced-motion instant mode.

---

## 9. 3D environment, sculptural nodes and rendering engineering

The PNGs contain **high-end, materially rich, sculptural spheres**, not flat UI circles. Reproducing them convincingly may justify WebGL, but the product **must also remain fast and usable without it**.

### 9.1 3D scene stack (if the isolated spike succeeds)

```text
React DOM (application shell, accessibility, controls, labels)
  └─ Center stage (clipped/presentational layout region)
      ├─ Static CSS/SVG ambient background, grid and circles
      ├─ Canvas / R3F scene (camera, lights, sphere meshes, optional glow)
      ├─ SVG overlays (precision edges, fault states, selection hit regions)
      └─ DOM labels and popovers projected to screen coordinates
```

An alternative is entirely SVG/CSS for the canonical small graph (including CSS gradients/pseudo-elements for spheres). **Prototype and compare both**. The final selection is a measured engineering tradeoff, not a requirement to use WebGL everywhere.

### 9.2 Node object design

**Geometry:** true sphere or slightly softened/globular procedural sphere with restrained micro-normal/roughness variation; keep silhouette round and premium. Avoid toy-like plastic or photoreal astronomical textures.

**Material / shading:** dark graphite, subtle near-black charcoal body, silvery Fresnel/rim highlight, restrained warm neutral specular. Investigate hero sphere includes richer low-contrast surface character, not a noisy texture that hurts labels. If R3F, evaluate `MeshPhysicalMaterial` with reasonable roughness / clearcoat vs. custom shader only if needed. Test under different device GPUs.

**Lighting concept:**
- Key light: small, bright neutral overhead/upper-left to create sharp upper rim.
- Fill: extremely gentle cool side illumination to preserve material shape.
- Rim / edge: narrow pale neutral glow. Avoid overexposing spheres to flat white.
- Ambient: near-black environment, occasional subtle silver or warm reflections.
- Fault state: red-orange halo/stroke as a separate **semantic overlay**; don't turn the entire sphere orange unless meaning remains unmistakable.
- Selected: thin icy-blue concentric focus ring around sphere, coherent with left rail and timeline.

**Texture:** controlled material noise/pattern (procedural or properly licensed texture); keep grain in the background independent of node surface. Any noise that evolves over time must not be mistaken for packet activity.

**LOD:** canonical 4-node spheres can be premium; at 20+ nodes use lower tessellation, simplified materials or instancing and reduce glow passes. Keep labels sharp independent of 3D resolution.

### 9.3 Environment and camera by mode

**Configure:** fixed/mostly orthographic composition of four spheres in diamond shape, faint concentric orbit guide in center, small exterior accent orbs, glass left/right panels rendered in DOM. Optional pointer parallax <=4px; control interactions are far more important than 3D camera movement.

**Simulate:** same topology world coordinates, camera optimized for topology readability. Subtle animated message along precisely projected edges; status materials and fault overlays. Panning/zoom optional as graph grows. No dramatic orbit controls that distort graph interpretation.

**Investigate:** camera centers enlarged selected sphere; surrounding source/target communication can be projected into horizontal 2D channels. The sphere remains perceptually sculptural, but state labels and arrows are DOM/SVG. A focus-specific camera may be used; keep depth cues minimal enough that arrows remain legible.

**Scaling and view transforms:**
- Use one canonical topology coordinate system (graph-space) and explicit project/unproject functions for Canvas/SVG/DOM overlays.
- If R3F renders the sphere, project its world location to CSS pixel coordinates for labels, focus outlines and hit areas; recompute on resize/camera updates.
- DOM panels must remain outside the 3D render context; avoid expensive render-to-texture just for UI labels.
- Define camera near/far, zoom bounds, drag friction, animation cancellation and fit-to-bounds.
- Ensure center stage overlays don't clip tooltips; portal menus/popovers to appropriate layer.

### 9.4 Lines, packets and particles

- Link connections: crisp SVG/Canvas/line geometry aligned exactly to node rim anchor points, no visible gap/mismatch when nodes morph/scale.
- Arrowheads/directional semantics only when necessary, with **separate visual for messages** vs. a static undirected/bidirectional link.
- Packet/arrow effects represent actual trace data. For a message sent at `tSend` and delivered/dropped at `tEnd`, the visual position during forward replay is based on normalized **virtual time**; **linear position** is the honest default, not eased motion implying variable latency. Do not animate a dropped packet as delivered.
- Packet loss at send vs. arrival must match the engine's modeled semantics; a message dropped immediately at send should not traverse the link.
- Multiple concurrent messages: lane offsets and clustering to prevent collisions; zoom-dependent simplification.
- While paused, semantic packets stay frozen. Decorative orbit dust may still move only if visually distinct, but default to pausing with playback for clarity.
- Connections for partition: dash/break effect + clear `partition`/`blocked` explanation. Asymmetric links require distinct A→B vs B→A semantics; do not display a symmetrical break if only one direction fails.
- Crash: separate status at node and any downstream delivery drops accurately shown; don't treat every neighboring edge as physically destroyed if only a node has crashed.

### 9.5 Visual fidelity versus performance fallbacks

**High tier:** R3F spheres + limited selective glow + SVG overlays + DOM panels.  
**Medium tier:** CSS/SVG gradient spheres or R3F without bloom; same behaviors.  
**Low tier / no WebGL:** SVG circles with static radial gradients, focus strokes and typed status; timeline/event inspector unchanged.  
**Reduced motion:** full fidelity static materials where affordable, zero parallax and instant mode transitions; messages can be static positions/step states with readable labels.

Detection should be capability-based. Show a short non-blocking message if visual quality is reduced. Never disable the simulator just because WebGL is unavailable.

### 9.6 WebGL engineering safeguards

- One canvas/context when practical; avoid separate contexts for every thumbnail, tooltip and card.
- Cap `devicePixelRatio` (e.g. 1.5–2 on suitable hardware, lower during heavy scenes), profile on laptop GPUs.
- Use `frameloop="demand"` or adaptive continuous rendering when scene is idle; don't burn CPU/GPU on a static page.
- Dispose meshes, geometries, textures, targets, shaders and listeners on unmount; handle context loss/recovery.
- Use instancing or batched geometry for many nodes and simple overlays for many packets.
- Keep postprocessing selective and capped; glow must not wash out mono technical text.
- Use overlay coordinate transforms, not pixel offsets hardcoded for one viewport.
- Never expose main-thread WebGL shader exceptions as failures of the engine; render fallback instead.
- Avoid mouse-following shader orbits that respond to actual simulation packets unless clearly separated as decorative effects.

---
## 10. Global interaction system, application state and commands

### 10.1 Keep these states separate

```ts
// Conceptual types: adapt to actual engine/trace contracts; do NOT
// create parallel, conflicting types if the repository already defines them.
type WorkbenchMode = 'configure' | 'simulate' | 'investigate';
type ExecutionStatus =
  | 'not-started' | 'validating' | 'executing'
  | 'completed' | 'stopped-on-violation' | 'stopped-on-limit' | 'error';
type PlaybackStatus = 'paused' | 'playing' | 'seeking';

type UISelection = {
  runId: string | null;
  traceEntry: number;        // index/ID with exact engine semantics
  selectedNodeId: string | null;
  selectedMessageId: string | null;
  selectedViolationId: string | null;
  selectedFaultId: string | null;
  mode: WorkbenchMode;
};
```

- **Experiment configuration** is editable before a run, and changes create a new run, not an undocumented mutation of an old trace.
- **Execution result** is immutable/versioned; playback never changes it.
- **Playback controller** selects a position and handles wall-clock presentation of virtual ticks.
- **Selection/UI state** concerns current node, message, event, zoom, inspector tabs, collapsed log, sidepanel sizes, modal and preferences. It is safe to persist separately.
- **Observable derived state** comes from `TraceIndex.frameAt(...)` or equivalent engine-backed adapter. Never store it as a second independently editable source of truth.
- **Worker state** records execution progress/errors/cancellation when running in worker. Worker command IDs and run IDs prevent stale results from overwriting a newer run.

### 10.2 Commands and exact behavior

| Command | Meaning | Important edge cases |
|---|---|---|
| `New experiment` | New editable config seeded from defaults | Preserve user draft or warn before discard |
| `Load preset` | Populate config using versioned supported scenario | Preset unavailable under protocol version: clear error |
| `Run` | Validate + execute one bounded experiment | Single-flight, cancel, errors and limits; reproducibility metadata |
| `Play / Pause` | Animate traversal of existing trace | Pausing must freeze virtual-time visualization; no rerun |
| `Step entry forward/back` | Move exactly one trace entry | Contrast with simulation-step stepping |
| `Step simulation-step forward/back` | Move to next/previous valid step boundary | Step may contain many entries; label distinctly |
| `Jump to tick` | Select defined frame at given virtual tick | Multiple entries at same tick: documented nearest/last selection policy |
| `Jump to event #` | Select exact trace entry | Invalid index and old versions handled |
| `Jump to violation` | Select first/next relevant violation | No violation: disabled with explanation |
| `Verify determinism` | Re-execute same version/config and compare full trace | Cannot verify across engine versions without explicit compatibility |
| `Replay segment` | Play actual trace window | Not to be confused with restore-and-resume |
| `Inspect node/message` | Open focus view/side panel at current entry | Object might not exist yet; show `not started` honestly |
| `Back to topology` | Return to Simulate mode preserving selection/time | Camera and log filters restored |
| `Export run` | Versioned JSON config + metadata + trace where supported | Size caps, privacy notice, error handling |
| `Import run` | Validate input, version and resource caps | Never execute embedded code, reject bad schemas |
| `Save local` | Persist selected experiment/trace locally | Quota exceeded, storage disabled, migration errors |

### 10.3 Proposed keyboard shortcuts (only when focus isn't in a text field)

| Key | Action | Guardrail |
|---|---|---|
| `Space` | Play / Pause | Never override native Space on buttons, toggles, inputs |
| `←` / `→` | One trace entry backward / forward | Timeline/list/slider focus owns arrows when relevant |
| `Shift+←` / `Shift+→` | Previous/next simulation step | Explicit step definitions |
| `Home` / `End` | Start/end trace while timeline focused | Respect native behavior elsewhere |
| `J` | Jump to next violation | Only if relevant and no text input focused |
| `E` | Toggle event log | Same tooltip/visible menu path available |
| `F` | Fit network | Only on network mode |
| `Esc` | Close drawer/popover; exit message inspect | Do not silently navigate away from run |
| `?` | Keyboard shortcuts/help | User discoverability; screen reader equivalent |

All shortcut bindings must be listed in Help and may be disabled under Preferences. Don't use global shortcuts that conflict with browser/assistive technology defaults.

---

## 11. Data semantics: exact visualization rules

This section is the **contract** between the beautiful UI and the real distributed-systems engine.

### 11.1 Time, events, entries, steps and animation

| Concept | What it means | UI display |
|---|---|---|
| Virtual tick `t` | Engine-defined simulation time unit | `t=300`, clearly not seconds unless conversion is explicit |
| Scheduled event | One engine-delivered action in virtual time | Message delivery, timer, fault, etc. |
| Simulation step | Engine processes a scheduled event and effects | Can generate multiple trace entries |
| Trace entry | One indexed record of what occurred or was observed | `#829`, exact click/seek target |
| Playback wall time | Time spent showing prerecorded events on screen | `60 ticks/s`, adjustable, NOT measured network latency |
| Keyframe/snapshot | Valid engine checkpoint (CP3) | Marker/restore option only at valid step boundary |
| Trace checkpoint | Observer index point used to derive a view quickly | Implementation detail; not automatically a user-facing event |

Never derive an event `t` from an animation frame count. Use virtual timestamps from the trace; visual interpolation is only a display convention between actual known endpoints.

### 11.2 Event-to-visual mapping

| Engine-trace fact | Visual treatment | No-go / important nuance |
|---|---|---|
| `node.start` | Node enters operational state, status label changes | Don't show active at `t=0` if trace cursor precedes its start entry |
| `node.crash` | Dashed fault ring, explicit `CRASHED`, optional × badge | Does not necessarily remove every network edge globally |
| `node.recover` | Restored operational rendering, incarnation increments | Storage write caused by recovery handler may appear **in a later trace entry**; don't jump ahead |
| `message.send` | New in-flight message with exact sender/receiver | Never animate delivery before corresponding event is recorded |
| `message.deliver` | Packet reaches receiver at recorded tick | Status of sender/receiver at delivery from same indexed frame |
| `message.drop` | Packet stops/disappears at recorded location / × marker | Link loss at send vs. partition/receiver crash on arrival follow engine semantics |
| `timer.set/cancel/fire` | Timeline/log/inspector timer data | Don't invent a separate countdown if only timer target tick is known |
| `fault.partition / heal` | Edge/group overlay and exact marker | Partition checked at arrival; asymmetric fault requires direction-specific treatment |
| `link.delay / loss / restore` | Link inspector + subtle status overlay | If delayed messages have already been scheduled, honor engine decision timing |
| `state.update` | State inspector changes, sourceEntry reference | Difference against prior **trace entry** only if observable |
| `storage.write` | Persistent storage row update with provenance | Do not display future committed value prematurely |
| `invariant.violation` | Fault result, evidence, affected nodes/step and marker | Detecting a violation isn't proving the inferred external cause |
| `invariant.clear` or close episode | Result episode updates, log marker | Only if supported in trace; don't invent clearing |
| `run.start / stop` | Execution metadata/status | Stop-on-limit ≠ successful, violation ≠ engine crash |

The actual event names/types must be read from engine exports and official traces. This table is a **semantic mapping**, not a request to rename working trace schemas.

### 11.3 Layout and domain edge cases not visible in PNGs

- **No nodes yet at entry 0:** instead of a confusing blank, clearly indicate `Ready to replay · Nodes initialize at event #...` and optionally give `Jump to first initialized state` with consent. Never silently fake all nodes started.
- **100+ nodes:** visual aggregation, accessible node search, zoom/focus; avoid 100 glowing 3D meshes + labels at full detail.
- **Thousands/millions of entries:** index-based frame reconstruction, virtualized log, timeline marker clustering, lazy-loaded trace segments if supported.
- **Concurrent messages:** multiple lanes or density indicators; avoid two identical dots obscuring one another.
- **Same-tick events:** stable exact ordering and step semantics, timestamp alone not a unique event address.
- **Historical vs. current invariant:** state invariant and history invariant are different; panel and evidence must reflect the configured rule.
- **No invariants:** `Not checked` not `Passed`.
- **Unexpected invariant exception:** `Checker error`, visually and technically different from `Protocol violation`.
- **Protocol crash/exception:** execution error, not a distributed node crash unless trace says so.
- **Undeliverable message:** reason from trace (partition, loss, down receiver) must be surfaced without invented explanations.
- **Persistent state/volatile state:** actual protocol storage schema and semantics, not names copied from PNG.
- **Fault-free runs:** no fake fault markers; keep layout by showing neutral guide ticks.
- **Different run versions:** visible compatibility error + export option; no reinterpretation of old fixture.
- **User-supplied imported trace:** validate before rendering; no HTML injection, unbounded JSON parsing, prototype pollution, or overlong string blocking the UI.

### 11.4 Trace provenance and causal exploration

`Cause` and `consequence` are **links stored/derived from the trace**, not an AI narrative. Clicking an entry can highlight linked nodes, messages, other event rows and timeline markers. For a violation show:

```text
Invariant: single-leader (version from actual metadata)
Observed at: t=..., Entry #...
Expected: at most one active leader (only if configured rule states this)
Observed: node IDs / states from violation evidence
Active faults: exact engine-backed fault list
Relevant state sources: Entry #..., Entry #...
Evidence references: Entry #..., Entry #...
Replay: run seed + engine/protocol/invariant versions + fault schedule
```

If causal references represent only direct event generation, label them `Direct trace links`; don't imply that one link proves a complete sufficient cause.

---

## 12. Responsive layouts, touch and viewports

The reference images are **desktop design targets**. The finished product needs actual responsive variants not visible in PNGs. Claude must **design these by extending the same system**, not by simply shrinking fonts and panels.

| Viewport class | Layout strategy | Non-negotiable |
|---|---|---|
| Wide desktop (≥1440px) | Reference layouts very close to 1:1; three columns and full-width timeline | Graph prominence, no required vertical scroll for playback |
| Laptop (1024–1439px) | Narrower context/inspector columns; optionally collapse advanced metadata into drawers | Graph not squeezed below usable size; timeline dock always reachable |
| Tablet (768–1023px) | Main canvas + one active side sheet/tab at a time; timeline dock; compact mode switcher | Run controls and graph remain accessible without impossible three-column fit |
| Phone (<768px) | Single primary visualization, bottom timeline, bottom sheets/tabs for setup, status, node data, log; node rail becomes horizontal strip/list | No tiny 3D interaction-only controls; all actions have full-size targets |

- Use `100dvh` / safe area insets, account for mobile browser bars; don't position controls behind iOS home indicator.
- Scrolling: desktop workbench should feel like an app viewport, not a 3-screen document; event logs and long inspectors scroll **internally** with clear scroll indicators.
- Timeline must remain visible on laptop and tablet while graph is visible (the documented UX-002 issue). On narrow phones allow a compact dock + expandable timeline rather than clipping.
- Avoid CSS `overflow: hidden` cutting off tooltips, menus or off-screen focus; render overlays in a dedicated portal.
- Responsive background geometry: crop/scale decor without sacrificing important graph points. Never let decorative orbs intercept pointer events.
- Touch node targets may exceed visible sphere bounds (minimum comfortable target). Press-and-hold can reveal inspector but a single tap path must exist.
- Zoom: plus/minus controls for mobile; pinch where feasible and prevented from hijacking entire page's scrolling; `Fit` action always available.
- If 3D is too expensive on phone, use deliberately styled 2D fallback preserving identity. No forced loss of core functionality.
- Support 200% browser text zoom and high contrast to a useful extent; panels scroll gracefully and labels don't overlap node sphere rims.
- The node inspector must not appear as a full-screen form with editable fields on small screens; it remains explicitly read-only.

---

## 13. Accessibility, semantics and internationalization readiness

**Minimum goal:** WCAG 2.2 AA where applicable, tested manually plus automation. There are graph-specific affordances that require semantic alternatives even if the canvas itself can't be made fully screen-reader accessible.

- Use semantic `header`, `main`, headings, button, links, inputs, dialogs and regions. SVG/Canvas/3D is a supplementary visualization, not the only access to results.
- Provide an equivalent **accessible node and connection list** and **accessible event log**. Every violation can be inspected in text.
- `aria-live="polite"` for meaningful state announcements; `assertive`/alert only for genuinely urgent events, throttled to avoid thousands of announcements during replay.
- All controls keyboard reachable; visible focus indicator in cool blue/neutral white, distinct from the currently selected scene object.
- Every hover tooltip must open on keyboard focus and have a tap alternative. Never hide a critical affordance behind a cursor glow.
- Toggle, slider, dropdown, dialog and listbox use correct ARIA roles and values; keep native semantics where possible.
- Contrast: verify normal text, subdued metadata, timeline marker selection, graph status strokes and fault states. Do not assume glowing outlines satisfy contrast.
- Status uses text/icon/shape in addition to color (dashed crashed ring, crossed dropped message, selected ring, labels).
- Set `prefers-reduced-motion` support across CSS, Motion, camera and WebGL; expose manual Reduce Motion setting if useful.
- Custom pointer off for touch, prefers-reduced-motion and text editing; always preserve native cursor when selection precision matters.
- Never create auto-playing sound as a status indicator; SFX optional, off by default, muted on reduced motion/setting.
- Virtual time uses a consistent display format (e.g. `t=347`) and accessible name (`virtual time 347 ticks`). Keep locale-specific number formatting separate from raw ID values.
- Interface copy in **English for global developer audience**. Keep architecture docs in English; `ENGINEERLOG.md` in Dutch. Dutch UI localization is optional future work; prepare string constants rather than deeply hardcoding copy inside shaders.
- If UI transitions route, update document title and focus appropriately, and support browser history/back navigation.

---

## 14. Complete UX state inventory (beyond static images)

For each visible mode/page, create a **state matrix** and test a representative screenshot. Every category below needs actual copy and component behavior, not only a gray skeleton.

| State | Display requirement | Action |
|---|---|---|
| First launch / no local runs | Explain what FaultLab is + try preset | `Try example` or `New experiment` |
| Loading app / fonts / worker | Lightweight, accessible loading presentation that resembles final style | Cancel if long-running |
| Configure pristine | Selected valid defaults, preview labeled as preview | Change settings / Run |
| Configure invalid | Specific field errors, summary, no active Run | Fix error, preserve valid fields |
| Configure no invariant | `No rules enabled; behavior will be recorded but not verified` | Enable rules / proceed knowingly |
| Running simulation | True progress if available, otherwise honest busy state, cancel | Cancel/return after completion |
| Execution complete healthy | `No violations detected in this run` and actual stop reason | Replay / Investigate |
| Execution stops on violation | Clear fault state, rule and relevant nodes, jump link | Investigate / replay counterexample |
| Execution stops at limit | Explicit limit, distinct from fault or success | Edit limits / inspect partial trace |
| Protocol/checker error | Identified source, diagnostic info, no fake crash state | View trace / edit config |
| Replay at Entry #0 | Nodes `not started` as needed and clear onboarding hint | Jump to first initialized state |
| Replay paused/playing | True playback cursor, speed, controls | Play / Pause / step |
| Replay at end | Current state + finished viewer, no nonexistent future packets | Restart playback |
| Node selected | Ring, inspector data and available actions | Inspect / deselect |
| No node selected | Helpful inspector prompt or experiment outcome | Select a node |
| Node crashed | Dashed fault ring and precise status / incarnation | Inspect crash and stored state |
| Network partition | Correct affected link directions/groups | Inspect fault |
| Event log no results | Clear filter summary and reset action | Clear filters |
| Import succeeded / failed | Version/size/compatibility status, safe errors | Open run / review file |
| Browser WebGL unavailable | Beautiful 2D fallback without breaking functionality | Continue in 2D |
| Offline | Local simulation works; no invented cloud features | Continue local work |
| Missing/invalid deep link | Clear recovery page with no false run data | Open gallery / import run |
| Local storage full | Clear non-destructive failure handling | Export / clear selected data |
| Reduced motion | No parallax/scene morph, semantic status still explicit | All tasks remain possible |

**Important:** real engine `stop reason` and `viewer cursor status` appear in different labeled fields. E.g. `Run: Completed · Viewing t=300 of t=600 · Playback: Paused`.

---

## 15. Non-PNG pages: art direction and interaction specifics

### 15.1 Landing / entry

- Use same charcoal/silver atmosphere, same brand mark, single sculptural *engine-backed example* (if animation is present), extreme typographic restraint and one main action.
- Hero text: **“Make complex systems understandable.”** Supporting line: *“Simulate failures. Discover bugs. Understand why.”*
- CTA **Launch FaultLab**; smaller **Try split-brain example**; gentle **What is a distributed system?** link.
- Below first viewport, short four-stage explainer: `Configure → Run → Discover → Replay`, using actual existing behavior (no fake GUI screenshots or promised working integrations).
- A minimal 'Built for learning and engineering' section and link to methodology / open-source repo when published.
- This page may use short choreographed scroll reveals (Motion/GSAP selectively), but **do not import a scroll-animation dependency into the simulation workbench** solely for the marketing page.

### 15.2 Preset gallery

- Distinct, restrained laboratory cards rather than colorful business thumbnails.
- Each item shows protocol, number of nodes, fault schedule, expected result, estimated runtime bounds and lesson, all generated from real preset metadata.
- Samples: healthy network, node crash/recovery, network partition/heal, naive leader split-brain, epoch reuse edge case, Raft safety examples **only after CP4**.
- Search/filter by protocol, fault type and difficulty. `Open setup` / `Run preset` explicit.
- Clear `Educationally unsafe example` label and why the counterexample exists.

### 15.3 Experiment details / save / import / export

- Metadata presented as a deliberate technical artifact: seed, protocol/invariant IDs and versions, engine version, input hash/fingerprint, fault list, bounds, trace length and integrity status.
- Small high-contrast copy icons; download JSON as explicit action with file size estimate.
- Import uses actual schema/version validation and rejects embedded code; present readable incompatibility reasons, not an unexplained `Invalid file`.
- Saving locally is opt-in/explicit unless the user approves autosave; private history must be deletable.

### 15.4 Learn and Docs

- Design as editorial technical documentation: generous prose width, Geist heading, Geist Mono code/trace examples, simple clear diagrams and floating ToC if appropriate.
- Concepts: virtual clocks, seeded PRNG, event queues, node lifecycle, crash persistence, faults, invariant properties, safety vs. liveness, determinism, counterexample shrinking, snapshots, consensus and Raft.
- Place **Run this experiment** beside a lesson when a verified preset exists, deep-linking into Configure or a read-only run, rather than a nonfunctional embedded animation.
- Add controls/reference docs, troubleshooting, keyboard shortcuts, glossary and limitations/trust assumptions.

### 15.5 Compare (after CP4, feature gated)

- Side-by-side runs with precise identity, run inputs, outcomes and separate trace indices; do not pretend naive election and Raft are semantically identical.
- Align by virtual tick or selected major fault with explicit policy, not arbitrary 'matching events' with no proof.
- Provide summary `unsafe protocol violated invariant` vs. `Raft run did not violate checked invariant`, with no universal guarantee beyond experiment scope.
- Visual treatment: same sphere materials, paired smaller topology stages, one shared comparison rail and clearly separated status labels.

### 15.6 Error / About / Accessibility / Help

- Same typography and materials, simpler composition, one obvious recovery action.
- An error page should never imply a distributed protocol failure if the actual problem is network asset loading, WebGL, local storage or worker timeout.
- Offer a dedicated **How to read this lab** explanation / short onboarding of replay, trace vs. engine execution and fault evidence. Keep it dismissible and non-blocking for experienced users.

---

## 16. Performance budgets and profiling plan

Visual fidelity is important, but FaultLab's main audience may have large traces, high-DPI laptops and multiple open applications.

- **Responsiveness target:** visibly smooth ~60 FPS during typical 4-node replay on an ordinary modern laptop; graceful 30 FPS path on low-power devices. These are **targets to measure**, not claims of achieved performance.
- Render panels, labels, tables and popovers in regular DOM. Avoid rendering text in WebGL.
- Animation loop: read a stable immutable current display frame, interpolate packet positions in a visual presenter; no React render for every individual pixel/packet frame. Use `requestAnimationFrame` with cleanup and no duplicate loops.
- Seek target: responsive perceived response on typical 10k–100k trace; benchmark actual `TraceIndex` lookups once available. Hard stop on unexpectedly large work / provide progress.
- Event log: virtualization and grouped rendering at high volumes; do not create 100,000 `<tr>` nodes.
- Keep initial bundle lean via route-level dynamic imports and lazy optional WebGL. Loading the Docs page should not initialize Three.js; viewing pure log data shouldn't require shaders.
- Bound React subscriptions to relevant slices (selection, cursor, run status); avoid rerendering entire shell on every timeline tick.
- Use stable scene objects and update positions/material uniforms without recreating mesh geometry per frame.
- Benchmark on reference desktop, integrated GPU laptop and simulated mid-tier phone. Record CPU, memory, GPU time, WebGL contexts, long tasks, screenshot stability and time to first interactive run.
- Continue preserving engine PERF-1/PERF-2 separately; UI optimizations must not change engine invariants or trace truth.

### Performance quality gate

A pretty design that makes node selection lag, loses playback synchronization, blocks the page or hangs on long traces is not acceptable. Fall back to a simpler rendering tier when necessary, with simulation and debugging functionality unchanged.

---

## 17. Tests and acceptance checklist

### 17.1 Visual acceptance (actual references)

- [ ] Configure, Simulate and Investigate compositions closely match their respective **approved PNG** at reference viewport.
- [ ] Material character matches: dark graphite spheres, restrained silver rim, blue focus, smoked glass, thin grid and orbits.
- [ ] Panel placement, typography hierarchy, whitespace and CTA treatment retain the intended proportions.
- [ ] Strong atmospheric look does not reduce critical labels below readable contrast.
- [ ] Five important visual states are captured: configured; healthy complete; crash; partition; split-brain violation; plus focused node inspector.
- [ ] `Trace locked`, `No violations detected`, `Run completed` and all other labels are true of the actual state.
- [ ] At least one human visual comparison per screen and per key responsive size, including color/status consistency.

### 17.2 Functional acceptance

- [ ] First user can understand where to begin and open a preset in ≤2–3 obvious actions.
- [ ] Configure uses real protocol options, validated inputs and supported invariants.
- [ ] A configured fault plan creates real engine faults; timeline preview never shows faults absent from configuration.
- [ ] Healthy preset executes and replays deterministically.
- [ ] N2 crash/recovery and one network partition/heal scenario reproduce actual trace statuses (CP2.5 reality-check cases).
- [ ] Stored split-brain counterexample produces real invariant evidence and exact event navigation.
- [ ] Switching Configure/Simulate/Investigate preserves run context, node selection where relevant and timeline position.
- [ ] Individual trace entries and simulation-step boundaries work distinctly and are labeled clearly.
- [ ] Timeline controls and markers remain reachable without scrolling out of view (UX-002).
- [ ] Initial 'not started' frame is clear and offers honest initialization navigation (UX-001).
- [ ] Right inspector shows actual read-only protocol data and state provenance; absent data is not fabricated.
- [ ] Event log supports useful filters, grouping and selected row → canvas/timeline navigation.
- [ ] Causal links lead only to recorded or validly derived trace relationships.
- [ ] Import/export validates compatibility and errors; no stale/untrusted data leaks into view.
- [ ] Browser reload / back navigation behave consistently for locally stored runs.
- [ ] Graph selection and playback always agree on virtual time and trace entry.

### 17.3 Accessibility and quality acceptance

- [ ] Full core user journey works with keyboard only, without relying on hover.
- [ ] Screen reader can get node statuses, experiment result, fault events and violation evidence via semantic alternatives.
- [ ] Focus order and focus retention work across route transitions, drawers and popovers.
- [ ] Reduced motion disables parallax/hero morph and unnecessary animated lighting but preserves truthful visual states.
- [ ] Semantics don't depend on red/blue alone; required contrast reviewed.
- [ ] Phone/tablet have accessible setup, graph, timeline and inspector without horizontal clipping.
- [ ] Main-thread long tasks bounded / worker execution where supported; WebGL fallback functional.
- [ ] Vitest/Playwright tests include invalid config, duplicate run, early crash, same-tick events, end-of-trace, backward seek and rapid mode switching.
- [ ] Browser tests verify no uncaught errors, stable engine traces/fingerprints and same run outcomes across viewer modes.
- [ ] No unnecessary external API keys, subscriptions or analytics trackers required for V1.

### 17.4 Suggested automated browser scenarios

1. Open app → choose healthy preset → run → replay → verify `No violations detected in this run` and actual engine metadata.
2. Choose crash/partition preset → navigate to exact crash entry → select node → verify `crashed` and dropped-message evidence → move to recovery entry → verify incarnation and storage timing.
3. Open split-brain fixture → `Jump to violation` → highlight relevant nodes → `Inspect violation` → `View event` → causal links point to correct trace IDs.
4. Re-execute same seed/config/version → compare trace fingerprints/bytes → ensure UI visual mode did not affect them.
5. Step single trace entry vs. whole simulation step across recovery storage-write boundary → inspect state at both positions; no premature storage updates.
6. Start with keyboard only → configure valid run → seek/select node → return to topology, with visible focus throughout.
7. Toggle reduced motion → transitions become immediate; status data unchanged.
8. Disable WebGL / test WebGL context loss → 2D fallback remains usable, app doesn't crash.
9. Resize desktop → tablet → mobile while paused and playing → node selection and exact cursor survive.
10. Attempt incompatible/corrupt/oversized import → clear error, no crash, no executable content invoked.

---

## 18. Implementation phases: what Claude should do, and when

**Do not start these visual implementation phases until the agreed engine roadmap allows them.** The historical context is: CP0, CP1, CP2 and CP2.5 were completed; CP3 was approved for snapshots/TraceIndex, and CP4 plans Raft. Verify actual repository state each time — this document is not proof that later checkpoints are finished. The source-of-truth is `docs/ROADMAP.md` and code/tests.

### UI0 — Audit and specification (no final UI implementation)

1. Inspect reference ZIP image by image, open exact sizes, classify each mode, sample tokens; note uncertainties.
2. Audit engine exports, TraceIndex status, worker plan, existing demo and browser tests.
3. Translate document into a machine-checkable `UI_REQUIREMENTS.md` task table and ADRs; don't overwrite useful previous requirements.
4. Create route map, mode transition diagram, data ownership diagram, mobile wireframes and experiment-state matrix.
5. Identify design contradictions or unsupported example labels. Present decisions and get approval.

**Exit:** documented component map and fidelity constraints; no speculative implementation of unavailable protocol features.

### UI1 — Design system and accessible skeleton

1. React/Vite app isolated in `apps/web`; define global tokens, fonts, panels, button/dial/slider/toggle, focus treatment, modal and tooltip primitives.
2. Build shell and route boundaries + Configure/Simulate/Investigate panel layout with fixture *layout data clearly flagged as mock design content* while engine integration is pending.
3. Make timeline dock viewport-visible, responsive modes, keyboard access and reduced motion.
4. Verify screenshots match reference geometry with **no 3D engine yet**.

**Exit:** clickable structure, no deceptive fake simulation results, responsive baseline.

### UI2 — Real engine and trace integration

1. Integrate controller/worker and strict run/config adapters without changing deterministic engine semantics.
2. Use TraceIndex for timeline, event log, inspector, status and provenance. Maintain exact step/entry mapping.
3. Connect every Configure control to real validated config and every Simulate/Investigate field to actual trace output.
4. Complete CP2.5 manual scenarios with more sophisticated interaction and tests.

**Exit:** fully functional and truthful **2D/SVG** app before visual effects.

### UI3 — Sculptural materials and 3D rendering spike

1. Create one standalone detailed sphere scene that closely matches reference at fixed viewport; benchmark WebGL vs. CSS/SVG.
2. Test blur/glass material, rim, normal details, glow, selected/fault statuses, 4→20 node scale, keyboard/touch hit regions and mobile fallback.
3. Decide and document final rendering stack. Do not commit to R3F merely because it is fashionable.
4. Integrate shared graph-space/projected coordinates and accurate message effects.

**Exit:** technical demo proving screenshot visual quality **and** stable perf/correctness.

### UI4 — Three modes, choreography and rich debugging

1. Reproduce approved Configure, Simulate and Investigate designs at full fidelity.
2. Implement shared-element node focus morph, selected node rail, precise UI transition, persistent timeline, log drawer and read-only inspector.
3. Implement event/status micro-motion from matrix, reduced-motion instant path and no faux packets.
4. Add violation evidence focus and causal exploration.

**Exit:** reference screens visually convincing and all primary flows functional.

### UI5 — Missing pages, education, exports and polish

1. Landing/entry, Lab/presets gallery, Preset details, Docs/Help, Settings, error states.
2. Export/import validated versioned runs; local save/history where approved.
3. Optional Compare mode once Raft is ready; make unsupported features explicitly unavailable.
4. Full mobile/tablet refinements, accessibility manual checks, perf audit, cross-browser tests.
5. Onboarding and accurate product explanations. Update documentation and Dutch `ENGINEERLOG.md`.

**Exit:** cohesive public V1, not just three impressive PNG recreations.

**At every phase:** run relevant tests; record visual comparison screenshots; summarize decisions, tradeoffs and limitations; request review at checkpoint boundary. Do not auto-push or auto-deploy without approval.

---

## 19. How to brief and evaluate Claude Code

### Instructions to place with this document and reference ZIP

```md
You are implementing the FaultLab UI from three approved PNG designs.
Read FAULTLAB_UI_IMPLEMENTATION_SPEC.md in full first.
Inspect each PNG at full resolution and identify Configure, Simulate, Investigate.

The PNGs determine the visual target. The spec defines real behavior,
missing pages, interactions, responsive layouts, performance and tests.

Do not redesign. Do not invent simulation data. Do not begin by generating
a single huge React component. Do not modify the deterministic engine
for a cosmetic effect. Check the actual ROADMAP before working on UI phases.

FIRST ACTIONS:
1. Audit the current repo and identify available engine/TraceIndex/worker APIs.
2. Produce a concise implementation plan mapped to UI0–UI5, and note
   unsupported/missing functionality, conflicts and dependencies.
3. Produce a component tree, route map, dataflow and technical rendering spike plan.
4. List any reference/image details you cannot infer (don't guess them).
5. Get approval before implementing the final interface.

WHEN AUTHORIZED TO BUILD:
- Implement in small, testable milestones.
- Match reference frames by visual comparison at the same viewport.
- Keep the UI truthful to engine output at all times.
- Preserve the original CP2.5 demo until the replacement is verified.
- Maintain ENGINEERLOG.md in Dutch with key technical learning.
- Stop and report tests, screenshots, perf and open issues at each checkpoint.
```

### Design review checklist for every screenshot

1. Does it still look unmistakably like the approved FaultLab reference?
2. Can a first-time user identify **current result, current virtual time and current mode**?
3. Is there a clear next action from Configure, Simulate or Investigate?
4. Can the user reach the event log and the evidence behind any violation?
5. Are all visual states real, validated and sourced from the selected engine trace?
6. Are hover animations optional enhancements with accessible alternatives?
7. Is every visible effect smooth without causing misleading message timing?
8. Does it work at laptop viewport and reduced motion, not just 1536×1024?
9. Is the UI still responsive with larger traces and more nodes?
10. Is the work checkpointed, documented, tested and understandable?

---

## 20. Definition of done for the entire FaultLab visual product

The project is **not visually complete** merely because the three screenshots have been recreated. It is complete enough for a public V1 when a new user can:

1. Arrive at a coherent branded entry and understand what FaultLab does.
2. Open a preset or configure a supported experiment using fully labeled, accessible controls.
3. Run the real deterministic engine and understand whether the run is executing or they are watching a replay.
4. See a readable network whose **actual** node states, messages, faults and outcomes match its trace.
5. Find the first violation, see expected vs. observed evidence and inspect affected nodes.
6. Use a persistent timeline with step, seek, markers and reliable provenance, even on a laptop.
7. Switch between Configure, Simulate and Investigate without losing important context.
8. Inspect real volatile/persistent state, timers and causal references without editable/fabricated values.
9. Reproduce a failure deterministically using captured configuration, seed and component versions.
10. Use the product with keyboard and reduced motion, and on phone/tablet with a considered layout.
11. Open the docs/help, find a sample experiment, recover from errors and export/import supported runs.
12. Experience the intended sculptural, cinematic, technically precise FaultLab visual identity at acceptable performance.

**Success condition:** an expert sees a genuine reproducible distributed-systems debugging tool; a newcomer understands what happened; a designer sees the approved original art direction preserved. All three must be true.

---

## 21. Open decisions for the implementation review

Claude should resolve these **with evidence** and get approval if a choice affects fidelity or scope:

- Exact route paths and whether landing/docs share the same bundle as the workbench.
- Which reference-derived tokens are sampled (rather than using approximate values above).
- CSS/SVG vs. Three.js for sphere visuals; one WebGL canvas vs. none; mobile fallback.
- Whether a true shared-element morph is possible without losing camera/DOM alignment; acceptable FLIP fallback.
- Layout logic for >6 nodes and collision avoidance / label occlusion.
- How to represent asymmetric links, bursts of dropped messages and same-tick event density.
- Which invariant cards reflect each protocol's **actual** supported checks.
- Exact status wording and available node-state field names from engine schemas.
- What data can be saved locally under current trace/snapshot version formats and quotas.
- Which P1/P2 pages are approved for the first public launch; never quietly mark optional features as complete.
- Whether the repo is ready for UI work per current `ROADMAP.md` and which backend/sandbox capabilities **actually exist**.

**Final engineering principle:** render what the engine can prove; design everything else to make that truth easier to understand.
