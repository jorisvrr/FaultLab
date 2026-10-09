import { useFrame, useSessionView } from '../../app/session-context';
import { NodeInspector, NodeTable } from '../../components/NodeTable';

/** SIMULATE: live execution and the network state at the cursor. */
export function SimulateView() {
  const { experiment, run, follow } = useSessionView();
  const frame = useFrame();
  if (experiment === null) return <p className="hint">Choose and load an experiment in Configure first.</p>;
  return (
    <div className="simulate" data-testid="simulate">
      <header>
        <h2>{experiment.title}</h2>
        <p data-testid="mode">
          {run.lifecycle === 'running' || run.lifecycle === 'paused' || run.lifecycle === 'ready'
            ? follow
              ? 'Live: showing the newest state the Worker has produced.'
              : 'Inspecting an earlier position while the run continues in the Worker.'
            : run.lifecycle === 'loading' || run.lifecycle === 'idle'
              ? ''
              : 'Replay: the run is over; you are inspecting the trace it produced.'}
        </p>
        {run.error !== null && (
          <p role="alert" className="alert" data-testid="error">
            {run.error}
          </p>
        )}
        {run.lifecycle === 'aborted' && (
          <p role="alert" className="alert" data-testid="aborted">
            {run.abortReason}. The trace below is incomplete and this outcome is not reproducible.
          </p>
        )}
        {run.fingerprint !== null && (
          <p data-testid="fingerprint" data-matches={run.fingerprint.matches === null ? 'pending' : String(run.fingerprint.matches)}>
            {run.fingerprint.matches === null
              ? `Worker fingerprint ${run.fingerprint.worker} · verifying the received trace…`
              : run.fingerprint.matches
                ? `Trace fingerprint ${run.fingerprint.received} ✓ equals the Worker’s`
                : `✗ the received trace (${run.fingerprint.received ?? 'incomplete'}) differs from the Worker’s ${run.fingerprint.worker}`}
          </p>
        )}
      </header>
      {frame === null ? (
        <p className="hint">Waiting for the first trace entries…</p>
      ) : (
        <div className="simulate__body">
          <NodeTable frame={frame} />
          <section aria-label="Network">
            <h3>Network</h3>
            <p data-testid="partition">Partition: {frame.partition === null ? 'none' : frame.partition.map((g) => `[${g.join(' ')}]`).join(' | ')}</p>
            <p>Degraded links: {frame.links.length === 0 ? 'none' : frame.links.map((l) => `${l.from}→${l.to}`).join(', ')}</p>
            <p data-testid="in-flight">Messages in flight: {frame.inFlight.length}</p>
          </section>
          <section aria-label="Checks">
            <h3>Safety and liveness</h3>
            <p data-testid="open-violations">
              Open safety violations: {frame.openViolations.length === 0 ? 'none' : frame.openViolations.map((v) => `${v.invariant.id}: ${v.observed}`).join('; ')}
            </p>
            <ul data-testid="liveness">
              {frame.liveness.map((l) => (
                <li key={l.id}>
                  {l.id}: {l.phase}
                  {l.deadlineAt !== null && l.phase === 'waiting' ? ` (test bound t=${l.deadlineAt})` : ''}
                </li>
              ))}
            </ul>
          </section>
          <NodeInspector frame={frame} />
        </div>
      )}
    </div>
  );
}
