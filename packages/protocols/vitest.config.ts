import { defineConfig } from 'vitest/config';

// `npm run bench` (FAULTLAB_BENCH=1) runs only the opt-in measurements in bench/.
const bench = process.env['FAULTLAB_BENCH'] === '1';

export default defineConfig({
  test: { include: bench ? ['bench/**/*.test.ts'] : ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'], testTimeout: bench ? 1_800_000 : 120_000 },
});
