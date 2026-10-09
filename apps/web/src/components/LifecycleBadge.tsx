import type { Lifecycle } from '@faultlab/runtime';
import { useSessionView } from '../app/session-context';

const LABEL: Record<Lifecycle, string> = {
  idle: 'No experiment loaded',
  loading: 'Loading…',
  ready: 'Ready (not started)',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  stopped: 'Stopped by you',
  aborted: 'Aborted (Worker terminated)',
  error: 'Error',
};

/** UX-001: the run's lifecycle is always explicit, including pending pause/stop and replay. */
export function LifecycleBadge() {
  const { run, replaying } = useSessionView();
  const pending = run.pending === 'pause' ? ' · pausing at the next step boundary…' : run.pending === 'stop' ? ' · stopping…' : '';
  const reason = run.lifecycle === 'completed' && run.stopReason !== null ? ` · ${run.stopReason}` : '';
  return (
    <div className="lifecycle" data-testid="lifecycle" data-state={run.lifecycle} role="status" aria-live="polite">
      <span className="lifecycle__state">{LABEL[run.lifecycle]}</span>
      <span>{reason}{pending}</span>
      {replaying && <span data-testid="replaying"> · replaying the received trace</span>}
      {run.throttled && <span data-testid="throttled"> · waiting for the UI to catch up</span>}
    </div>
  );
}
