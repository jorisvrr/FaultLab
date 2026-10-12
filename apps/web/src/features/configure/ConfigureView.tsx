import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGINE_VERSION } from '@faultlab/engine';
import { invariantsFor, PRESETS, type Preset } from '@faultlab/experiments';
import {
  Button,
  Card,
  Chip,
  DualRangeField,
  EmptyState,
  FactTable,
  IconButton,
  NumberField,
  Panel,
  SelectField,
  Switch,
} from '../../design';
import { Stage } from '../../stage/Stage';
import { detectTier, prefersReducedMotion } from '../../stage/capabilities';
import type { NodeSprite } from '../../stage/types';
import { useSession } from '../../app/session-context';
import { configurableProtocols, draftFromSpec, effectiveSpec, nodeIds, signature, validate, withNodeCount, withProtocol, type Draft } from './draft';
import { FaultEditor } from './FaultEditor';
import { FaultPlan } from './FaultPlan';
import raw from './Configure.module.css';

const styles = raw as Record<
  | 'configure' | 'column' | 'leftColumn' | 'rightColumn' | 'stageColumn' | 'setup' | 'setupBody' | 'row' | 'rowSplit' | 'cta'
  | 'stage' | 'stageCanvas' | 'stageGrid' | 'stageOrbit' | 'stageCaption' | 'plan' | 'planHead' | 'planTitle' | 'planHint'
  | 'planDisabled' | 'planEmpty' | 'invariants' | 'invariantList' | 'invariantCard' | 'invariantIcon' | 'invariantIconOn'
  | 'invariantBody' | 'invariantTitle' | 'invariantSwitch' | 'invariantText' | 'signature' | 'errors' | 'errorItem' | 'links' | 'plannedBadge'
  | 'stageLegend' | 'legendSwatch' | 'invariantMore' | 'sigInvalid',
  string
>;

const REFERENCE: Preset = PRESETS.find((p) => p.id === 'configure-reference')!;

/**
 * CONFIGURE: build an experiment and start it.
 *
 * Everything on this screen is configuration. Nothing here describes the state of a run, and
 * the topology in the centre is a PREVIEW of what will be built — before a run exists there is
 * no leader, no message and no violation to show, so none is shown.
 */
