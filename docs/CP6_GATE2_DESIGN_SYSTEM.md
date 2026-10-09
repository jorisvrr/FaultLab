# CP6 Gate 2 — design system and component gallery

For review. Gate 2 builds the reusable visual system that Configure (Gate 3), Simulate (Gate 4) and Investigate (Gate 5) will be assembled from. **No dashboard was rebuilt**; the CP5 functional views still work exactly as before.

Plan: [CP6_GATE2_PLAN.md](CP6_GATE2_PLAN.md). Measurements: [CP6_DESIGN_AUDIT.md](CP6_DESIGN_AUDIT.md) §1. Behaviour: [FAULTLAB_UI_IMPLEMENTATION_SPEC.md](FAULTLAB_UI_IMPLEMENTATION_SPEC.md). The three approved PNGs remain the visual source of truth.

**Gallery:** `design.html` (development only, a separate Vite entry, never part of the simulation workflow). Every value it shows is a demonstration value and is labelled as such on the page.

---

## 1 · Design tokens

Three layers, so a palette change never reaches a component:

| Layer | Prefix | Rule |
|---|---|---|
| Reference | `--ref-*` | Raw values measured from the PNGs, named for what they are. **Never used by a component.** |
| Semantic | `--color-*`, `--space-*`, `--type-*`, `--motion-*`, `--z-*`, `--shadow-*`, `--radius-*`, `--focus-*` | Named for the role. The only layer components may use. |
| Component | local | Only where a component genuinely deviates (`--_disc` on the CTA). |

Delivered as one `tokens.css`; no CSS-in-JS, no theme provider, no runtime cost. `tokens.ts` documents the semantic names and the gallery renders it.

**Three unit tests keep the two honest** (`test/tokens.test.ts`): every documented token is declared, every declared semantic token is documented, and **no component stylesheet reaches past the semantic layer into `--ref-*`**. Documentation and stylesheet cannot drift apart quietly.

Palette (unchanged from the approved hierarchy, values measured):

| Role | Value | Meaning |
|---|---|---|
| `--color-void` → `--color-surface-control` | `#030405` → `#15181a` | Charcoal/graphite ramp: void, stage, panel, card, control |
| `--color-text` / `-muted` / `-subtle` | `#eaebe9` / `#c4cfd9` / `#8b949e` | Warm near-white; keys and secondary are faintly cool |
| `--color-border` / `-lit` | `rgb(255 248 240 / 0.12)` / `/ 0.3` | Hairline, and the **lit top edge** |
| `--color-accent` | `#adc8fe` | Selection, focus, interactive |
| `--color-state-fault` | `#f8c781` amber | Injected faults: crash, partition, dropped message |
| `--color-state-recovery` | cool blue | Recovery and healing |
| `--color-state-violation` | `#ef7451` red-orange | **Invariant violations, protocol errors, critical errors only** |

A fault is not a bug: amber says *something was done to the system*, red-orange says *the system broke a rule*. A unit test asserts the two hues stay more than 15° apart so they cannot become confusable, and **no status is carried by colour alone** — every tone has its own glyph (check, triangle, crossed circle) and the text says what it means.

## 2 · Typography

Geist and Geist Mono, self-hosted via `@fontsource-variable/*` (already in the repo for the CP2.5 demo; no font CDN at runtime). A browser test asserts both families actually loaded, because a silent fallback would change every measurement below.

| Token | Family | Size (reference) | Use |
|---|---|---|---|
| `--type-display-size` | Geist | ~22 px | Wordmark, page titles |
| `--type-title-size` | Geist Mono | ~20 px | Panel titles |
| `--type-label-size` | Geist Mono | ~15–16 px | Labels, fact keys |
| `--type-value-size` | Geist Mono | ~15–16 px, tabular | Values, timestamps, node ids, seeds, fingerprints |
| `--type-card-size` | Geist Mono | ~15 px, uppercase, tracked | Card titles, chips |
| `--type-body-size` | Geist | ~14–15 px | Prose and explanations |
| `--type-micro-size` | Geist Mono | ~11 px, uppercase, tracked | Micro labels ("STATE ORIGIN") |

