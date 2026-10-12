# CP6 Gate 3 — Configure

For review. The approved Configure design, reconstructed and made fully functional against real experiment data. Gates 4 and 5 are not started; Simulate and Investigate keep their CP5 presentation.

Screenshots: `references/cp6/configure/`. Captured from the verified build, each in its own
browser context so no draft state leaks between shots: `impl.png`, `invariants.png`,
`signature.png`, `fault-editor.png`, `faults-disabled.png`, `topology-7.png`, `validation.png`,
`mobile.png`, `mobile-nav.png`, `mobile-editor.png`. Desktop shots are 1586 × 992 at 2×, the
mobile pair 390 × 844, all with reduced motion and the `configure-reference` preset.

Two files in that folder are **older composites against the original reference PNG** and were not
regenerated: `side-by-side.png` and `plan-compare.png`. They are crops of the same, unchanged
composition, but they predate the fixes below.

---

## 1 · The five questions, as resolved

| | Decision | What was built |
|---|---|---|
| **Q3** seed | Integer input with a regenerate action, no slider | `NumberField` with copy and regenerate. The value is kept exactly as typed — nothing is clamped or reformatted — and any change updates the signature |
| **Q5** fault editor | Switch + clickable schedule + one shared drawer | The switch arms the plan; the drawer edits it; clicking a marker opens the drawer on that fault. Disabling keeps the draft and excludes it from the effective spec |
| **Q6** reference data | A real, deterministic preset | `configure-reference`, built from the registry, fingerprint pinned |
| **Q7** invariants | Show every registered invariant; descriptions in the UI-facing registry | Five real cards per protocol, scrollable, with a truthful enabled count and an honest empty state |
| **Q8** signature | Four real properties, titled EXPERIMENT SIGNATURE | Seed, specification fingerprint, engine version, protocol version — all of the *effective* spec |

## 2 · Draft versus effective specification

The screen keeps two things apart, and this is the idea most of the correctness rests on:

- the **draft** — everything configured, including a fault schedule that is currently switched off;
- the **effective spec** — what would actually be submitted, derived from the draft.

Switching fault injection off keeps the schedule in the draft (shown, dimmed, labelled *"kept, not applied to the next run"*) while removing it from the effective spec. Switching it back on restores exactly the same schedule.

**The signature is computed from the effective spec**, so disabling faults *does* change it — because it changes what will execute — even though nothing was discarded. A unit test asserts both halves: every execution-relevant edit (seed, node count, latency, limits, invariant selection, policy, schedule, faults on/off, protocol) changes the fingerprint, and an edit the engine never sees (the order faults were typed in) does not.

The spec is built in a fixed key order with the faults sorted by time. Without that, the same configuration could produce two different fingerprints depending only on which field was touched first.

## 3 · Validation comes from the engine

The form builds a spec and runs it through `parseSpec` and `resolveExperiment` — the same checks the Worker uses. A `SpecError` carries a path such as `spec.limits.maxEvents`, which maps onto the field that owns it, so the message shown is the engine's own ("must be a positive integer"). On a failed submit the offending field is scrolled into view and focused, because the setup panel scrolls and an error at its foot would otherwise sit behind the CTA.

Plans that are legal but usually mistakes — recovering a node that is not crashed, healing with no partition active, a second partition replacing the first, a fault after the time limit — are **warnings**, shown in the editor and never blocking a run. The engine decides what is legal; an unusual plan is often exactly what an experiment is for.

## 4 · Fault editing, with the engine's real semantics

All six supported types: `crash`, `recover`, `partition`, `heal`, `link`, `link-restore`. Add, edit, duplicate, remove; each type explains what it does.

Two engine rules are made visible rather than hidden, because a UI that hides them teaches the wrong model:

- **A partition is a complete regrouping** that replaces any partition in force — not a per-link toggle. The editor assigns nodes to groups and renders the implicit group ("everyone else") as a real row, so the whole partition is visible, not just the half that was typed.
- **A link fault is directed.** `from` and `to` are separate controls, and the editor says in words that the reverse direction needs a second fault.

