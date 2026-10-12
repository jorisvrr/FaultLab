# CP6 Gate 3 — Configure: implementation plan

For approval. Gate 3 reconstructs the approved **Configure** dashboard at full fidelity and makes every control functional against real experiment data. Nothing is implemented yet.

Inputs: the Configure PNG (`references/cp6/01-configure.png`, the visual source of truth), [FAULTLAB_UI_IMPLEMENTATION_SPEC.md](FAULTLAB_UI_IMPLEMENTATION_SPEC.md) §5, [CP6_DESIGN_AUDIT.md](CP6_DESIGN_AUDIT.md) §2.1, the Gate 1 node renderer, the Gate 2 design system, and the CP5 application architecture.

---

## 1. The five open design questions

Quoted verbatim from [CP6_DESIGN_AUDIT.md](CP6_DESIGN_AUDIT.md) §6, with the technical constraints and my recommendation.

### Q3 — already approved

> **Question:** "Random seed 2026" is drawn as a **dual-thumb slider**.
> **Recommendation:** Integer field styled into the same row (value, copy, regenerate); no slider (spec §5.1).

**Approved.** `NumberField` with copy and regenerate affixes exists in the design system and is in the gallery. No further decision needed.

### Q5 — needs your decision

> **Question:** "Fault injection Enabled".
> **Recommendation:** Switch; enabled opens the fault-schedule editor (drawer); disabled = empty plan.

**What the engine actually supports** (`packages/engine/src/faults.ts`). A fault plan is *scheduled input*, not something that happens interactively (ADR-0009). Six fault types, each with a virtual time `at`, up to 10 000 per run:

| Type | Fields |
|---|---|
| `crash` | `node` |
| `recover` | `node` |
| `partition` | `groups` — listed groups plus one implicit group of every unlisted node; replaces any active partition |
| `heal` | — |
| `link` | `from`, `to`, optional `loss` (0–1), optional `delay` range; directed, replaces any previous condition on that link |
| `link-restore` | `from`, `to` |

Two consequences worth stating before we build: a partition is **not** a toggle per link but a complete grouping that replaces the previous one, and a link fault is **directed** (`from → to` only). A UI that hides either of those would teach the wrong model.

**The tension in the reference.** The PNG shows a row reading "Fault injection · Enabled" and a separate timeline with four markers. It does not show an editor. So the switch has to lead somewhere, and the question is where.

| Option | For | Against |
|---|---|---|
| **A. Switch opens a drawer** (my original recommendation) | Keeps the left panel exactly at the reference's density; the editor gets room for six fault types, node pickers and partition groups | The plan is edited away from the timeline that visualises it |
| **B. Switch reveals an inline section** in the left panel | Everything in one place | The left panel is already full at the reference's size; it would scroll or grow and the composition would drift from the PNG |
| **C. Switch arms the plan; editing happens by clicking the fault timeline** in the centre stage | Edit where you see it; the timeline is already in the reference | Invents an interaction the PNG does not show; discoverability is poor |

**My recommendation: A, with one addition.** The switch opens a drawer (the Gate 2 `Dialog variant="drawer"`), *and* the fault timeline under the stage is clickable to open that same drawer focused on the marker you clicked. That keeps the reference's composition exactly, gives the six fault types the room they need, and still lets you edit from where you see the plan. Switching the toggle off keeps the plan but sends an empty `faults` array to the engine, so turning it back on does not lose your work — and the timeline shows the retained plan greyed, labelled "not applied to the next run".

**I need your decision on A / B / C**, and on one sub-question: should switching off **discard** the plan instead of retaining it greyed? Retaining is friendlier; discarding is more honest about what will run. I lean to retaining with the explicit label.

### Q6 — already approved

> **Question:** Configure's timeline shows four faults, but the healthy preset has none.
> **Recommendation:** Show the real plan; empty state when none. For visual comparison use a real **reference spec** (naive-leader, 4 nodes, seed 2026, crash → partition → recover → heal), so the screenshot matches with real data.

**Approved**, with your instruction to prefer an existing reproducible scenario. I checked all ten presets against what the PNG shows (naive leader, 4 nodes, seed 2026, four faults, five invariant cards):

| Preset | Protocol | Nodes | Seed | Faults | Invariants |
|---|---|---|---|---|---|
| `heartbeat-crash-partition` | heartbeat | 4 | **2026** | **4** | **0** |
| `naive-split-brain` | **naive-leader** | **4** | 7 | 1 | **5** |
| `naive-healthy` | **naive-leader** | **4** | 7 | 0 | **5** |
| the other seven | raft / diagnostics | 2–5 | 1 | 0–80 | 0–5 |

Interesting: the PNG's seed (2026) and fault count (4) come from `heartbeat-crash-partition`, while its invariant cards are naive-leader's — the design mixes two scenarios. So **no existing preset matches**, and taking the closest one would leave either an empty invariant panel or a single fault marker.

I will therefore add one preset, `configure-reference`: naive-leader, four nodes, seed 2026, a crash → partition → recover → heal plan, all five invariants. Built from the real registry, validated by `resolveExperiment`, and covered by the same reproducibility test that pins every other preset's fingerprint. **No engine event is invented**; the screenshot matches because the scenario genuinely runs.

