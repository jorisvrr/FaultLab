import type { SimulationSnapshot, StopReason, TraceEntry } from '@faultlab/engine';
import { host, wallClock } from './host';
import {
  ContractError,
  decodeChunk,
  DEFAULT_RUN_OPTIONS,
  parseEvent,
  WORKER_PROTOCOL,
  type Command,
  type RunId,
  type RunOptions,
  type WorkerEvent,
  type WorkerMetrics,
} from './contract';

/**
 * Main-thread side of the Worker runtime (CP5, ADR-0022). Framework-independent: React (or a
 * test) subscribes to it. Owns the run lifecycle, the Worker, flow control and the watchdog.
 *
 * Lifecycle (UX-001: always explicit):
 *   idle → loading → ready ⇄ running ⇄ paused → completed | stopped
 *   any → aborted  (the Worker was terminated: watchdog or abort(); NOT reproducible)
 *   any → error    (invalid spec, protocol violation, engine bug, Worker crash)
 *
 * - completed: the engine stopped by itself (quiescent, limits, a violation under stop-on-first,
 *   a protocol error …). Deterministic and reproducible.
 * - stopped: the user ended the run (normal, cooperative stop); the trace so far is complete.
 * - aborted: the Worker was killed. Whatever arrived is kept but marked incomplete.
 */
export type Lifecycle = 'idle' | 'loading' | 'ready' | 'running' | 'paused' | 'completed' | 'stopped' | 'aborted' | 'error';

export interface WorkerLike {
  postMessage(message: Command, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}
type Transferable = ArrayBuffer;

export interface RunView {
  readonly runId: RunId | null;
  readonly lifecycle: Lifecycle;
  /** A pause or stop was requested and is waiting for the next step boundary. */
  readonly pending: 'pause' | 'stop' | null;
  readonly stepsCompleted: number;
  readonly now: number;
  /** Entries received and applied (always a gap-free prefix of the trace). */
  readonly received: number;
  /** Trace length the Worker last reported. */
  readonly produced: number;
  readonly pendingEvents: number;
  readonly stopReason: StopReason | null;
  readonly throttled: boolean;
  readonly chunks: number;
  readonly engineVersion: string | null;
  /**
   * Worker's fingerprint of the whole trace, and the fingerprint of what was received. The
   * received one is computed AFTER the run, in background batches (it costs ≈ 3 µs per entry, too
   * much to do on every chunk without dropping frames), so it is null while verification runs.
   */
  readonly fingerprint: { readonly worker: string; readonly received: string | null; readonly matches: boolean | null } | null;
  readonly error: string | null;
  readonly abortReason: string | null;
  /** Messages from earlier runs that arrived late and were ignored. */
  readonly staleIgnored: number;
  /** The Worker's own wall-clock measurements, reported when the run finishes. */
  readonly workerMetrics: WorkerMetrics | null;
  /** Main-thread milliseconds spent receiving chunks (decode, freeze, apply), total and largest. */
  readonly chunkMs: number;
  readonly maxChunkMs: number;
}

export interface ClientOptions {
  readonly createWorker: () => WorkerLike;
  /** Abort the run if the Worker says nothing for this long while it should be working. */
  readonly watchdogMs?: number;
  readonly runOptions?: Partial<RunOptions>;
  /** Called with every chunk in order, before credit is returned (apply it synchronously). */
  readonly onEntries: (entries: readonly TraceEntry[], runId: RunId) => void;
  /** Called when a new run starts, so consumers can reset (e.g. a new TraceStore). */
  readonly onReset?: (runId: RunId) => void;
  /** Fingerprint of everything received, computed without blocking (see RunView.fingerprint). */
  readonly verifyReceived: () => Promise<string>;
  readonly now?: () => number;
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly newRunId?: () => RunId;
  readonly decoder?: { decode(data: ArrayBuffer): string };
}

const IDLE: RunView = Object.freeze({
  runId: null,
  lifecycle: 'idle',
  pending: null,
  stepsCompleted: 0,
  now: 0,
  received: 0,
  produced: 0,
  pendingEvents: 0,
  stopReason: null,
  throttled: false,
  chunks: 0,
  engineVersion: null,
  fingerprint: null,
  error: null,
  abortReason: null,
  staleIgnored: 0,
  workerMetrics: null,
  chunkMs: 0,
  maxChunkMs: 0,
});

let counter = 0;
/** Unique within this page; a fresh page starts a new prefix (wall-clock based, never used by the simulation). */
const pagePrefix = Math.floor(wallClock() * 1000).toString(36);
const defaultRunId = (): RunId => `run-${pagePrefix}-${(counter++).toString(36)}`;

export class RuntimeClient {
  readonly #o: Required<Pick<ClientOptions, 'watchdogMs' | 'now' | 'setInterval' | 'clearInterval' | 'newRunId'>> & ClientOptions;
  readonly #runOptions: RunOptions;
  #worker: WorkerLike | null = null;
  #view: RunView = IDLE;
  #listeners = new Set<() => void>();
  #expectedSeq = 0;
  #lastHeard = 0;
  #watchdog: unknown = null;
  #snapshotRequests = new Map<number, { resolve: (s: { step: number; snapshot: SimulationSnapshot }) => void; reject: (e: Error) => void }>();
  #nextRequest = 0;
  readonly #decoder: { decode(data: ArrayBuffer): string };

