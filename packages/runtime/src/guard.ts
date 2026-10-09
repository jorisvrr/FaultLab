/**
 * Determinism guards for code that runs INSIDE simulation steps (CP5, ADR-0022).
 *
 * While simulation steps execute, ambient sources of nondeterminism are replaced by functions
 * that throw. The Worker installs the guard once per execution SLICE (a batch of whole steps),
 * not per handler call: per call it cost 2.6× in execution time (measured, TEST_STRATEGY CP5).
 * Between slices nothing is touched, so the Worker's own scheduling (MessageChannel) and its
 * timing (a clock captured at module load) keep working; inside a slice the only code that runs
 * is the engine and the protocol, invariant and liveness code it calls. A guarded call throws a
 * NondeterminismError, which the engine records like any handler error (`protocol.error`,
 * `invariant.error`, `liveness.error`): deterministic, so the run stays reproducible.
 *
 * This catches ACCIDENTS. It is not a sandbox: trusted code could still reach the originals
 * (e.g. via a reference captured at import time, or another realm). Untrusted protocols need the
 * CP10 security architecture.
 */
export class NondeterminismError extends Error {
  override name = 'NondeterminismError';
}

type Patch = { readonly target: object; readonly key: string; readonly label: string };

const g = globalThis as unknown as Record<string, unknown>;
const forbidden = (label: string) =>
  function nondeterministic(): never {
    throw new NondeterminismError(`${label} is not available inside a simulation step (FaultLab determinism guard)`);
  };

function computePatches(): Patch[] {
  const list: Patch[] = [
    { target: Math, key: 'random', label: 'Math.random' },
    { target: g, key: 'Date', label: 'Date' },
    { target: g, key: 'setTimeout', label: 'setTimeout' },
    { target: g, key: 'setInterval', label: 'setInterval' },
    { target: g, key: 'queueMicrotask', label: 'queueMicrotask' },
  ];
  if (typeof g['performance'] === 'object' && g['performance'] !== null) list.push({ target: g['performance'] as object, key: 'now', label: 'performance.now' });
  if (typeof g['crypto'] === 'object' && g['crypto'] !== null) {
    list.push({ target: g['crypto'] as object, key: 'getRandomValues', label: 'crypto.getRandomValues' });
    list.push({ target: g['crypto'] as object, key: 'randomUUID', label: 'crypto.randomUUID' });
  }
  return list;
}

/** Computed once: the patched objects exist for the lifetime of the realm. */
let patchList: Patch[] | null = null;
let depth = 0;
let saved: { patch: Patch; own: PropertyDescriptor | undefined }[] = [];

/** `Date` itself and its static methods (Date.now is the usual way to read the clock). */
function forbiddenDate(): unknown {
  const date = forbidden('Date');
  for (const key of ['now', 'parse', 'UTC']) Object.defineProperty(date, key, { value: forbidden(`Date.${key}`), enumerable: false });
  return date;
}

function install(): void {
  if (depth++ > 0) return; // nested guarded calls (e.g. an invariant inside a handler) share one install
  patchList ??= computePatches();
  saved = patchList.map((patch) => ({ patch, own: Object.getOwnPropertyDescriptor(patch.target, patch.key) }));
  for (const { patch } of saved) {
    // An OWN property shadows a prototype method (performance.now, crypto.*) without touching the prototype.
    const value = patch.label === 'Date' ? forbiddenDate() : forbidden(patch.label);
    Object.defineProperty(patch.target, patch.key, { value, configurable: true, writable: true, enumerable: false });
  }
}

function uninstall(): void {
  if (--depth > 0) return;
  for (const { patch, own } of saved) {
    if (own === undefined) delete (patch.target as Record<string, unknown>)[patch.key];
    else Object.defineProperty(patch.target, patch.key, own);
  }
  saved = [];
}

/** Run `fn` with the guard installed (nested calls share one installation). */
export function withGuards<R>(fn: () => R): R {
  install();
  try {
    return fn();
  } finally {
    uninstall();
  }
}

/** `fn` wrapped so that every call runs with the guard installed. */
export function guarded<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return function guardedCall(this: unknown, ...args: A): R {
    return withGuards(() => fn.apply(this, args));
  };
}

/** True while guarded code is running (for tests). */
export const guardActive = (): boolean => depth > 0;
