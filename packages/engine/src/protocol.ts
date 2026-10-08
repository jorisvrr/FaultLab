import type { JsonValue } from './json';
import type { RandomSource } from './random';
import type { Duration, VirtualTime } from './time';

/** Node identifier, e.g. "n1". Validated by the config boundary: [A-Za-z0-9][A-Za-z0-9_-]{0,31}. */
export type NodeId = string;
/** Unique per run, namespaced by sender: "n1:m3" is the third message n1 sent. */
export type MessageId = string;
/** Unique per run, namespaced by owner: "n2:t1" is the first timer n2 set. */
export type TimerId = string;

export interface IncomingMessage<M extends JsonValue> {
  readonly id: MessageId;
  readonly from: NodeId;
  readonly sentAt: VirtualTime;
  readonly payload: M;
}

export interface FiredTimer {
  readonly id: TimerId;
  readonly tag: string;
  readonly setAt: VirtualTime;
}

/**
 * Everything a protocol handler may do or observe. A context is only valid during the single
 * handler call it was created for; using it afterwards throws ProtocolViolationError.
 *
 * Effects (send / setTimer / cancelTimer) are buffered and applied, in call order, only after
 * the handler returns successfully. A handler that throws therefore has no externally visible
 * effects — each handler invocation is an atomic step.
 */
export interface NodeContext<M extends JsonValue> {
  readonly self: NodeId;
  readonly now: VirtualTime;
  /** All other nodes, in configuration order. */
  readonly peers: readonly NodeId[];
  /** This node's private random stream. Never use Math.random in protocol code. */
  readonly random: RandomSource;
  /** Send `payload` to `to`. The payload is copied and frozen immediately. */
  send(to: NodeId, payload: M): MessageId;
  /** Send `payload` to every peer, in `peers` order. */
  broadcast(payload: M): MessageId[];
  /** Fire `onTimer` with `tag` after `delay` ticks (a non-negative integer). */
  setTimer(delay: Duration, tag: string): TimerId;
  /** Cancel a pending timer. Cancelling a timer that already fired or was cancelled is a no-op. */
  cancelTimer(id: TimerId): void;
}

/**
 * A distributed protocol, written as pure-ish event handlers over immutable state.
 *
 * - State `S` and messages `M` must be plain JSON data. Declare them with `type` aliases,
 *   not `interface`s: TypeScript interfaces are not assignable to JsonValue's index signature.
 * - State passed to handlers is deeply frozen. Return a new state object to change it
 *   (`return { ...state, count: state.count + 1 }`); return `state` unchanged otherwise.
 * - Handlers must be synchronous and deterministic: no Math.random, Date, timers, I/O, or
 *   module-level mutable variables. All randomness comes from `ctx.random`.
 */
export interface Protocol<S extends JsonValue = JsonValue, M extends JsonValue = JsonValue> {
  readonly name: string;
  /** Bump when behaviour changes: traces are only reproducible for identical versions. */
  readonly version: string;
  /** Called when the node starts. Returns the node's initial volatile state. */
  init(ctx: NodeContext<M>): S;
  onMessage(state: S, message: IncomingMessage<M>, ctx: NodeContext<M>): S;
  onTimer(state: S, timer: FiredTimer, ctx: NodeContext<M>): S;
}
