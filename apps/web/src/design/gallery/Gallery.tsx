import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AppShell,
  Backdrop,
  Button,
  Card,
  Chip,
  DecorativeMotif,
  Dialog,
  Divider,
  DualRangeField,
  EmptyState,
  FactTable,
  Header,
  IconButton,
  Legend,
  NumberField,
  Panel,
  RangeField,
  Segmented,
  SelectField,
  Spinner,
  StatusDot,
  Switch,
  Tabs,
  TabPanel,
  Timeline,
  Tooltip,
  ValueRow,
} from '../index';
import { TOKENS } from '../tokens';
import raw from './Gallery.module.css';

const styles = raw as Record<'page' | 'bar' | 'barTitle' | 'barNote' | 'frame' | 'section' | 'sectionTitle' | 'sectionNote' | 'grid' | 'row' | 'stack' | 'swatches' | 'swatch' | 'chipColour' | 'swatchName' | 'swatchRole' | 'tokenList' | 'tokenValue' | 'specimen' | 'specimenName' | 'example' | 'exampleLabel' | 'stagePatch' | 'stageOverlayPanel' | 'measure' | 'behind' | 'reconGrid', string>;

/**
 * CP6 Gate 2 component gallery (design.html). Development only, never part of the simulation
 * workflow.
 *
 * Every value shown here is a DEMONSTRATION VALUE, not a simulation result. Where a component
 * normally displays trace data, the gallery labels it as such; nothing here is produced by the
 * engine and nothing here should be read as one.
 */

const VIEWPORTS = [
  { id: 'reference', label: 'Reference 1586', width: 1586 },
  { id: 'desktop', label: 'Desktop 1440', width: 1440 },
  { id: 'laptop', label: 'Laptop 1280', width: 1280 },
  { id: 'tablet', label: 'Tablet 768', width: 768 },
  { id: 'phone', label: 'Phone 390', width: 390 },
  { id: 'fluid', label: 'Fluid', width: 0 },
] as const;
type ViewportId = (typeof VIEWPORTS)[number]['id'];

function Section({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section} id={id} aria-labelledby={`${id}-h`}>
      <h2 className={styles.sectionTitle} id={`${id}-h`}>
        {title}
      </h2>
      {note !== undefined && <p className={styles.sectionNote}>{note}</p>}
      {children}
    </section>
  );
}

function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.example}>
      <span className={styles.exampleLabel}>{label}</span>
      {children}
    </div>
  );
}

/** Reads the computed value of a custom property, so the gallery shows what the browser resolved. */
function useTokenValues(names: readonly string[]) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(names.map((n) => [n, style.getPropertyValue(n).trim()])));
  }, [names]);
  return values;
}

