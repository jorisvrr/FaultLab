import { resolveConfig, MAX_DELAY, type ResolvedConfig, type SimulationConfig } from './config';
import { EngineInvariantError, ProtocolViolationError } from './errors';
import { toFrozenJson, type JsonValue } from './json';
import { VirtualNetwork } from './network';
import type { FiredTimer, IncomingMessage, MessageId, NodeContext, NodeId, TimerId } from './protocol';
import { deriveStream, type RandomSource, type Xoshiro128 } from './random';
import { EventScheduler, type EventSeq } from './scheduler';
import type { Duration, VirtualTime } from './time';
import { EventTrace, type StopReason, type TraceEntry } from './trace';
import { ENGINE_VERSION } from './version';

/** Events that can sit in the scheduler queue. `cause` is the trace index that scheduled them. */
type SimEvent =
  | { readonly kind: 'node.start'; readonly node: NodeId; readonly cause: number }
  | { readonly kind: 'message.deliver'; readonly message: Envelope; readonly cause: number }
  | { readonly kind: 'timer.fire'; readonly node: NodeId; readonly timer: FiredTimer; readonly cause: number };

interface Envelope {
  readonly id: MessageId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly payload: JsonValue;
  readonly sentAt: VirtualTime;
}

/** A buffered side effect requested by a handler, applied only if the handler succeeds. */
type Effect =
  | { readonly kind: 'send'; readonly id: MessageId; readonly to: NodeId; readonly payload: JsonValue }
  | { readonly kind: 'set-timer'; readonly id: TimerId; readonly tag: string; readonly delay: Duration }
  | { readonly kind: 'cancel-timer'; readonly id: TimerId };

type NodeStatus = 'idle' | 'running';

/** Engine-side bookkeeping for one virtual node. Protocol code never sees this object. */
interface NodeRuntime {
  readonly id: NodeId;
  readonly peers: readonly NodeId[];
  readonly random: Xoshiro128;
  status: NodeStatus;
  /** Volatile protocol state. undefined until init has run. */
  state: JsonValue | undefined;
  messagesSent: number;
  timersSet: number;
  /** Pending timers owned by this node, mapped to their scheduler sequence numbers. */
  readonly timers: Map<TimerId, EventSeq>;
}

export interface RunResult {
  readonly reason: StopReason;
  readonly eventsProcessed: number;
  readonly pendingEvents: number;
  readonly finalTime: VirtualTime;
  readonly trace: readonly TraceEntry[];
}

const MAX_TIMER_TAG_LENGTH = 64;

/**
 * One deterministic simulation run.
 *
 * The main loop is: take the earliest live event from the scheduler, advance the virtual clock
 * to its time, run the matching protocol handler on the target node, then apply the handler's
 * buffered effects (which schedule new events) and record everything in the trace.
 * Nothing in this loop reads wall-clock time, global randomness, or UI state.
 */
export class Simulation<S extends JsonValue = JsonValue, M extends JsonValue = JsonValue> {
  readonly config: ResolvedConfig<S, M>;
  readonly #scheduler = new EventScheduler<SimEvent>();
  readonly #trace = new EventTrace();
  readonly #network: VirtualNetwork;
  readonly #nodes = new Map<NodeId, NodeRuntime>();
  #eventsProcessed = 0;
  #stopReason: StopReason | null = null;

