import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { SessionContext } from './app/session-context';
import { Session } from './state/session';
import './design/base.css';
import './styles.css';

/**
 * One Session per page. Each run gets its own Web Worker (created here), so the engine never
 * runs on the main thread. React re-renders at most once per animation frame.
 */
const session = new Session({
  createWorker: () => new Worker(new URL('./worker/simulation.worker.ts', import.meta.url), { type: 'module', name: 'faultlab-simulation' }) as never,
  schedule: (fn) => requestAnimationFrame(fn),
});
(globalThis as { faultlab?: unknown }).faultlab = { session }; // for end-to-end tests and the browser console

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionContext value={session}>
      <App />
    </SessionContext>
  </StrictMode>,
);
