import type { NodeId } from './protocol';
import type { Xoshiro128, Xoshiro128State } from './random';
import type { Duration, VirtualTime } from './time';

export interface LatencyRange {
  /** Inclusive lower bound in ticks (integer >= 0). */
  readonly min: Duration;
  /** Inclusive upper bound in ticks (integer >= min). */
  readonly max: Duration;
}

export interface NetworkConfig {
  /** Base latency applied to every link; each message draws uniformly from [min, max]. */
  readonly latency: LatencyRange;
}

/** Why a message was not delivered. */
export type DropReason =
  /** Sender and receiver were in different partition groups when it was sent. */
  | 'partitioned'
  /** A partition separated sender and receiver while the message was in flight. */
  | 'partitioned-in-flight'
  /** The link's loss probability dropped it at send time. */
  | 'lost'
  /** The receiver was crashed when the message arrived. */
  | 'node-down';

/**
 * What the network decided for one message at send time. `conditionIndex` is the trace index of
 * the fault entry that caused a drop (the partition or link fault), for explaining it later.
 */
export type RoutingDecision =
  | { readonly kind: 'deliver'; readonly deliverAt: VirtualTime }
  | { readonly kind: 'drop'; readonly reason: 'partitioned' | 'lost'; readonly conditionIndex: number };

export interface LinkCondition {
  readonly loss: number;
  readonly delay: LatencyRange;
}

/** Snapshot of the active network conditions; `since` is the trace index of the establishing fault. */
export interface NetworkConditions {
  readonly partition: { readonly groups: readonly (readonly NodeId[])[]; readonly since: number } | null;
  readonly links: readonly {
    readonly from: NodeId;
    readonly to: NodeId;
    readonly loss: number;
    readonly delay: LatencyRange;
    readonly since: number;
  }[];
}

interface ActiveLink extends LinkCondition {
  /** Trace index of the `link.fault` entry that set this condition. */
  readonly since: number;
}

interface ActivePartition {
  readonly groups: readonly (readonly NodeId[])[];
  readonly groupOf: ReadonlyMap<NodeId, number>;
  /** Trace index of the `network.partition` entry. */
  readonly since: number;
}

/**
 * Explicit model of the network between nodes (ADR-0010).
 *
 * - Fully connected; base latency drawn per message from the network's own random stream.
 * - Links are NOT FIFO: messages can overtake each other when latencies differ.
 * - Directed link conditions (loss, extra delay) decide a message's fate once, at send time.
 * - Partitions are checked at send AND at delivery, so a new partition also cuts messages
 *   that are already in flight.
 *
 * Random draws happen only for active conditions, so a run without faults consumes exactly one
 * draw per message — the same as CP0.
 */
export class VirtualNetwork {
  readonly #config: NetworkConfig;
  readonly #random: Xoshiro128;
  readonly #links = new Map<string, ActiveLink>();
  #partition: ActivePartition | null = null;

  constructor(config: NetworkConfig, random: Xoshiro128) {
    this.#config = config;
    this.#random = random;
  }

  /** Install a partition (replacing any active one). `groups` must cover every node exactly once. */
  partition(groups: readonly (readonly NodeId[])[], since: number): void {
    const groupOf = new Map<NodeId, number>();
    groups.forEach((group, g) => group.forEach((id) => groupOf.set(id, g)));
    this.#partition = { groups, groupOf, since };
  }

  /** State of the network's random stream (for snapshots). */
  randomState(): Xoshiro128State {
    return this.#random.getState();
  }

  heal(): void {
    this.#partition = null;
  }

  setLink(from: NodeId, to: NodeId, condition: LinkCondition, since: number): void {
    this.#links.set(linkKey(from, to), { loss: condition.loss, delay: condition.delay, since });
  }

  restoreLink(from: NodeId, to: NodeId): void {
    this.#links.delete(linkKey(from, to));
  }

  /** Decide the fate of a message sent now: partition, then loss, then latency. */
  route(from: NodeId, to: NodeId, now: VirtualTime): RoutingDecision {
    const cut = this.#separatedBy(from, to);
    if (cut !== null) return { kind: 'drop', reason: 'partitioned', conditionIndex: cut };

    // Fast path: no link faults at all (the common case) needs no key string or map lookup.
    const link = this.#links.size === 0 ? undefined : this.#links.get(linkKey(from, to));
    if (link !== undefined && link.loss > 0 && this.#random.chance(link.loss)) {
      return { kind: 'drop', reason: 'lost', conditionIndex: link.since };
    }

    const { min, max } = this.#config.latency;
    let latency = this.#random.nextInt(min, max);
    if (link !== undefined && link.delay.max > 0) latency += this.#random.nextInt(link.delay.min, link.delay.max);
    return { kind: 'deliver', deliverAt: now + latency };
  }

  /**
   * Read-only description of every active condition, with the trace index of the fault entry
   * that established it. Used for invariant views and violation records. Returns fresh, frozen
   * data; nothing in it aliases the network's internal maps.
   */
  conditions(): NetworkConditions {
    const partition = this.#partition;
    return Object.freeze({
      partition: partition === null ? null : Object.freeze({ groups: partition.groups, since: partition.since }),
      links: Object.freeze(
        [...this.#links].map(([key, link]) => {
          const [from, to] = key.split('>') as [NodeId, NodeId];
          return Object.freeze({ from, to, loss: link.loss, delay: link.delay, since: link.since });
        }),
      ),
    });
  }

  /** At delivery time: the trace index of the partition that now separates the pair, or null. */
  blockedAtDelivery(from: NodeId, to: NodeId): number | null {
    return this.#separatedBy(from, to);
  }

  #separatedBy(from: NodeId, to: NodeId): number | null {
    const partition = this.#partition;
    if (partition === null) return null;
    return partition.groupOf.get(from) === partition.groupOf.get(to) ? null : partition.since;
  }
}

/** Node ids cannot contain '>' (see config validation), so this key is unambiguous. */
const linkKey = (from: NodeId, to: NodeId): string => `${from}>${to}`;
