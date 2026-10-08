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
export { EventTrace, fingerprintTrace, serializeTrace, type StopReason, type TraceEntry, type TraceEntryKind } from './trace';
export { runSimulation, Simulation, type NodeInfo, type RunResult } from './simulation';
