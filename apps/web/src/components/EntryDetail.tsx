import { useMemo } from 'react';
import type { TraceIndex } from '@faultlab/trace';
import { describeEntry } from '../format';
import { useSession } from '../app/session-context';
import { WindowedList } from './WindowedList';

const ROW = 24;

/**
 * One entry with its causal neighbourhood: cause chain, direct consequences, explained drops.
 *
 * The cause chain can be thousands of entries long (heartbeat timers re-arm themselves, so the
 * chain grows with the run). Computing it is cheap (≈ 0.2 ms for 8 001 entries); rendering it
 * was not. The lists are windowed: the whole chain stays reachable (scroll, or jump to the
 * root), but only the visible rows are rendered.
 */
export function EntryDetail({ index, at }: { index: TraceIndex; at: number }) {
  const session = useSession();
  const entry = index.entry(at);
  // Entries are immutable once received, so the causal neighbourhood depends on `at` only…
  const ancestors = useMemo(() => index.ancestors(at), [index, at]);
  // …except consequences, which can appear as the trace grows: recomputed on every render.
  const { direct, explained } = index.consequences(at);
  const go = (i: number) => (
    <>
      <button type="button" className="link" onClick={() => session.setCursor(i)}>
        #{i}
      </button>{' '}
      {index.entry(i).kind} · {describeEntry(index.entry(i))}
    </>
  );
  const root = ancestors.at(-1);
  return (
    <section className="entry-detail" aria-label={`Entry ${at}`} data-testid="entry-detail">
      <h3>
        #{at} {entry.kind} · t={entry.time} · step {index.stepOf(at) ?? '—'}
      </h3>
      <p>{describeEntry(entry)}</p>
      <h4>
        Caused by (nearest first, back to run.start): <span data-testid="ancestors-count">{ancestors.length}</span> {ancestors.length === 1 ? 'entry' : 'entries'}
      </h4>
      {root !== undefined && (
        <p>
          <button type="button" onClick={() => session.setCursor(ancestors[0]!)} data-testid="ancestors-nearest">
            Nearest cause #{ancestors[0]}
          </button>{' '}
          <button type="button" onClick={() => session.setCursor(root)} data-testid="ancestors-root">
            Root #{root}
          </button>
        </p>
      )}
      <WindowedList items={ancestors} rowHeight={ROW} maxRows={8} label="Cause chain" testId="ancestors" resetKey={at} renderItem={go} empty={<li>— (root)</li>} />
      <h4>Direct consequences ({direct.length})</h4>
      <WindowedList items={direct} rowHeight={ROW} maxRows={6} label="Direct consequences" testId="consequences" resetKey={at} renderItem={go} empty={<li>none</li>} />
      {explained.length > 0 && (
        <>
          <h4>Messages dropped because of this fault ({explained.length})</h4>
          <WindowedList items={explained} rowHeight={ROW} maxRows={6} label="Dropped messages" testId="explained" resetKey={at} renderItem={go} empty={null} />
        </>
      )}
      <details>
        <summary>Raw entry</summary>
        <pre>{JSON.stringify(entry, null, 2)}</pre>
      </details>
    </section>
  );
}
