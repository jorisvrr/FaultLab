# ADR-0001: Repository layout — npm workspaces, one engine package

**Status:** Accepted (CP0)

**Problem.** The engine must stay independent of React and the browser, and stay portable to a Web Worker (and possibly WASM later). The brief proposes eleven candidate modules. Splitting too early adds build ceremony; splitting too late lets UI imports creep into the engine.

**Decision.** npm workspaces. `packages/engine` (`@faultlab/engine`) is a single package with **zero runtime dependencies**, compiled against the ECMAScript library only. Candidate modules are files inside it. The React app becomes `apps/web` in CP5. The package exports TypeScript source directly (`"exports": "./src/index.ts"`); Vite and Vitest consume it without a build step.

**Alternatives.**
- *Single package with folders:* simplest, but nothing mechanically stops `src/engine` from importing React.
- *One package per module (11 packages):* strong boundaries, but heavy tooling for boundaries that never break in practice (scheduler ↔ heap).
- *Turborepo/Nx:* useful for many packages and CI caching; unnecessary for two.

**Trade-off.** We accept one level of workspace tooling to get the one boundary that matters (engine vs. app), enforced by package dependencies, by tsconfig `lib`, and by a fitness test.

**Invariant.** The engine imports only its own modules and declares no runtime dependencies.

**Tested by.** `test/architecture.test.ts` (imports, dependencies), `tsc` (no DOM/Node globals).
