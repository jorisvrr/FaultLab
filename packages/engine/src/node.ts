import type { JsonValue } from './json';
import type { NodeId, TimerId } from './protocol';
import type { Xoshiro128 } from './random';
import type { EventSeq } from './scheduler';

export type NodeStatus = 'idle' | 'running' | 'crashed';

/**
 * Engine-side record of one virtual node. Protocol code never sees this object.
 *
 * The fields are grouped by what a crash does to them (ADR-0008):
 *
 * | Category                   | Fields                               | Crash        | Recovery          |
 * |----------------------------|--------------------------------------|--------------|-------------------|
 * | volatile protocol state    | state                                | discarded    | rebuilt by init   |
 * | persistent protocol state  | storage                              | kept         | visible to init   |
 * | node runtime state         | status, incarnation, timers, crashedAt | updated    | updated           |
 * | infrastructure             | id, peers, random, id counters       | untouched    | untouched         |
 */
export class NodeRuntime {
  // Infrastructure: never reset. The PRNG stream continues across crashes so a restarted node
  // does not replay its earlier "random" choices; counters keep message/timer ids unique.
  readonly id: NodeId;
  readonly peers: readonly NodeId[];
  readonly random: Xoshiro128;
  messagesSent = 0;
  timersSet = 0;

  // Runtime state.
  status: NodeStatus = 'idle';
  /** 0 before the first start, 1 after it, +1 per recovery. */
  incarnation = 0;
  /** Trace index of the crash that took the node down, while it is crashed. */
  crashedAt: number | null = null;
  /** Pending timers of the CURRENT incarnation, mapped to their scheduler sequence numbers. */
  readonly timers = new Map<TimerId, EventSeq>();

  // Protocol state.
  /** Volatile: undefined until init has run, and again after a crash. */
  state: JsonValue | undefined = undefined;
  /** Persistent: survives crashes. Written only by committed steps (sync-on-commit). */
  readonly storage = new Map<string, JsonValue>();

  constructor(id: NodeId, peers: readonly NodeId[], random: Xoshiro128) {
    this.id = id;
    this.peers = peers;
    this.random = random;
  }

  /** Begin a new incarnation (first start or recovery). The caller then runs `init`. */
  boot(): void {
    this.status = 'running';
    this.incarnation++;
    this.crashedAt = null;
    this.state = undefined;
  }

  /**
   * Crash: discard volatile state and hand back every pending timer so the caller can cancel it
   * in the scheduler. Storage and infrastructure are untouched. The caller records the crash in
   * the trace and stores that entry's index in `crashedAt`.
   */
  crash(): Array<[TimerId, EventSeq]> {
    const pending = [...this.timers];
    this.timers.clear();
    this.status = 'crashed';
    this.state = undefined;
    return pending;
  }
}
