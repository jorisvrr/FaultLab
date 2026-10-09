import { ENGINE_VERSION, Simulation, TraceFingerprint, type SimulationConfig, type SimulationSnapshot, type TraceEntry } from '@faultlab/engine';
import { resolveExperiment, SpecError } from '@faultlab/experiments';
import { ContractError, parseCommand, WORKER_PROTOCOL, type Command, type ErrorCode, type RunId, type RunOptions, type WorkerEvent, type WorkerState } from './contract';
import { withGuards } from './guard';

/**
 * The Worker side of a run (CP5, ADR-0022), independent of the actual Worker global so it can be
 * tested in Node. One WorkerCore serves one run.
 *
 * Execution is TIME-SLICED: a slice executes whole simulation steps until its wall-clock budget
 * or step limit is used up, sends what it produced, and yields to the event loop so that pause,
 * stop and credit messages can arrive. Slices therefore end only at step boundaries, and the
 * trace is identical for every slice size, budget, pause pattern and encoding.
 */
export interface WorkerHost {
  /** Send an event to the main thread, optionally transferring buffers. */
  post(event: WorkerEvent, transfer?: readonly ArrayBuffer[]): void;
  /** Run `fn` on a later turn of the event loop (MessageChannel in browsers, never nested). */
  schedule(fn: () => void): void;
  /** Wall-clock milliseconds, captured OUTSIDE the determinism guard. Used only for budgets. */
  now(): number;
  encode(text: string): Uint8Array;
}

type Mode = 'idle' | 'run' | 'step';
/** An event without the envelope fields (distributes over the union). */
type EventBody = WorkerEvent extends infer E ? (E extends unknown ? Omit<E, 'protocol' | 'runId'> : never) : never;

export class WorkerCore {
  readonly #host: WorkerHost;
  #runId: RunId | null = null;
  #options: RunOptions | null = null;
  #config: SimulationConfig | null = null;
  #sim: Simulation | null = null;
  #state: WorkerState = 'ready';
  #mode: Mode = 'idle';
  #stepsLeft = 0;
  #stopRequested = false;
  #credits = 0;
  #seq = 0;
  #sent = 0; // absolute index of the next entry to send
  #scheduled = false;
  #finished = false;
  readonly #fingerprint = new TraceFingerprint();
  readonly #keyframes: SimulationSnapshot[] = [];
  readonly #metrics = { executeMs: 0, flushMs: 0, slices: 0, chunks: 0, bytes: 0, maxRetainedEntries: 0 };

  constructor(host: WorkerHost) {
    this.#host = host;
  }

