import type { NodeId, Protocol, TimerId } from '../protocol';

export type HeartbeatMessage = { readonly type: 'heartbeat'; readonly boot: number };

export type HeartbeatState = {
  /** This incarnation's boot number, read from and persisted to storage. */
  readonly boot: number;
  /** Virtual time each peer was last heard from (volatile: forgotten on crash). */
  readonly lastHeard: { readonly [peer: string]: number };
  /** Peers currently suspected of having failed, in peer order. */
  readonly suspected: readonly NodeId[];
  /** The pending suspicion timer per peer. */
  readonly watchdogs: { readonly [peer: string]: TimerId };
};

export interface HeartbeatOptions {
  /** Ticks between heartbeats (>= 1). */
  readonly interval?: number;
  /** Extra random ticks (0..jitter) per interval, from the node's own stream. */
  readonly jitter?: number;
  /** Ticks without a heartbeat after which a peer is suspected. */
  readonly timeout?: number;
}

/**
 * CP1 fixture: a heartbeat failure detector, the simplest protocol in which crashes, recovery,
 * partitions and message loss have visible consequences.
 *
 * - Every node broadcasts a heartbeat every `interval` (+ jitter) ticks.
 * - Each node keeps one "watchdog" timer per peer; every heartbeat from that peer cancels and
 *   re-arms it (the timer-reset pattern of Raft election timeouts). If it fires, the peer is
 *   suspected; the next heartbeat clears the suspicion.
 * - The boot counter lives in persistent storage, so after a recovery a node knows it restarted
 *   while its volatile knowledge (lastHeard, suspicions) starts from scratch.
 *
 * It never stops on its own; runs are bounded by limits.
 */
export function createHeartbeatProtocol(options: HeartbeatOptions = {}): Protocol<HeartbeatState, HeartbeatMessage> {
  const { interval = 20, jitter = 5, timeout = 60 } = options;
  const nextBeat = (random: { nextInt(min: number, max: number): number }): number =>
    interval + (jitter > 0 ? random.nextInt(0, jitter) : 0);

  return {
    name: 'heartbeat',
    version: '1',
    init(ctx) {
      const boot = ((ctx.storage.get('boots') as number | undefined) ?? 0) + 1;
      ctx.storage.set('boots', boot);
      ctx.setTimer(nextBeat(ctx.random), 'beat');
      const watchdogs: Record<string, TimerId> = {};
      for (const peer of ctx.peers) watchdogs[peer] = ctx.setTimer(timeout, `suspect:${peer}`);
      return { boot, lastHeard: {}, suspected: [], watchdogs };
    },
    onMessage(state, message, ctx) {
      const peer = message.from;
      const previous = state.watchdogs[peer];
      if (previous !== undefined) ctx.cancelTimer(previous);
      return {
        ...state,
        lastHeard: { ...state.lastHeard, [peer]: ctx.now },
        suspected: state.suspected.filter((p) => p !== peer),
        watchdogs: { ...state.watchdogs, [peer]: ctx.setTimer(timeout, `suspect:${peer}`) },
      };
    },
    onTimer(state, timer, ctx) {
      if (timer.tag === 'beat') {
        ctx.broadcast({ type: 'heartbeat', boot: state.boot });
        ctx.setTimer(nextBeat(ctx.random), 'beat');
        return state;
      }
      const peer = timer.tag.slice('suspect:'.length);
      const { [peer]: _expired, ...watchdogs } = state.watchdogs;
      const suspected = ctx.peers.filter((p) => p === peer || state.suspected.includes(p));
      return { ...state, suspected, watchdogs };
    },
  };
}
