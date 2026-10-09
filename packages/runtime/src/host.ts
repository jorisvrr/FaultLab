/**
 * The few host (browser / Worker / Node) APIs the runtime uses, reached through one typed view of
 * `globalThis`. The runtime compiles without DOM or WebWorker type libraries because it runs in
 * both environments; this keeps the dependency on the host explicit and small.
 */
export interface Host {
  performance: { now(): number };
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  TextEncoder: new () => { encode(text: string): Uint8Array };
  TextDecoder: new () => { decode(data: ArrayBuffer): string };
  MessageChannel: new () => { port1: { onmessage: (() => void) | null }; port2: { postMessage(message: unknown): void } };
}

export const host = globalThis as unknown as Host;

/**
 * Wall-clock time captured at module load, BEFORE any determinism guard can replace
 * `performance.now`. Used only for slice budgets, the watchdog and measurements.
 */
const now = host.performance.now.bind(host.performance);
export const wallClock = (): number => now();

/** A macrotask scheduler without the nested-setTimeout clamp (≥ 4 ms after five levels). */
export function macrotaskScheduler(): (fn: () => void) => void {
  const channel = new host.MessageChannel();
  const queue: (() => void)[] = [];
  channel.port1.onmessage = () => queue.shift()?.();
  return (fn) => {
    queue.push(fn);
    channel.port2.postMessage(null);
  };
}
