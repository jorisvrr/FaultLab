# ADR-0024: Application architecture for the three modes (CP5 foundation, CP6 visuals)

**Status:** Accepted (CP5)

**Problem.** The approved frontend (Configure, Simulate, Investigate; React; R3F/Canvas where justified) must be built on real simulation data, without the engine depending on React and without rendering ever influencing outcomes. CP5 must establish the structure without the final visuals.

**Decision.** `apps/web` (React 19 + Vite 8, no router, no state library):

- **Layers**: `state/` framework-free (`Session`, `TraceStore`) → `app/` hooks (`useSessionView` via `useSyncExternalStore`, `useFrame` = `TraceIndex.frameAt(cursor)`) → `features/{configure,simulate,investigate}` → `components/` (playback bar, node table/inspector, entry detail). Visual components read frames; they never call the engine.
- **One Session per page** owns the `RuntimeClient` and the `TraceStore`. The UI can influence a run ONLY by loading a spec and sending run commands. Cursor, follow-live, selection and replay speed are UI state.
- **Notifications are coalesced per animation frame** (`requestAnimationFrame`), so a fast Worker cannot force more than one React render per frame.
- **Modes** are hash-routed (`#/configure`, …). UX-001: explicit lifecycle badge, configuration separated from current state, live vs replay wording. UX-002: a docked playback bar (grid row, never scrolls away) with marker navigation to exact entries and keyboard shortcuts.
- **Styling** is deliberately minimal and system-coloured (one CSS file); CP6 replaces it. No Three.js/R3F, no custom visual system in CP5.

**Constraints for CP6 (from CP5 measurements and contracts).** (1) Renderers consume `Frame`s and the Session; no engine access. (2) At most one React update per frame; heavy visuals (R3F) should read the frame in their own render loop rather than through React state. (3) Main-thread budget while streaming a heavy run: chunk application ≤ 8 ms per chunk (measured), so rendering must stay well under ~8 ms per frame to keep 60 fps. (4) Interpolated message positions are display-only (`displayTime`). (5) Never invent events: every visual element maps to a trace entry index. (6) The lifecycle states and their meaning (completed / stopped / aborted) are part of the UX contract.

**Alternatives.** *Redux/Zustand*: unnecessary for one external store. *React Router*: three modes need no router. *Running the engine in React state*: rejected (rendering would determine execution timing).

**Tested by.** `apps/web/test/` (Session, browser goldens) and `apps/web/e2e/` (Chromium, Firefox, WebKit).
