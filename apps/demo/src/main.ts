import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';
import { ENGINE_VERSION, fingerprintTrace, runSimulation, serializeTrace, type TraceEntry } from '@faultlab/engine';
import { buildModel, frameAt, lastIndexAtOrBefore, type Frame, type InvariantViolationEntry, type TraceModel } from './derive';
import { experiments, type Experiment } from './experiments';

/**
 * CP2.5 prototype. Two strictly separate phases:
 *   1. EXECUTE: the real @faultlab/engine runs the experiment to completion (synchronously; the
 *      experiments are small and bounded) and returns a trace.
 *   2. REPLAY: everything on screen is a pure function of (trace, cursor, display time). Playback
 *      never calls the engine and cannot change what happened.
 * Throwaway UI code: the reusable part is derive.ts.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $('graph') as unknown as SVGSVGElement;
const SVG = 'http://www.w3.org/2000/svg';

interface Run {
  readonly experiment: Experiment;
  readonly model: TraceModel;
  readonly fingerprint: string;
  readonly serialized: string;
  readonly ms: number;
}

let run: Run | null = null;
let cursor = 0;
let displayTime = 0;
let playing = false;
let selected: string | null = null;
let renderedCursor = -1;

// ── Execute ────────────────────────────────────────────────────────────────────────────────

function execute(experiment: Experiment): void {
  playing = false;
  const t0 = performance.now();
  const result = runSimulation(experiment.build());
  const ms = performance.now() - t0;
  run = { experiment, model: buildModel(result.trace), fingerprint: fingerprintTrace(result.trace), serialized: serializeTrace(result.trace), ms };
  cursor = 0;
  displayTime = 0;
  renderedCursor = -1;
  selected = null;
  $('verify-result').textContent = '';
  buildStatic();
  render();
}

function verify(): void {
  if (run === null) return;
  const runs = [1, 2].map(() => runSimulation(run!.experiment.build()));
  const identical = runs.every((r) => serializeTrace(r.trace) === run!.serialized);
  const lines = [`re-executed 2× from the same inputs: traces ${identical ? 'byte-identical ✓' : 'DIFFER ✗'}`, `fingerprint ${run.fingerprint}`];
  const expected = run.experiment.expected;
  if (expected !== undefined) {
    const match = expected.fingerprint === run.fingerprint;
    lines.push(`stored fixture fingerprint ${expected.fingerprint}: ${match ? 'matches ✓' : 'MISMATCH ✗'}`);
  }
  const el = $('verify-result');
  el.textContent = lines.join('\n');
  el.className = `verify mono ${identical && (expected === undefined || expected.fingerprint === run.fingerprint) ? 'ok' : 'fail'}`;
  el.dataset['identical'] = String(identical);
}

// ── Static parts (once per run) ─────────────────────────────────────────────────────────────

function buildStatic(): void {
  if (run === null) return;
  const { model, experiment } = run;
  const start = model.start;
  $('engine-version').textContent = `@faultlab/engine ${ENGINE_VERSION}`;
  $('experiment-summary').textContent = experiment.summary;
  const problem = $('experiment-problem');
  problem.hidden = experiment.problem === undefined;
  problem.textContent = experiment.problem ?? '';
  $('run-info').textContent =
    `EXECUTED in this tab: ${model.trace.length} trace entries, ${model.end?.eventsProcessed ?? '?'} events in ${run.ms.toFixed(1)} ms\n` +
    `stop: ${model.end?.reason ?? 'running'} at t=${model.end?.time ?? '?'} · fingerprint ${run.fingerprint}\n` +
    `source: ${experiment.source}`;
  $('inputs').textContent = [
    `engine     ${start.engineVersion}`,
    `protocol   ${start.protocol.name}@${start.protocol.version}`,
    `seed       ${start.seed}`,
    `nodes      ${start.nodes.join(' ')}`,
    `latency    ${start.latency.min}–${start.latency.max} ticks`,
    `limits     maxTime ${String(start.limits.maxTime)} · maxEvents ${start.limits.maxEvents}`,
    `invariants ${start.invariants.map((i) => `${i.id}@${i.version}`).join(', ') || 'none'}`,
    `policy     ${start.invariantPolicy}`,
    'faults',
    ...(start.faults.length === 0 ? ['  none'] : start.faults.map((f) => `  ${f.id} t=${f.at} ${describeFault(f as unknown as Record<string, unknown>)}`)),
  ].join('\n');

  const log = $('log');
  log.replaceChildren(
    ...model.trace.map((entry) => {
      const li = document.createElement('li');
      li.dataset['index'] = String(entry.index);
      li.dataset['kind'] = entry.kind;
      if ('faultId' in entry || entry.kind === 'message.drop' || entry.kind === 'protocol.error') li.classList.add('fault');
      if (entry.kind.startsWith('invariant.')) li.classList.add('violation');
      const cells = [`#${entry.index}`, `t=${entry.time}`, entry.kind, describeEntry(entry)];
      li.append(...cells.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
      li.addEventListener('click', () => seekIndex(entry.index));
      return li;
    }),
  );

  const timeline = $('timeline');
  timeline.querySelectorAll('.mark').forEach((m) => m.remove());
  const pct = (t: number) => `${model.duration === 0 ? 0 : (t / model.duration) * 100}%`;
  for (const i of model.faultIndices) {
    const mark = Object.assign(document.createElement('div'), { className: 'mark', title: describeEntry(model.trace[i]!) });
    mark.style.left = pct(model.trace[i]!.time);
    timeline.append(mark);
  }
  for (const v of model.violations) {
    const mark = Object.assign(document.createElement('div'), { className: 'mark violation', title: v.observed });
    mark.style.left = pct(v.time);
    mark.dataset['testid'] = 'violation-marker';
    timeline.append(mark);
  }
}

// ── Per-frame rendering (pure function of trace + cursor + display time) ───────────────────

function render(): void {
  if (run === null) return;
  const frame = frameAt(run.model, cursor, displayTime);
  renderGraph(frame);
  $('clock').textContent = `t ${Math.floor(frame.time)}`;
  $('cursor').textContent = `#${frame.index} / ${run.model.trace.length - 1}`;
  $('stop-reason').textContent = frame.stopped ? `run.end: ${run.model.end?.reason}` : '';
  $('playhead').style.left = `${run.model.duration === 0 ? 0 : (frame.time / run.model.duration) * 100}%`;
  ($('play') as HTMLButtonElement).textContent = playing ? 'Pause' : 'Play';
  updateLog(frame.index);
  renderViolation(frame);
  renderInspector(frame);
}

function positions(nodes: readonly string[]): Map<string, { x: number; y: number }> {
  const cx = 260;
  const cy = 205;
  const r = 150;
  return new Map(nodes.map((id, i) => {
    const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
    return [id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }];
  }));
}

function el(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderGraph(frame: Frame): void {
  if (run === null) return;
  const pos = positions(run.model.nodes);
  const group = new Map<string, number>();
  frame.partition?.forEach((g, i) => g.forEach((id) => group.set(id, i)));
  const degraded = new Set(frame.links.flatMap((l) => [`${l.from}>${l.to}`, `${l.to}>${l.from}`]));
  const violating = new Set(frame.openViolations.flatMap((v) => v.nodes));
  const children: SVGElement[] = [];

  const ids = run.model.nodes;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = pos.get(ids[i]!)!;
      const b = pos.get(ids[j]!)!;
      const cut = frame.partition !== null && group.get(ids[i]!) !== group.get(ids[j]!);
      const cls = cut ? 'link cut' : degraded.has(`${ids[i]}>${ids[j]}`) ? 'link degraded' : 'link';
      children.push(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls, 'data-testid': cut ? 'link-cut' : 'link' }));
    }
  }

  // Messages: offset each direction slightly so both directions stay visible.
  const along = (from: string, to: string, p: number) => {
    const a = pos.get(from)!;
    const b = pos.get(to)!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: a.x + dx * p + (-dy / len) * 5, y: a.y + dy * p + (dx / len) * 5 };
  };
  for (const m of frame.inFlight) {
    const p = along(m.record.from, m.record.to, 0.12 + 0.76 * m.progress);
    children.push(el('circle', { cx: p.x, cy: p.y, r: 3.5, class: 'msg', 'data-testid': 'message' }));
  }
  for (const d of frame.recentDrops) {
    const p = along(d.record.from, d.record.to, d.at === 0 ? 0.18 : 0.82);
    children.push(el('text', { x: p.x, y: p.y + 4, class: 'drop', 'data-testid': 'drop' }, '×'));
  }

  for (const node of frame.nodes) {
    const p = pos.get(node.id)!;
    const summary = run.experiment.describe(node.state);
    const g = el('g', {
      class: `node ${node.status}${summary?.emphasis === true ? ' leader' : ''}`,
      transform: `translate(${p.x} ${p.y})`,
      'data-testid': `node-${node.id}`,
      'data-status': node.status,
      'data-role': summary?.emphasis === true ? 'leader' : '',
      'data-violating': String(violating.has(node.id)),
    });
    g.append(el('circle', { r: 26, class: 'body' }));
    if (violating.has(node.id)) g.append(el('circle', { r: 33, class: 'ring' }));
    if (selected === node.id) g.append(el('circle', { r: 39, class: 'select' }));
    g.append(el('text', { y: 4, class: 'id' }, node.id));
    if (node.status === 'crashed') g.append(el('text', { y: -32, class: 'cross' }, '×'));
    const sub = node.status === 'crashed' ? `crashed (inc ${node.incarnation})` : node.status === 'idle' ? 'not started' : `inc ${node.incarnation}${summary ? ` · ${summary.label}` : ''}`;
    g.append(el('text', { y: 46, class: node.status === 'crashed' ? 'sub warn' : 'sub' }, sub));
    if (violating.has(node.id)) g.append(el('text', { y: 60, class: 'sub warn' }, 'VIOLATION'));
    g.addEventListener('click', () => {
      selected = node.id;
      render();
    });
    children.push(g);
  }
  if (frame.partition !== null) {
    children.push(el('text', { x: 12, y: 20, class: 'partition-label', 'data-testid': 'partition-label' }, `partition ${frame.partition.map((g) => `[${g.join(' ')}]`).join(' | ')}`));
  }
  svg.replaceChildren(...children);
}

function updateLog(index: number): void {
  const rows = $('log').children;
  const from = renderedCursor < 0 ? 0 : Math.min(index, renderedCursor);
  const to = renderedCursor < 0 ? rows.length - 1 : Math.max(index, renderedCursor);
  for (let i = from; i <= to; i++) {
    const row = rows[i];
    row?.classList.toggle('future', i > index);
    row?.classList.toggle('current', i === index);
  }
  // Scroll only the log panel (scrollIntoView would also scroll the page).
  const row = rows[index] as HTMLElement | undefined;
  const panel = $('log').parentElement!;
  if (renderedCursor !== index && row !== undefined) {
    const top = row.offsetTop - panel.offsetTop;
    if (top < panel.scrollTop || top > panel.scrollTop + panel.clientHeight - 40) panel.scrollTop = top - panel.clientHeight / 2;
  }
  renderedCursor = index;
}

function link(index: number | null): string {
  return index === null ? '—' : `<a href="#" data-seek="${index}">#${index}</a>`;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderViolation(frame: Frame): void {
  const panel = $('violation');
  const reached = run!.model.violations.filter((v) => v.index <= frame.index);
  const v: InvariantViolationEntry | undefined = reached.at(-1);
  panel.hidden = v === undefined;
  if (v === undefined) return;
  const trace = run!.model.trace;
  panel.className = 'violation-box';
  panel.innerHTML = `
    <h3>INVARIANT VIOLATION · ${escape(v.invariant.name)}</h3>
    <p class="label">Asserted by the invariant</p>
    <dl>
      <dt>rule</dt><dd class="mono">${escape(v.invariant.id)}@${escape(v.invariant.version)}</dd>
      <dt>time</dt><dd class="mono">t=${v.time} · ${escape(v.violationId)}</dd>
      <dt>nodes</dt><dd class="mono" data-testid="violation-nodes">${v.nodes.join(', ')}</dd>
      <dt>expected</dt><dd>${escape(v.expected)}</dd>
      <dt>observed</dt><dd data-testid="violation-observed">${escape(v.observed)}</dd>
      <dt>evidence</dt><dd><pre class="mono">${escape(JSON.stringify(v.evidence, null, 1))}</pre></dd>
      <dt>cites</dt><dd class="mono">${v.references.map(link).join(' ') || '—'}</dd>
    </dl>
    <p class="label">Observed by the engine (facts, no inferred cause)</p>
    <dl>
      <dt>trigger</dt><dd class="mono">${link(v.trigger)} ${escape(trace[v.trigger]!.kind)} ${escape(describeEntry(trace[v.trigger]!))}</dd>
      <dt>step</dt><dd class="mono">#${v.step.first}–#${v.step.last}</dd>
      <dt>node states</dt><dd class="mono">${v.nodeStates.map((s) => `${s.node} ${s.status} inc ${s.incarnation} state ${link(s.stateEntry)}`).join('<br>')}</dd>
      <dt>active faults</dt><dd class="mono" data-testid="violation-active-faults">partition ${link(v.activeFaults.partition)} · links ${v.activeFaults.links.map(link).join(' ') || '—'} · crashed ${v.activeFaults.crashed.map(link).join(' ') || '—'}</dd>
      <dt>replay</dt><dd class="mono">run.start inputs for ${v.eventNumber} events</dd>
    </dl>`;
  panel.querySelectorAll<HTMLAnchorElement>('a[data-seek]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      seekIndex(Number(a.dataset['seek']));
    }),
  );
}

function renderInspector(frame: Frame): void {
  const box = $('inspector');
  const node = frame.nodes.find((n) => n.id === selected);
  if (node === undefined) return;
  box.innerHTML = `
    <h3 class="label">Node ${node.id} at #${frame.index} (derived from the trace)</h3>
    <pre class="mono">status       ${node.status}\nincarnation  ${node.incarnation}\nstate from   ${node.stateEntry === null ? '—' : `#${node.stateEntry}`}</pre>
    <p class="label">volatile state</p><pre class="mono" data-testid="inspector-state">${escape(JSON.stringify(node.state ?? null, null, 1))}</pre>
    <p class="label">persistent storage</p><pre class="mono">${escape(JSON.stringify(node.storage, null, 1))}</pre>`;
}

// ── Formatting ─────────────────────────────────────────────────────────────────────────────

function describeFault(f: Record<string, unknown>): string {
  switch (f['type']) {
    case 'partition':
      return `partition ${(f['groups'] as string[][]).map((g) => `[${g.join(' ')}]`).join(' | ')}`;
    case 'link':
      return `link ${String(f['from'])}→${String(f['to'])} loss ${String(f['loss'])} delay ${JSON.stringify(f['delay'])}`;
    case 'link-restore':
      return `link-restore ${String(f['from'])}→${String(f['to'])}`;
    case 'heal':
      return 'heal';
    default:
      return `${String(f['type'])} ${String(f['node'])}`;
  }
}

function describeEntry(e: TraceEntry): string {
  switch (e.kind) {
    case 'run.start':
      return `seed ${e.seed}, ${e.nodes.length} nodes, ${e.faults.length} faults`;
    case 'node.start':
    case 'node.recover':
      return `${e.node} incarnation ${e.incarnation}`;
    case 'node.crash':
      return `${e.node} (cancelled ${e.cancelledTimers.length} timers)`;
    case 'message.send':
      return `${e.node}→${e.to} ${e.messageId} ${JSON.stringify(e.payload)}${e.deliverAt === null ? ' (dropped at send)' : ` due t=${e.deliverAt}`}`;
    case 'message.deliver':
      return `${e.from}→${e.node} ${e.messageId}`;
    case 'message.drop':
      return `${e.from}→${e.node} ${e.messageId} ${e.reason} (fault #${e.conditionIndex})`;
    case 'timer.set':
      return `${e.node} ${e.tag} fires t=${e.fireAt}`;
    case 'timer.fire':
    case 'timer.cancel':
      return `${e.node} ${'tag' in e ? e.tag : e.timerId}`;
    case 'state.update':
      return `${e.node} ${JSON.stringify(e.state).slice(0, 90)}`;
    case 'storage.write':
      return `${e.node} ${JSON.stringify(e.set)}`;
    case 'network.partition':
      return e.groups.map((g) => `[${g.join(' ')}]`).join(' | ');
    case 'network.heal':
      return 'partition healed';
    case 'link.fault':
      return `${e.from}→${e.to} loss ${e.loss} delay ${e.delay.min}–${e.delay.max}`;
    case 'link.restore':
      return `${e.from}→${e.to}`;
    case 'fault.skipped':
      return `${e.faultType} ${e.node}: ${e.reason}`;
    case 'invariant.violation':
      return `${e.invariant.id}: ${e.observed}`;
    case 'invariant.cleared':
      return `${e.invariant.id} holds again (${e.violationId})`;
    case 'invariant.error':
      return `${e.invariant.id}: ${e.error}`;
    case 'protocol.error':
      return `${e.node}: ${e.error}`;
    case 'run.end':
      return `${e.reason} after ${e.eventsProcessed} events`;
  }
}

// ── Playback (view only) ───────────────────────────────────────────────────────────────────

function seekIndex(index: number): void {
  if (run === null) return;
  playing = false;
  cursor = Math.max(0, Math.min(index, run.model.trace.length - 1));
  displayTime = run.model.trace[cursor]!.time;
  render();
}

let last = 0;
function tick(now: number): void {
  if (playing && run !== null) {
    const speed = Number(($('speed') as HTMLSelectElement).value);
    displayTime = Math.min(run.model.duration, displayTime + ((now - last) / 1000) * speed);
    cursor = lastIndexAtOrBefore(run.model, displayTime);
    if (displayTime >= run.model.duration) {
      cursor = run.model.trace.length - 1;
      playing = false;
    }
    render();
  }
  last = now;
  requestAnimationFrame(tick);
}

function wire(): void {
  const select = $('experiment') as HTMLSelectElement;
  select.append(...experiments.map((e) => Object.assign(document.createElement('option'), { value: e.id, textContent: `${e.title}${e.source === 'stored counterexample' ? ' ★' : ''}` })));
  const current = () => experiments.find((e) => e.id === select.value)!;
  select.addEventListener('change', () => execute(current()));
  $('execute').addEventListener('click', () => execute(current()));
  $('verify').addEventListener('click', verify);
  $('restart').addEventListener('click', () => seekIndex(0));
  $('back').addEventListener('click', () => seekIndex(cursor - 1));
  $('forward').addEventListener('click', () => seekIndex(cursor + 1));
  $('end').addEventListener('click', () => seekIndex(Number.MAX_SAFE_INTEGER));
  $('jump').addEventListener('click', () => {
    const v = run?.model.violations[0];
    if (v !== undefined) seekIndex(v.index);
  });
  $('play').addEventListener('click', () => {
    if (run === null) return;
    if (!playing && cursor >= run.model.trace.length - 1) {
      cursor = 0;
      displayTime = 0;
    }
    playing = !playing;
    render();
  });
  $('timeline').addEventListener('click', (e) => {
    if (run === null) return;
    const rect = $('timeline').getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * run.model.duration;
    seekIndex(lastIndexAtOrBefore(run.model, t));
  });
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    if (e.key === ' ') {
      e.preventDefault();
      $('play').click();
    } else if (e.key === 'ArrowRight') seekIndex(cursor + 1);
    else if (e.key === 'ArrowLeft') seekIndex(cursor - 1);
    else if (e.key === 'Home') seekIndex(0);
  });
  // Deep link for tests and demos: ?experiment=<id>
  const requested = new URLSearchParams(location.search).get('experiment');
  if (requested !== null && experiments.some((e) => e.id === requested)) select.value = requested;
  execute(current());
  requestAnimationFrame(tick);
}

wire();
