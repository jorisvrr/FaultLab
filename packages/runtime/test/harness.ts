import { TraceFingerprint, type TraceEntry } from '@faultlab/engine';
import { RuntimeClient, WorkerCore, type ClientOptions, type Command, type RunOptions, type WorkerLike } from '../src';

/**
 * An in-memory "Worker" for Node tests: the real WorkerCore behind the real message semantics
 * (structured clone, transferred buffers are detached, asynchronous delivery on later
 * macrotasks), without a real thread. Infinite loops cannot be tested this way (they would block
 * the test); those run against real Workers in the browser tests.
 */
export interface InMemoryWorker extends WorkerLike {
  readonly sentToWorker: Command[];
  /** Chunks the Worker posted that the client has not yet returned credit for (max seen). */
  maxChunksInFlight: number;
  terminated: boolean;
  core: WorkerCore;
}

const later = (fn: () => void) => setImmediate(fn);
/**
 * The Worker's clock must be captured OUTSIDE the determinism guard (like `wallClock` in the real
 * Worker): slices run guarded, so calling `performance.now()` at call time would throw.
 */
const now = performance.now.bind(performance);

export function inMemoryWorker(options: { delayMs?: number; silent?: boolean } = {}): InMemoryWorker {
  let chunksInFlight = 0;
  const worker: InMemoryWorker = {
    sentToWorker: [],
    maxChunksInFlight: 0,
    terminated: false,
    onmessage: null,
    onerror: null,
    core: null as unknown as WorkerCore,
    postMessage(message: Command) {
      if (worker.terminated) return;
      const copy = structuredClone(message);
      worker.sentToWorker.push(copy);
      if (copy.type === 'credit') chunksInFlight -= copy.chunks;
      if (options.silent === true) return; // a Worker that never answers (watchdog tests)
      later(() => !worker.terminated && worker.core.receive(copy));
    },
    terminate() {
      worker.terminated = true;
    },
  };
  worker.core = new WorkerCore({
    post: (event, transfer) => {
      if (worker.terminated) return;
      if (event.type === 'chunk') worker.maxChunksInFlight = Math.max(worker.maxChunksInFlight, ++chunksInFlight);
      const copy = structuredClone(event, { transfer: transfer === undefined ? [] : [...transfer] });
      const deliver = () => !worker.terminated && worker.onmessage?.({ data: copy });
      if (options.delayMs !== undefined) setTimeout(deliver, options.delayMs);
      else later(deliver);
    },
    schedule: later,
    now,
    encode: (text) => new TextEncoder().encode(text),
  });
  return worker;
}

/** A client plus a simple trace store, wired the way the app does it. */
export function harness(overrides: Partial<ClientOptions> & { workers?: InMemoryWorker[]; runOptions?: Partial<RunOptions> } = {}) {
  const workers = overrides.workers ?? [];
  let entries: TraceEntry[] = [];
  let hasher = new TraceFingerprint();
  const client = new RuntimeClient({
    createWorker: () => {
      const w = inMemoryWorker();
      workers.push(w);
      return w;
    },
    onEntries: (chunk) => {
      entries.push(...chunk);
      hasher.update(chunk);
    },
    onReset: () => {
      entries = [];
      hasher = new TraceFingerprint();
    },
    verifyReceived: async () => hasher.digest(),
    ...overrides,
  });
  return {
    client,
    workers,
    entries: () => entries,
    /** Resolve once the run reaches one of these lifecycle states. */
    until: (states: readonly string[], timeoutMs = 60_000) =>
      new Promise<void>((resolve, reject) => {
        if (states.includes(client.view.lifecycle)) return resolve();
        const timer = setTimeout(() => {
          off();
          reject(new Error(`timed out waiting for ${states.join('/')}; lifecycle is ${client.view.lifecycle} (${client.view.error ?? ''})`));
        }, timeoutMs);
        const off = client.subscribe(() => {
          if (states.includes(client.view.lifecycle)) {
            clearTimeout(timer);
            off();
            resolve();
          }
        });
      }),
  };
}

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Resolve once the received trace's fingerprint has been verified (it runs after the run ends). */
export const verified = (client: { view: { fingerprint: { matches: boolean | null } | null }; subscribe(l: () => void): () => void }) =>
  new Promise<void>((resolve) => {
    const check = () => client.view.fingerprint !== null && client.view.fingerprint.matches !== null && (off(), resolve());
    const off = client.subscribe(check);
    check();
  });
