import { ConfigureView } from '../features/configure/ConfigureView';
import { InvestigateView } from '../features/investigate/InvestigateView';
import { SimulateView } from '../features/simulate/SimulateView';
import { PlaybackBar } from '../components/PlaybackBar';
import { MODES, useMode } from './route';
import { useSessionView } from './session-context';

/**
 * Application shell (CP5): header with the three modes, the active view, and the docked playback
 * bar (UX-002). Minimal styling on purpose: the approved visual design arrives in CP6 and
 * replaces the presentation, not this structure.
 */
export function App() {
  const [mode, setMode] = useMode();
  const { experiment } = useSessionView();
  return (
    <div className="shell">
      <header className="shell__header">
        <h1>FaultLab</h1>
        <nav aria-label="Mode">
          {MODES.map((m) => (
            <a key={m.id} href={`#/${m.id}`} aria-current={mode === m.id ? 'page' : undefined} data-testid={`mode-${m.id}`}>
              {m.label}
            </a>
          ))}
        </nav>
        <span className="shell__experiment" data-testid="experiment">
          {experiment === null ? 'no experiment loaded' : experiment.title}
        </span>
      </header>
      <main className="shell__main" id="main">
        {mode === 'configure' && <ConfigureView onLoaded={() => setMode('simulate')} />}
        {mode === 'simulate' && <SimulateView />}
        {mode === 'investigate' && <InvestigateView />}
      </main>
      <PlaybackBar />
    </div>
  );
}
