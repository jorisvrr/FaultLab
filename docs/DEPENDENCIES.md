# Dependencies

Rule: a dependency must solve a problem we actually have, better than ~100 lines of our own tested code would, and must not leak into the engine's runtime.

**The engine has zero runtime dependencies**, and a test enforces it.

## Current (all `devDependencies`, root `package.json`)

| Package | Version | Why | Alternatives considered |
|---|---|---|---|
| `typescript` | ^7.0.2 | Strict static typing; TS 7 is the native (Go) compiler, ~10× faster checks. Its stricter defaults match ours. | — |
| `vitest` | ^5.0.3 | Test runner; native TS/ESM, no transpile config; the same tool the Vite app will use. Requires Node ≥ 22.12. | Jest (needs a TS/ESM transform setup), `node:test` (weaker DX, no watch UI, no coverage integration) |
| `@vitest/coverage-v8` | ^5.0.3 | Coverage via V8's built-in instrumentation (no source rewriting). | Istanbul provider (slower) |
| `fast-check` | ^4.10.2 | Property-based testing with shrinking. Essential for a scheduler/PRNG/determinism suite, and since CP2 for fault-space exploration: generating fault plans, shrinking failures to minimal counterexamples (`test/explore.ts`). Seeded globally for a deterministic suite. | Hand-rolled random tests (no shrinking), jsverify (unmaintained) |
| `@types/node` | ^24 | Types for `node:fs`/`node:path` in architecture tests only. **Not** visible to engine source (`types: []`). | — |

## `@faultlab/trace` (CP3)

No runtime dependencies. It imports only TypeScript **types** from `@faultlab/engine` (declared as a dev dependency); an architecture test enforces this.

## `@faultlab/protocols` (CP4)

No runtime dependencies. It imports only TypeScript **types** from `@faultlab/engine`; an architecture test enforces this and forbids `Math.random`, `Date`, `performance`, timers and `process` in its source. Its tests use the root `fast-check` and `vitest`, plus `@faultlab/engine` (runtime, tests only) and `@faultlab/trace` (TraceIndex cross-checks). No new third-party package was added in CP4. `immer` was reconsidered for Raft's state updates and again not adopted: Raft's state is small, and plain spreads keep the copy semantics visible.

## CP5 (`packages/experiments`, `packages/runtime`, `apps/web`)

| Package | Version | License | Where | Why |
|---|---|---|---|---|
| `react`, `react-dom` | ^19.3.0 | MIT | `apps/web` (dependency) | Approved UI framework for the application shell. Never imported by engine, trace, protocols, experiments or runtime (architecture test) |
| `@types/react`, `@types/react-dom` | ^19.3.0 | MIT | `apps/web` (dev) | Types |
| `@playwright/test` | ^1.64.0 | Apache-2.0 | `apps/web` (dev) | Browser tests; same version as the demo |
| Playwright Firefox 157.0 / WebKit 27.2 builds | via `npx playwright install firefox webkit` | MPL-2.0 / BSD-style (browser engines; downloaded to the user cache, never shipped) | test machines only | Cross-engine determinism and Worker tests (approved in CP5). Chromium tests use the locally installed Chrome |

Deliberately **not** added: `@vitejs/plugin-react` (Vite 8 compiles TSX itself; no fast refresh needed), a router (three hash-routed modes), a state library (one external store with `useSyncExternalStore`), a schema library (hand-written validation of a small contract), Comlink (we need to see and test the messages), jsdom/testing-library (UI behaviour is tested in real browsers; logic lives in framework-free stores tested in Node). `@faultlab/experiments` and `@faultlab/runtime` have only workspace dependencies.

## CP2.5 demo (`apps/demo` devDependencies/dependencies; never engine dependencies)

| Package | Version | License | Why |
|---|---|---|---|
| `vite` | ^8.3.4 | MIT | Dev server and bundler for the prototype viewer; consumes the engine's TypeScript source directly |
| `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | ^5.3.0 | OFL-1.1 | Self-hosted Geist fonts (approved typography), no third-party font CDN at runtime |
| `@playwright/test` | ^1.64.0 | Apache-2.0 | End-to-end assertions in a real browser; uses the locally installed Chrome (`channel: 'chrome'`), so no browser download |

## Planned (added when their checkpoint starts, not before)

| Package | Checkpoint | Purpose | Note |
|---|---|---|---|
| `vite`, `@vitejs/plugin-react` | CP5 | Dev server/bundler; first-class Web Worker support | |
| `react`, `react-dom` | CP5 | UI composition | Engine never imports it (enforced) |
| `@playwright/test` | CP5 | E2E and cross-browser determinism tests | |
| `eslint`, `typescript-eslint` | CP5 | Linting once there is UI code with hooks/a11y rules | Engine guards are already covered by tsconfig + fitness tests |
| A schema validator (`valibot` or `zod`) | CP7 | Validating imported experiment files/share links | Hand-written validation is fine for the small CP0 config. Re-evaluate when schemas grow. |
| `idb` (≈1 KB) or raw IndexedDB | CP7 | Persistence | Decide by API ergonomics in a spike |
| Rendering/motion libraries | CP6 | See [DESIGN_DIRECTION §10](DESIGN_DIRECTION.md) | Only after measured prototypes |

## Rejected

| Package | Why not |
|---|---|
| `seedrandom` and other PRNG libraries | Our generator is ~40 lines, verified bit-exact against the C reference, and exposes its state for snapshots, which most libraries do not. |
| `immer` | Would make protocol state updates terser, but hides the copy/freeze semantics we want students and reviewers to see. Reconsidered in CP4 for Raft and not needed. |
| `lodash`, `ramda` | Nothing needed. |
| Any backend, auth, database | Out of scope by design: the first milestones run entirely in the browser. |
| Rust/WASM toolchain | Not justified until profiling says so (CP9) or sandboxing requires it (CP10). |

## License compatibility

FaultLab's own code is MIT-licensed ([LICENSE](../LICENSE)). The engine ships **no** third-party code (zero runtime dependencies), so no third-party license reaches users of the engine.

Development-only dependencies, audited from `package-lock.json` on 2026-10-08: 60 MIT, 23 Apache-2.0 (TypeScript and its native binaries, `detect-libc`, `expect-type`), 1 ISC (`picocolors`), 1 BSD-3-Clause (`source-map-js`), and 12 MPL-2.0 (`lightningcss` and its platform binaries, pulled in transitively by Vite inside Vitest). All are compatible with an MIT project. MPL-2.0 is file-level copyleft that applies only when modified MPL files are distributed, which FaultLab does not do.

Planned assets: Geist and Geist Mono fonts (SIL OFL 1.1, bundling allowed; ship the OFL text with the font files). Design reference images are never committed ([DESIGN_DIRECTION §1.1](DESIGN_DIRECTION.md)).
