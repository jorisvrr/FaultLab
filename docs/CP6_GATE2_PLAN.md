# CP6 Gate 2 — Design system implementation plan

For approval. Gate 2 builds the component system that Configure (Gate 3), Simulate (Gate 4) and Investigate (Gate 5) are assembled from. **No dashboard is reconstructed in this gate.**

Inputs: the three approved PNGs (visual source of truth), [FAULTLAB_UI_IMPLEMENTATION_SPEC.md](FAULTLAB_UI_IMPLEMENTATION_SPEC.md) (behaviour and everything the images cannot show), [CP6_DESIGN_AUDIT.md](CP6_DESIGN_AUDIT.md) (measured geometry, colour and typography), the CP5 React application, and the approved Gate 1 node renderer.

---

## 1. Component inventory

Grouped by the gate that first needs each component. Gate 2 builds everything in the first two groups and the primitives the later ones depend on; it does **not** compose them into dashboards.

**Shell and chrome (Gate 2 builds and uses)**

| Component | Notes |
|---|---|
| `AppShell` | Header + main + docked bar, `100dvh`, overlay layers (ADR-0025 stage sits between background and panels) |
| `Header` | Guide line at y ≈ 57, branding slot, mode navigation, status cluster at the right |
| `BrandMark` | **Placeholder only** — see §8 |
| `StatusPill` | The top-right cluster. Needs decision **Q11** before it ships (see §14) |
| `Panel` | Glass and matte variants, hairline border, inner top-left highlight, corner radius 15 px, optional title row with sphere icon |
| `Card` | Nested panel, radius 12 px, used for setting rows, invariant cards, inspector groups |
| `Backdrop` | Static void gradient, ultra-thin structural grid, decorative orbit arcs. Passive; never encodes data |

**Controls (Gate 2 builds, gallery only)**

| Component | Reference | Notes |
|---|---|---|
| `Button` primary (CTA) | Configure "Run Experiment" | Pale blue gradient, dark disc, mono label; hover sheen, press, busy, disabled |
| `Button` secondary / `IconButton` | Transport, rail prev/next | Rounded square, metallic edge |
| `TransportButton` | Replay dock | Play is a disc with a blue ring |
| `Select` | Protocol, experiment, invariant policy | Chevron, mono or sans value per audit §2 |
| `NumberField` | Seed (decision Q3), node count, limits | Integer only, copy + regenerate affordances |
| `RangeSlider` (single and dual-thumb) | Latency 1–10 | Dashed track, blue thumbs |
| `Switch` | Invariant on/off, fault injection | Pill, knob left/right |
| `SegmentedControl` | Entries vs markers, future filters | |
| `Chip` / `StatusDot` | "Trace locked", "Trace derived", status chips (**Q10**) | |
| `ValueCell` | Inspector rows | Read-only, copyable, lock icon, provenance dot (**Q13**) |
| `FactTable` | Trace context facts | Mono keys cool grey, values white |
| `Tooltip` | | Keyboard reachable, Esc dismisses |
| `Dialog` / `Drawer` | Shortcuts, preferences, event log | Focus trap, Esc, restore focus |
| `Timeline` primitives | Axis, ticks, markers, selection, docked dock | Geometry only; playback logic is Gate 4 |
| `Dial` / knob | **Not planned.** No reference shows one; I will not add one for its own sake | |

**Later gates (Gate 2 only guarantees the primitives exist)**: invariant card, fault schedule editor, node rail, hero node card, message lanes, event log, violation focus, run details sheet.

## 2. Design token architecture

Three layers, so that a change of palette never requires touching components:

1. **Reference tokens** — raw measured values, named by what they are: `--fl-ref-graphite-900: #0b0d0f`. Sourced from audit §1, re-sampled during implementation per spec §4.4.
2. **Semantic tokens** — named by role: `--fl-surface-panel`, `--fl-text-muted`, `--fl-accent-focus`, `--fl-state-fault`, `--fl-state-violation`. Components use **only** these.
3. **Component tokens** — only where a component genuinely deviates: `--fl-cta-fill`.

Delivery: one `tokens.css` with `:root`, imported once. No CSS-in-JS, no theme provider, no runtime cost. A `tokens.ts` mirror is generated only if the stage or a canvas needs the same values in JS; the generator asserts the two agree (unit test), so they cannot drift.

Dark is the only theme. `color-scheme: dark` is declared; a light theme is explicitly out of scope and the token layer is what would make it possible later.

