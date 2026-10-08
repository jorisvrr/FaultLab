import type { Protocol } from '../protocol';

export type EchoMessage = { readonly hop: number };
export type EchoState = { readonly echoes: number };

/**
 * Never terminates on its own: the first node sends a message to the second, and every
 * receiver bounces it back to the sender. Used to prove that `limits.maxEvents` and
 * `limits.maxTime` stop runaway protocols.
 */
export const echoForever: Protocol<EchoState, EchoMessage> = {
  name: 'echo-forever',
  version: '1',
  init(ctx) {
    const first = [ctx.self, ...ctx.peers].sort()[0];
    if (ctx.self === first && ctx.peers.length > 0) ctx.send(ctx.peers[0] as string, { hop: 0 });
    return { echoes: 0 };
  },
  onMessage(state, message, ctx) {
    ctx.send(message.from, { hop: message.payload.hop + 1 });
    return { echoes: state.echoes + 1 };
  },
  onTimer(state) {
    return state;
  },
};