### Q7 — needs your decision

> **Question:** Three invariant cards; naive-leader and Raft each register **five**.
> **Recommendation:** Scrollable card list (all registered invariants of the protocol; the first three match the PNG: single-leader ↔ SINGLE LEADER, unique-leader-per-epoch ↔ UNIQUE EPOCH, epoch-monotonic ↔ EPOCH MONOTONICITY). Custom icons for each, in the same style.

**What the registry actually contains.** Five per protocol, and the ids are real:

| naive-leader | Raft |
|---|---|
| `single-leader` | `raft-election-safety` |
| `unique-leader-per-epoch` | `raft-term-monotonic` |
| `epoch-monotonic` | `raft-one-vote-per-term` |
| `leader-epoch-consistent` | `raft-leader-has-quorum` |
| `no-overdue-messages` | `raft-term-adoption` |

**Constraints.** An `Invariant` carries `id`, `version` and a one-line human `name` (for example *"At most one leader at a time"*) — **there is no description field**, and the PNG's cards show two lines of explanatory text. Enabling and disabling is genuinely supported: the spec's `invariants` array lists which checks run, so a card's switch adds or removes a `CheckRef`. The heartbeat and ping protocols register **no** invariants at all, so the panel needs a real empty state.

| Option | For | Against |
|---|---|---|
| **A. Scroll the list of five** | All real rules visible and switchable; matches the engine | The panel scrolls where the PNG does not |
| **B. Show three, "show all" expands** | Matches the PNG exactly at rest | Hides two real safety checks behind a click — the panel's whole job is to say what is being checked |
| **C. Compress the cards** so five fit in the reference's height | No scrolling, nothing hidden | Cards become ~78 px instead of 131 px; the two-line description would not fit |

**My recommendation: A.** The purpose of that panel is to state exactly which rules the run will check; hiding two of them to match a picture would be the wrong trade. The first three cards match the PNG at rest, so the composition still reads correctly, and the scroll is only visible once you reach for it.

**Two things I need from you.** (1) Confirm A over B or C. (2) The two-line descriptions are **new UI copy that does not exist in the engine**. I propose adding a `description` to the *registry entry* (`packages/experiments`, the UI-facing layer) rather than to the `Invariant` itself, so the engine stays unchanged and the text lives next to the id it explains. I will write one sentence per invariant, derived from the rule's actual check, and show them to you before they ship. Alternative: show only the existing `name` and no second line, which is honest but leaves the card looking emptier than the reference.

### Q8 — needs your decision

> **Question:** "Deterministic" card has placeholder bars.
> **Recommendation:** Rows: seed, spec fingerprint, engine version, protocol version (blue dots = present / verified).

**What is actually available before a run.** `spec.seed`; `specFingerprint(spec)` (a hash of the specification itself); `ENGINE_VERSION`; `spec.protocol.name` and `.version`. **A trace fingerprint does not exist until the run has executed** — it is produced by the Worker and verified on the main thread afterwards. So the card cannot promise reproducibility on evidence it does not yet have.

| Option | For | Against |
|---|---|---|
| **A. Four input rows** (seed, spec fingerprint, engine version, protocol version) | Every value is real and present before running; it states what *determines* the outcome | Says nothing about whether this run matched a previous one |
| **B. A + a trace-fingerprint row** that is empty before the run and fills in after | Closes the loop from inputs to the verified outcome | Configure is left after a run starts, so the filled state would rarely be seen here |
| **C. A + "verify determinism"**, a button that runs the same spec twice and compares fingerprints | Actually demonstrates the claim | A second full run; belongs more naturally in Simulate, where the first run's fingerprint already exists |

**My recommendation: A for Gate 3**, with the card titled so it describes inputs rather than asserting a result — for example *"Reproducible inputs"* with the four rows, and the dot meaning *"recorded"*, not *"verified"*. Option C is genuinely valuable and I would like to build it in Gate 4, next to the run it would verify. The wording matters here for the same reason "ALL INVARIANTS SATISFIED" had to become "NO VIOLATIONS DETECTED": the card must not imply a guarantee the simulation cannot give.

**I need your decision on A / B / C and on the card's title.**

---

## 2. Required functionality

### Experiment setup

| Control | Real source | Validation |
|---|---|---|
| Protocol | `PROTOCOLS` registry, `category === 'protocol'`; broken variants and diagnostics shown separately and labelled | `findProtocol(name, version)` |
| Node count | Generates `n1…nN`; valid range per protocol (Raft needs ≥ 3 for a majority) | `resolveConfig` rejects out-of-range |
| Seed | Integer field + regenerate + copy (Q3) | integer, ≥ 0 |
| Network latency | Dual range `min`/`max` | `min ≤ max`, within engine bounds |
| Limits | `maxTime`, `maxEvents`, `maxPendingEvents`, `maxViolations` — in an "advanced" disclosure, since the reference does not show them | `resolveConfig` |
| Invariant policy | `stop-on-first` / `record-and-continue` | enum |
| Presets | `PRESETS` + the new `configure-reference`; selecting one fills the form | spec re-validated after fill |

