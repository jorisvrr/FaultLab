# Measurement scripts (CP5 Phase 0 and performance gate)

Node-side measurements with V8's own profilers, which Vitest does not expose. Each script is
bundled into one ESM file and run with `node` (flags as needed). Not part of the build or tests;
results are recorded in `docs/TEST_STRATEGY.md` (CP5) and `docs/ROADMAP.md` (PERF items).

```bash
cd tools/perf
npx vite build --config vite.config.ts --ssr churn.ts && node .out/churn.mjs 160000        # PERF-5 (add `none` for no invariants)
node --cpu-prof --cpu-prof-dir=.prof .out/churn.mjs 160000                                  # CPU profile of the same
npx vite build --config vite.config.ts --ssr memory.ts && node --expose-gc .out/memory.mjs naive8   # PERF-3 (drop-delta heap)
npx vite build --config vite.config.ts --ssr seek.ts && node .out/seek.mjs naive8 retain     # PERF-4 seeks vs GC entries
npx vite build --config vite.config.ts --ssr seek-repeat.ts && node --trace-gc .out/seek-repeat.mjs 4096   # PERF-4 follow-up
npx vite build --config vite.config.ts --ssr overhead.ts && node .out/overhead.mjs 100000    # PERF-2 decomposition
npx vite build --config vite.config.ts --ssr pipeline.ts && node .out/pipeline.mjs          # Worker pipeline stages
npx vite build --config vite.config.ts --ssr fp.ts && node .out/fp.mjs                      # fingerprint cost split
```

Browser measurements (three engines) are in `apps/web/e2e/performance.spec.ts` and `apps/web/src/bench/`.