## 3. Typography system

Geist and Geist Mono, self-hosted via `@fontsource-variable/*` — already a dependency of the CP2.5 demo, so no new third party and no font CDN at runtime. Variable fonts, `font-display: swap`, preloaded for the two weights actually used.

| Role | Family | Size (reference) | Use |
|---|---|---|---|
| `--fl-type-display` | Geist | ~22 px | Wordmark, page titles |
| `--fl-type-title` | Geist Mono | ~20 px | Panel titles ("Run setup", "Trace context") |
| `--fl-type-label` | Geist Mono | ~15–16 px | Setting labels, fact keys |
| `--fl-type-value` | Geist Mono | ~15–16 px, tabular | Values, timestamps, node ids, fingerprints, seeds |
| `--fl-type-card` | Geist Mono | ~15 px, uppercase, tracked | Invariant card titles |
| `--fl-type-micro` | Geist Mono | ~11 px, uppercase, tracked | "STATE ORIGIN", captions |
| `--fl-type-body` | Geist | ~14–15 px | Explanations, help text |

Rules: `font-variant-numeric: tabular-nums` on every numeric readout so figures do not jitter while playing; real hierarchy (title > result > object name > label > explanation > micro) rather than uniform contrast; **no text below the legibility floor to match the PNG** (spec §4.3) — where the reference is dimmer than readable, contrast wins and the difference is documented. Responsive scale with `clamp()` between the 390 px and 1586 px viewports.

## 4. Colours and semantic states

From the audit's measurements, with the approved semantics:

| Role | Value | Meaning |
|---|---|---|
| `--fl-void` | `#030405` | Page background |
| `--fl-surface-panel` | `#0b0d0f`–`#0d1010` | Glass panel body |
| `--fl-surface-stage` | `#080909`–`#0b0d0f` | Centre stage |
| `--fl-line-hairline` | `rgb(255 248 240 / 0.12)` | Panel border |
| `--fl-text` / `--fl-text-muted` | `#eaebe9` / `#c4cfd9` | Primary / keys and secondary |
| `--fl-accent-focus` | `#adc8fe` | Selection, focus, interactive |
| `--fl-accent-fill` | `#9cb6eb` → `#d0e0fc` | CTA gradient |
| `--fl-state-fault` | `#f8c781` (amber) | Injected faults, crashes, partitions, dropped messages |
| `--fl-state-recovery` | cool blue | Recovery and healing, distinguished by shape and label too |
| `--fl-state-violation` | red-orange, ≈ `#ef7451` | **Invariant violations, protocol errors, critical errors only** |

The rule that drives this: **a fault is not a bug**. Amber says "something was done to the system"; red-orange says "the system broke a rule". No reference PNG shows a violation, so the red-orange token is defined here and first used in Gates 4–5; the gallery includes a violation specimen so it is reviewed before it ships.

Every pairing is checked against WCAG 2.2 AA (4.5:1 body, 3:1 large text and UI boundaries) as part of the gallery, not afterwards.

## 5. Surfaces and materials

| Surface | Construction |
|---|---|
| Glass panel | Low-opacity fill + 1 px warm-neutral border + inner top-left highlight (inset box-shadow) + very low-frequency grain + restrained corner glow |
| Matte panel | Same geometry, no blur — the fallback over the live stage |
| Metallic control | Deliberate gradient + border + inner highlight, never a full-screen effect |
| Background | Static void gradient, ultra-thin grid, decorative orbit arcs as SVG |
| Node stage | The approved Gate 1 renderer, unchanged |

**`backdrop-filter` policy, decided now rather than discovered later:** blur over a continuously repainting canvas re-blurs every frame. Glass with blur is allowed only over static regions; any panel overlapping the live stage uses the matte variant while a run is streaming. The gallery includes a measured comparison (frame times with and without blur over the stage) so the rule is evidence-based.

## 6. Layout and spacing

8 px rhythm with optical exceptions for hairlines and sphere placement (spec §4.1). Measured from the references: outer margin ≈ 30 px, gutters 16–17 px, header hairline at y ≈ 57, panel radius 15 px, card radius 12 px.

The shell is a CSS grid: `header / main / dock`, `100dvh`, main a three-column `minmax()` grid whose proportions come from the measured panel boxes (audit §2) expressed as fractions, never fixed pixels. Overlay layers are an explicit z-index scale (`background → grid → orbits → links → nodes → panels → tooltips → dialogs → focus`), defined once as tokens.

