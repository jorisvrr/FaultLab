/**
 * Version of the engine's *observable semantics*.
 *
 * A trace is only guaranteed to be reproducible by the same ENGINE_VERSION running the
 * same protocol name + version with the same configuration. Bump this whenever a change
 * could alter any trace produced from identical inputs (ordering rules, PRNG algorithm,
 * latency sampling, trace format, ...). The golden-trace test exists to catch forgotten bumps.
 */
export const ENGINE_VERSION = '0.3.0-cp2';
