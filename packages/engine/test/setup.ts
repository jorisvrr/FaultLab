import fc from 'fast-check';

/**
 * Property tests are deterministic by default: every fc.assert/fc.check uses this fixed seed, so
 * the suite gives the same verdict on every run and machine. Exploratory runs with fresh random
 * seeds are opt-in (`npm run test:explore` sets FAULTLAB_FC_SEED=random); any failure they find
 * prints its seed and counterexample, which then becomes a pinned regression test.
 */
const configured = process.env['FAULTLAB_FC_SEED'];
if (configured !== 'random') {
  fc.configureGlobal({ seed: configured === undefined ? 20261008 : Number(configured) });
}