  constructor(config: SimulationConfig<S, M>) {
    this.config = resolveConfig(config);
    const { seed, nodes, protocol, network, limits } = this.config;
    this.#network = new VirtualNetwork(network, deriveStream(seed, 'network'));

    const runStart = this.#trace.append({
      kind: 'run.start',
      time: 0,
      cause: null,
      engineVersion: ENGINE_VERSION,
      protocol: { name: protocol.name, version: protocol.version },
      seed,
      nodes,
      latency: network.latency,
      limits,
    });

    for (const id of nodes) {
      this.#nodes.set(id, {
        id,
        peers: Object.freeze(nodes.filter((other) => other !== id)),
        random: deriveStream(seed, `node:${id}`),
        status: 'idle',
        state: undefined,
        messagesSent: 0,
        timersSet: 0,
        timers: new Map(),
      });
      // All nodes start at t=0 in configuration order. These are the first events scheduled,
      // so they run before any message, even one sent with zero latency.
      this.#scheduler.schedule(0, { kind: 'node.start', node: id, cause: runStart });
    }
  }

  get now(): VirtualTime {
    return this.#scheduler.now;
  }

  get eventsProcessed(): number {
    return this.#eventsProcessed;
  }

  get pendingEvents(): number {
    return this.#scheduler.pendingCount;
  }

  /** null while the run can continue; the reason it ended otherwise. */
  get stopReason(): StopReason | null {
    return this.#stopReason;
  }

  /** Frozen copy of the trace so far. */
  get trace(): readonly TraceEntry[] {
    return this.#trace.snapshot();
  }

  /** Current volatile state of a node (deeply frozen), or undefined before it started. */
  nodeState(id: NodeId): JsonValue | undefined {
    return this.#node(id).state;
  }

  /**
   * Dispatch at most one event. Returns true if an event was dispatched.
   *
   * Limits are checked in a fixed order before each dispatch: quiescence first (so a run that
   * finishes on exactly its last allowed event is reported as quiescent), then maxEvents, then
   * maxTime. maxPendingEvents and protocol errors are checked after the dispatch that caused them.
   */
  step(): boolean {
    if (this.#stopReason !== null) return false;
    const { limits } = this.config;

    const upcoming = this.#scheduler.peek();
    if (upcoming === undefined) return this.#stop('quiescent');
    if (this.#eventsProcessed >= limits.maxEvents) return this.#stop('event-limit');
    if (limits.maxTime !== null && upcoming.time > limits.maxTime) return this.#stop('time-limit');

    const scheduled = this.#scheduler.next();
    if (scheduled === undefined) throw new EngineInvariantError('peeked event vanished');
    this.#eventsProcessed++;

    if (!this.#dispatch(scheduled.event)) {
      this.#stop('protocol-error');
      return true;
    }
    if (this.#scheduler.pendingCount > limits.maxPendingEvents) this.#stop('pending-limit');
    return true;
  }

  /** Step until a stop condition is reached. Always terminates because of `limits.maxEvents`. */
  run(): RunResult {
    while (this.#stopReason === null) this.step();
    return {
      reason: this.#stopReason,
      eventsProcessed: this.#eventsProcessed,
      pendingEvents: this.#scheduler.pendingCount,
      finalTime: this.#scheduler.now,
      trace: this.#trace.snapshot(),
    };
  }

  #stop(reason: StopReason): false {
    this.#stopReason = reason;
    this.#trace.append({
      kind: 'run.end',
      time: this.#scheduler.now,
      cause: null,
      reason,
      eventsProcessed: this.#eventsProcessed,
      pendingEvents: this.#scheduler.pendingCount,
    });
    return false;
  }

  #node(id: NodeId): NodeRuntime {
    const node = this.#nodes.get(id);
    if (node === undefined) throw new EngineInvariantError(`unknown node ${id}`);
    return node;
  }

  /** Returns false if the protocol handler failed. */
  #dispatch(event: SimEvent): boolean {
    const { protocol } = this.config;
    const time = this.#scheduler.now;

    switch (event.kind) {
      case 'node.start': {
        const node = this.#node(event.node);
        const entry = this.#trace.append({ kind: 'node.start', time, cause: event.cause, node: node.id });
        node.status = 'running';
        return this.#invoke(node, entry, (ctx) => protocol.init(ctx));
      }

      case 'message.deliver': {
        const { message } = event;
        const node = this.#node(message.to);
        // CP0 has no crashes, and start events precede every delivery. CP1 turns this case
        // into a traced `message.drop` for crashed nodes.
        if (node.status !== 'running') throw new EngineInvariantError(`delivery to ${node.id} before it started`);
        const entry = this.#trace.append({
          kind: 'message.deliver',
          time,
          cause: event.cause,
          node: node.id,
          from: message.from,
          messageId: message.id,
          payload: message.payload,
        });
        const incoming: IncomingMessage<M> = Object.freeze({
          id: message.id,
          from: message.from,
          sentAt: message.sentAt,
          payload: message.payload as M,
        });
        return this.#invoke(node, entry, (ctx) => protocol.onMessage(node.state as S, incoming, ctx));
      }

      case 'timer.fire': {
        const node = this.#node(event.node);
        node.timers.delete(event.timer.id);
        const entry = this.#trace.append({
          kind: 'timer.fire',
          time,
          cause: event.cause,
          node: node.id,
          timerId: event.timer.id,
          tag: event.timer.tag,
        });
        return this.#invoke(node, entry, (ctx) => protocol.onTimer(node.state as S, event.timer, ctx));
      }
    }
  }

  /**
   * Run one protocol handler as an atomic step. Exceptions thrown by protocol code (including
   * API misuse and invalid state) are recorded as `protocol.error`; engine bugs outside the
   * handler call are not caught and propagate to the caller.
   */
  #invoke(node: NodeRuntime, cause: number, handler: (ctx: NodeContext<M>) => S): boolean {
    const effects: Effect[] = [];
    const context = this.#createContext(node, effects);
    let nextState: JsonValue;
    try {
      const result: unknown = handler(context.api);
      nextState = node.state !== undefined && result === node.state ? node.state : toFrozenJson(result, 'state');
    } catch (error) {
      this.#trace.append({
        kind: 'protocol.error',
        time: this.#scheduler.now,
        cause,
        node: node.id,
        error: describeError(error),
      });
      return false;
    } finally {
      context.expire();
    }

    context.commitCounters();
    this.#applyEffects(node, effects, cause);
    if (nextState !== node.state) {
      node.state = nextState;
      this.#trace.append({ kind: 'state.update', time: this.#scheduler.now, cause, node: node.id, state: nextState });
    }
    return true;
  }

  #applyEffects(node: NodeRuntime, effects: readonly Effect[], cause: number): void {
    const now = this.#scheduler.now;
    for (const effect of effects) {
      switch (effect.kind) {
        case 'send': {
          const decision = this.#network.route(node.id, effect.to, now);
          const sendIndex = this.#trace.append({
            kind: 'message.send',
            time: now,
            cause,
            node: node.id,
            to: effect.to,
            messageId: effect.id,
            payload: effect.payload,
            deliverAt: decision.deliverAt,
          });
          this.#scheduler.schedule(decision.deliverAt, {
            kind: 'message.deliver',
            message: { id: effect.id, from: node.id, to: effect.to, payload: effect.payload, sentAt: now },
            cause: sendIndex,
          });
          break;
        }
        case 'set-timer': {
          const fireAt = now + effect.delay;
          const setIndex = this.#trace.append({
            kind: 'timer.set',
            time: now,
            cause,
            node: node.id,
            timerId: effect.id,
            tag: effect.tag,
            fireAt,
          });
          const timer: FiredTimer = Object.freeze({ id: effect.id, tag: effect.tag, setAt: now });
          const seq = this.#scheduler.schedule(fireAt, { kind: 'timer.fire', node: node.id, timer, cause: setIndex });
          node.timers.set(effect.id, seq);
          break;
        }
        case 'cancel-timer': {
          const seq = node.timers.get(effect.id);
          if (seq === undefined) break; // already fired, already cancelled, or never existed
          this.#scheduler.cancel(seq);
          node.timers.delete(effect.id);
          this.#trace.append({ kind: 'timer.cancel', time: now, cause, node: node.id, timerId: effect.id });
          break;
        }
      }
    }
  }

  #createContext(node: NodeRuntime, effects: Effect[]): { api: NodeContext<M>; expire(): void; commitCounters(): void } {
    const maxEffects = this.config.limits.maxPendingEvents;
    let active = true;
    let messagesSent = node.messagesSent;
    let timersSet = node.timersSet;

    const guard = (operation: string): void => {
      if (!active) {
        throw new ProtocolViolationError(`ctx.${operation} was called after its handler returned`);
      }
    };
    const push = (effect: Effect): void => {
      if (effects.length >= maxEffects) {
        throw new ProtocolViolationError(`a single handler produced more than ${maxEffects} effects`);
      }
      effects.push(effect);
    };
    const send = (to: NodeId, payload: M): MessageId => {
      guard('send');
      if (to === node.id) throw new ProtocolViolationError(`${node.id} cannot send a message to itself`);
      if (typeof to !== 'string' || !this.#nodes.has(to)) {
        throw new ProtocolViolationError(`${node.id} sent to unknown node ${String(to)}`);
      }
      const id = `${node.id}:m${++messagesSent}`;
      push({ kind: 'send', id, to, payload: toFrozenJson(payload, `send(${to}).payload`) });
      return id;
    };

    const random: RandomSource = Object.freeze({
      nextUint32: () => (guard('random'), node.random.nextUint32()),
      nextFloat: () => (guard('random'), node.random.nextFloat()),
      nextInt: (min: number, max: number) => (guard('random'), node.random.nextInt(min, max)),
      chance: (p: number) => (guard('random'), node.random.chance(p)),
    });

    const api: NodeContext<M> = Object.freeze({
      self: node.id,
      now: this.#scheduler.now,
      peers: node.peers,
      random,
      send,
      broadcast: (payload: M) => node.peers.map((peer) => send(peer, payload)),
      setTimer: (delay: Duration, tag: string): TimerId => {
        guard('setTimer');
        if (!Number.isSafeInteger(delay) || delay < 0 || delay > MAX_DELAY) {
          throw new ProtocolViolationError(`timer delay must be an integer in [0, ${MAX_DELAY}], got ${String(delay)}`);
        }
        if (typeof tag !== 'string' || tag.length > MAX_TIMER_TAG_LENGTH) {
          throw new ProtocolViolationError(`timer tag must be a string of at most ${MAX_TIMER_TAG_LENGTH} characters`);
        }
        const id = `${node.id}:t${++timersSet}`;
        push({ kind: 'set-timer', id, tag, delay });
        return id;
      },
      cancelTimer: (id: TimerId): void => {
        guard('cancelTimer');
        if (typeof id !== 'string') throw new ProtocolViolationError('timer id must be a string');
        push({ kind: 'cancel-timer', id });
      },
    });

    return {
      api,
      expire: () => {
        active = false;
      },
      commitCounters: () => {
        node.messagesSent = messagesSent;
        node.timersSet = timersSet;
      },
    };
  }
}

/** Convenience: build a simulation and run it to completion. */
export function runSimulation<S extends JsonValue, M extends JsonValue>(config: SimulationConfig<S, M>): RunResult {
  return new Simulation(config).run();
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return `non-Error thrown: ${String(error)}`;
  } catch {
    return 'non-Error thrown';
  }
}
