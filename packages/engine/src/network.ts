import type { NodeId } from './protocol';
import type { RandomSource } from './random';
import type { Duration, VirtualTime } from './time';

export interface LatencyRange {
  /** Inclusive lower bound in ticks (integer >= 0). */
  readonly min: Duration;
  /** Inclusive upper bound in ticks (integer >= min). */
  readonly max: Duration;
}

export interface NetworkConfig {
  /** Latency applied to every link; each message draws uniformly from [min, max]. */
  readonly latency: LatencyRange;
}

/** What the network decided for one message. CP2 adds `{ kind: 'drop'; reason }`. */
export type RoutingDecision = { readonly kind: 'deliver'; readonly deliverAt: VirtualTime };

/**
 * Explicit model of the network between nodes.
 *
 * CP0 semantics: a fully connected network, every message is delivered exactly once, latency
 * is drawn per message from the network's own random stream. Links are NOT FIFO — two messages
 * on the same link can arrive in either order if their latencies differ — which matches
 * datagram networks and is what protocols such as Raft are designed to tolerate.
 */
export class VirtualNetwork {
  readonly #config: NetworkConfig;
  readonly #random: RandomSource;

  constructor(config: NetworkConfig, random: RandomSource) {
    this.#config = config;
    this.#random = random;
  }

  route(_from: NodeId, _to: NodeId, now: VirtualTime): RoutingDecision {
    const { min, max } = this.#config.latency;
    return { kind: 'deliver', deliverAt: now + this.#random.nextInt(min, max) };
  }
}
