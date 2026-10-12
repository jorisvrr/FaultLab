import { useEffect, useState } from 'react';
import type { FaultSpec, FaultType } from '@faultlab/engine';
import { Button, Chip, Dialog, IconButton, NumberField, SelectField } from '../../design';
import { faultNodes, nodeIds, type Draft } from './draft';
import raw from './Configure.module.css';

const styles = raw as Record<
  'faultList' | 'faultRow' | 'faultRowSelected' | 'faultAt' | 'faultWhat' | 'faultActions' | 'editor' | 'editorGrid' | 'groupPicker' | 'groupRow' | 'groupLabel' | 'nodeToggle' | 'nodeToggleOn' | 'warnings' | 'warning',
  string
>;

/**
 * The fault schedule editor.
 *
 * It edits a PLAN: faults are scheduled input (ADR-0009), never something that happens
 * interactively. Two engine rules are made visible rather than hidden, because a UI that
 * hides them teaches the wrong model:
 *
 * - a `partition` is a COMPLETE regrouping that replaces any partition already in force, not a
 *   per-link switch. The editor therefore assigns every node to a group, and shows the implicit
 *   group (every node you did not list) explicitly.
 * - a `link` fault is DIRECTED: it degrades from → to only. The reverse direction is a separate
 *   fault, and the editor says so.
 */
export const FAULT_TYPES: readonly { value: FaultType; label: string; explain: string }[] = [
  { value: 'crash', label: 'Crash a node', explain: 'The node stops. Its volatile state is lost; committed storage survives.' },
  { value: 'recover', label: 'Recover a node', explain: 'The node restarts with a new incarnation and reads back its committed storage.' },
  { value: 'partition', label: 'Partition the network', explain: 'Replaces any partition in force. Messages only pass within a group.' },
  { value: 'heal', label: 'Heal the partition', explain: 'Removes the partition entirely; every node can reach every other again.' },
  { value: 'link', label: 'Degrade a link', explain: 'One direction only: from → to. Replaces any previous condition on that link.' },
  { value: 'link-restore', label: 'Restore a link', explain: 'Removes the degradation from that one direction.' },
];

/** A short, literal description of what a scheduled fault does. */
export function describeFault(fault: FaultSpec): string {
  switch (fault.type) {
    case 'crash':
      return `${fault.node} crashes`;
    case 'recover':
      return `${fault.node} recovers`;
    case 'partition':
      return `partition ${fault.groups.map((g) => `[${g.join(' ')}]`).join(' | ')}`;
    case 'heal':
      return 'partition heals';
    case 'link':
      return `link ${fault.from}→${fault.to} degraded${fault.loss === undefined ? '' : `, loss ${fault.loss}`}${fault.delay === undefined ? '' : `, delay ${fault.delay.min}–${fault.delay.max}`}`;
    case 'link-restore':
      return `link ${fault.from}→${fault.to} restored`;
  }
}

export const faultTone = (type: FaultType): 'fault' | 'recovery' =>
  type === 'recover' || type === 'heal' || type === 'link-restore' ? 'recovery' : 'fault';

const blank = (type: FaultType, nodes: readonly string[], at: number): FaultSpec => {
  switch (type) {
    case 'crash':
    case 'recover':
      return { at, type, node: nodes[0]! };
    case 'partition':
      return { at, type, groups: [[nodes[0]!]] };
    case 'heal':
      return { at, type };
    case 'link':
      return { at, type, from: nodes[0]!, to: nodes[1] ?? nodes[0]!, loss: 1 };
    case 'link-restore':
      return { at, type, from: nodes[0]!, to: nodes[1] ?? nodes[0]! };
  }
};

export interface FaultEditorProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly draft: Draft;
  readonly onChange: (faults: readonly FaultSpec[]) => void;
  readonly warnings: readonly string[];
  /** Index to select when opening, e.g. the marker the user clicked on the plan timeline. */
  readonly focusIndex: number | null;
}