## 5 · The topology preview is a preview

Nothing has run, so every node is `idle` — the Gate 1 model's "not started". No leader, no message, no crash, no violation.

An earlier version gave nodes in the plan the `partitioned` state, which drew the dotted amber fence. It looked right and it lied: in this system that fence means *cut off now*. Scheduled faults are now a **DOM badge** carrying a count, outside the visual state channels entirely, and the accessible name reads "n2, not started, 2 scheduled faults". A plan can no longer be mistaken for a result.

The preview uses the Gate 1 renderer unchanged, with all three tiers, the DOM overlay and reduced-motion support. It responds to node count; the ring is sized so nodes never overlap at any cluster size or viewport, which the reference's own proportion does not guarantee below ~700 px.

## 6 · The `configure-reference` preset

Real, deterministic, and it tells a complete story about the naive protocol's weakness:

| t | event |
|---|---|
| 63 | n4 becomes leader (epoch 1) |
| 150 | n2 crashes |
| 400 | a partition isolates n4 |
| **477** | n3 claims leadership in epoch 2 → **single-leader violated**: two running nodes lead |
| 650 | n2 recovers |
| 900 | the partition heals |
| 904 | n4 is still leading epoch 1 |

naive-leader, four nodes, seed 2026, all five invariants, `record-and-continue` so all four scheduled faults actually run. 1 538 entries, stop reason `time-limit`, fingerprint **`6dfb02d2`**, pinned by a test that also asserts the four faults execute in order and that the one violation is the documented split brain.

**No existing golden was touched.** I verified this mechanically: the browser-goldens file gained exactly one entry, zero removed, zero changed.

## 7 · Visual fidelity

`references/cp6/configure/side-by-side.png` and `plan-compare.png`.

Matching: the three-column composition at the measured geometry (left 23.3 %, stage 47.5 %, right 23.4 %, gutters 16 px, margin 30 px); the glass panels with their lit top edge; the sculptural node ring with the complete graph and junction dots; the fault plan drawn as icon badges with dashed stems to a graduated axis and names beneath; the `lg` CTA below the setup panel; the header with its guide line; the background grid and orbit.

**Intentional differences, none accidental:**

1. **Heal is blue, not amber.** The reference draws heal in amber; the approved Q2 decision is cool blue for recovery and healing, and shape distinguishes it as well as colour.
2. **The setup rows are editable controls**, laid out as label-above-control, where the reference shows icon-box + label + value in a read-only-looking row. The reference's rows are a picture of a form; these have to be operated.
3. **The invariant panel scrolls.** Five registered checks, not the three the PNG shows at rest; the first three match the reference's composition.
4. **Preview nodes carry no visible labels**, as in the reference. Their names remain in the DOM for assistive technology and keyboard focus.
5. **Decorative bubble spheres** around the panels and stage are not reproduced; they belong to a later polish pass.
6. The reference's node rim is slightly warmer and brighter than the preview's; the preview is deliberately dimmer than a live run will be.

No PNG sample value is hardcoded. The form's defaults come from the registry, and the screenshots match because `configure-reference` genuinely runs.

## 8 · Accessibility

Every control is a native element, so keyboard behaviour and assistive-technology semantics come from the browser. The fault editor uses the Gate 2 dialog (native `<dialog>` + `showModal()`): focus moves in, is contained, Esc closes, focus returns to the opener, the background is inert. Validation errors are a `role="alert"` region and each field is `aria-invalid` with `aria-describedby`. Nodes are focusable buttons with names that state their status and any scheduled faults. Status never depends on colour alone — the plan's amber/blue markers differ in icon and shape too. Reduced motion is honoured throughout.

## 9 · Responsive

| Width | Behaviour |
|---|---|
| 1586 (reference) | The three-column composition |
| 1440 / 1280 | Same composition, fluid columns |
| 1100 → 760 | Stage spans the top; setup and invariants below, side by side |
| < 760 | One column: setup, CTA, preview + plan, invariants, signature |

