import { useEffect } from 'react';
import { useSession, useSessionView } from '../app/session-context';
import { LifecycleBadge } from './LifecycleBadge';

/**
 * UX-002: essential controls, docked at the bottom of the viewport and always visible.
 * Execution controls (run, pause, step, stop) talk to the Worker; inspection controls (cursor,
 * follow, replay, marker navigation) only move the cursor over the received trace.
 *
 * Keyboard: Space run/pause · ←/→ entry · Shift+←/→ simulation step · [ / ] previous/next marker
 * · Home/End first/last entry · F follow live.
 */
export function PlaybackBar() {
  const session = useSession();
  const view = useSessionView();
  const { run, length, cursor, follow, replaying } = view;
  const index = session.trace.index;
  const entry = index !== null && length > 0 ? index.entry(cursor) : null;
  const step = index !== null && length > 0 ? index.stepOf(cursor) : null;
  const canRun = run.lifecycle === 'ready' || run.lifecycle === 'paused';
  const active = run.lifecycle === 'ready' || run.lifecycle === 'running' || run.lifecycle === 'paused';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const s = session.view;
      if (event.key === ' ') {
        event.preventDefault();
        if (s.run.lifecycle === 'running') session.pause();
        else if (s.run.lifecycle === 'ready' || s.run.lifecycle === 'paused') session.run();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.shiftKey) session.moveSteps(1);
        else session.moveEntries(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.shiftKey) session.moveSteps(-1);
        else session.moveEntries(-1);
      } else if (event.key === ']') session.moveMarker(1);
      else if (event.key === '[') session.moveMarker(-1);
      else if (event.key === 'Home') session.setCursor(0);
      else if (event.key === 'End') session.setCursor(s.length - 1);
      else if (event.key === 'f' || event.key === 'F') session.setFollow(!s.follow);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [session]);

  return (
    <footer className="playback" aria-label="Playback and execution controls" data-testid="playback">
      <LifecycleBadge />
      <div className="playback__row" role="toolbar" aria-label="Execution">
        <button type="button" onClick={session.run} disabled={!canRun} data-testid="run" aria-keyshortcuts="Space">Run</button>
        <button type="button" onClick={session.pause} disabled={run.lifecycle !== 'running'} data-testid="pause" aria-keyshortcuts="Space">Pause</button>
        <button type="button" onClick={() => session.step(1)} disabled={!canRun} data-testid="step">Step</button>
        <button type="button" onClick={session.stop} disabled={!active || run.pending === 'stop'} data-testid="stop" title="End the run normally; everything produced so far is kept">Stop</button>
        <button type="button" onClick={() => session.restart()} disabled={view.spec === null} data-testid="restart" title="Run the same experiment again from the start">Restart</button>
        <span className="playback__stats" data-testid="stats">
          steps {run.stepsCompleted} · t={run.now} · entries {run.received}
          {run.produced > run.received ? ` (+${run.produced - run.received} in transfer)` : ''}
        </span>
      </div>
      <div className="playback__row" role="toolbar" aria-label="Inspection">
        <button type="button" onClick={() => session.moveMarker(-1)} disabled={length === 0} aria-label="Previous marker" aria-keyshortcuts="[">⟨ marker</button>
        <button type="button" onClick={() => session.moveSteps(-1)} disabled={length === 0} aria-label="Previous simulation step" aria-keyshortcuts="Shift+ArrowLeft">⟨ step</button>
        <button type="button" onClick={() => session.moveEntries(-1)} disabled={length === 0} aria-label="Previous entry" aria-keyshortcuts="ArrowLeft">⟨</button>
        <input
          type="range"
          aria-label="Trace position (entry)"
          data-testid="cursor"
          min={0}
          max={Math.max(0, length - 1)}
          value={cursor}
          onChange={(e) => session.setCursor(Number(e.currentTarget.value))}
          disabled={length === 0}
        />
        <button type="button" onClick={() => session.moveEntries(1)} disabled={length === 0} aria-label="Next entry" aria-keyshortcuts="ArrowRight">⟩</button>
        <button type="button" onClick={() => session.moveSteps(1)} disabled={length === 0} aria-label="Next simulation step" aria-keyshortcuts="Shift+ArrowRight">step ⟩</button>
        <button type="button" onClick={() => session.moveMarker(1)} disabled={length === 0} aria-label="Next marker" aria-keyshortcuts="]">marker ⟩</button>
        <label>
          <input type="checkbox" checked={follow} onChange={(e) => session.setFollow(e.currentTarget.checked)} data-testid="follow" aria-keyshortcuts="F" /> follow live
        </label>
        <button type="button" onClick={() => (replaying ? session.stopReplay() : session.replay())} disabled={length < 2} data-testid="replay">
          {replaying ? 'Stop replay' : 'Replay'}
        </button>
        <span className="playback__position" data-testid="position" aria-live="off">
          {entry === null ? '—' : `entry #${cursor} · step ${step ?? '—'} · t=${entry.time} · ${entry.kind}`}
        </span>
      </div>
    </footer>
  );
}