Validation happens in one place: the form builds an `ExperimentSpec`, `parseSpec` checks its shape and `resolveExperiment` checks its values against the engine's own `resolveConfig`. A `SpecError` carries a `path` (for example `spec.network.latency`), which maps directly onto the field that owns it, so error messages come from the engine rather than being duplicated in the UI.

### Fault configuration

A drawer (pending Q5) listing the plan in time order, with add, edit, remove and duplicate. Per type: crash/recover need a node and a time; partition needs groups (chips per node, assigned to group 1, 2, … with the implicit group shown explicitly so the model is visible); heal needs only a time; link needs direction, loss and a delay range; link-restore needs direction.

Validation beyond the engine's: recovering a node that is not crashed, healing with no partition active, or two faults at the same tick are all *legal* but usually mistakes — these are warnings, not errors, and never block a run.

**Scheduled versus active** is a hard distinction: Configure only ever shows the **plan**. "Currently active" is a property of a position in a trace and belongs to Simulate. The fault timeline here is labelled as a plan and uses the scheduled-marker style, never the active-fault style.

### Invariants

Cards for every invariant the registry lists for the selected protocol, each with its real id, name, a switch, and (pending Q7) one line of explanation. Protocols with no invariants get an honest empty state rather than a blank panel. Liveness checks (Raft only) appear as a separate card with their `deadline` parameter, labelled as a bounded, conditional test rather than a guarantee.

### Network preview

The Gate 1 renderer, unchanged, showing the planned topology: N nodes on the reference's circular arrangement, complete-graph links, no protocol state (nothing has run, so every node is `idle` — the state the Gate 1 model already has). It updates when the node count changes, keeps the DOM overlay for names and keyboard access, and keeps all three fallback tiers. Nodes affected by the fault plan are marked with the scheduled-fault style so the plan and the picture agree.

### Run action

The `lg` primary CTA. On press: build the spec → validate → on failure focus the first offending field and show the engine's message; on success `session.load(spec, meta)`, wait for `ready`, `session.run()`, then navigate to Simulate. The button shows its busy state throughout and is single-flight. Nothing about this path changes `Session`, the Worker contract or the engine.

---

## 3. Visual fidelity

Reconstructed from the measured geometry in audit §2.1: left panel x31–400, centre stage x417–1170, right panel x1187–1558, all y78–935; CTA x50–384 y820–917; invariant cards 335 × 131 at y173/325/479; the fault timeline axis at y783 with markers at y698; gutters 16–17 px, outer margin 30 px. Expressed as fractions and `minmax()`, never fixed pixels.

The centre stage is the dominant element: the sculptural nodes, the orbit circle, the vertical grid hairlines and the fault timeline, with the panels as glass to either side. No panel overlaps the stage in this composition, so glass is allowed here; the matte rule applies where they do overlap (Simulate).

**Screenshot comparison at 1586 × 992** against the PNG, using the real `configure-reference` scenario, plus the other four viewports for responsiveness. Human review, as agreed. Differences caused by real data, accessibility or responsiveness will be listed and justified, not hidden.

---

## 4. Milestones

| # | Milestone | Done when |
|---|---|---|
| 1 | Layout and composition | The three panels, stage and CTA sit at the measured geometry; screenshot overlays the PNG; responsive at five viewports |
| 2 | Form functionality and validation | Every control builds a real `ExperimentSpec`; engine errors map to fields; presets fill the form; round-trip test spec → form → spec |
| 3 | Fault schedule editor | All six fault types editable; plan renders on the timeline; warnings for suspicious but legal plans |
| 4 | Invariant selection | Real cards per protocol, switches edit the spec's `invariants`, empty state for protocols without any, liveness card for Raft |
| 5 | Topology preview | Gate 1 renderer driven by node count and the fault plan; fallback tiers and keyboard access intact |
| 6 | Run integration | Validate → load → run → Simulate; busy and error states; single-flight |
| 7 | Responsive and accessibility | axe clean, keyboard walkthrough, five viewports, reduced motion |
| 8 | Comparison and polish | Side-by-side at 1586 × 992, differences documented |

Each milestone ends with the full regression suite. I will stop and report at the end, not between milestones, unless something needs your decision.

---

## 5. Constraints I will hold to

- No change to simulation semantics, protocols, `TraceIndex`, the Worker contract, historical fingerprints or counterexample fixtures.
- The Gate 1 renderer is used as-is; no new 3D implementation and no further material tuning.
- The Gate 2 components are used as-is; anything genuinely missing is added to the design system with its gallery entry, not inlined into Configure.
- No PNG sample value is hardcoded. The form's defaults come from the registry; the reference scenario is a real, reproducible preset.
- No logo is generated; the branding slot stays as it is.
- Dutch `ENGINEERLOG.md` entries with "Dit moet ik zelf kunnen uitleggen".

## 6. What I need before starting

Decisions on **Q5** (A/B/C, and whether disabling discards the plan), **Q7** (A/B/C, and whether registry descriptions may be added), and **Q8** (A/B/C, and the card's title). Q3 and Q6 are settled.
