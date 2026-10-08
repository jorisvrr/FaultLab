import { EngineInvariantError } from './errors';

/**
 * A point in simulated time, measured in integer ticks since the start of the run.
 *
 * By convention one tick represents one millisecond of simulated time, but the engine never
 * relates ticks to wall-clock time. Integers (not floats) keep arithmetic exact, so
 * `a + b` and comparisons can never differ between runs or JavaScript engines.
 */
export type VirtualTime = number;

/** A non-negative span of simulated time in ticks. */
export type Duration = number;

export function isVirtualTime(value: unknown): value is VirtualTime {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Monotonic virtual clock. Only the scheduler advances it, and only to the timestamp of the
 * event it is about to dispatch, so time never moves backwards and never "drifts".
 */
export class VirtualClock {
  #now: VirtualTime = 0;

  get now(): VirtualTime {
    return this.#now;
  }

  advanceTo(time: VirtualTime): void {
    if (!isVirtualTime(time)) {
      throw new EngineInvariantError(`clock cannot advance to non-integer time ${String(time)}`);
    }
    if (time < this.#now) {
      throw new EngineInvariantError(`clock cannot move backwards from ${this.#now} to ${time}`);
    }
    this.#now = time;
  }
}
