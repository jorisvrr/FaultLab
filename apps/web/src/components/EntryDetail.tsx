import type { TraceIndex } from '@faultlab/trace';
import { describeEntry } from '../format';
import { useSession } from '../app/session-context';

/** One entry with its causal neighbourhood: cause chain, direct consequences, explained drops. */
export function EntryDetail({ index, at }: { index: TraceIndex; at: number }) {
  const session = useSession();
  const entry = index.entry(at);
  const ancestors = index.ancestors(at);
  const { direct, explained } = index.consequences(at);
  const go = (i: number) => (
    <li key={i}>
      <button type="button" className="link" onClick={() => session.setCursor(i)}>
        #{i}
      </button>{' '}
      {index.entry(i).kind} · {describeEntry(index.entry(i))}
    </li>
  );
  return (
    <section className="entry-detail" aria-label={`Entry ${at}`} data-testid="entry-detail">
      <h3>
        #{at} {entry.kind} · t={entry.time} · step {index.stepOf(at) ?? '—'}
      </h3>
      <p>{describeEntry(entry)}</p>
      <h4>Caused by (back to run.start)</h4>
      <ol data-testid="ancestors">{ancestors.length === 0 ? <li>— (root)</li> : ancestors.map(go)}</ol>
      <h4>Direct consequences</h4>
      <ul data-testid="consequences">{direct.length === 0 ? <li>none</li> : direct.map(go)}</ul>
      {explained.length > 0 && (
        <>
          <h4>Messages dropped because of this fault</h4>
          <ul>{explained.map(go)}</ul>
        </>
      )}
      <details>
        <summary>Raw entry</summary>
        <pre>{JSON.stringify(entry, null, 2)}</pre>
      </details>
    </section>
  );
}
