import fc from 'fast-check';

// Same policy as the engine: deterministic property tests by default.
const configured = process.env['FAULTLAB_FC_SEED'];
if (configured !== 'random') fc.configureGlobal({ seed: configured === undefined ? 20261008 : Number(configured) });