At 390 px everything is reachable: the CTA is unobstructed, all five invariant switches are operable, the fault editor is a full-height drawer, and the preview keeps a 280 px band without taking space the controls need.

That last claim was wrong when first written, and the screenshot is what caught it. The 280 px floor sat on the stage *column*, which also holds the 184 px fault plan, so the preview itself was left about 94 px tall with the nodes shrunk into their own caption. The floor now sits on the canvas; measured at 390 px the preview is 280 px and the document still has no horizontal overflow.

The wordmark is hidden below 560 px by design — the brand mark stays and its slot keeps its size, so swapping in the final logo changes no layout.

## 10 · Tests

| Layer | What it proves |
|---|---|
| `test/configure-draft.test.ts` (27) | Draft → effective spec reproduces the reference preset exactly; **every preset Configure can load round-trips** — the engine resolves the rebuilt spec to the same configuration and it runs to the same trace and runs to its pinned fingerprint; canonical serialisation; disabled faults retained in draft but absent from the spec; the signature tracks every execution-relevant edit and nothing else; protocol switching replaces invariants and raises the node minimum; stale invariant ids never reach the engine; faults naming removed nodes are dropped; engine-sourced validation; six warning cases |
| `test/tokens.test.ts`, registry tests | Invariant descriptions exist, are sentences, and **never claim Raft does log replication or full consensus** |
| `e2e/configure.spec.ts` (12 × 3 engines) | Real registry data on open; seed exactness, regeneration and signature; protocol switching incl. the empty-invariant protocol; node count driving the preview and its accessible names; disable/re-enable retaining the plan and signature; fault editor add/edit/remove with partition and direction semantics; warnings not blocking; marker → editor; invariant switches; invalid config explained and unsubmittable; **the submitted spec matches field-by-field what Configure showed**; a UI change after submission does not touch the running experiment |

### Two real bugs the tests found

1. **The run never started.** `session.load()` is asynchronous — a Worker is created and the lifecycle only then reaches `ready` — and `run()` before that is ignored. Configure now waits for `ready` (or `error`). Caught by the test that follows the lifecycle to `completed`.
2. **The stage's stylesheet lived on the prototype page.** The moment the stage was used anywhere else, the nodes had no layout and the labels rendered as white blocks. It now ships with the component (`src/stage/stage.css`).

3. **Configure silently imposed a five-times stricter event limit.** The draft defaulted a missing `limits.maxEvents` to 20 000; the engine's own default is 100 000. Every Raft preset omits it, so loading one and pressing Run executed a *truncated* experiment — `raft-isolate-leader` fingerprinted `f4d9dce4` instead of its golden `4320fef1`, and `raft-long-heartbeats` would have been cut from 123 932 entries to a sixth of that. The same round trip also dropped `protocol.options`, which quietly reconfigured the heartbeat protocol's interval, jitter and timeout. The draft now takes its default from the engine's exported `DEFAULT_LIMITS` and carries the options through untouched.

   This is the defect the gate's own requirement was aimed at — *the experiment executed by the Worker must be exactly the one configured* — and the test that existed only checked that the rebuilt spec was *accepted* by the engine, not that it was the *same experiment*. It is now checked per preset, both at the resolved-configuration level and by running both and comparing traces.

A fourth was caught by my own review of the screenshots: input clamping (`Math.max(1, …)`) meant an invalid value could never be entered, so the engine's error never appeared. Silently rewriting what someone typed is worse than a clear message; the clamping is gone.

## 10b · Final review fixes

Six issues from the Gate 3 review, each found by looking at the screenshots rather than by a test.
Two of them were not what they appeared to be.

**1 · The modes were undiscoverable at 390 px.** There were *two* navigations: the visible one and
an `sr-only` duplicate that existed only to carry the `mode-*` test ids. The visible one was an
`overflow-x: auto` container with `scrollbar-width: none` — navigation you have to swipe to find is
navigation most people never find. The duplicate is gone (the test ids moved onto the real links,
which also removes a redundant nav landmark), and below 560 px the header is two rows: identity and
run status above, the three modes as a full-width row beneath. The decorative motif is hidden there,
since it carries no information. `aria-current`, keyboard order and accessible names are unchanged.