const isColour = (v: string) => /^(#|rgb|hsl|color\()/.test(v);

export function Gallery() {
  const [viewport, setViewport] = useState<ViewportId>('fluid');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dialog, setDialog] = useState<null | 'dialog' | 'drawer' | 'drawer-bottom'>(null);
  const [tab, setTab] = useState<'overview' | 'details'>('overview');
  const [seed, setSeed] = useState(2026);
  const [nodes, setNodes] = useState(4);
  const [latency, setLatency] = useState({ low: 1, high: 10 });
  const [speed, setSpeed] = useState(200);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [invariants, setInvariants] = useState({ single: true, unique: true, monotonic: false });
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0.5);
  const frameWidth = VIEWPORTS.find((v) => v.id === viewport)!.width;
  const names = Object.values(TOKENS).flatMap((g) => g.map(([n]) => n));
  const values = useTokenValues(names);

  // The toggle emulates the media query, so reduced motion can be reviewed without OS settings.
  useEffect(() => {
    document.documentElement.style.setProperty('--motion-fast', reducedMotion ? '0ms' : '');
    document.documentElement.style.setProperty('--motion-base', reducedMotion ? '0ms' : '');
    document.documentElement.style.setProperty('--motion-slow', reducedMotion ? '0ms' : '');
  }, [reducedMotion]);

  return (
    <div className={styles.page}>
      <Backdrop orbits={false} />
      <header className={styles.bar}>
        <h1 className={styles.barTitle}>FaultLab design system · Gate 2</h1>
        <Segmented label="Viewport" value={viewport} options={VIEWPORTS.map((v) => ({ value: v.id, label: v.label }))} onChange={setViewport} />
        <Switch label="reduced motion" checked={reducedMotion} onChange={(e) => setReducedMotion(e.currentTarget.checked)} />
        <Segmented
          label="Density"
          value={density}
          options={[
            { value: 'comfortable', label: 'comfortable' },
            { value: 'compact', label: 'compact' },
          ]}
          onChange={setDensity}
        />
        <span className={styles.barNote}>All values below are demonstration values, not simulation results.</span>
      </header>

      <main className={styles.frame} id="main" style={frameWidth === 0 ? undefined : { width: frameWidth, maxWidth: '100%' }} data-testid="frame">
        <Section id="tokens" title="1 · Design tokens" note="Three layers: raw reference values, semantic roles, then component tokens. Components use the semantic layer only; a unit test fails if the two drift apart.">
          {Object.entries(TOKENS).map(([group, entries]) => (
            <div key={group} style={{ marginBottom: 'var(--space-5)' }}>
              <Legend>{group}</Legend>
              {group === 'colour' ? (
                <div className={styles.swatches}>
                  {entries.map(([name, role]) => (
                    <div className={styles.swatch} key={name}>
                      <span className={styles.chipColour} style={{ background: `var(${name})` }} />
                      <span>
                        <span className={styles.swatchName}>{name}</span>
                        <br />
                        <span className={styles.swatchRole}>{role}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <dl className={styles.tokenList}>
                  {entries.map(([name, role]) => (
                    <div key={name} style={{ display: 'contents' }}>
                      <dt>{name}</dt>
                      <dd>{role}</dd>
                      {/* The computed value, unless it only repeats the description. */}
                      <dd className={styles.tokenValue}>{(values[name] ?? '') === role || isColour(values[name] ?? '') ? '' : (values[name] ?? '').slice(0, 42)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </Section>

        <Section id="type" title="2 · Typography" note="Geist for headings, navigation and prose; Geist Mono for labels, values, identifiers and timestamps. Numeric readouts are tabular so figures never jitter during playback.">
          <div className={styles.specimen}>
            <span className={styles.specimenName}>display · Geist</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--type-display-size)' }}>FaultLab</span>
          </div>
          <div className={styles.specimen}>
            <span className={styles.specimenName}>title · Geist Mono</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-title-size)' }}>Experiment status</span>
          </div>
          <div className={styles.specimen}>
            <span className={styles.specimenName}>label · Geist Mono</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-label-size)', color: 'var(--color-text-muted)' }}>Network latency</span>
          </div>
          <div className={styles.specimen}>
            <span className={styles.specimenName}>value · tabular</span>
            <span className="tabular" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-value-size)' }}>
              t=15201 · #829 · 1–10 ticks
            </span>
          </div>
          <div className={styles.specimen}>
            <span className={styles.specimenName}>card · uppercase</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-card-size)', letterSpacing: 'var(--type-tracking-wide)', textTransform: 'uppercase' }}>Single leader</span>
          </div>
          <div className={styles.specimen}>
            <span className={styles.specimenName}>body · Geist</span>
            <span style={{ fontSize: 'var(--type-body-size)' }}>A fault is something done to the system; a violation is the system breaking a rule.</span>
          </div>
          <div className={styles.specimen}>
            <span className={styles.specimenName}>micro · uppercase</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-micro-size)', letterSpacing: 'var(--type-tracking-wide)', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}>State origin</span>
          </div>
        </Section>

        <Section
          id="surfaces"
          title="3 · Surfaces and materials"
          note="Glass is translucent with a backdrop blur; matte is opaque with the same edges, highlight and geometry. A blurred surface over the live 3D stage re-blurs every frame, so matte is mandatory there — the measurement is in the Gate 2 report."
        >
          <div className={styles.grid}>
            <Example label="glass panel · over static content">
              <div className={styles.behind} aria-hidden="true" />
              <Panel material="glass" title="Run setup" style={{ marginTop: -96 }}>
                <FactTable
                  facts={[
                    ['Protocol', 'Naive Leader Election'],
                    ['Seed', '2026'],
                    ['Nodes', 'n1 n2 n3 n4'],
                  ]}
                />
              </Panel>
            </Example>
            <Example label="matte panel · over the live stage">
              <div className={styles.behind} aria-hidden="true" />
              <Panel material="matte" title="Run setup" style={{ marginTop: -96 }}>
                <FactTable
                  facts={[
                    ['Protocol', 'Naive Leader Election'],
                    ['Seed', '2026'],
                    ['Nodes', 'n1 n2 n3 n4'],
                  ]}
                />
              </Panel>
            </Example>
            <Example label="card inside a panel">
              <Panel material="matte" title="Invariant set">
                <Card style={{ padding: 'var(--space-4)' }}>
                  <Switch label="SINGLE LEADER" labelFirst checked={invariants.single} onChange={(e) => setInvariants({ ...invariants, single: e.currentTarget.checked })} />
                  <Divider style={{ margin: 'var(--space-3) 0' }} />
                  <Switch label="UNIQUE EPOCH" labelFirst checked={invariants.unique} onChange={(e) => setInvariants({ ...invariants, unique: e.currentTarget.checked })} />
                </Card>
              </Panel>
            </Example>
            <Example label="matte over a stage patch">
              <div className={styles.stagePatch}>
                <Panel material="matte" className={styles.stageOverlayPanel} padded>
                  <span className={styles.measure}>Panels overlapping the stage use the matte material.</span>
                </Panel>
              </div>
            </Example>
          </div>
        </Section>

        <Section id="buttons" title="4 · Buttons" note="Every state of every variant. All are real <button> elements: native activation, native disabled semantics, keyboard for free.">
          <div className={styles.grid}>
            <Example label="primary · the Configure CTA">
              <div className={styles.stack}>
                <Button variant="primary" glyph="▶">
                  Run Experiment
                </Button>
                <Button variant="primary" glyph="▶" busy>
                  Running…
                </Button>
                <Button variant="primary" glyph="▶" disabled>
                  Run Experiment
                </Button>
              </div>
            </Example>
            <Example label="secondary">
              <div className={styles.row}>
                <Button>Pause</Button>
                <Button busy>Loading</Button>
                <Button disabled>Stop</Button>
              </div>
            </Example>
            <Example label="ghost">
              <div className={styles.row}>
                <Button variant="ghost">Regenerate seed</Button>
                <Button variant="ghost" disabled>
                  Regenerate seed
                </Button>
              </div>
            </Example>
            <Example label="icon and transport">
              <div className={styles.row}>
                <IconButton label="Previous marker">⟨</IconButton>
                <IconButton label="Previous entry">◀</IconButton>
                <IconButton label={playing ? 'Pause' : 'Play'} transport active onClick={() => setPlaying(!playing)}>
                  {playing ? '❚❚' : '▶'}
                </IconButton>
                <IconButton label="Next entry">▶</IconButton>
                <IconButton label="Next marker" disabled>
                  ⟩
                </IconButton>
              </div>
            </Example>
            <Example label="busy, triggered">
              <Button
                variant="primary"
                glyph="▶"
                busy={busy}
                onClick={() => {
                  setBusy(true);
                  setTimeout(() => setBusy(false), 1400);
                }}
              >
                {busy ? 'Starting…' : 'Click to see busy'}
              </Button>
            </Example>
            <Example label="loading indicator">
              <div className={styles.row}>
                <Spinner label="Loading" />
                <span className={styles.measure}>standalone, with an accessible name</span>
              </div>
            </Example>
          </div>
        </Section>

        <Section id="controls" title="5 · Form controls" note="Each wraps a native element, so form association, validation and keyboard behaviour are the browser's. Demonstration values only.">
          <div className={styles.grid}>
            <Example label="select">
              <SelectField
                label="Protocol"
                value="naive"
                onChange={() => undefined}
                options={[
                  { value: 'naive', label: 'Naive leader election' },
                  { value: 'raft', label: 'Raft leader election' },
                  { value: 'heartbeat', label: 'Heartbeat failure detector' },
                ]}
              />
            </Example>
            <Example label="select · disabled and invalid">
              <div className={styles.stack}>
                <SelectField label="Protocol" disabled value="naive" onChange={() => undefined} options={[{ value: 'naive', label: 'Naive leader election' }]} />
                <SelectField label="Liveness check" error="Not available for this protocol" value="x" onChange={() => undefined} options={[{ value: 'x', label: 'raft-leader-elected@1' }]} />
              </div>
            </Example>
            <Example label="number · a seed is a value, not a range">
              <NumberField
                label="Random seed"
                value={seed}
                min={0}
                step={1}
                onChange={(e) => setSeed(Number(e.currentTarget.value))}
                affix={
                  <>
                    <IconButton label="Copy seed" variant="ghost">
                      ⧉
                    </IconButton>
                    <IconButton label="Regenerate seed" variant="ghost" onClick={() => setSeed(Math.floor(Math.random() * 10000))}>
                      ↻
                    </IconButton>
                  </>
                }
              />
            </Example>
            <Example label="number · hint, error, disabled">
              <div className={styles.stack}>
                <NumberField label="Nodes" value={nodes} min={2} max={8} hint="2–8 for this protocol" onChange={(e) => setNodes(Number(e.currentTarget.value))} />
                <NumberField label="Nodes" value={1} min={2} max={8} error="Raft needs at least 3 nodes" onChange={() => undefined} />
                <NumberField label="Max events" value={20000} disabled onChange={() => undefined} />
              </div>
            </Example>
            <Example label="range and dual range">
              <div className={styles.stack}>
                <RangeField label={`Replay speed · ${speed}/s`} value={speed} min={10} max={1000} step={10} onChange={(e) => setSpeed(Number(e.currentTarget.value))} />
                <DualRangeField
                  label={`Network latency · ${latency.low}–${latency.high} ticks`}
                  min={1}
                  max={40}
                  low={latency.low}
                  high={latency.high}
                  lowLabel="Minimum latency in ticks"
                  highLabel="Maximum latency in ticks"
                  onChange={setLatency}
                />
              </div>
            </Example>
            <Example label="switch">
              <div className={styles.stack}>
                <Switch label="Fault injection" checked={invariants.monotonic} onChange={(e) => setInvariants({ ...invariants, monotonic: e.currentTarget.checked })} />
                <Switch label="EPOCH MONOTONICITY" labelFirst checked={false} onChange={() => undefined} />
                <Switch label="Unsupported here" checked={false} disabled onChange={() => undefined} />
              </div>
            </Example>
            <Example label="segmented">
              <div className={styles.stack}>
                <Segmented
                  label="Show"
                  value={density}
                  options={[
                    { value: 'comfortable', label: 'entries' },
                    { value: 'compact', label: 'markers only' },
                  ]}
                  onChange={setDensity}
                />
                <Segmented
                  label="Disabled example"
                  value="a"
                  options={[
                    { value: 'a', label: 'time' },
                    { value: 'b', label: 'events', disabled: true },
                  ]}
                  onChange={() => undefined}
                />
              </div>
            </Example>
            <Example label="tooltip · hover and keyboard">
              <Tooltip content="Ends the run normally; everything produced so far is kept.">
                <Button>Stop</Button>
              </Tooltip>
            </Example>
          </div>
        </Section>

        <Section
          id="status"
          title="6 · Status, data and empty states"
          note="Status never depends on colour alone: each tone carries its own glyph and the text says what it means. Amber is an injected fault; red-orange is the system breaking a rule."
        >
          <div className={styles.grid}>
            <Example label="chips">
              <div className={styles.row}>
                <Chip tone="ok">NO VIOLATIONS DETECTED</Chip>
                <Chip tone="accent">Trace locked</Chip>
                <Chip tone="fault">Partition active</Chip>
                <Chip tone="violation">single-leader violated</Chip>
                <Chip tone="neutral" glyph={false}>
                  Trace derived
                </Chip>
              </div>
            </Example>
            <Example label="dots">
              <div className={styles.row}>
                <span className={styles.measure}>
                  <StatusDot tone="accent" /> changed here
                </span>
                <span className={styles.measure}>
                  <StatusDot tone="accent" filled={false} /> unchanged
                </span>
                <span className={styles.measure}>
                  <StatusDot tone="fault" /> fault
                </span>
              </div>
            </Example>
            <Example label="decorative motif (Q11)">
              <div className={styles.stack}>
                <DecorativeMotif />
                <span className={styles.measure}>Decoration. Not a node count, counter, progress or health light. aria-hidden, no focus, no hover.</span>
              </div>
            </Example>
            <Example label="value rows · read-only historical state">
              <div>
                <ValueRow label="currentTerm" value="3" trailing={<StatusDot tone="accent" />} />
                <ValueRow label="votedFor" value="n1" trailing={<StatusDot tone="accent" filled={false} />} />
                <ValueRow label="leaderId" value={undefined} />
              </div>
            </Example>
            <Example label="fact table">
              <FactTable
                facts={[
                  ['Protocol', 'Naive Leader Election'],
                  ['Seed', '7'],
                  ['Nodes', 'n1 n2 n3 n4'],
                  ['Latency', '1–10 ticks'],
                  ['Faults', 'none'],
                  ['Invariants', '5 / 5'],
                  ['Limits', '600 ticks · 20k events'],
                ]}
              />
            </Example>
            <Example label="empty state">
              <EmptyState title="No experiment loaded" action={<Button variant="ghost">Go to Configure</Button>}>
                Choose an experiment and run it; its trace will be inspected here.
              </EmptyState>
            </Example>
            <Example label="error state">
              <EmptyState title="Worker terminated">
                The run was aborted by the watchdog. The trace below is incomplete and this outcome is not reproducible.
              </EmptyState>
            </Example>
          </div>
        </Section>

        <Section id="overlays" title="7 · Overlays" note="Dialogs use the native <dialog> element with showModal(), so focus containment, Esc, the top layer and inert background come from the browser. We add focus restoration and backdrop dismissal.">
          <div className={styles.row}>
            <Button onClick={() => setDialog('dialog')}>Open dialog</Button>
            <Button onClick={() => setDialog('drawer')}>Open side drawer</Button>
            <Button onClick={() => setDialog('drawer-bottom')}>Open bottom drawer</Button>
          </div>
          <Dialog
            open={dialog !== null}
            onClose={() => setDialog(null)}
            variant={dialog ?? 'dialog'}
            title={dialog === 'dialog' ? 'Keyboard shortcuts' : 'Event log'}
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => setDialog(null)}>
                  Done
                </Button>
              </>
            }
          >
            <FactTable
              facts={[
                ['Space', 'run or pause'],
                ['← / →', 'previous or next entry'],
                ['Shift + ← / →', 'previous or next simulation step'],
                ['Home / End', 'first or last entry'],
                ['F', 'follow live'],
                ['Esc', 'close this dialog'],
              ]}
            />
            <p className={styles.sectionNote} style={{ marginTop: 'var(--space-4)' }}>
              Tab moves only between controls inside this dialog. Esc closes it and focus returns to the button that opened it.
            </p>
          </Dialog>
        </Section>

        <Section id="tabs" title="8 · Tabs" note="The ARIA tab pattern: one tab stop, arrow keys move, Home and End jump to the ends.">
          <Tabs
            label="Example"
            value={tab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'details', label: 'Details' },
            ]}
            onChange={setTab}
          />
          <TabPanel value="overview" active={tab === 'overview'}>
            <p className={styles.sectionNote}>Overview panel.</p>
          </TabPanel>
          <TabPanel value="details" active={tab === 'details'}>
            <p className={styles.sectionNote}>Details panel.</p>
          </TabPanel>
        </Section>

        <Section id="timeline" title="9 · Timeline primitives" note="Geometry and appearance only: no clock, no trace, no playback. Markers are real buttons; scrubbing is a native range input. Gate 4 supplies the data.">
          <Panel material="matte" title="Replay trace">
            <div className={styles.row} style={{ justifyContent: 'center', marginBottom: 'var(--space-3)' }}>
              <IconButton label="First entry">|◀</IconButton>
              <IconButton label="Previous entry">◀</IconButton>
              <IconButton label={playing ? 'Pause' : 'Play'} transport active onClick={() => setPlaying(!playing)}>
                {playing ? '❚❚' : '▶'}
              </IconButton>
              <IconButton label="Next entry">▶</IconButton>
              <IconButton label="Last entry">▶|</IconButton>
            </div>
            <Timeline
              position={position}
              positionLabel={`t ${Math.round(position * 600)}`}
              ticks={Array.from({ length: 13 }, (_, i) => ({ at: i / 12, label: `t ${i * 50}` }))}
              markers={[
                { id: 'a', at: 0.18, tone: 'accent', label: 'Demonstration marker at t=108' },
                { id: 'b', at: 0.37, tone: 'fault', label: 'Demonstration crash marker at t=222' },
                { id: 'c', at: 0.52, tone: 'recovery', label: 'Demonstration recovery marker at t=312' },
                { id: 'd', at: 0.74, tone: 'violation', label: 'Demonstration violation marker at t=444' },
              ]}
              scrub={{
                'aria-label': 'Trace position (demonstration)',
                min: 0,
                max: 1000,
                value: Math.round(position * 1000),
                onChange: (e) => setPosition(Number(e.currentTarget.value) / 1000),
              }}
            />
          </Panel>
        </Section>

        <Section
          id="recon"
          title="10 · Reference reconstructions"
          note="Small crops of the approved PNGs, rebuilt from the components above and sized to the reference. These are for side-by-side comparison; the numbers shown are the reference's own demonstration values."
        >
          <div className={styles.reconGrid}>
            <Example label="Configure · run setup rows (reference x31–400)">
              <div style={{ width: 369 }}>
                <Panel material="matte" title="Run setup">
                  <div className={styles.stack}>
                    <SelectField label="Protocol" value="naive" onChange={() => undefined} options={[{ value: 'naive', label: 'Naive leader election' }]} />
                    <Divider />
                    <NumberField
                      label="Random seed"
                      value={2026}
                      onChange={() => undefined}
                      affix={
                        <IconButton label="Regenerate seed" variant="ghost">
                          ↻
                        </IconButton>
                      }
                    />
                    <Divider />
                    <DualRangeField label="Network latency · 1–10 ticks" min={1} max={40} low={1} high={10} lowLabel="Minimum latency" highLabel="Maximum latency" onChange={() => undefined} />
                    <Divider />
                    <Switch label="Fault injection" checked onChange={() => undefined} />
                  </div>
                </Panel>
              </div>
            </Example>
            <Example label="Configure · CTA (reference x50–384, h 97)">
              <div style={{ width: 334 }}>
                <Button variant="primary" size="lg" glyph="▶" style={{ width: '100%' }}>
                  Run Experiment
                </Button>
              </div>
            </Example>
            <Example label="Configure · invariant card (reference 335×131)">
              <div style={{ width: 335 }}>
                <Card style={{ padding: 'var(--space-4)', height: 131, display: 'grid', alignContent: 'center', gap: 'var(--space-2)' }}>
                  <Switch
                    label={<span style={{ fontFamily: 'var(--font-mono)', letterSpacing: 'var(--type-tracking-wide)' }}>SINGLE LEADER</span>}
                    labelFirst
                    checked
                    onChange={() => undefined}
                  />
                  <span className={styles.measure}>At most one leader may claim any single epoch.</span>
                </Card>
              </div>
            </Example>
            <Example label="Simulate · trace context facts (reference x30–357)">
              <div style={{ width: 327 }}>
                <Panel material="matte" title="Trace context">
                  <SelectField label="Experiment" hideLabel value="healthy" onChange={() => undefined} options={[{ value: 'healthy', label: 'Healthy network' }]} />
                  <div style={{ height: 'var(--space-4)' }} />
                  <FactTable
                    facts={[
                      ['Protocol', 'Naive Leader Election'],
                      ['Seed', '7'],
                      ['Nodes', 'n1 n2 n3 n4'],
                      ['Latency', '1-10 ticks'],
                      ['Faults', 'none'],
                      ['Invariants', '5 / 5'],
                      ['Limits', '600 ticks · 20k events'],
                    ]}
                  />
                </Panel>
              </div>
            </Example>
            <Example label="Simulate · experiment status (reference x1206–1558)">
              <div style={{ width: 352 }}>
                <Panel material="matte" title="Experiment status">
                  <Chip tone="ok">NO VIOLATIONS DETECTED</Chip>
                  <div style={{ height: 'var(--space-4)' }} />
                  <Card style={{ padding: 'var(--space-4)' }}>
                    <FactTable
                      facts={[
                        ['Status', 'Completed'],
                        ['Violations', '0'],
                        ['Active nodes', '4'],
                      ]}
                    />
                  </Card>
                </Panel>
              </div>
            </Example>
            <Example label="Investigate · derived state (reference x1153–1557)">
              <div style={{ width: 404 }}>
                <Panel material="matte" title="Derived state" actions={<Chip tone="accent">Trace derived</Chip>}>
                  <Card style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    <Legend>Volatile state</Legend>
                    <ValueRow label="currentTerm" value="3" trailing={<StatusDot tone="accent" />} />
                    <ValueRow label="leaderId" value="n2" trailing={<StatusDot tone="accent" filled={false} />} />
                    <ValueRow label="votesGranted" value="n2 n3" trailing={<StatusDot tone="accent" filled={false} />} />
                  </Card>
                  <div style={{ height: 'var(--space-3)' }} />
                  <Legend>State origin</Legend>
                  <span className={styles.measure}>Updated at Event #829</span>
                </Panel>
              </div>
            </Example>
          </div>
        </Section>

        <Section id="shell" title="11 · Shell and header" note="The branding slot is a reserved box of the reference's dimensions with a temporary placeholder inside; the final logo is a file swap with no layout change.">
          <div style={{ border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-panel)', overflow: 'hidden', height: 320 }}>
            <AppShell
              contentAs="div"
              header={
                <Header
                  nav={[
                    { id: 'configure', label: 'Configure', href: '#', current: true },
                    { id: 'simulate', label: 'Simulate', href: '#' },
                    { id: 'investigate', label: 'Investigate', href: '#' },
                  ]}
                  end={
                    <>
                      <Chip tone="accent">Trace locked</Chip>
                      <DecorativeMotif />
                    </>
                  }
                />
              }
            >
              <Panel material="matte" title="Panel inside the shell">
                <span className={styles.measure}>The shell is a grid: header, main, dock. 100dvh, so the dock never scrolls away.</span>
              </Panel>
            </AppShell>
          </div>
        </Section>
      </main>
    </div>
  );
}