## 7. Component gallery

A new page `design.html`, built exactly like `node-lab.html`: a separate Vite entry, outside the application, no router needed. It shows every component in every state side by side, plus token swatches, type specimens, surface specimens and contrast results. It is the Gate 2 review artefact and afterwards the place where regressions are caught.

Controls on the page: viewport presets (1586 × 992, 1440 × 900, 1280 × 800, 768 × 1024, 390 × 844), reduced-motion toggle, and a "data density" toggle. All components are rendered with **real or clearly-labelled placeholder data**; nothing invents a simulation result.

## 8. Branding

You are designing the logos. Gate 2 uses a `BrandMark` placeholder: the wordmark set in Geist at the measured size, with the mark slot as an empty box of the reference's dimensions (40–82 × 15–55 px), marked in the gallery as a placeholder. The header reserves that box through a token, so dropping in the final asset is a file swap with **no layout change**. No logo will be generated, drawn or AI-produced.

## 9. Motion rules

Reuses the Gate 1 approach, which is already approved: exponential approach per channel, interruptible by construction, no continuous decorative animation.

| Interaction | Response |
|---|---|
| Hover | ≤ 120 ms, light and border only; no movement |
| Press | ≤ 80 ms, tactile depth |
| Focus | Instant ring; never animated away from the user |
| Panel appearance | ≤ 200 ms, opacity + transform only (compositor-friendly) |
| Dialog / drawer | ≤ 200 ms, with focus moved on open and restored on close |
| Reduced motion | Every duration collapses to 0; state changes are instantaneous, nothing is removed |

No animation library. CSS transitions for chrome; the one JS loop that exists belongs to the stage. **No animation ever owns the playback clock** — that is Gate 4's `PlaybackClock`.

## 10. Responsive behaviour

Desktop-first, as approved, but the five viewports above are part of the gallery's acceptance, not an afterthought. Rules: the three-column grid collapses to two then one; the docked bar never scrolls out of view (UX-002, already tested at 1200 × 600); panels become full-width sheets below 768 px; the stage keeps its aspect and shrinks; **no feature is removed on a small screen** — inspection must stay possible, which is what you asked for in the handoff.

## 11. Accessibility requirements

- WCAG 2.2 AA contrast on every token pairing, verified in the gallery.
- Every control reachable and operable by keyboard, visible `:focus-visible` ring on the token scale, logical tab order, no focus traps outside dialogs.
- Dialogs and drawers: focus moved in, trapped, restored; Esc closes.
- Hit targets ≈ 44 × 44 px where a pointer is expected; visible lettering may be smaller where it stays readable.
- Status never conveyed by colour alone — the Gate 1 state channels already follow this and the chrome must too.
- `prefers-reduced-motion` and `prefers-reduced-transparency` both honoured.
- axe-core run over the gallery in CI as part of Gate 2's acceptance, not deferred to the final gate.

## 12. Performance implications

| Budget | Target | Why it is at risk in this gate |
|---|---|---|
| Blur | 0 blurred surfaces over the live stage | `backdrop-filter` re-blurs per frame (§5) |
| CSS size | Tokens + components ≤ 40 KB gzip | A design system is where CSS quietly doubles |
| Fonts | 2 variable files, preloaded, `swap` | Font loading is the most visible first-paint cost |
| Re-renders | Still ≤ 1 React commit per frame | Gate 2 must not introduce context providers that re-render the tree per frame |
| Shell JS | ≤ 250 KB gzip excluding the lazy 3D chunk | New dependencies (§13) |

Measured in the gallery and re-measured in Gate 4 under a live run.

## 13. Dependencies — recommendation

**Add nothing in Gate 2** beyond the two fonts, which are already in the repo for the demo. Specifically:

- **CSS Modules** — built into Vite, no dependency. Recommended over a global stylesheet for component scoping.
- **No component library.** The references' controls are too specific; adapting a library would cost more than writing them.
- **Radix / React Aria** — *deferred, not rejected.* The dialog and drawer primitives (focus trap, restore, Esc, scroll lock, `inert`) are the one place where hand-written code reliably gets accessibility wrong. My recommendation: write them by hand in Gate 2, test them with axe and by keyboard, and adopt `@radix-ui/react-dialog` only if that testing finds problems I cannot fix cheaply. I will bring the evidence either way rather than deciding silently.
- **Router** — still not needed in Gate 2; reassess in Gate 6 with the supporting pages, as you directed.