**2 · The signature identified an invalid draft.** A fingerprint is an identity claim — *this is the
experiment that will run*. A draft the engine would reject identifies no experiment, so `signature()`
now returns `null` for one and the card reads **"Invalid configuration"**. Nothing is substituted,
and no previous value is retained; hashing is untouched for every spec that validates, which a test
pins by checking that a configuration hashes identically before breaking it and after repairing it.

**3 · The fifth invariant looked like the end of the list.** The panel's foot now carries a fade and
a chevron, shown only while something is actually below and measured rather than assumed, so it
disappears at the bottom instead of lying. Card styling and panel height are unchanged, and nothing
is hidden behind a "show all".

**4 · The experiment name was clipped.** The full preset title is repeated as supporting text under
the control, so it needs no hover — which keyboard and touch never get. No preset identity or spec
value was changed to solve a presentation problem.

**5 · The "disabled" CTA was never disabled.** This one was a misdiagnosis worth recording. The
button has no `disabled` state at all; validation happens on submit so the error can be explained.
What the screenshot caught was `.button:hover:not(:disabled)` using the `background` *shorthand*,
which also resets `background-image` — and that rule out-specifies `.primary`. So **hovering the CTA
threw away its gradient**, leaving near-black text on a dark surface at about 1.1:1. The screenshot
showed it because the pointer was still over the button after the click. The shared hover rule now
touches only `background-color`, and a test asserts the computed gradient is *identical* before and
after hover, not merely present. Separately, genuinely disabled primary buttons went from 3.92:1 to
5.80:1.

**Two defects the capture pass itself found.** The legend swatch reused the node badge's class,
which is absolutely positioned to anchor to a node, so in the legend it sat on top of its own
label; swatch and badge now share every visual property and differ only in positioning. And the
scroll chevron, centred, landed on the partially visible card's title — it now sits at the right
edge, clear of the text, with a stronger fade beneath it.

**6 · The numbered badges.** Confirmed: they count scheduled faults involving that node. The count
was already in the node's accessible name ("n2, not started, 2 scheduled faults"), so the badge is
now `aria-hidden` — announcing a bare "2" a second time is worse than not announcing it — and a
one-line legend beside the preview says what the numbers mean. No node state channel was touched,
and nothing here reports an active fault.

## 11 · Known limitations

- Protocol **options** (heartbeat interval, Raft election timeout) are not editable in the form yet. They are no longer discarded: a loaded experiment's options are carried through unchanged, so the run matches the experiment. Editing them is worth a later pass.
- **An unbounded run cannot be configured.** "Max virtual time" always holds a number, so a spec with `limits.maxTime: null` (only `diagnostic-spin`, which Configure does not offer) cannot round-trip through the form. The round-trip test asserts this for every non-diagnostic preset and skips that one deliberately rather than silently.
- The experiment select lists presets; saving a custom configuration is CP7 (persistence).
- Liveness is added automatically for Raft with the standard deadline and is not yet editable in the form.
- The fault editor's time field accepts any tick; it does not yet offer drag-on-the-timeline editing.
- Decorative bubble spheres (§7.5) are not reproduced.
- The CTA is deliberately never disabled: an invalid configuration is explained on submit, because a disabled button cannot say why it is disabled.

## 12 · Verification

- Unit tests: **792 passed**, 13 skipped, across seven workspaces; typechecks clean; both production builds pass.
- Browser tests: the full suite in Chromium, Firefox and WebKit, including the Gate 1 node-renderer tests, the Investigate performance fix, the Follow Live fix, cross-browser determinism and the counterexample fixtures.
- No golden fingerprint, fixture or historical value was regenerated; the browser-goldens file gained exactly one entry for the new preset and nothing else changed.
- Simulation semantics, protocols, `TraceIndex` and the Worker contract are untouched.
