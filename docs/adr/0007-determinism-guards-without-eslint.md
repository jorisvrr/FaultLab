# ADR-0007: Determinism guards — tsconfig libs + fitness tests, no ESLint (yet)

**Status:** Accepted (CP0)

**Problem.** Determinism is only as strong as its weakest import. One stray `Date.now()` or `setTimeout` in the engine silently breaks reproducibility. We need mechanical enforcement, not code review alone.

**Decision.** Two layers.
1. **Compiler:** the engine's `tsconfig.json` sets `lib: ["ES2023"]` and `types: []`. `setTimeout`, `performance`, `console`, `process` and `fetch` do not exist, so using them is a compile error.
2. **Fitness tests:** `test/architecture.test.ts` scans engine source (comments stripped) for `Math.random`, `Date`, timers, `async`/`await`/`Promise`, and `crypto`. It also rejects non-relative imports and runtime dependencies.

**Alternatives.**
- *ESLint `no-restricted-globals`/`no-restricted-properties`:* precise (AST-based) and editor-integrated, but adds a dependency tree and config for rules the two layers above already cover.
- *Runtime stubbing* (replacing `Math.random` during handlers): also catches *protocol* violations, but mutates globals in-process. Better done inside the Worker in CP5.

**Trade-off.** The text scan is cruder than an AST rule (it could false-positive on a string literal). That is acceptable for a small, controlled codebase; ESLint arrives with the UI in CP5, and these rules can move there.

**Invariant.** Engine source references no wall-clock, timer, async, or ambient-randomness API, and imports nothing outside itself.

**Tested by.** The fitness tests themselves; they were confirmed to fail on a probe file containing `Math.random()`. The tsconfig guard was confirmed with a probe using `setTimeout`/`console`/`performance` (three compile errors).
