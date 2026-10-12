import { ConfigureView } from '../features/configure/ConfigureView';
import { InvestigateView } from '../features/investigate/InvestigateView';
import { SimulateView } from '../features/simulate/SimulateView';
import { PlaybackBar } from '../components/PlaybackBar';
import { AppShell, Chip, DecorativeMotif, Header } from '../design';
import { MODES, useMode } from './route';
import { useSessionView } from './session-context';

/**
 * Application shell. Configure wears the Gate 3 design; Simulate and Investigate keep their
 * CP5 presentation until their own gates, so the application is never broken between gates.
 */
export function App() {
  const [mode, setMode] = useMode();
  const { experiment, run } = useSessionView();
  const styled = mode === 'configure';
  const header = (
    <Header
      nav={MODES.map((m) => ({ id: m.id, label: m.label, href: `#/${m.id}`, current: mode === m.id, testId: `mode-${m.id}` }))}
      end={
        <>
          <Chip tone={experiment === null ? 'neutral' : 'accent'} glyph={experiment !== null} data-testid="experiment">
            {experiment === null ? 'no experiment loaded' : experiment.title}
          </Chip>
          <DecorativeMotif />
        </>
      }
    />
  );

  if (!styled) {
    // CP5 presentation, unchanged, so Simulate and Investigate keep working until their gates.
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
          {mode === 'simulate' && <SimulateView />}
          {mode === 'investigate' && <InvestigateView />}
        </main>
        <PlaybackBar />
      </div>
    );
  }

  return (
    <AppShell header={header}>
      <ConfigureView onLoaded={() => setMode('simulate')} />
      {run.error !== null && (
        <p role="alert" className="alert" data-testid="load-error">
          {run.error}
        </p>
      )}
    </AppShell>
  );
}