Every size uses `clamp()` between the 390 px and 1586 px viewports. Numeric readouts are `tabular-nums`, so figures do not jitter during playback. Not everything is monospaced: prose, navigation and the wordmark are Geist.

## 3 · Surfaces and materials

| Surface | Construction |
|---|---|
| Glass panel | `rgb(11 13 15 / 0.72)` + `backdrop-filter: blur(20px)`, hairline border, lit top edge, faint top lift |
| Matte panel | Opaque `#0b0d0f`, **identical geometry, border, highlight and gradient** |
| Card | Nested surface, 12 px radius, no outer shadow |
| Metallic control | Deliberate gradient + border + inner highlight |
| Backdrop | Static void gradient, ultra-thin structural grid (96 px), decorative orbit arcs — passive, never encoding data |

The panel's edge is asymmetric, as measured: the **top** edge is lit (`#59554f` over `#0b0d0f`) while the sides and bottom are dim (`#1c1c1d`…`#2d2e2e`). That asymmetry is what makes a panel read as a physical surface rather than a rectangle, so it is a token (`--shadow-inset-panel`), not a detail.

### The blur rule, with the measurement

`backdrop-filter` samples and blurs what is behind it; over a canvas that repaints every frame, that work repeats every frame. `e2e/surface-cost.spec.ts` puts a panel over the Gate 1 node stage, forces continuous rendering and alternates the two materials three times each:

| Engine | matte p50 / p95 | glass p50 / p95 |
|---|---|---|
| Chromium | 16.7 / 17.3 ms | 16.7 / 17.1 ms |
| Firefox | **8 / 10 ms** | **13 / 15 ms** |
| WebKit | 17 / 18 ms | 17 / 18 ms |

**Stated honestly:** frame-to-frame time is capped by the display's refresh. On this machine Chromium and WebKit sit at ~17 ms (60 Hz) in both conditions, so the extra work fits inside the frame and the measurement cannot see it. Firefox runs at 120 Hz here and shows it plainly: **+62 % frame time**. So the result proves the cost is real and bounded; it does not prove it is absent on the two engines that were vsync-limited. The rule stands on that measurement plus the architectural fact, and `prefers-reduced-transparency` already forces matte everywhere.

**Rule:** any panel overlapping the live stage uses `material="matte"`. The gallery shows the two side by side over a patterned strip, so the difference is visible rather than asserted.

## 4 · Components

All built; all in the gallery in every state. Every one wraps a **native element**, so form association, validation, keyboard behaviour and assistive-technology semantics come from the browser rather than being re-implemented.

| Group | Components |
|---|---|
| Surfaces | `Panel` (glass/matte), `Card`, `Divider`, `Backdrop` |
| Actions | `Button` (primary/secondary/ghost, md/lg, busy, disabled), `IconButton`, transport button, `Spinner` |
| Forms | `SelectField`, `NumberField` (with affix slot), `RangeField`, `DualRangeField`, `Switch`, `Segmented` |
| Status | `Chip` (5 tones), `StatusDot`, `ValueRow`, `FactTable`, `EmptyState`, `Legend`, `DecorativeMotif` |
| Overlays | `Tooltip`, `Dialog` (modal / side drawer / bottom drawer) |
| Shell | `AppShell`, `Header`, `BrandMark`, `Tabs` + `TabPanel` |
| Timeline | `Timeline` (axis, ticks, markers, playhead, scrub) — geometry only |

**Not built, deliberately:** knobs and dials. No reference shows one, and a control with no demonstrated need is decoration pretending to be an instrument.

`Button size="lg"` is the Configure CTA's measured size (97 px tall, 46 px disc) — a real size in the system, not a one-off override in a dashboard.