## 14. Open decisions that Gate 2 must close

These three were left open at Gate 0 and the header and gallery need them. I will bring each with its quoted proposal, what it communicates, its real data source, its interactions and its visual states, **before** building it:

- **Q11 — the five-dot pill** (header, Gate 2 scope: blocks `StatusPill`).
- **Q10 — the three status chips** (Simulate, Gate 4: can be decided in Gate 2 or deferred).
- **Q13 — the inspector's blue dots** (Investigate, Gate 5: same).

If any of them turns out to have no honest meaning, it stays decorative and is built so it cannot be mistaken for a control.

## 15. Testing strategy

| Layer | What it proves |
|---|---|
| Token unit tests | Semantic tokens resolve; the JS mirror equals the CSS (no drift); every documented pairing meets its contrast ratio |
| Gallery browser tests | Every component renders in every state in Chromium, Firefox and WebKit; no console errors |
| Accessibility | axe-core clean over the gallery; keyboard walk-through test (tab order, focus visible, Esc, focus restore) |
| Visual comparison | Gallery screenshots at the five viewports; side-by-side against the reference crops for components that appear in the PNGs; human review, as agreed, because pixel diffing WebGL and grain is not meaningful |
| Regression | All CP0–CP5 and Gate 1 tests keep passing unchanged; the existing unstyled dashboards keep working throughout Gate 2 |
| Performance | CSS size, font loading, blur policy measured; React commit count unchanged |

No golden value, fixture or fingerprint is regenerated.

## 16. Implementation order

1. **Tokens and type.** `tokens.css`, fonts, the type scale, contrast verification. Gallery skeleton.
2. **Surfaces.** Panel, card, backdrop, grid, orbits; the blur measurement and the resulting policy.
3. **Shell.** AppShell, header, navigation, brand placeholder, docked bar geometry. Q11 decided here.
4. **Controls, part 1.** Button family, icon button, select, switch, number field, slider.
5. **Controls, part 2.** Chips, value cells, fact table, tooltip, segmented control.
6. **Overlays.** Dialog and drawer foundations, focus management, the Radix decision with evidence.
7. **Timeline primitives.** Axis, ticks, markers, selection — geometry only.
8. **Motion and polish.** Transition tokens, reduced-motion pass, focus ring consistency.
9. **Verification.** Full gallery screenshots, axe, five viewports, three engines, performance, regression.

## 17. Integration with the existing React shell — recommendation

The design system is **additive**. Nothing below `apps/web` changes, and inside it `Session`, `TraceStore`, `TraceIndex` and the Worker client are untouched.

- New: `src/design/` (tokens, primitives, each with a CSS Module) and `design.html` + `src/design/gallery.tsx`.
- `src/styles.css` stays until Gates 3–5 replace each view; the CP5 dashboards keep working the whole time, so the application is never in a broken state between gates.
- The existing structural components (`PlaybackBar`, `NodeTable`, `EntryDetail`, `WindowedList`, `LifecycleBadge`) keep their behaviour and get restyled in their gates; `WindowedList` in particular stays exactly as it is, because the Investigate fix depends on it.
- The Gate 1 stage is consumed, not modified: `Stage` already takes node sprites and draws them, and the design system supplies the panels around it.
- Data flow is unchanged: components receive props; only the view layer gains tokens and CSS Modules.

## 18. Review and acceptance criteria

Gate 2 is complete when:

1. Every component in §1's first two groups exists in the gallery, in every state, in three engines.
2. Tokens are measured from the references, documented, and used exclusively through the semantic layer.
3. Contrast meets WCAG 2.2 AA everywhere, and axe-core is clean over the gallery.
4. Keyboard operation and focus management are demonstrated, including dialogs.
5. The five viewports render without horizontal scroll or clipped controls.
6. Reduced motion and reduced transparency are honoured.
7. The blur policy is backed by a measurement.
8. The brand placeholder can be replaced without layout change.
9. All CP0–CP5 and Gate 1 tests still pass; no golden value regenerated.
10. Side-by-side comparisons against the reference crops exist for every component visible in the PNGs, with remaining differences documented and justified.
11. Q11 is decided and recorded; Q10 and Q13 are decided or explicitly deferred with a date.
12. No new dependency beyond the fonts, or a measured justification for each one.

Then I stop for your review before Gate 3.
