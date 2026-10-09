import type { SimulationConfig } from './config';
import { EngineInvariantError } from './errors';
import type { JsonValue } from './json';
import { Simulation } from './simulation';
import type { SimulationSnapshot, StepCount } from './snapshot';
import type { EntryIndex, StopReason, TraceEntry } from './trace';

/**
 * Keyframe-based time travel (ADR-0016).
 *
 * While a run executes, a snapshot ("keyframe") is kept every `keyframeSteps` completed
 * SIMULATION STEPS. Any step boundary n can then be reached by restoring the nearest keyframe at
 * or before n and re-executing at most `keyframeSteps − 1` steps — however many trace entries
 * those steps produce. Any range of the trace can be regenerated the same way, with its
 * original absolute entry indices, so a long run does not need to keep its whole trace.
 *
 * Positions are always step boundaries; there is no seeking to an entry inside a step.
 */
export interface RecordOptions {
  /** Keyframe interval, in simulation steps (≥ 1). */
  readonly keyframeSteps: number;
  /** Keep the full trace in memory (default true). With false, only keyframes are retained. */
  readonly retainTrace?: boolean;
}

export interface Keyframe {
  readonly step: StepCount;
  /** Absolute trace index of the first entry produced after this keyframe. */
  readonly traceLength: EntryIndex;
  readonly snapshot: SimulationSnapshot;
}

export interface SeekResult<S extends JsonValue, M extends JsonValue> {
  /** A live simulation positioned exactly after `step` completed steps (a trace segment). */
  readonly simulation: Simulation<S, M>;
  readonly keyframe: Keyframe;
  /** Steps re-executed after restoring the keyframe; always < keyframeSteps. */
  readonly reexecutedSteps: number;
}

export class TimeTravel<S extends JsonValue = JsonValue, M extends JsonValue = JsonValue> {
  readonly config: SimulationConfig<S, M>;
  readonly keyframeSteps: number;
  readonly keyframes: readonly Keyframe[];
  /** Steps completed when the recorded run stopped. */
  readonly totalSteps: StepCount;
  readonly stopReason: StopReason;
  /** Absolute trace length at the end of the run. */
  readonly traceLength: EntryIndex;
  /** The full trace if it was retained, otherwise null. */
  readonly trace: readonly TraceEntry[] | null;

  private constructor(fields: {
    config: SimulationConfig<S, M>;
    keyframeSteps: number;
    keyframes: readonly Keyframe[];
    totalSteps: StepCount;
    stopReason: StopReason;
    traceLength: EntryIndex;
    trace: readonly TraceEntry[] | null;
  }) {
    this.config = fields.config;
    this.keyframeSteps = fields.keyframeSteps;
    this.keyframes = fields.keyframes;
    this.totalSteps = fields.totalSteps;
    this.stopReason = fields.stopReason;
    this.traceLength = fields.traceLength;
    this.trace = fields.trace;
  }

  /** Execute a run from the start, keeping a keyframe every `keyframeSteps` steps. */
  static record<S extends JsonValue, M extends JsonValue>(config: SimulationConfig<S, M>, options: RecordOptions): TimeTravel<S, M> {
    const { keyframeSteps, retainTrace = true } = options;
    if (!Number.isSafeInteger(keyframeSteps) || keyframeSteps < 1) throw new RangeError('keyframeSteps must be a positive integer');
    const sim = new Simulation(config);
    const keyframes: Keyframe[] = [];
    const keep = (): void => {
      keyframes.push(Object.freeze({ step: sim.stepsCompleted, traceLength: sim.traceLength, snapshot: sim.snapshot() }));
      if (!retainTrace) sim.releaseTraceBefore(sim.traceLength);
    };
    keep();
    while (sim.stopReason === null) {
      sim.step();
      if (sim.stopReason === null && sim.stepsCompleted % keyframeSteps === 0) keep();
    }
    return new TimeTravel<S, M>({
      config,
      keyframeSteps,
      keyframes: Object.freeze(keyframes),
      totalSteps: sim.stepsCompleted,
      stopReason: sim.stopReason ?? 'quiescent',
      traceLength: sim.traceLength,
      trace: retainTrace ? sim.trace : null,
    });
  }

  /** Binary search: the last keyframe whose step is ≤ `step`. */
  #keyframeAtOrBefore(step: StepCount): Keyframe {
    let lo = 0;
    let hi = this.keyframes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.keyframes[mid]!.step <= step) lo = mid;
      else hi = mid - 1;
    }
    const keyframe = this.keyframes[lo];
    if (keyframe === undefined) throw new EngineInvariantError('no keyframes recorded');
    return keyframe;
  }

  /** Reconstruct the execution state after exactly `step` completed steps (clamped to the run). */
  seek(step: StepCount): SeekResult<S, M> {
    const target = Math.max(0, Math.min(step, this.totalSteps));
    const keyframe = this.#keyframeAtOrBefore(target);
    const simulation = Simulation.restore(this.config, keyframe.snapshot);
    while (simulation.stepsCompleted < target && simulation.step()) {
      // re-execute
    }
    if (simulation.stepsCompleted !== target) throw new EngineInvariantError(`seek reached step ${simulation.stepsCompleted}, wanted ${target}`);
    return { simulation, keyframe, reexecutedSteps: target - keyframe.step };
  }

  /** Absolute trace index at the boundary after `step` completed steps. */
  stepBoundary(step: StepCount): EntryIndex {
    return this.seek(step).simulation.traceLength;
  }

  /**
   * Regenerate the trace entries produced by steps (fromStep, toStep], with their original
   * absolute indices, byte-identical to the uninterrupted run. If the run stopped by `toStep`,
   * the final `run.end` entry is included.
   */
  regenerate(fromStep: StepCount, toStep: StepCount): { readonly firstIndex: EntryIndex; readonly entries: readonly TraceEntry[] } {
    if (fromStep > toStep) throw new RangeError('fromStep must be ≤ toStep');
    const { simulation } = this.seek(fromStep);
    const firstIndex = simulation.traceLength;
    const end = Math.min(toStep, this.totalSteps);
    while (simulation.stepsCompleted < end && simulation.step()) {
      // execute the requested range
    }
    if (end === this.totalSteps) simulation.step(); // appends run.end if the stop happens before a dispatch
    return { firstIndex, entries: simulation.trace.filter((entry) => entry.index >= firstIndex) };
  }
}
