import type { Protocol } from '../protocol';

export type PingMessage = { readonly type: 'ping'; readonly round: number } | { readonly type: 'pong'; readonly round: number };

export type PingState = {
  readonly round: number;
  readonly pingsReceived: number;
  readonly pongsReceived: number;
};

export interface PingOptions {
  /** Number of broadcast rounds each node performs (>= 1). */
  readonly rounds?: number;
  /** Base ticks between rounds. */
  readonly interval?: number;
  /** Extra random ticks (0..jitter) added to each interval from the node's own stream. */
  readonly jitter?: number;
}

/**
 * CP0's minimal message-passing protocol. Every node broadcasts `ping` to all peers once per
 * round; every `ping` is answered with a `pong` to its sender. Round timers use the node's
 * seeded random stream for jitter, so the protocol exercises messages, timers and randomness.
 *
 * With n nodes and r rounds the run is finite: n·r·(n−1) pings, the same number of pongs.
 */
export function createPingProtocol(options: PingOptions = {}): Protocol<PingState, PingMessage> {
  const { rounds = 1, interval = 50, jitter = 0 } = options;
  const nextDelay = (random: { nextInt(min: number, max: number): number }): number =>
    interval + (jitter > 0 ? random.nextInt(0, jitter) : 0);

  return {
    name: 'ping',
    version: '1',
    init(ctx) {
      ctx.broadcast({ type: 'ping', round: 1 });
      if (rounds > 1) ctx.setTimer(nextDelay(ctx.random), 'next-round');
      return { round: 1, pingsReceived: 0, pongsReceived: 0 };
    },
    onMessage(state, message, ctx) {
      const { payload } = message;
      if (payload.type === 'ping') {
        ctx.send(message.from, { type: 'pong', round: payload.round });
        return { ...state, pingsReceived: state.pingsReceived + 1 };
      }
      return { ...state, pongsReceived: state.pongsReceived + 1 };
    },
    onTimer(state, timer, ctx) {
      if (timer.tag !== 'next-round') return state;
      const round = state.round + 1;
      ctx.broadcast({ type: 'ping', round });
      if (round < rounds) ctx.setTimer(nextDelay(ctx.random), 'next-round');
      return { ...state, round };
    },
  };
}
