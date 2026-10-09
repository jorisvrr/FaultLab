export { ENGINE_VERSION } from './version';
export { ConfigError, EngineInvariantError, FaultLabError, InvalidJsonError, ProtocolViolationError } from './errors';
export { isVirtualTime, MAX_DELAY, VirtualClock, type Duration, type VirtualTime } from './time';
export { canonicalJson, toFrozenJson, type JsonArray, type JsonObject, type JsonPrimitive, type JsonValue } from './json';
export { deriveStream, Xoshiro128, type RandomSource, type Xoshiro128State } from './random';
export { BinaryHeap } from './priority-queue';
export { compareScheduled, DEFAULT_COMPACTION_THRESHOLD, EventScheduler, type EventSeq, type ScheduledEvent } from './scheduler';
export {
  VirtualNetwork,
  type DropReason,
  type LatencyRange,
  type LinkCondition,
  type NetworkConditions,
  type NetworkConfig,
  type RoutingDecision,
} from './network';
export type { FiredTimer, IncomingMessage, MessageId, NodeContext, NodeId, NodeStorage, Protocol, TimerId } from './protocol';
export { MAX_STORAGE_KEY_LENGTH, MAX_TIMER_TAG_LENGTH } from './context';
export { MAX_FAULT_TIME, MAX_FAULTS, resolveFaults, type Fault, type FaultId, type FaultSpec, type FaultType } from './faults';
export type { NodeStatus } from './node';
export {
  DEFAULT_MAX_VIOLATIONS,
  defineInvariant,
  MAX_INVARIANTS,
  type InFlightMessage,
  type Invariant,
  type InvariantInput,
  type InvariantPolicy,
  type InvariantRef,
  type InvariantVerdict,
  type NetworkView,
  type NodeView,
  type SimulationView,
  type StepInfo,
  type ViolationReport,
} from './invariants';
export { DEFAULT_LIMITS, MAX_NODES, resolveConfig, type Limits, type ResolvedConfig, type SimulationConfig } from './config';
export {
  EventTrace,
  fingerprintTrace,
  serializeTrace,
  TraceFingerprint,
  type EntryIndex,
  type FaultSkippedEntry,
  type InvariantClearedEntry,
  type InvariantErrorEntry,
  type InvariantViolationEntry,
  type LinkFaultEntry,
  type LinkRestoreEntry,
  type LivenessArmedEntry,
  type LivenessCheckRef,
  type LivenessDisarmedEntry,
  type LivenessErrorEntry,
  type LivenessMetEntry,
  type LivenessMissedEntry,
  type MessageDeliverEntry,
  type MessageDropEntry,
  type MessageSendEntry,
  type NetworkHealEntry,
  type NetworkPartitionEntry,
  type NodeCrashEntry,
  type NodeRecoverEntry,
  type NodeStartEntry,
  type ProtocolErrorEntry,
  type RunEndEntry,
  type RunStartEntry,
  type StateUpdateEntry,
  type StopReason,
  type StorageWriteEntry,
  type TimerCancelEntry,
  type TimerFireEntry,
  type TimerSetEntry,
  type TraceEntry,
  type TraceEntryKind,
} from './trace';
export { runSimulation, Simulation, type NodeInfo, type RunResult } from './simulation';
export { TimeTravel, type Keyframe, type RecordOptions, type SeekResult } from './time-travel';
export { MAX_LIVENESS_CHECKS, resolveLiveness, type LivenessCheck, type LivenessCheckState, type LivenessPhase, type LivenessRef } from './liveness';
export { LEGACY_TRACE_VERSIONS, projectTrace, type LegacyTraceVersion } from './legacy';
export {
  SNAPSHOT_FORMAT,
  SNAPSHOT_LIMITS,
  SnapshotError,
  type NodeSnapshot,
  type SimulationSnapshot,
  type SnapshotEvent,
  type StepCount,
} from './snapshot';