export function ConfigureView({ onLoaded }: { onLoaded: () => void }) {
  const session = useSession();
  const [draft, setDraft] = useState<Draft>(() => draftFromSpec(REFERENCE.spec));
  const [presetId, setPresetId] = useState<string>(REFERENCE.id);
  const [editorOpen, setEditorOpen] = useState(false);
  const [focusFault, setFocusFault] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tier] = useState(() => detectTier());
  const [reducedMotion] = useState(() => prefersReducedMotion());

  const protocols = useMemo(() => configurableProtocols(), []);
  const available = useMemo(() => invariantsFor(draft.protocol), [draft.protocol]);
  const result = useMemo(() => validate(draft), [draft]);
  const sig = useMemo(() => signature(draft, ENGINE_VERSION), [draft]);
  const errorFor = (path: string) => (submitted ? result.errors.find((e) => e.path.startsWith(path))?.message : undefined);

  const edit = (next: Draft) => {
    setDraft(next);
    setPresetId('');
  };

  /**
   * Preview layout: a ring, which at four nodes is the reference's composition (one at the top,
   * one at each side, one at the bottom) and stays legible as the cluster grows.
   */
  const layout = useMemo(() => (size: { width: number; height: number }): NodeSprite[] => {
    const ids = nodeIds(draft.nodeCount);

    // Measured on the reference: the four centres sit 167 px from the middle of a 753 px stage.
    const scale = Math.min(1, size.width / 753);
    const radius = (ids.length <= 4 ? 54 : ids.length <= 6 ? 46 : 38) * scale;
    // Two neighbours on the ring are 2·r·sin(π/n) apart, so this is the smallest ring that
    // keeps a gap between them — without it the nodes overlap on a narrow screen or a big
    // cluster. The reference's proportion is used whenever it is already large enough.
    const fits = Math.min(size.width, size.height) / 2 - radius - 8;
    const ring = Math.min(fits, Math.max(Math.min(size.width, size.height) * 0.222, (radius * 1.35) / Math.sin(Math.PI / Math.max(2, ids.length))));
    return ids.map((id, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ids.length;
      return {
        id,
        x: size.width / 2 + ring * Math.cos(angle),
        y: size.height / 2 + ring * Math.sin(angle),
        radius,
        warmth: 1,
        spark: 1,
        exposure: 0.58,
        ports: ids.filter((o) => o !== id).map((o) => {
          const j = ids.indexOf(o);
          const other = -Math.PI / 2 + (j * 2 * Math.PI) / ids.length;
          return Math.atan2(-(Math.sin(other) - Math.sin(angle)), Math.cos(other) - Math.cos(angle));
        }),
        // Nothing has run, so nothing has a role and nothing is partitioned: every node is
        // `idle`, which is exactly what the Gate 1 model means by "not started". The fault
        // PLAN is annotated separately below, so a preview can never be read as live state.
        state: { role: null, status: 'idle', recovering: false, partitioned: false, active: false, hovered: false, selected: false },
      };
    });
  }, [draft.nodeCount, draft.faults, draft.faultsEnabled]);

  /** Which nodes the plan touches, and how many times. A plan, never a live state. */
  const planned = useMemo(() => {
    const counts = new Map<string, number>();
    if (!draft.faultsEnabled) return counts;
    for (const f of draft.faults) {
      for (const n of f.type === 'crash' || f.type === 'recover' ? [f.node] : f.type === 'partition' ? f.groups.flat() : f.type === 'heal' ? [] : [f.from, f.to]) {
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    return counts;
  }, [draft.faults, draft.faultsEnabled]);
  const plannedTotal = useMemo(() => [...planned.values()].reduce((a, b) => a + b, 0), [planned]);

  /**
   * Whether the invariant panel has more below the fold. The panel scrolls by design (a protocol
   * may register more checks than fit), and a card cut off at the edge reads as the end of the
   * list unless something says otherwise. Measured rather than assumed, so the hint disappears
   * once the user reaches the bottom.
   */
  const listRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const syncMore = () => {
    const el = listRef.current;
    if (el !== null) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useEffect(syncMore, [available.length, draft.protocol]);

  const run = () => {
    setSubmitted(true);
    if (!result.ok) {
      // Bring the offending control AND its message into view: the setup panel scrolls, so an
      // error at its foot would otherwise sit behind the CTA where nobody reads it.
      const field = document.querySelector<HTMLElement>('[data-invalid="true"]');
      field?.scrollIntoView({ block: 'center', behavior: 'auto' });
      field?.querySelector<HTMLElement>('input, select')?.focus();
      return;
    }
    setBusy(true);
    // The spec submitted is exactly the one the signature above describes.
    const spec = effectiveSpec(draft);
    const chosen = PRESETS.find((p) => p.id === presetId);
    session.load(spec, {
      id: presetId === '' ? `custom~${sig.fingerprint}` : presetId,
      title: chosen?.title ?? 'Custom experiment',
      summary: chosen?.summary ?? `${draft.protocol}, ${draft.nodeCount} nodes, seed ${draft.seed}.`,
      category: chosen?.category ?? 'custom',
    });
    // `load` prepares a Worker and settles on `ready` (or `error`); running before that is
    // ignored by the client, so wait for the lifecycle rather than assuming it.
    const off = session.subscribe(() => {
      const { lifecycle } = session.view.run;
      if (lifecycle === 'ready') {
        off();
        setBusy(false);
        session.run();
      } else if (lifecycle === 'error') {
        off();
        setBusy(false);
      }
    });
    onLoaded();
  };

  return (
    <div className={styles.configure} data-testid="configure">
      {/* ── left: run setup ─────────────────────────────────────────────────────────────── */}
      <div className={[styles.column, styles.leftColumn].join(' ')}>
        <Panel className={styles.setup} title="Run setup" padded={false} material="glass">
          <div className={styles.setupBody}>
            <SelectField
              label="Experiment"
              value={presetId}
              // The closed control clips a long title, so the full name is repeated beneath it as
              // supporting text rather than left to a hover the keyboard and touch never get.
              hint={presetId === '' ? 'Not one of the built-in experiments' : PRESETS.find((p) => p.id === presetId)?.title}
              title={presetId === '' ? undefined : PRESETS.find((p) => p.id === presetId)?.title}
              options={[{ value: '', label: 'Custom configuration' }, ...PRESETS.filter((p) => p.category !== 'diagnostic').map((p) => ({ value: p.id, label: p.title }))]}
              onChange={(e) => {
                const preset = PRESETS.find((p) => p.id === e.currentTarget.value);
                if (preset !== undefined) {
                  setDraft(draftFromSpec(preset.spec));
                  setPresetId(preset.id);
                  setSubmitted(false);
                }
              }}
            />
            <SelectField
              label="Protocol"
              value={draft.protocol}
              hint={protocols.find((p) => p.name === draft.protocol)?.description}
              options={protocols.map((p) => ({ value: p.name, label: p.title }))}
              onChange={(e) => edit(withProtocol(draft, e.currentTarget.value))}
            />
            <NumberField
              label="Nodes"
              value={draft.nodeCount}
              min={draft.protocol === 'raft-election' ? 3 : 2}
              max={12}
              error={errorFor('spec.nodes')}
              hint={nodeIds(draft.nodeCount).join(' ')}
              onChange={(e) => edit(withNodeCount(draft, Number(e.currentTarget.value)))}
            />
            <NumberField
              label="Random seed"
              value={draft.seed}
              min={0}
              step={1}
              error={errorFor('spec.seed')}
              onChange={(e) => edit({ ...draft, seed: Math.trunc(Number(e.currentTarget.value)) })}
              affix={
                <>
                  <IconButton label="Copy seed" variant="ghost" onClick={() => void navigator.clipboard?.writeText(String(draft.seed))}>
                    ⧉
                  </IconButton>
                  <IconButton label="Regenerate seed" variant="ghost" data-testid="regenerate-seed" onClick={() => edit({ ...draft, seed: Math.floor(Math.random() * 100_000) })}>
                    ↻
                  </IconButton>
                </>
              }
            />
            <DualRangeField
              label={`Network latency · ${draft.latency.min}–${draft.latency.max} ticks`}
              min={1}
              max={60}
              low={draft.latency.min}
              high={draft.latency.max}
              lowLabel="Minimum latency in ticks"
              highLabel="Maximum latency in ticks"
              error={errorFor('spec.network')}
              onChange={({ low, high }) => edit({ ...draft, latency: { min: low, max: high } })}
            />
            <div className={styles.rowSplit}>
              <Switch
                label="Fault injection"
                labelFirst
                checked={draft.faultsEnabled}
                data-testid="faults-enabled"
                onChange={(e) => edit({ ...draft, faultsEnabled: e.currentTarget.checked })}
              />
              <Button
                onClick={() => {
                  setFocusFault(null);
                  setEditorOpen(true);
                }}
                data-testid="open-fault-editor"
              >
                {draft.faults.length === 0 ? 'Add faults' : `Edit ${draft.faults.length}`}
              </Button>
            </div>
            <SelectField
              label="Invariant policy"
              value={draft.invariantPolicy}
              options={[
                { value: 'stop-on-first', label: 'Stop on first violation' },
                { value: 'record-and-continue', label: 'Record and continue' },
              ]}
              onChange={(e) => edit({ ...draft, invariantPolicy: e.currentTarget.value as Draft['invariantPolicy'] })}
            />
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--color-text-subtle)', fontFamily: 'var(--font-mono)', fontSize: 'var(--type-card-size)' }}>Execution limits</summary>
              <div className={styles.row} style={{ marginTop: 'var(--space-3)' }}>
                <NumberField label="Max virtual time" value={draft.maxTime} min={1} error={errorFor('spec.limits.maxTime')} onChange={(e) => edit({ ...draft, maxTime: Number(e.currentTarget.value) })} />
                <NumberField label="Max events" value={draft.maxEvents} min={1} error={errorFor('spec.limits.maxEvents')} onChange={(e) => edit({ ...draft, maxEvents: Number(e.currentTarget.value) })} />
              </div>
            </details>
            {submitted && !result.ok && (
              <div className={styles.errors} role="alert" data-testid="validation-errors">
                {result.errors.map((e) => (
                  <span className={styles.errorItem} key={e.path}>
                    {e.path}: {e.message}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Panel>
        <Button variant="primary" size="lg" glyph="▶" className={styles.cta} busy={busy} onClick={run} data-testid="run-experiment" style={{ width: '100%' }}>
          Run Experiment
        </Button>
      </div>

      {/* ── centre: topology preview and the fault plan ─────────────────────────────────── */}
      <div className={[styles.column, styles.stageColumn].join(' ')}>
        <Panel className={styles.stage} padded={false} material="glass">
          <div className={styles.stageCanvas}>
            <div className={styles.stageGrid} aria-hidden="true" />
            <svg className={styles.stageOrbit} aria-hidden="true">
              <circle cx="50%" cy="50%" r="31%" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className={styles.stageCaption}>
              Configuration preview · {draft.nodeCount} nodes
            </span>
            {/*
              What the amber numbers mean, said once, near the thing they annotate. They count
              SCHEDULED faults; nothing here is a running simulation, so they never report an
              active fault state.
            */}
            {plannedTotal > 0 && (
              <span className={styles.stageLegend} data-testid="badge-legend">
                <span className={styles.legendSwatch} aria-hidden="true">
                  n
                </span>
                scheduled faults for that node
              </span>
            )}
            <Stage
              layout={layout}
              under={<Links layout={layout} />}
              tier={tier}
              reducedMotion={reducedMotion}
              // The reference shows no labels on the preview nodes; their names stay in the
              // DOM layer, so assistive technology and keyboard focus still identify them.
              labels="none"
              describe={(n) => {
                const n_ = planned.get(n.id) ?? 0;
                return `${n.id}, not started${n_ === 0 ? '' : `, ${n_} scheduled ${n_ === 1 ? 'fault' : 'faults'}`}`;
              }}
              badge={(n) => {
                const count = planned.get(n.id) ?? 0;
                // The count is already spoken as part of the node's accessible name above, so the
                // badge itself is decoration for sighted users; announcing a bare number twice
                // would be worse than not announcing it.
                return count === 0 ? null : (
                  <span className={styles.plannedBadge} aria-hidden="true" title={`${count} scheduled ${count === 1 ? 'fault' : 'faults'} for ${n.id}`} data-testid={`planned-badge-${n.id}`}>
                    {count}
                  </span>
                );
              }}
            />
          </div>
          <div className={[styles.plan, draft.faultsEnabled ? null : styles.planDisabled].filter(Boolean).join(' ')} data-testid="fault-plan" data-enabled={draft.faultsEnabled}>
            <div className={styles.planHead}>
              <span className={styles.planTitle}>Scheduled faults</span>
              {!draft.faultsEnabled && draft.faults.length > 0 && <Chip tone="neutral">kept, not applied to the next run</Chip>}
              <span className={styles.planHint}>a plan, not a running simulation</span>
            </div>
            <FaultPlan
              faults={draft.faults}
              maxTime={draft.maxTime}
              onSelect={(index) => {
                setFocusFault(index);
                setEditorOpen(true);
              }}
            />
          </div>
        </Panel>
      </div>

      {/* ── right: invariants and the experiment signature ──────────────────────────────── */}
      <div className={[styles.column, styles.rightColumn].join(' ')}>
        <Panel
          className={styles.invariants}
          title="Invariant set"
          padded={false}
          material="glass"
          actions={
            <Chip tone="neutral" glyph={false} data-testid="invariant-count">
              {draft.invariants.filter((id) => available.some((e) => e.invariant.id === id)).length} / {available.length}
            </Chip>
          }
        >
          <div className={styles.invariantList} data-testid="invariant-list" ref={listRef} onScroll={syncMore} data-more={more}>
            {available.length === 0 ? (
              <EmptyState title="No invariants for this protocol">
                The registry has no safety checks for {draft.protocol}. The run will execute, but nothing will be verified.
              </EmptyState>
            ) : (
              available.map((entry) => {
                const on = draft.invariants.includes(entry.invariant.id);
                return (
                  <Card className={styles.invariantCard} key={entry.invariant.id} data-testid={`invariant-${entry.invariant.id}`}>
                    <span className={[styles.invariantIcon, on ? styles.invariantIconOn : null].filter(Boolean).join(' ')} aria-hidden="true">
                      <InvariantIcon id={entry.invariant.id} />
                    </span>
                    <div className={styles.invariantBody}>
                      <span className={styles.invariantTitle}>
                        {entry.invariant.id.replace(/^raft-/, '').replace(/-/g, ' ')}
                        <Switch
                          className={styles.invariantSwitch}
                          label={`Check ${entry.invariant.name}`}
                          hideLabel
                          checked={on}
                          onChange={(e) => edit({ ...draft, invariants: e.currentTarget.checked ? [...draft.invariants, entry.invariant.id] : draft.invariants.filter((i) => i !== entry.invariant.id) })}
                        />
                      </span>
                      <p className={styles.invariantText}>{entry.description}</p>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
          {/* Subtle, and only while there is actually something below the fold. */}
          <span className={styles.invariantMore} data-visible={more} aria-hidden="true" data-testid="invariant-more" />
        </Panel>
        <Panel className={styles.signature} title="Experiment signature" material="glass">
          <FactTable
            facts={[
              ['Random seed', <span data-testid="sig-seed">{sig.seed}</span>],
              [
                'Specification',
                <span data-testid="sig-fingerprint" data-valid={sig.fingerprint !== null} className={sig.fingerprint === null ? styles.sigInvalid : undefined}>
                  {sig.fingerprint ?? 'Invalid configuration'}
                </span>,
              ],
              ['Engine', sig.engineVersion],
              ['Protocol', sig.protocol],
            ]}
          />
        </Panel>
      </div>

      <FaultEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        draft={draft}
        focusIndex={focusFault}
        warnings={result.warnings}
        onChange={(faults) => edit({ ...draft, faults, faultsEnabled: faults.length > 0 ? draft.faultsEnabled : draft.faultsEnabled })}
      />
    </div>
  );
}

/**
 * The complete graph between the nodes, drawn beneath them. Straight, thin, bright hairlines
 * with a junction dot where they meet a rim, as in the reference.
 */
function Links({ layout }: { readonly layout: (size: { width: number; height: number }) => NodeSprite[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current!.parentElement!;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const nodes = size.width === 0 ? [] : layout(size);
  return (
    <div ref={ref} className={styles.links} aria-hidden="true">
      <svg width={size.width} height={size.height}>
        {nodes.flatMap((a, i) =>
          nodes.slice(i + 1).map((b) => {
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            const x1 = a.x + a.radius * Math.cos(angle);
            const y1 = a.y + a.radius * Math.sin(angle);
            const x2 = b.x - b.radius * Math.cos(angle);
            const y2 = b.y - b.radius * Math.sin(angle);
            return <line key={`${a.id}-${b.id}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
          }),
        )}
      </svg>
    </div>
  );
}

/** A small distinct mark per invariant, so the cards are told apart by shape as well as text. */
function InvariantIcon({ id }: { readonly id: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'single-leader':
    case 'raft-election-safety':
      // A crown: one leader.
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 15h16M4 15 3 6l5 4 3-5 3 5 5-4-1 9" {...common} />
        </svg>
      );
    case 'unique-leader-per-epoch':
    case 'raft-one-vote-per-term':
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <circle cx="8" cy="11" r="4.5" {...common} />
          <circle cx="15" cy="11" r="4.5" {...common} />
        </svg>
      );
    case 'epoch-monotonic':
    case 'raft-term-monotonic':
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 17l5-5 4 3 7-8" {...common} />
        </svg>
      );
    case 'leader-epoch-consistent':
    case 'raft-leader-has-quorum':
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M11 3l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V6z" {...common} />
        </svg>
      );
    default:
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M4 11h5l2-5 2 10 2-5h3" {...common} />
        </svg>
      );
  }
}
