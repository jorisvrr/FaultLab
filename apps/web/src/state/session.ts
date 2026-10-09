import { findProtocol, type ExperimentSpec, type NodeSummary } from '@faultlab/experiments';
import type { MarkerKind } from '@faultlab/trace';
import { RuntimeClient, type ClientOptions, type RunOptions, type RunView, type WorkerLike } from '@faultlab/runtime';
import { TraceStore } from './trace-store';

/**
 * Application session (CP5): the one place that connects the UI to a run. Framework-free so it
 * can be tested without a browser; React reads it through `useSession` (useSyncExternalStore).
 *
 * The UI influences a simulation ONLY by loading a spec and sending run commands. The cursor,
 * follow mode, selection and replay speed are UI state and never reach the Worker.
 */
export interface ExperimentMeta {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
}

export interface SessionView {
  readonly run: RunView;
  readonly experiment: ExperimentMeta | null;
  readonly spec: ExperimentSpec | null;
  /** Entries received (the trace known on the main thread). */
  readonly length: number;
  readonly traceVersion: number;
  /** Selected trace entry; with `follow`, always the newest entry. */
  readonly cursor: number;
  readonly follow: boolean;
  /** Replaying the received trace at `replaySpeed` entries per second (UI only). */
  readonly replaying: boolean;
  readonly replaySpeed: number;
  readonly selectedNode: string | null;
}

export interface SessionOptions {
  readonly createWorker: () => WorkerLike;
  /** Coalesces notifications (requestAnimationFrame in the browser). */
  readonly schedule?: (fn: () => void) => void;
  readonly runOptions?: Partial<RunOptions>;
  readonly checkpointEntries?: number;
  readonly client?: Partial<ClientOptions>;
}

export class Session {
  readonly trace: TraceStore;
  readonly client: RuntimeClient;
  #view: SessionView;
  #listeners = new Set<() => void>();
  #notifyScheduled = false;
  readonly #schedule: (fn: () => void) => void;
  #replayTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionOptions) {
    this.trace = new TraceStore(options.checkpointEntries);
    this.#schedule = options.schedule ?? ((fn) => fn());
    this.client = new RuntimeClient({
      createWorker: options.createWorker,
      ...(options.runOptions === undefined ? {} : { runOptions: options.runOptions }),
      onEntries: (entries) => this.trace.append(entries),
      onReset: () => this.trace.reset(),
      verifyReceived: () => this.trace.fingerprint(),
      ...options.client,
    });
    this.#view = Object.freeze({ run: this.client.view, experiment: null, spec: null, length: 0, traceVersion: 0, cursor: 0, follow: true, replaying: false, replaySpeed: 200, selectedNode: null });
    this.client.subscribe(() => this.#changed());
  }

  get view(): SessionView {
    return this.#view;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  // ── run control (the only path into the simulation) ─────────────────────────────────────

  load(spec: ExperimentSpec, experiment: ExperimentMeta, runOptions?: Partial<RunOptions>): void {
    this.#stopReplay();
    this.#set({ experiment, spec, cursor: 0, follow: true, selectedNode: null });
    this.client.load(spec, runOptions);
  }

  /** Load the same experiment again (a fresh, identical run). */
  restart(): void {
    const { spec, experiment } = this.#view;
    if (spec !== null && experiment !== null) this.load(spec, experiment);
  }

  run = (): void => this.client.run();
  pause = (): void => this.client.pause();
  step = (steps = 1): void => this.client.step(steps);
  stop = (): void => this.client.stop();
  abort = (): void => this.client.abort();

  // ── inspection state (UI only) ──────────────────────────────────────────────────────────

  setCursor(index: number): void {
    const last = Math.max(0, this.trace.length - 1);
    this.#set({ cursor: Math.max(0, Math.min(last, Math.round(index))), follow: false });
  }

  setFollow(follow: boolean): void {
    this.#set({ follow, cursor: follow ? Math.max(0, this.trace.length - 1) : this.#view.cursor });
  }

  /** Move by trace entries (±1 …). */
  moveEntries(delta: number): void {
    this.setCursor(this.#view.cursor + delta);
  }

  /** Move to the last entry of the previous / next simulation step. */
  moveSteps(delta: number): void {
    const index = this.trace.index;
    if (index === null) return;
    const step = index.stepOf(this.#view.cursor) ?? index.steps.length;
    const target = Math.max(0, Math.min(index.steps.length, step + delta));
    this.setCursor(target === 0 ? 0 : index.step(target).last);
  }

  /** Jump to the exact entry of the previous / next marker (crash, partition, violation …). */
  moveMarker(delta: 1 | -1, kinds?: readonly MarkerKind[]): void {
    const index = this.trace.index;
    if (index === null) return;
    const marker = delta > 0 ? index.nextMarker(this.#view.cursor, kinds) : index.previousMarker(this.#view.cursor, kinds);
    if (marker !== null) this.setCursor(marker.index);
  }

  selectNode(id: string | null): void {
    this.#set({ selectedNode: id });
  }

  /** Replay the RECEIVED trace from the cursor at `entriesPerSecond`. Never re-runs the engine. */
  replay(entriesPerSecond = this.#view.replaySpeed): void {
    this.#stopReplay();
    if (this.#view.cursor >= this.trace.length - 1) this.#set({ cursor: 0 });
    this.#set({ replaying: true, follow: false, replaySpeed: entriesPerSecond });
    const tickMs = 50;
    this.#replayTimer = setInterval(() => {
      const next = this.#view.cursor + Math.max(1, Math.round((entriesPerSecond * tickMs) / 1000));
      if (next >= this.trace.length - 1) {
        this.#set({ cursor: Math.max(0, this.trace.length - 1) });
        this.#stopReplay();
      } else this.#set({ cursor: next });
    }, tickMs);
  }

  stopReplay(): void {
    this.#stopReplay();
  }

  /** Protocol-specific summary of a node's state (registry view adapter; display only). */
  describe(state: Parameters<NonNullable<ReturnType<typeof findProtocol>>['describe']>[0]): NodeSummary | null {
    const spec = this.#view.spec;
    if (spec === null) return null;
    return findProtocol(spec.protocol.name, spec.protocol.version)?.describe(state) ?? null;
  }

  dispose(): void {
    this.#stopReplay();
    this.client.dispose();
    this.#listeners.clear();
  }

  #stopReplay(): void {
    if (this.#replayTimer !== null) clearInterval(this.#replayTimer);
    this.#replayTimer = null;
    if (this.#view?.replaying) this.#set({ replaying: false });
  }

  #changed(): void {
    const length = this.trace.length;
    this.#set({ run: this.client.view, length, traceVersion: this.trace.version, ...(this.#view.follow ? { cursor: Math.max(0, length - 1) } : {}) });
  }

  #set(patch: Partial<SessionView>): void {
    const next = { ...this.#view, ...patch };
    if (patch.run === undefined) next.run = this.client.view;
    next.length = this.trace.length;
    next.traceVersion = this.trace.version;
    this.#view = Object.freeze(next);
    if (this.#notifyScheduled) return;
    this.#notifyScheduled = true;
    this.#schedule(() => {
      this.#notifyScheduled = false;
      for (const listener of [...this.#listeners]) listener();
    });
  }
}
