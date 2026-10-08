/** Base class for every error the engine raises on purpose. */
export class FaultLabError extends Error {
  override name = 'FaultLabError';
}

/** The simulation configuration was rejected at the trust boundary. */
export class ConfigError extends FaultLabError {
  override name = 'ConfigError';

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${path}: ${reason}`);
  }
}

/** A value that must be plain JSON data (message payload, protocol state) was not. */
export class InvalidJsonError extends FaultLabError {
  override name = 'InvalidJsonError';

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${path}: ${reason}`);
  }
}

/** Protocol code misused the node API (unknown destination, negative delay, stale context, ...). */
export class ProtocolViolationError extends FaultLabError {
  override name = 'ProtocolViolationError';
}

/**
 * An internal engine invariant was broken. This always indicates an engine bug, never a
 * protocol bug, so it is deliberately NOT caught by the simulation loop.
 */
export class EngineInvariantError extends FaultLabError {
  override name = 'EngineInvariantError';
}
