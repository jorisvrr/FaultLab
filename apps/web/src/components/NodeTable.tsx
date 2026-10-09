import type { Frame } from '@faultlab/trace';
import { useSession, useSessionView } from '../app/session-context';

/** Nodes at the cursor, derived from the TraceIndex frame and the protocol's view adapter. */
export function NodeTable({ frame }: { frame: Frame }) {
  const session = useSession();
  const { selectedNode } = useSessionView();
  const partitionOf = (id: string) => frame.partition?.findIndex((g) => g.includes(id));
  return (
    <table className="nodes" data-testid="nodes">
      <caption>Nodes at entry #{frame.index} (t={frame.entry.time})</caption>
      <thead>
        <tr>
          <th scope="col">Node</th>
          <th scope="col">Status</th>
          <th scope="col">Incarnation</th>
          <th scope="col">Protocol state</th>
          <th scope="col">Partition group</th>
          <th scope="col">Timers</th>
        </tr>
      </thead>
      <tbody>
        {frame.nodes.map((n) => {
          const summary = session.describe(n.state);
          const group = partitionOf(n.id);
          return (
            <tr key={n.id} data-testid={`node-${n.id}`} data-status={n.status} data-leader={summary?.leader === true} aria-selected={selectedNode === n.id}>
              <th scope="row">
                <button type="button" onClick={() => session.selectNode(selectedNode === n.id ? null : n.id)} aria-pressed={selectedNode === n.id}>
                  {n.id}
                </button>
              </th>
              <td>{n.status}</td>
              <td>{n.incarnation}</td>
              <td data-testid={`node-${n.id}-summary`}>{summary?.label ?? '—'}</td>
              <td>{group === undefined ? '—' : group + 1}</td>
              <td>{n.pendingTimers.length}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function NodeInspector({ frame }: { frame: Frame }) {
  const session = useSession();
  const { selectedNode } = useSessionView();
  const node = frame.nodes.find((n) => n.id === selectedNode);
  if (node === undefined) return <p className="hint">Select a node to inspect its state, storage and timers.</p>;
  return (
    <section className="inspector" aria-label={`Node ${node.id}`} data-testid="node-inspector">
      <h3>
        {node.id} · {node.status} · incarnation {node.incarnation}
      </h3>
      <p>
        State from{' '}
        {node.stateEntry === null ? (
          '—'
        ) : (
          <button type="button" className="link" onClick={() => session.setCursor(node.stateEntry!)}>
            entry #{node.stateEntry}
          </button>
        )}
      </p>
      <h4>Volatile state</h4>
      <pre data-testid="node-state">{node.state === undefined ? '(none)' : JSON.stringify(node.state, null, 2)}</pre>
      <h4>Persistent storage</h4>
      <pre data-testid="node-storage">{JSON.stringify(node.storage, null, 2)}</pre>
      <h4>Pending timers</h4>
      <ul>
        {node.pendingTimers.length === 0 ? <li>none</li> : node.pendingTimers.map((t) => <li key={t.timerId}>{t.tag} at t={t.fireAt} (set by #{t.setIndex})</li>)}
      </ul>
    </section>
  );
}