  /** Handle one raw message from the main thread. Never throws. */
  receive(raw: unknown): void {
    let command: Command;
    try {
      command = parseCommand(raw);
    } catch (error) {
      const runId = typeof (raw as { runId?: unknown } | null)?.runId === 'string' ? ((raw as { runId: string }).runId) : (this.#runId ?? 'unknown');
      this.#error('invalid-message', (error as Error).message, runId);
      return;
    }
    if (command.type !== 'load' && command.runId !== this.#runId) {
      this.#error('invalid-message', `command for run ${command.runId}, this Worker serves ${String(this.#runId)}`, command.runId);
      return;
    }
    try {
      this.#handle(command);
    } catch (error) {
      const code: ErrorCode = error instanceof SpecError ? 'invalid-spec' : error instanceof ContractError ? 'invalid-state' : 'engine-error';
      this.#error(code, `${(error as Error).name}: ${(error as Error).message}`);
    }
  }

  #handle(command: Command): void {
    switch (command.type) {
      case 'load': {
        if (this.#runId !== null) throw new ContractError('this Worker already serves a run (one Worker per run)');
        this.#runId = command.runId;
        this.#options = command.options;
        this.#credits = command.options.initialCredits;
        const { config, protocol } = resolveExperiment(command.spec);
        this.#config = config;
        this.#sim = new Simulation(this.#config);
        this.#post({ type: 'loaded', engineVersion: ENGINE_VERSION, protocolName: protocol.name, protocolVersion: protocol.version });
        this.#keyframe();
        this.#flush();
        this.#status();
        return;
      }
      case 'run':
        this.#requireActive();
        this.#mode = 'run';
        this.#state = 'running';
        this.#wake();
        return;
      case 'step':
        this.#requireActive();
        this.#mode = 'step';
        this.#stepsLeft = command.steps;
        this.#state = 'running';
        this.#wake();
        return;
      case 'pause':
        if (this.#finished) return;
        this.#mode = 'idle';
        this.#state = 'paused';
        this.#status();
        return;
      case 'stop':
        if (this.#finished) return;
        this.#stopRequested = true;
        this.#mode = 'idle';
        this.#finishIfDone();
        return;
      case 'credit':
        this.#credits += command.chunks;
        this.#flush();
        this.#finishIfDone();
        this.#wake();
        return;
      case 'snapshot':
        this.#snapshot(command.requestId, command.atStep);
        return;
    }
  }

  #requireActive(): void {
    if (this.#sim === null) throw new ContractError('no experiment loaded');
    if (this.#finished || this.#stopRequested) throw new ContractError(`the run is ${this.#state}`);
  }

  #wake(): void {
    if (this.#scheduled || this.#mode === 'idle') return;
    this.#scheduled = true;
    this.#host.schedule(() => {
      this.#scheduled = false;
      try {
        // The determinism guard covers exactly the simulation execution of this slice.
        withGuards(() => this.#execute());
        this.#afterSlice();
      } catch (error) {
        // An engine invariant broke (an engine bug, not a protocol error): stop executing.
        this.#mode = 'idle';
        this.#error('engine-error', `${(error as Error).name}: ${(error as Error).message}`);
      }
    });
  }

  /** One execution slice: whole steps only, bounded by time, step count and flow control. */
  #execute(): void {
    const sim = this.#sim!;
    const options = this.#options!;
    const started = this.#host.now();
    const deadline = started + options.sliceBudgetMs;
    let steps = 0;
    this.#metrics.slices++;
    while (this.#mode !== 'idle' && sim.stopReason === null && !this.#backlogged()) {
      sim.step();
      steps++;
      if (options.keyframeSteps > 0 && sim.stepsCompleted % options.keyframeSteps === 0) this.#keyframe();
      if (this.#mode === 'step' && --this.#stepsLeft === 0) {
        this.#mode = 'idle';
        this.#state = 'paused';
      }
      if (steps >= options.sliceMaxSteps || this.#host.now() >= deadline) break;
    }
    if (sim.stopReason !== null) this.#mode = 'idle';
    this.#metrics.executeMs += this.#host.now() - started;
  }

  /** After a slice (guard removed): send what it produced, report, and schedule the next one. */
  #afterSlice(): void {
    this.#flush();
    if (!this.#finishIfDone()) {
      this.#status();
      // Waiting for credit: do NOT reschedule (that would busy-wait, burning CPU and flooding the
      // main thread with status messages). The next `credit` command wakes the Worker.
      if (!this.#backlogged()) this.#wake();
    }
  }

  /** More than one chunk's worth of unsent entries and no credit: wait for the consumer. */
  #backlogged(): boolean {
    return this.#credits === 0 && this.#sim!.traceLength - this.#sent >= this.#options!.chunkMaxEntries;
  }

  /** Send as many chunks as credit allows; release what was sent. */
  #flush(): void {
    const sim = this.#sim!;
    const { chunkMaxEntries, encoding } = this.#options!;
    const started = this.#host.now();
    this.#metrics.maxRetainedEntries = Math.max(this.#metrics.maxRetainedEntries, sim.traceLength - sim.traceStart);
    while (this.#credits > 0 && this.#sent < sim.traceLength) {
      const to = Math.min(sim.traceLength, this.#sent + chunkMaxEntries);
      const entries = sim.entriesSince(this.#sent).slice(0, to - this.#sent) as readonly TraceEntry[];
      this.#fingerprint.update(entries);
      const range = { seq: this.#seq++, from: this.#sent, to };
      if (encoding === 'json') {
        const bytes = this.#host.encode(JSON.stringify(entries));
        const data = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
        this.#metrics.bytes += data.byteLength;
        this.#post({ type: 'chunk', ...range, encoding: 'json', data }, [data]);
      } else {
        this.#post({ type: 'chunk', ...range, encoding: 'clone', entries });
      }
      this.#credits--;
      this.#metrics.chunks++;
      this.#sent = to;
      sim.releaseTraceBefore(this.#sent); // the Worker never holds the whole trace (PERF-4 mitigation)
    }
    this.#metrics.flushMs += this.#host.now() - started;
  }

  /** Send `finished` once the run has ended (or was stopped) AND every entry has been sent. */
  #finishIfDone(): boolean {
    const sim = this.#sim;
    if (sim === null || this.#finished) return this.#finished;
    const ended = sim.stopReason !== null || this.#stopRequested;
    if (!ended || this.#sent < sim.traceLength) {
      if (ended) this.#status(); // still delivering the tail; the client will send credit
      return false;
    }
    this.#finished = true;
    this.#mode = 'idle';
    this.#state = sim.stopReason !== null ? 'completed' : 'stopped';
    this.#status();
    this.#post({
      type: 'finished',
      state: this.#state as 'completed' | 'stopped',
      stopReason: sim.stopReason,
      stepsCompleted: sim.stepsCompleted,
      traceLength: sim.traceLength,
      fingerprint: this.#fingerprint.digest(),
      metrics: { ...this.#metrics },
    });
    return true;
  }

  #keyframe(): void {
    const sim = this.#sim!;
    if (this.#options!.keyframeSteps > 0 && this.#keyframes.at(-1)?.position.stepsCompleted !== sim.stepsCompleted) this.#keyframes.push(sim.snapshot());
  }

  /** Engine snapshot at a step boundary: the current one, or an earlier one rebuilt from a keyframe. */
  #snapshot(requestId: number, atStep: number | null): void {
    const sim = this.#sim;
    if (sim === null) throw new ContractError('no experiment loaded');
    const step = atStep ?? sim.stepsCompleted;
    if (step > sim.stepsCompleted) {
      this.#error('invalid-state', `step ${step} has not been executed yet (at ${sim.stepsCompleted})`, this.#runId!, requestId);
      return;
    }
    let snapshot: SimulationSnapshot;
    if (step === sim.stepsCompleted) snapshot = sim.snapshot();
    else {
      const keyframe = [...this.#keyframes].reverse().find((k) => k.position.stepsCompleted <= step);
      if (keyframe === undefined) {
        this.#error('invalid-state', `no keyframe at or before step ${step}`, this.#runId!, requestId);
        return;
      }
      const replay = Simulation.restore(this.#config!, keyframe);
      withGuards(() => {
        while (replay.stepsCompleted < step) replay.step();
      });
      snapshot = replay.snapshot();
    }
    this.#post({ type: 'snapshot', requestId, step, snapshot });
  }

  #status(): void {
    const sim = this.#sim!;
    this.#post({
      type: 'status',
      state: this.#state,
      stepsCompleted: sim.stepsCompleted,
      now: sim.now,
      traceLength: sim.traceLength,
      pendingEvents: sim.pendingEvents,
      stopReason: sim.stopReason,
      throttled: this.#mode !== 'idle' && this.#backlogged(),
    });
  }

  #post(event: EventBody, transfer?: readonly ArrayBuffer[]): void {
    this.#host.post({ protocol: WORKER_PROTOCOL, runId: this.#runId!, ...event } as WorkerEvent, transfer);
  }

  #error(code: ErrorCode, message: string, runId: RunId = this.#runId ?? 'unknown', requestId?: number): void {
    this.#host.post({ protocol: WORKER_PROTOCOL, runId, type: 'error', code, message, ...(requestId === undefined ? {} : { requestId }) });
  }
}
