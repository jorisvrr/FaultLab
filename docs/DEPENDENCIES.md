# Dependencies

Rule: a dependency must solve a problem we actually have, better than ~100 lines of our own tested code would, and must not leak into the engine's runtime.

**The engine has zero runtime dependencies**, and a test enforces it.

## Current (all `devDependencies`, root `package.json`)

| Package | Version | Why | Alternatives considered |
|---|---|---|---|
| `typescript` | ^7.0.2 | Strict static typing; TS 7 is the native (Go) compiler, ~10× faster checks. Its stricter defaults match ours. | — |
| `vitest` | ^5.0.3 | Test runner; native TS/ESM, no transpile config; the same tool the Vite app will use. Requires Node ≥ 22.12. | Jest (needs a TS/ESM transform setup), `node:test` (weaker DX, no watch UI, no coverage integration) |
| `@vitest/coverage-v8` | ^5.0.3 | Coverage via V8's built-in instrumentation (no source rewriting). | Istanbul provider (slower) |
| `fast-check` | ^4.10.2 | Property-based testing with shrinking. Essential for a scheduler/PRNG/determinism suite, and later for shrinking failing fault plans. | Hand-rolled random tests (no shrinking), jsverify (unmaintained) |
| `@types/node` | ^24 | Types for `node:fs`/`node:path` in architecture tests only. **Not** visible to engine source (`types: []`). | — |

## Planned (added when their checkpoint starts, not before)

| Package | Checkpoint | Purpose | Note |
|---|---|---|---|
| `vite`, `@vitejs/plugin-react` | CP6 | Dev server/bundler; first-class Web Worker support | |
| `react`, `react-dom` | CP6 | UI composition | Engine never imports it (enforced) |
| `@playwright/test` | CP6 | E2E and cross-browser determinism tests | |
| `eslint`, `typescript-eslint` | CP6 | Linting once there is UI code with hooks/a11y rules | Engine guards are already covered by tsconfig + fitness tests |
| A schema validator (`valibot` or `zod`) | CP8 | Validating imported experiment files/share links | Hand-written validation is fine for the small CP0 config. Re-evaluate when schemas grow. |
| `idb` (≈1 KB) or raw IndexedDB | CP8 | Persistence | Decide by API ergonomics in a spike |
| Rendering/motion libraries | CP7 | See [DESIGN_DIRECTION §10](DESIGN_DIRECTION.md) | Only after measured prototypes |

## Rejected

| Package | Why not |
|---|---|
| `seedrandom` and other PRNG libraries | Our generator is ~40 lines, verified bit-exact against the C reference, and exposes its state for snapshots, which most libraries do not. |
| `immer` | Would make protocol state updates terser, but hides the copy/freeze semantics we want students and reviewers to see. Reconsider for Raft ergonomics in CP5. |
| `lodash`, `ramda` | Nothing needed. |
| Any backend, auth, database | Out of scope by design: the first milestones run entirely in the browser. |
| Rust/WASM toolchain | Not justified until profiling says so (CP10) or sandboxing requires it (CP11). |

## License compatibility

FaultLab's own code is MIT-licensed ([LICENSE](../LICENSE)). The engine ships **no** third-party code (zero runtime dependencies), so no third-party license reaches users of the engine.

Development-only dependencies, audited from `package-lock.json` on 2026-10-08: 60 MIT, 23 Apache-2.0 (TypeScript and its native binaries, `detect-libc`, `expect-type`), 1 ISC (`picocolors`), 1 BSD-3-Clause (`source-map-js`), and 12 MPL-2.0 (`lightningcss` and its platform binaries, pulled in transitively by Vite inside Vitest). All are compatible with an MIT project. MPL-2.0 is file-level copyleft that applies only when modified MPL files are distributed, which FaultLab does not do.

Planned assets: Geist and Geist Mono fonts (SIL OFL 1.1, bundling allowed; ship the OFL text with the font files). Design reference images are never committed ([DESIGN_DIRECTION §1.1](DESIGN_DIRECTION.md)).
