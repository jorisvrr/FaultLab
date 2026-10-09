import type { WorkerEvent } from './contract';
import { host, macrotaskScheduler, wallClock } from './host';
import { WorkerCore } from './worker-core';

/**
 * Web Worker entry point (CP5). One Worker serves exactly one run. Import it from the app as
 * `new Worker(new URL('…/worker-entry.ts', import.meta.url), { type: 'module' })` or via the
 * package export `@faultlab/runtime/worker`.
 */
interface WorkerScope {
  postMessage(message: unknown, transfer?: unknown[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}
const scope = globalThis as unknown as WorkerScope;
const encoder = new host.TextEncoder();

const core = new WorkerCore({
  post: (event: WorkerEvent, transfer) => scope.postMessage(event, transfer === undefined ? [] : [...transfer]),
  schedule: macrotaskScheduler(),
  now: wallClock,
  encode: (text) => encoder.encode(text),
});
scope.onmessage = (event) => core.receive(event.data);
