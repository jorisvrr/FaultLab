import { TraceFingerprint, type TraceEntry } from '@faultlab/engine';
import { TraceIndex } from '@faultlab/trace';

/**
 * Main-thread trace storage for one run (CP5): the received entries, indexed incrementally as
 * chunks arrive. Framework-free.
 *
 * The content fingerprint (end-to-end check against the Worker's) is NOT computed per chunk: it
 * costs ≈ 3 µs per entry and was ~60 % of the main thread's streaming work (measured). Order,
 * gaps and duplicates are already rejected per chunk by the client and the index; the fingerprint
 * is computed after the run in small batches that yield to the event loop.
 */
export class TraceStore {
  #index: TraceIndex | null = null;
  #version = 0;
  #generation = 0;
  /** Main-thread milliseconds spent indexing chunks, total and largest. */
  appendMs = 0;
  maxAppendMs = 0;

  constructor(
    readonly checkpointEntries = 256,
    private readonly clock: () => number = () => performance.now(),
    private readonly yieldToEventLoop: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
  ) {}

  get index(): TraceIndex | null {
    return this.#index;
  }

  get length(): number {
    return this.#index?.length ?? 0;
  }

  /** Changes whenever entries were added (cheap equality check for renderers). */
  get version(): number {
    return this.#version;
  }

  append(entries: readonly TraceEntry[]): void {
    if (entries.length === 0) return;
    const t0 = this.clock();
    if (this.#index === null) this.#index = TraceIndex.build(entries, { checkpointEntries: this.checkpointEntries });
    else this.#index.append(entries);
    this.#version++;
    const ms = this.clock() - t0;
    this.appendMs += ms;
    this.maxAppendMs = Math.max(this.maxAppendMs, ms);
  }

  /**
   * Fingerprint of all entries received, computed in batches of `batch` entries with a yield
   * between batches so the UI keeps rendering. Rejects if the store is reset meanwhile.
   */
  async fingerprint(batch = 1024): Promise<string> {
    const generation = this.#generation;
    const hasher = new TraceFingerprint();
    const trace = this.#index?.trace ?? [];
    for (let at = 0; at < trace.length; at += batch) {
      hasher.update(trace.slice(at, at + batch));
      await this.yieldToEventLoop();
      if (generation !== this.#generation) throw new Error('trace store was reset');
    }
    return hasher.digest();
  }

  reset(): void {
    this.#index = null;
    this.#generation++;
    this.#version++;
    this.appendMs = 0;
    this.maxAppendMs = 0;
  }
}
