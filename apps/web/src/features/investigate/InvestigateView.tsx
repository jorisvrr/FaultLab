import { useMemo, useState } from 'react';
import { ENGINE_VERSION, fingerprintTrace, LEGACY_TRACE_VERSIONS, projectTrace, type LegacyTraceVersion } from '@faultlab/engine';
import { COUNTEREXAMPLES } from '@faultlab/experiments';
import type { MarkerKind } from '@faultlab/trace';
import { useFrame, useSession, useSessionView } from '../../app/session-context';
import { EntryDetail } from '../../components/EntryDetail';
import { NodeInspector } from '../../components/NodeTable';
import { describeEntry, entryTone } from '../../format';

const WINDOW = 25;

/** INVESTIGATE: historical inspection, causal navigation and violation analysis. */
export function InvestigateView() {
  const session = useSession();
  const view = useSessionView();
  const frame = useFrame();
  const index = session.trace.index;
  const [kinds, setKinds] = useState<'all' | 'markers'>('all');
  const markerKinds: MarkerKind[] = ['crash', 'recover', 'partition', 'heal', 'link-fault', 'link-restore', 'violation', 'violation-cleared', 'liveness-met', 'liveness-missed', 'protocol-error', 'run-end'];

  const fixture = useMemo(() => COUNTEREXAMPLES.find((c) => c.id === view.experiment?.id), [view.experiment]);
  const verification = useMemo(() => {
    if (fixture === undefined || index === null || view.run.lifecycle !== 'completed') return null;
    const legacy = fixture.expected.engineVersion !== ENGINE_VERSION && (LEGACY_TRACE_VERSIONS as readonly string[]).includes(fixture.expected.engineVersion);
    const actual = legacy ? fingerprintTrace(projectTrace(index.trace, fixture.expected.engineVersion as LegacyTraceVersion) as never) : fingerprintTrace(index.trace);
    return { expected: fixture.expected.fingerprint, actual, legacy };
  }, [fixture, index, view.run.lifecycle, view.traceVersion]);

  if (index === null || frame === null) return <p className="hint">Load and run an experiment first; its trace is inspected here.</p>;
  const rows =
    kinds === 'markers'
      ? index.markers.map((m) => m.index)
      : Array.from({ length: Math.min(index.length, 2 * WINDOW + 1) }, (_, k) => Math.max(0, Math.min(index.length - (2 * WINDOW + 1), view.cursor - WINDOW)) + k).filter((i) => i >= 0 && i < index.length);

  return (
    <div className="investigate" data-testid="investigate">
      <section className="investigate__entries" aria-label="Trace entries">
        <h2>Trace ({index.length} entries)</h2>
        <div role="radiogroup" aria-label="Show">
          <label>
            <input type="radio" checked={kinds === 'all'} onChange={() => setKinds('all')} /> entries around the cursor
          </label>
          <label>
            <input type="radio" checked={kinds === 'markers'} onChange={() => setKinds('markers')} data-testid="show-markers" /> markers only
          </label>
        </div>
        <ol className="entries" data-testid="entries">
          {rows.map((i) => {
            const e = index.entry(i);
            return (
              <li key={i} aria-current={i === view.cursor ? 'true' : undefined} data-tone={entryTone(e) ?? undefined}>
                <button type="button" className="link" onClick={() => session.setCursor(i)} data-testid={`entry-${i}`}>
                  #{i} t={e.time} {e.kind}
                </button>{' '}
                {describeEntry(e)}
              </li>
            );
          })}
        </ol>
      </section>
      <EntryDetail index={index} at={view.cursor} />
      <section className="investigate__side" aria-label="Analysis">
        <h3>Safety violations ({index.violations.length})</h3>
        <ul data-testid="violations">
          {index.violations.length === 0 ? (
            <li>none recorded</li>
          ) : (
            index.violations.map((v) => (
              <li key={v.index}>
                <button type="button" className="link" onClick={() => session.setCursor(v.index)} data-testid={`violation-${v.index}`}>
                  #{v.index} t={v.time}
                </button>{' '}
                <strong>{v.invariant.id}</strong>: {v.observed}
                <br />
                expected: {v.expected}
                <br />
                cited:{' '}
                {v.references.map((r) => (
                  <button key={r} type="button" className="link" onClick={() => session.setCursor(r)}>
                    #{r}{' '}
                  </button>
                ))}
              </li>
            ))
          )}
        </ul>
        <h3>Markers</h3>
        <p>
          <button type="button" onClick={() => session.moveMarker(-1, markerKinds)}>⟨ previous</button>{' '}
          <button type="button" onClick={() => session.moveMarker(1, markerKinds)}>next ⟩</button>
        </p>
        {verification !== null && (
          <p data-testid="fixture-verification" data-matches={verification.actual === verification.expected}>
            Stored counterexample fingerprint {verification.expected}: {verification.actual === verification.expected ? 'reproduced ✓' : `differs ✗ (${verification.actual})`}
            {verification.legacy ? ' (via the legacy trace projection)' : ''}
          </p>
        )}
        <NodeInspector frame={frame} />
      </section>
    </div>
  );
}
