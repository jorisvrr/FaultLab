import type { TraceEntry } from '@faultlab/engine';
import { TraceIndex, type Frame, type InvariantViolationEntry, type MarkerKind, type MessageRecord, type RunEndEntry, type RunStartEntry } from '@faultlab/trace';

/**
 * CP3: the reconstruction logic that used to live here moved to the framework-independent
 * @faultlab/trace package (TraceIndex). This file is now a thin adapter that keeps the CP2.5
 * prototype's API unchanged.
 */
export type { Frame, InvariantViolationEntry, MessageRecord };

export interface TraceModel {
  readonly index: TraceIndex;
  readonly trace: readonly TraceEntry[];
  readonly start: RunStartEntry;
  readonly end: RunEndEntry | null;
  readonly nodes: readonly string[];
  readonly messages: readonly MessageRecord[];
  readonly violations: readonly InvariantViolationEntry[];
  /** Indices of fault entries (for timeline markers). */
  readonly faultIndices: readonly number[];
  readonly duration: number;
}

const FAULT_MARKERS: readonly MarkerKind[] = ['crash', 'recover', 'partition', 'heal', 'link-fault', 'link-restore', 'fault-skipped'];

export function buildModel(trace: readonly TraceEntry[]): TraceModel {
  const index = TraceIndex.build(trace);
  return {
    index,
    trace,
    start: index.start,
    end: index.end,
    nodes: index.start.nodes,
    messages: index.messages,
    violations: index.violations,
    faultIndices: index.markers.filter((m) => FAULT_MARKERS.includes(m.kind)).map((m) => m.index),
    duration: index.duration,
  };
}

export function frameAt(model: TraceModel, index: number, displayTime?: number): Frame {
  return model.index.frameAt(index, displayTime);
}

export function lastIndexAtOrBefore(model: TraceModel, t: number): number {
  return model.index.lastIndexAtOrBefore(t);
}

export { DROP_MARKER_TICKS } from '@faultlab/trace';
