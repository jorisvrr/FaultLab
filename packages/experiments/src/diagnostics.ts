import type { Protocol } from '@faultlab/engine';

type SpinState = { readonly ticks: number };

/**
 * DIAGNOSTIC protocol for the Worker watchdog (CP5). Every node ticks every 10 ticks; when n1's
 * tick reaches `spinAt`, its handler never returns. A handler that never returns cannot be
 * interrupted from inside its own thread: only terminating the Worker stops it, and such a run
 * is reported as aborted (not completed, not reproducible). Never use outside tests and the
 * diagnostics section of the UI.
 */
export function createSpinProtocol(spinAt = 100): Protocol<SpinState, null> {
  return {
    name: 'diagnostic-spin',
    version: '1',
    init(ctx) {
      ctx.setTimer(10, 'tick');
      return { ticks: 0 };
    },
    onMessage: (state) => state,
    onTimer(state, _timer, ctx) {
      if (ctx.self === 'n1' && ctx.now >= spinAt) {
        // Deliberate infinite loop. `for (;;)` with a side effect the optimiser cannot remove.
        let spins = 0;
        for (;;) spins = (spins + 1) | 0;
      }
      ctx.setTimer(10, 'tick');
      return { ticks: state.ticks + 1 };
    },
  };
}