## 4a · Final checks (post-review)

**The motif read as progress, and now does not.** The reference pairs a grey dot at one end with a glowing blue one at the other, which reads as "step 5 of 5" or a range — exactly the meaning Q11 forbids. The figure is now **symmetric**: two identical neutral ends around three hollow rings, inside the same pill, and **the accent blue is gone** (blue is this system's selection and interaction colour, which is what made one dot look active). A symmetric figure cannot be read as a sequence. Size, spacing and the large–small–small–small–large rhythm are unchanged; see `references/cp6/compare/ds-motif.png`.

**Open overlay states, captured and inspected.** `references/cp6/gallery/overlay-{dialog,side-drawer,bottom-drawer}-{desktop,phone}.png`, now part of the test suite. Capturing them found two real defects:

1. **The first captures showed an undimmed backdrop and a see-through panel** — the screenshots were taken mid-entrance. The test now awaits every running animation and additionally asserts `:modal`, so a dialog that merely opened (rather than opening modally) would fail.
2. **The side drawer's footer floated in the middle** of the full-height panel. Fixed by making the dialog a flex column with a growing content area — and, in doing so, a second bug: a bare `display: flex` on `<dialog>` **overrides the UA's `display: none` and leaves a closed dialog on screen**. The rule is now scoped to `[open]`, which the existing Esc test caught immediately.

Verified at 1586 × 992 and 390 × 844: the backdrop dims and blurs, the panel is opaque with the system's lighting, spacing and typography are the shared tokens, the close control is named and shows its focus ring, the body scrolls while head and footer stay, and no overlay exceeds the viewport in either dimension.

**Mobile at 390 px, complete gallery.** `references/cp6/gallery/responsive-phone.png` (full page). No horizontal overflow, labels and values legible, no interactive control under 24 px, panels stack, the bottom drawer is comfortable. One real defect found: **the header's navigation clipped**, putting "Investigate" out of reach. The modes now scroll inside the header, and the responsive test asserts every mode stays reachable at every viewport.

## 5 · Q11 — the five-dot motif

Implemented as **decoration**, exactly as approved, and restyled after review so it cannot read as progress (§4a). `DecorativeMotif` is `aria-hidden`, has no tab stop, no pointer cursor and no hover or active response, so it reads as a control to neither a sighted nor an assistive-technology user. It is not a node count, an invariant counter, a loading state, a progress indicator or a health light, and the component's own documentation says so, so nobody can quietly give it a meaning later. Q10 and Q13 stay open for Gates 4 and 5; the slots they need (status chips, a provenance marker in `ValueRow`) exist.

## 6 · Branding

`BrandMark` renders the temporary text **FaultLab** beside a reserved box sized by `--brand-mark-width/height` (42 × 40 px, from the reference). The placeholder inside is a neutral bead marked `data-placeholder`. Dropping in your final asset is a file swap: the box, and therefore the layout, does not change. No logo was generated, drawn or redesigned.

## 7 · Motion

| Interaction | Response |
|---|---|
| Hover | 120 ms, light and border only — nothing moves |
| Press | 80 ms, inset depth |
| Focus | Instant ring |
| Toggle | 120 ms knob travel |
| Tooltip | 120 ms opacity **and visibility** |
| Dialog / drawer | 200 ms, opacity + transform only (compositor-friendly) |

No animation library. Under `prefers-reduced-motion` all three duration tokens become 0 and the spinner stops rotating while staying visible as a ring — the state is still conveyed, it just does not move. A browser test asserts both.

## 8 · Accessibility results

`axe-core` with `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice` over the whole gallery:

| Engine | Violations | Passes |
|---|---|---|
| Chromium | **0** | 43 rules |
| Firefox | **0** | 43 rules |
| WebKit | **0** | 43 rules |

`color-contrast` is reported as *incomplete* (not failing): axe cannot compute a ratio through a `backdrop-filter`. That gap is covered deterministically by the token unit test, which computes every documented pairing:

| Pairing | Measured | Required |
|---|---|---|
| text on panel | **16.28 : 1** | 4.5 |
| text on void | **17.16 : 1** | 4.5 |
| text on control | **14.91 : 1** | 4.5 |
| muted on panel / card | **12.31 / 12.06 : 1** | 4.5 |
| subtle on panel | **6.33 : 1** | 3 (micro) |
| accent on panel | **11.56 : 1** | 4.5 |
| fault on panel | **12.49 : 1** | 4.5 |
| violation on panel | **6.76 : 1** | 4.5 |
| CTA label on its darkest fill | **8.82 : 1** | 4.5 |

Keyboard, verified in all three engines: every control reachable; a visible focus ring on everything that takes `:focus-visible`; Space toggles the switch; arrow keys move within the segmented control and the tabs, with Home/End; arrow keys step the number field and the range. Dialogs: focus moves in, is contained (12 tabs never reach background content), Esc closes, focus returns to the opener, the background is inert, and nothing is left behind after closing. Tooltips open on focus as well as hover and Esc dismisses them without moving focus.

### Seven real defects the tests and the review screenshots found

1. **Native controls had their focus ring suppressed.** I had relied on the surrounding surface changing border colour. A border tint is a weaker indicator than a ring, and the keyboard test caught it. Fixed: the shared `:focus-visible` ring applies to the control itself, inset inside the surface.
2. **The switch was unclickable by pointer.** Its input was `0 × 0` with the label doing the work, so a pointer landing on the control hit nothing and the decorative track intercepted events. Fixed: the input covers its track at `opacity: 0` with `z-index: 1`.
3. **Dismissed tooltips were still in the accessibility tree.** `opacity: 0` alone leaves an element present and "visible". Fixed with `visibility`.
4. **WebKit lost focus restoration after a dialog closed.** Diagnosed rather than patched: WebKit does not focus a button on click at all (macOS convention), so a pointer-opened dialog has nothing to restore to — and nothing is lost, because restoration matters for keyboard users, whose trigger *is* focused. The tests now exercise the keyboard path, and the component also repeats the restore on the next frame, since WebKit moves focus after the close event.

5. **A closed `<dialog>` stayed on screen** once I gave it `display: flex`, because that overrides the UA's `display: none`. Scoped to `[open]`.
6. **The side drawer's footer floated mid-panel** instead of sitting at the bottom of a full-height drawer.
7. **The header's navigation clipped at 390 px**, making "Investigate" unreachable. It now scrolls, and a test asserts reachability.

Timeline markers were enlarged from 18 to 26 px hit targets while the visible dot stays 7 px.

## 9 · Responsive behaviour

Five viewports, all engines: **1586 × 992, 1440 × 900, 1280 × 800, 768 × 1024, 390 × 844**. Asserted: no horizontal overflow at any size (`scrollWidth ≤ clientWidth`), and at ≤ 768 px no interactive control shorter than 24 px.

| Adaptation | Behaviour |
|---|---|
| Header | Margins tighten below 900 px; the wordmark hides below 560 px while the brand box keeps its size |
| Panels | Fluid via `minmax()`; the shell grid collapses |
| Segmented control | Scrolls inside itself rather than widening the page |
| Token list | Three columns stack below 700 px |
| Reconstructions | Scroll inside their box — they are a fidelity exhibit at reference pixel widths, not a responsive component |

Two of those were found by the responsive test, not by design.

## 10 · Performance

| Budget | Target | Measured |
|---|---|---|
| Design-system CSS | ≤ 40 KB gzip | **7.6 KB** |
| Gallery JS (not shipped to the app) | — | 12.4 KB gzip |
| App shell CSS | — | 1.0 KB gzip |
| Fonts | 2 variable families, `swap`, latin subsets | **56 KB** for the two latin files |
| New runtime dependencies | 0 | **0** (fonts only; `@axe-core/playwright` is dev-only) |
| Blur over the live stage | forbidden | enforced by the matte material |

## 11 · Reference comparison

`references/cp6/compare/ds-*.png`: each is a crop of the approved PNG beside the same thing rebuilt from these components (`ds-run-setup`, `ds-cta`, `ds-trace-context`, `ds-status`, `ds-derived`). Full gallery screenshots per engine are in `references/cp6/gallery/`.

Close: panel geometry and radii, the lit top edge, the CTA's proportions and double rim light, the fact table's 23 px row pitch, chips, value cells with their padlocks, the switch, the header and its guide line.

**Remaining differences, none of them accidental:**

1. **Form labels are visible where the reference shows none.** A select with no label is an accessibility problem. `hideLabel` exists so a dashboard can match the reference exactly while keeping the accessible name, and Gate 3 will decide per control.
2. **Text is slightly larger and lighter than the reference in places.** The spec forbids making text illegibly dim to match the PNG; where the two conflict, legibility wins.
3. **Font rendering differs from the PNG's compositing.** The references were composited, not rendered by a browser; glyph weight and edges will never be identical.
4. **Decorative elements** (bubble spheres over panel corners, orbit arcs behind the stage, the faint vertical grid inside panels) are present as a backdrop but not yet tuned per dashboard — that is Gates 3–5, where their real positions are known.
5. **The invariant-card icons** are not drawn yet; the reference has a bespoke icon per invariant. Gate 3.

## 12 · Known limitations

- The blur measurement cannot see the cost on a vsync-limited 60 Hz engine (§3). It is a lower bound, not a full picture.
- `axe-core` cannot evaluate contrast through a blur; the token test covers it deterministically, but only for the pairings documented there.
- The gallery is desktop-first; phone layouts are verified for overflow and target size, not reviewed for composition.
- No component has been connected to real trace data yet; that starts in Gate 3.
- `Tabs` implements the ARIA tab pattern but has no deep-linking — a router decision deferred to Gate 6, as agreed.

## 13 · Integration with the existing shell

Additive. `Session`, `TraceStore`, `TraceIndex`, the Worker client and the engine are untouched, and nothing in `src/design/` imports any of them — components receive props. That is what lets the gallery render every state without a simulation.

- New: `src/design/` (tokens, components, each with a CSS Module) and `design.html` + `src/design/gallery/`.
- `src/styles.css` and the CP5 views are unchanged and still work; they are restyled in their own gates, so the application is never broken between gates.
- `WindowedList` stays exactly as it is: the Investigate fix depends on it.
- The Gate 1 stage is consumed, not modified.

## 14 · Gate 3 readiness

Ready. Configure needs, and now has: panel and card, select, number field with affix, dual range, switch, chips, the `lg` CTA, dividers, empty and error states, the backdrop and the shell. What Gate 3 must still build is Configure-specific and belongs there: the fault-schedule editor, the invariant cards with their per-invariant icons, the deterministic summary, the topology preview wired to the Gate 1 stage, and the spec builder that turns the form into a real `ExperimentSpec` validated by the engine.

Open decisions it will need: **Q3** (seed as an integer field — the component exists), **Q5** (fault injection switch opens the editor), **Q6** (which real experiment the visual comparison uses), **Q7** (invariant list scrolls), **Q8** (what the "Deterministic" card contains).

## 15 · Test summary

| Suite | Result |
|---|---|
| Unit tests | **762 passed**, 13 skipped (7 workspaces; +6 token tests) |
| Typecheck | clean |
| Production build | `apps/web` and `apps/demo` |
| Design-system browser tests | **27 passed** (9 × Chromium, Firefox, WebKit) |
| Surface cost | 3 passed |
| All earlier browser tests | unchanged and passing |

No golden value, fixture or fingerprint was regenerated; no simulation semantics, protocol, TraceIndex behaviour or Worker contract was touched.
