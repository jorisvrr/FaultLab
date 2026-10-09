# ADR-0025: Sculptural 3D nodes in the core instrument (supersedes DESIGN_DIRECTION §10 "not for the core instrument" and phase V7)

**Status:** Accepted (CP6, approved 2026-10-09)

**Problem.** DESIGN_DIRECTION §10 (CP0) ruled Three.js / React Three Fiber out of the core instrument and §13 limited 3D to an optional, late "V7" view. The approved CP6 designs (`01-configure`, `02-simulate`, `03-investigate`) place sculptural, physically lit graphite spheres at the centre of every mode; flat SVG circles cannot reproduce their rim lighting, reflections and depth convincingly.

**Decision.** Three.js and React Three Fiber are allowed in the core instrument for the network nodes and their direct material effects, under these conditions:

1. **One active WebGL context.** A single persistent stage canvas in the application shell; modes change the scene, not the context (this also enables the Simulate → Investigate node morph).
2. **Lazy-loaded.** The 3D renderer is a separate chunk; pages without a stage (help, errors, 404) never load it.
3. **Text and controls stay in the DOM.** Labels, values, buttons, forms, tables, inspectors and timeline controls are DOM; DOM overlays are positioned by projecting 3D coordinates.
4. **Accessible DOM equivalents.** Every node and connection is reachable through a focusable DOM layer (names, role, term, status); results are available as text.
5. **Fallback tiers.** Full 3D → reduced 3D (no post-processing, lower DPR, simpler material) → pre-rendered / 2.5D nodes. Every tier shows the same real data with the same interactions.
6. **Resource hygiene.** Shared geometry and materials, instancing where possible, on-demand rendering, shader warm-up at load, disposal on unmount, context-loss handling.
7. **Reduced motion.** No camera moves, parallax or ambient motion; state changes are instantaneous.
8. **Responsiveness.** Budgets in docs/CP6_DESIGN_AUDIT.md §8; React updates stay ≤ 1 per animation frame; the stage reads the reconstructed frame in its own render loop.
9. **Separation.** The renderer reads view models derived from `Session` / `TraceIndex` frames. It never drives the Worker, the engine, `TraceStore` or `TraceIndex`; rendering frequency never influences execution or reconstruction.

Approved for the prototype: `three`, `@react-three/fiber`. Conditionally approved, only when a component needs them and their cost is measured: `@react-three/drei`, `motion`, `postprocessing`.

**Alternatives.** *SVG/CSS gradient spheres only:* cheapest and most accessible, but cannot reproduce the references' rim light and surface depth; kept as the lowest fallback tier. *Pre-rendered images only:* faithful at one angle and size, but no interactive lighting for hover/selection/state transitions; kept as the middle-to-low tier. *Pixi / raw WebGL:* no advantage over R3F for a handful of sculptural objects inside a React app.

**Consequences.** Bundle size and GPU cost increase (measured in the Gate 1 prototype before scaling); accessibility needs an explicit DOM mirror; visual regression of WebGL output needs tolerances and human review.

**Verification.** Gate 1 (single node prototype): screenshots against the reference at the reference viewport, CPU/GPU/memory measurements, multiple instances sharing resources; approval required before the network is built.