  constructor(options: ClientOptions) {
    this.#o = {
      watchdogMs: 3000,
      now: wallClock,
      setInterval: (fn, ms) => host.setInterval(fn, ms),
      clearInterval: (h) => host.clearInterval(h),
      newRunId: defaultRunId,
      ...options,
    };
    this.#runOptions = { ...DEFAULT_RUN_OPTIONS, ...options.runOptions };
    this.#decoder = options.decoder ?? new host.TextDecoder();
  }

  get view(): RunView {
    return this.#view;
  }

  /** React: useSyncExternalStore(client.subscribe, () => client.view). */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * Start a new run in a NEW Worker. Any previous run is cancelled first: its Worker is
   * terminated and its message handler detached, and any late message carrying its runId is
   * ignored. A run can therefore never modify another run's state.
   */
  load(spec: unknown, runOptions: Partial<RunOptions> = {}): RunId {
    this.#teardown();
    const runId = this.#o.newRunId();
    this.#expectedSeq = 0;
    // Reset consumers BEFORE announcing the new run: listeners must never see the new run's
    // lifecycle together with the previous run's trace (found by the Session tests).
    this.#o.onReset?.(runId);
    this.#set({ ...IDLE, runId, lifecycle: 'loading', staleIgnored: this.#view.staleIgnored });
    const worker = this.#o.createWorker();
    this.#worker = worker;
    worker.onmessage = (event) => this.#receive(worker, event.data);
    worker.onerror = (event) => {
      if (this.#worker === worker) this.#fail(`Worker error: ${event.message ?? 'unknown'}`);
    };
    this.#lastHeard = this.#o.now();
    this.#startWatchdog();
    this.#send({ protocol: WORKER_PROTOCOL, runId, type: 'load', spec, options: { ...this.#runOptions, ...runOptions } });
    return runId;
  }

  run(): void {
    if (!this.#can(['ready', 'paused'])) return;
    this.#set({ ...this.#view, lifecycle: 'running', pending: null });
    this.#lastHeard = this.#o.now();
    this.#command('run');
  }

  step(steps = 1): void {
    if (!this.#can(['ready', 'paused'])) return;
    this.#set({ ...this.#view, lifecycle: 'running', pending: 'pause' });
    this.#lastHeard = this.#o.now();
    this.#send({ protocol: WORKER_PROTOCOL, runId: this.#view.runId!, type: 'step', steps });
  }

  /** Cooperative pause: the Worker pauses at the next step boundary and confirms. */
  pause(): void {
    if (!this.#can(['running'])) return;
    this.#set({ ...this.#view, pending: 'pause' });
    this.#command('pause');
  }

  /** Normal stop: the Worker ends the run at the next step boundary and delivers what it produced. */
  stop(): void {
    if (!this.#can(['ready', 'running', 'paused'])) return;
    this.#set({ ...this.#view, pending: 'stop' });
    this.#lastHeard = this.#o.now();
    this.#command('stop');
  }

  /** Forced termination: kill the Worker now. The run becomes `aborted` (not reproducible as is). */
  abort(reason = 'aborted by the user'): void {
    if (this.#worker === null || ['idle', 'completed', 'stopped', 'aborted', 'error'].includes(this.#view.lifecycle)) return;
    this.#teardown();
    this.#set({ ...this.#view, lifecycle: 'aborted', pending: null, abortReason: reason, throttled: false });
  }

  /** An engine snapshot after `atStep` steps (null: the Worker's current position). */
  snapshot(atStep: number | null = null): Promise<{ step: number; snapshot: SimulationSnapshot }> {
    if (this.#worker === null || this.#view.runId === null) return Promise.reject(new Error('no Worker'));
    const requestId = this.#nextRequest++;
    const promise = new Promise<{ step: number; snapshot: SimulationSnapshot }>((resolve, reject) => this.#snapshotRequests.set(requestId, { resolve, reject }));
    this.#send({ protocol: WORKER_PROTOCOL, runId: this.#view.runId, type: 'snapshot', requestId, atStep });
    return promise;
  }

  dispose(): void {
    this.#teardown();
    this.#listeners.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────

  #can(states: readonly Lifecycle[]): boolean {
    return this.#worker !== null && states.includes(this.#view.lifecycle) && this.#view.pending !== 'stop';
  }

  #command(type: 'run' | 'pause' | 'stop'): void {
    this.#send({ protocol: WORKER_PROTOCOL, runId: this.#view.runId!, type });
  }

  #send(command: Command): void {
    this.#worker?.postMessage(command);
  }

  #receive(worker: WorkerLike, raw: unknown): void {
    if (worker !== this.#worker) return; // a terminated Worker's late message
    let event: WorkerEvent;
    try {
      event = parseEvent(raw);
    } catch (error) {
      this.#fail(`protocol violation: ${(error as Error).message}`);
      return;
    }
    if (event.runId !== this.#view.runId) {
      this.#set({ ...this.#view, staleIgnored: this.#view.staleIgnored + 1 });
      return;
    }
    this.#lastHeard = this.#o.now();
    switch (event.type) {
      case 'loaded':
        this.#set({ ...this.#view, engineVersion: event.engineVersion });
        return;
      case 'chunk':
        this.#chunk(event);
        return;
      case 'status': {
        const lifecycle: Lifecycle =
          event.state === 'ready' ? 'ready' : event.state === 'paused' ? 'paused' : event.state === 'running' ? 'running' : this.#view.lifecycle; // completed/stopped arrive with `finished`
        const pending = lifecycle === 'paused' && this.#view.pending === 'pause' ? null : this.#view.pending;
        // While a pause is pending, a "running" status from a slice that was already executing must not undo it.
        const keep = this.#view.pending === 'pause' && event.state === 'running';
        this.#set({
          ...this.#view,
          lifecycle: keep ? this.#view.lifecycle : lifecycle,
          pending,
          stepsCompleted: event.stepsCompleted,
          now: event.now,
          produced: event.traceLength,
          pendingEvents: event.pendingEvents,
          stopReason: event.stopReason,
          throttled: event.throttled,
        });
        return;
      }
      case 'finished': {
        const complete = this.#view.received === event.traceLength;
        this.#stopWatchdog();
        this.#set({
          ...this.#view,
          lifecycle: event.state,
          pending: null,
          stepsCompleted: event.stepsCompleted,
          produced: event.traceLength,
          stopReason: event.stopReason,
          throttled: false,
          fingerprint: { worker: event.fingerprint, received: null, matches: complete ? null : false },
          workerMetrics: event.metrics,
          ...(complete ? {} : { error: `received ${this.#view.received} of ${event.traceLength} entries` }),
        });
        if (complete) {
          const runId = event.runId;
          void this.#o.verifyReceived().then(
            (received) => {
              if (this.#view.runId !== runId) return; // a newer run started meanwhile
              this.#set({ ...this.#view, fingerprint: { worker: event.fingerprint, received, matches: received === event.fingerprint } });
            },
            () => {}, // cancelled because a new run started
          );
        }
        return;
      }
      case 'snapshot': {
        const request = this.#snapshotRequests.get(event.requestId);
        this.#snapshotRequests.delete(event.requestId);
        request?.resolve({ step: event.step, snapshot: event.snapshot as SimulationSnapshot });
        return;
      }
      case 'error': {
        if (event.requestId !== undefined && this.#snapshotRequests.has(event.requestId)) {
          this.#snapshotRequests.get(event.requestId)!.reject(new Error(event.message));
          this.#snapshotRequests.delete(event.requestId);
          return;
        }
        if (event.code === 'invalid-state') {
          // A command that did not fit the Worker's state (a race with completion): report, keep the run.
          this.#set({ ...this.#view, pending: null, error: event.message });
          return;
        }
        this.#fail(`${event.code}: ${event.message}`);
        return;
      }
    }
  }

  #chunk(event: Extract<WorkerEvent, { type: 'chunk' }>): void {
    // Chunks must arrive exactly in order, without gaps or duplicates.
    if (event.seq !== this.#expectedSeq || event.from !== this.#view.received) {
      this.#fail(`protocol violation: expected chunk #${this.#expectedSeq} at entry ${this.#view.received}, got #${event.seq} [${event.from}, ${event.to})`);
      return;
    }
    const t0 = this.#o.now();
    let entries: readonly TraceEntry[];
    try {
      entries = decodeChunk(event, this.#decoder);
      this.#o.onEntries(entries, event.runId);
    } catch (error) {
      this.#fail(error instanceof ContractError ? `protocol violation: ${error.message}` : `could not apply chunk: ${(error as Error).message}`);
      return;
    }
    this.#expectedSeq++;
    const ms = this.#o.now() - t0;
    this.#set({ ...this.#view, received: event.to, chunks: this.#view.chunks + 1, chunkMs: this.#view.chunkMs + ms, maxChunkMs: Math.max(this.#view.maxChunkMs, ms) });
    // Credit only after the chunk is applied: the Worker can never be more than `initialCredits`
    // chunks ahead of what the main thread has processed (bounded queue, bounded memory).
    this.#send({ protocol: WORKER_PROTOCOL, runId: event.runId, type: 'credit', chunks: 1 });
  }

  #fail(message: string): void {
    this.#teardown();
    this.#set({ ...this.#view, lifecycle: 'error', pending: null, throttled: false, error: message });
  }

  #teardown(): void {
    this.#stopWatchdog();
    if (this.#worker !== null) {
      this.#worker.onmessage = null;
      this.#worker.onerror = null;
      this.#worker.terminate();
      this.#worker = null;
    }
    for (const request of this.#snapshotRequests.values()) request.reject(new Error('run ended'));
    this.#snapshotRequests.clear();
  }

  #startWatchdog(): void {
    this.#stopWatchdog();
    this.#watchdog = this.#o.setInterval(() => this.#checkWatchdog(), Math.max(50, Math.floor(this.#o.watchdogMs / 4)));
  }

  #stopWatchdog(): void {
    if (this.#watchdog !== null) this.#o.clearInterval(this.#watchdog);
    this.#watchdog = null;
  }

  /** Only while the Worker is expected to be busy: loading, running, or finishing a pause/stop. */
  #checkWatchdog(): void {
    const { lifecycle, pending } = this.#view;
    const busy = lifecycle === 'loading' || lifecycle === 'running' || pending !== null;
    if (!busy) return;
    const silent = this.#o.now() - this.#lastHeard;
    if (silent > this.#o.watchdogMs) this.abort(`watchdog: the Worker did not respond for ${Math.round(silent)} ms (a handler that never returns?)`);
  }

  #set(view: RunView): void {
    this.#view = Object.freeze(view);
    for (const listener of [...this.#listeners]) listener();
  }
}
