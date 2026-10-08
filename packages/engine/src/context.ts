import { ProtocolViolationError } from './errors';
import { toFrozenJson, type JsonValue } from './json';
import type { NodeRuntime } from './node';
import type { MessageId, NodeContext, NodeId, NodeStorage, TimerId } from './protocol';
import type { RandomSource } from './random';
import { MAX_DELAY, type Duration, type VirtualTime } from './time';

/** A buffered side effect requested by a handler, applied only if the handler succeeds. */
export type Effect =
  | { readonly kind: 'send'; readonly id: MessageId; readonly to: NodeId; readonly payload: JsonValue }
  | { readonly kind: 'set-timer'; readonly id: TimerId; readonly tag: string; readonly delay: Duration }
  | { readonly kind: 'cancel-timer'; readonly id: TimerId };

/** Storage writes of one step: key → new value, or `undefined` for a deletion. */
export type StorageWrites = ReadonlyMap<string, JsonValue | undefined>;

export interface CommittedStep {
  readonly effects: readonly Effect[];
  readonly storageWrites: StorageWrites;
}

export interface ContextHandle<M extends JsonValue> {
  readonly api: NodeContext<M>;
  /** Invalidate the context. Called when the handler returns or throws. */
  expire(): void;
  /** Commit id counters and hand over the buffered effects. Only called if the handler succeeded. */
  commit(): CommittedStep;
}

export interface ContextEnvironment {
  readonly now: VirtualTime;
  isNode(id: NodeId): boolean;
  /** Maximum number of effects (sends, timer operations, storage writes) one handler may buffer. */
  readonly maxEffects: number;
}

export const MAX_TIMER_TAG_LENGTH = 64;
export const MAX_STORAGE_KEY_LENGTH = 128;

/**
 * Build the context for ONE handler invocation. Nothing it does is visible to the rest of the
 * simulation until `commit()`; a handler that throws therefore leaves no trace except the error.
 */
export function createNodeContext<M extends JsonValue>(node: NodeRuntime, env: ContextEnvironment): ContextHandle<M> {
  const effects: Effect[] = [];
  const writes = new Map<string, JsonValue | undefined>();
  let effectCount = 0;
  let active = true;
  let messagesSent = node.messagesSent;
  let timersSet = node.timersSet;

  const guard = (operation: string): void => {
    if (!active) throw new ProtocolViolationError(`ctx.${operation} was called after its handler returned`);
  };
  const count = (): void => {
    if (++effectCount > env.maxEffects) {
      throw new ProtocolViolationError(`a single handler produced more than ${env.maxEffects} effects`);
    }
  };
  const checkKey = (key: unknown): string => {
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH) {
      throw new ProtocolViolationError(`storage keys must be strings of 1–${MAX_STORAGE_KEY_LENGTH} characters`);
    }
    return key;
  };

  const send = (to: NodeId, payload: M): MessageId => {
    guard('send');
    if (to === node.id) throw new ProtocolViolationError(`${node.id} cannot send a message to itself`);
    if (typeof to !== 'string' || !env.isNode(to)) {
      throw new ProtocolViolationError(`${node.id} sent to unknown node ${String(to)}`);
    }
    count();
    const id = `${node.id}:m${++messagesSent}`;
    effects.push({ kind: 'send', id, to, payload: toFrozenJson(payload, `send(${to}).payload`) });
    return id;
  };

  const random: RandomSource = Object.freeze({
    nextUint32: () => (guard('random'), node.random.nextUint32()),
    nextFloat: () => (guard('random'), node.random.nextFloat()),
    nextInt: (min: number, max: number) => (guard('random'), node.random.nextInt(min, max)),
    chance: (p: number) => (guard('random'), node.random.chance(p)),
  });

  const storage: NodeStorage = Object.freeze({
    get: (key: string): JsonValue | undefined => {
      guard('storage.get');
      const k = checkKey(key);
      return writes.has(k) ? writes.get(k) : node.storage.get(k);
    },
    set: (key: string, value: JsonValue): void => {
      guard('storage.set');
      const k = checkKey(key);
      const frozen = toFrozenJson(value, `storage.set(${JSON.stringify(k)})`);
      count();
      writes.set(k, frozen);
    },
    delete: (key: string): void => {
      guard('storage.delete');
      const k = checkKey(key);
      count();
      writes.set(k, undefined);
    },
    keys: (): string[] => {
      guard('storage.keys');
      const keys = new Set(node.storage.keys());
      for (const [k, v] of writes) {
        if (v === undefined) keys.delete(k);
        else keys.add(k);
      }
      return [...keys].sort();
    },
  });

  const api: NodeContext<M> = Object.freeze({
    self: node.id,
    now: env.now,
    peers: node.peers,
    random,
    storage,
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
      count();
      const id = `${node.id}:t${++timersSet}`;
      effects.push({ kind: 'set-timer', id, tag, delay });
      return id;
    },
    cancelTimer: (id: TimerId): void => {
      guard('cancelTimer');
      if (typeof id !== 'string') throw new ProtocolViolationError('timer id must be a string');
      count();
      effects.push({ kind: 'cancel-timer', id });
    },
  });

  return {
    api,
    expire: () => {
      active = false;
    },
    commit: () => {
      node.messagesSent = messagesSent;
      node.timersSet = timersSet;
      return { effects, storageWrites: writes };
    },
  };
}