export function FaultEditor({ open, onClose, draft, onChange, warnings, focusIndex }: FaultEditorProps) {
  const nodes = nodeIds(draft.nodeCount);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (open) setSelected(focusIndex);
  }, [open, focusIndex]);

  const faults = draft.faults;
  const current = selected !== null ? faults[selected] : undefined;
  const replace = (index: number, fault: FaultSpec) => onChange(faults.map((f, i) => (i === index ? fault : f)));

  const add = () => {
    const at = faults.length === 0 ? 100 : Math.min(draft.maxTime, Math.max(...faults.map((f) => f.at)) + 100);
    onChange([...faults, blank('crash', nodes, at)]);
    setSelected(faults.length);
  };

  return (
    <Dialog open={open} onClose={onClose} variant="drawer" title="Fault schedule" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p style={{ margin: '0 0 var(--space-4)', color: 'var(--color-text-subtle)', fontSize: 'var(--type-body-size)' }}>
        A plan of faults to inject at fixed virtual times. Nothing here happens until the experiment runs.
      </p>

      <div className={styles.faultList} data-testid="fault-list">
        {faults.length === 0 && <p style={{ color: 'var(--color-text-subtle)' }}>No faults scheduled. The run will be fault-free.</p>}
        {faults.map((fault, i) => (
          <div key={i} className={[styles.faultRow, i === selected ? styles.faultRowSelected : null].filter(Boolean).join(' ')} data-testid={`fault-row-${i}`}>
            <Chip tone={faultTone(fault.type)} className={styles.faultAt}>
              t={fault.at}
            </Chip>
            <button
              type="button"
              className={styles.faultWhat}
              style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
              aria-expanded={i === selected}
              onClick={() => setSelected(i === selected ? null : i)}
            >
              {describeFault(fault)}
            </button>
            <span className={styles.faultActions}>
              <IconButton label={`Duplicate the ${fault.type} at t=${fault.at}`} variant="ghost" onClick={() => onChange([...faults, { ...fault, at: Math.min(draft.maxTime, fault.at + 50) }])}>
                ⧉
              </IconButton>
              <IconButton label={`Remove the ${fault.type} at t=${fault.at}`} variant="ghost" onClick={() => { onChange(faults.filter((_, k) => k !== i)); setSelected(null); }}>
                ✕
              </IconButton>
            </span>
          </div>
        ))}
      </div>

      <Button onClick={add} data-testid="add-fault">
        Add a fault
      </Button>

      {current !== undefined && selected !== null && (
        <div className={styles.editor} style={{ marginTop: 'var(--space-4)' }} data-testid="fault-editor">
          <div className={styles.editorGrid}>
            <SelectField
              label="Type"
              value={current.type}
              options={FAULT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              onChange={(e) => replace(selected, blank(e.currentTarget.value as FaultType, nodes, current.at))}
            />
            <NumberField label="At tick" value={current.at} min={0} max={draft.maxTime} onChange={(e) => replace(selected, { ...current, at: Math.max(0, Number(e.currentTarget.value)) } as FaultSpec)} />
          </div>
          <p style={{ margin: 0, color: 'var(--color-text-subtle)', fontSize: 'var(--type-body-size)' }}>{FAULT_TYPES.find((t) => t.value === current.type)!.explain}</p>

          {(current.type === 'crash' || current.type === 'recover') && (
            <SelectField label="Node" value={current.node} options={nodes.map((n) => ({ value: n, label: n }))} onChange={(e) => replace(selected, { ...current, node: e.currentTarget.value })} />
          )}

          {current.type === 'partition' && (
            <PartitionPicker nodes={nodes} groups={current.groups} onChange={(groups) => replace(selected, { ...current, groups })} />
          )}

          {(current.type === 'link' || current.type === 'link-restore') && (
            <>
              <div className={styles.editorGrid}>
                <SelectField label="From" value={current.from} options={nodes.map((n) => ({ value: n, label: n }))} onChange={(e) => replace(selected, { ...current, from: e.currentTarget.value })} />
                <SelectField label="To" value={current.to} options={nodes.map((n) => ({ value: n, label: n }))} onChange={(e) => replace(selected, { ...current, to: e.currentTarget.value })} />
              </div>
              {current.type === 'link' && (
                <div className={styles.editorGrid}>
                  <NumberField label="Loss (0–1)" value={current.loss ?? 1} min={0} max={1} step={0.1} onChange={(e) => replace(selected, { ...current, loss: Math.max(0, Math.min(1, Number(e.currentTarget.value))) })} />
                  <NumberField label="Extra delay, min" value={current.delay?.min ?? 0} min={0} onChange={(e) => replace(selected, { ...current, delay: { min: Number(e.currentTarget.value), max: Math.max(Number(e.currentTarget.value), current.delay?.max ?? 0) } })} />
                  <NumberField label="Extra delay, max" value={current.delay?.max ?? 0} min={0} onChange={(e) => replace(selected, { ...current, delay: { min: current.delay?.min ?? 0, max: Math.max(current.delay?.min ?? 0, Number(e.currentTarget.value)) } })} />
                </div>
              )}
              <p style={{ margin: 0, color: 'var(--color-text-subtle)', fontSize: 'var(--type-micro-size)' }}>
                This affects {current.from}→{current.to} only. Schedule a second fault for the reverse direction.
              </p>
            </>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className={styles.warnings} role="status" data-testid="fault-warnings">
          {warnings.map((w) => (
            <span className={styles.warning} key={w}>
              <span aria-hidden="true">⚠</span>
              {w}
            </span>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/**
 * Assigns every node to a group. The engine takes the listed groups plus one implicit group of
 * everything unlisted, so the implicit group is rendered as a real row: a user should be able
 * to see the whole partition, not just the half they typed.
 */
function PartitionPicker({ nodes, groups, onChange }: { nodes: readonly string[]; groups: readonly (readonly string[])[]; onChange: (groups: readonly (readonly string[])[]) => void }) {
  const assigned = new Set(groups.flat());
  const rest = nodes.filter((n) => !assigned.has(n));
  const move = (node: string, to: number) => {
    const without = groups.map((g) => g.filter((n) => n !== node));
    if (to === -1) onChange(without.filter((g) => g.length > 0));
    else {
      const next = [...without];
      while (next.length <= to) next.push([]);
      next[to] = [...next[to]!, node];
      onChange(next.filter((g) => g.length > 0));
    }
  };
  return (
    <div className={styles.groupPicker} role="group" aria-label="Partition groups">
      {groups.map((group, i) => (
        <div className={styles.groupRow} key={i}>
          <span className={styles.groupLabel}>Group {i + 1}</span>
          {nodes.map((n) => (
            <button
              key={n}
              type="button"
              className={[styles.nodeToggle, group.includes(n) ? styles.nodeToggleOn : null].filter(Boolean).join(' ')}
              aria-pressed={group.includes(n)}
              onClick={() => move(n, group.includes(n) ? -1 : i)}
            >
              {n}
            </button>
          ))}
        </div>
      ))}
      <div className={styles.groupRow}>
        <span className={styles.groupLabel}>Everyone else</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-card-size)', color: 'var(--color-text-subtle)' }}>
          {rest.length === 0 ? '— (every node is listed)' : rest.join(' ')}
        </span>
      </div>
      <Button variant="ghost" onClick={() => onChange([...groups, []])} disabled={rest.length === 0}>
        Add a group
      </Button>
      <p style={{ margin: 0, color: 'var(--color-text-subtle)', fontSize: 'var(--type-micro-size)' }}>
        A partition replaces any partition already in force. Nodes you do not list form one further group of their own.
      </p>
    </div>
  );
}

export { faultNodes };
