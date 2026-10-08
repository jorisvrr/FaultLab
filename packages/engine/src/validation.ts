import { ConfigError } from './errors';

/** Small helpers shared by the trust-boundary validators (config.ts, faults.ts). */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isIntIn(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** Reject fields we don't know: a typo like `nodes` instead of `node` must not be silently ignored. */
export function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new ConfigError(`${path}.${key}`, 'unknown field');
  }
}
