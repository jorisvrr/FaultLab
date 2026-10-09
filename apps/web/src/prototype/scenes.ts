import type { NodeVisualInput } from '../stage/node-visual';
import type { NodeSprite } from '../stage/types';

/**
 * Gate 1 prototype scenes. Every protocol state here is CHOSEN BY HAND to show the visual
 * language; none of it is a simulation result (the page says so). Coordinates of the three
 * reference scenes are measured from the approved PNGs (1586 × 992), so a screenshot at that
 * viewport overlays the reference directly.
 */
export const BASE: NodeVisualInput = { role: 'follower', status: 'up', recovering: false, partitioned: false, active: false, hovered: false, selected: false };

export interface Link {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Panel {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fill: string;
}

export interface Scene {
  readonly id: string;
  readonly title: string;
  readonly nodes: readonly NodeSprite[];
  readonly links: readonly Link[];
  readonly panels: readonly Panel[];
  readonly labels: 'inside' | 'below' | 'none';
  readonly captions?: readonly { readonly x: number; readonly y: number; readonly text: string; readonly kind: string }[];
}

const angle = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.atan2(-(to.y - from.y), to.x - from.x);

/** A complete graph whose links run between rim ports (Configure and Simulate references). */
/** `exposure`: scene lighting, from the amplitude fitted to that reference (hero = 1.0). */
function completeGraph(centres: readonly { id: string; x: number; y: number; r: number }[], warmth: number, spark: number, state: (id: string) => NodeVisualInput, exposure = 1) {
  const nodes: NodeSprite[] = centres.map(({ r, ...c }) => ({
    ...c,
    radius: r,
    exposure,
    warmth,
    spark,
    ports: centres.filter((o) => o.id !== c.id).map((o) => angle(c, o)),
    state: state(c.id),
  }));
  const links: Link[] = [];
  centres.forEach((a, i) =>
    centres.slice(i + 1).forEach((b) => {
      const t = angle(a, b);
      links.push({ x1: a.x + a.r * Math.cos(t), y1: a.y - a.r * Math.sin(t), x2: b.x - b.r * Math.cos(t), y2: b.y + b.r * Math.sin(t) });
    }),
  );
  return { nodes, links };
}

// Centres and radii fitted to the rim in each PNG (least-squares circle fit; the generated
// references are not perfectly regular, so sizes differ by a pixel or two between nodes).
const simulateCentres = [
  { id: 'n1', x: 813.7, y: 189.8, r: 55.5 },
  { id: 'n2', x: 1038, y: 364.1, r: 56.4 },
  { id: 'n3', x: 812.7, y: 543, r: 56.3 },
  { id: 'n4', x: 590.3, y: 363.4, r: 57 },
];

export function simulateReference(): Scene {
  const g = completeGraph(simulateCentres, 0, 1, () => BASE, 0.60);
  return { id: 'simulate-ref', title: 'Reference: Simulate topology', ...g, labels: 'inside', panels: [{ x: 373, y: 76, w: 817, h: 653, fill: '#0f1011' }] };
}

export function configureReference(): Scene {
  const centres = [
    { id: 'n1', x: 795.4, y: 216.6, r: 52.8 },
    { id: 'n2', x: 598.9, y: 383.3, r: 55 },
    { id: 'n3', x: 999.1, y: 383.5, r: 54.6 },
    { id: 'n4', x: 794.8, y: 548.8, r: 53.2 },
  ];
  const g = completeGraph(centres, 1, 1, () => BASE, 0.52);
  return { id: 'configure-ref', title: 'Reference: Configure topology preview', ...g, labels: 'none', panels: [{ x: 417, y: 79, w: 753, h: 856, fill: '#101213' }] };
}

export function investigateReference(): Scene {
  const hero: NodeSprite = { id: 'hero', x: 709.9, y: 447.4, radius: 95.2, warmth: 1, spark: 0, exposure: 1.04, ports: [Math.PI / 2, Math.PI, 0, -Math.PI / 2], state: BASE };
  const railFit = [
    [148.5, 29.4],
    [288.2, 29.2],
    [429.5, 29.1],
    [571.7, 30.3],
  ] as const;
  // The reference dims the rail nodes you are not inspecting (scene lighting, not state).
  const rail: NodeSprite[] = railFit.map(([y, radius], i) => ({ id: `n${i + 1}`, x: 109.2, y, radius, exposure: i === 3 ? 1.45 : 0.95, warmth: 0.5, spark: 0, ports: [], state: { ...BASE, selected: i === 3 } }));
  const links: Link[] = [
    { x1: 709.9, y1: 272, x2: 709.9, y2: 352 },
    { x1: 709.9, y1: 543, x2: 709.9, y2: 787 },
    { x1: 295, y1: 447.4, x2: 614.7, y2: 447.4 },
    { x1: 805.1, y1: 447.4, x2: 1080, y2: 447.4 },
    ...railFit.slice(0, 3).map(([y, r], i) => ({ x1: 109.2, y1: y + r, x2: 109.2, y2: railFit[i + 1]![0] - railFit[i + 1]![1] })),
  ];
  return {
    id: 'investigate-ref',
    title: 'Reference: Investigate hero node and rail',
    nodes: [hero, ...rail],
    links,
    labels: 'none',
    panels: [
      { x: 31, y: 79, w: 157, h: 709, fill: '#101318' },
      { x: 204, y: 79, w: 933, h: 708, fill: '#0b0d0d' },
    ],
  };
}

/** Every state from the Gate 1 brief, plus combinations, on one sheet. */
export function stateSheet(warmth: number): Scene {
  const cells: { label: string; kind: string; state: Partial<NodeVisualInput> }[] = [
    { label: 'Idle (not started)', kind: 'protocol', state: { status: 'idle', role: null } },
    { label: 'Follower', kind: 'protocol', state: {} },
    { label: 'Candidate', kind: 'protocol', state: { role: 'candidate' } },
    { label: 'Leader', kind: 'protocol', state: { role: 'leader' } },
    { label: 'Active (event here)', kind: 'protocol', state: { active: true } },
    { label: 'Crashed', kind: 'protocol', state: { status: 'crashed', role: null } },
    { label: 'Partitioned', kind: 'protocol', state: { partitioned: true } },
    { label: 'Recovering', kind: 'protocol', state: { recovering: true } },
    { label: 'Hovered', kind: 'interaction', state: { hovered: true } },
    { label: 'Selected', kind: 'interaction', state: { selected: true } },
    { label: 'Leader + selected', kind: 'combination', state: { role: 'leader', selected: true } },
    { label: 'Candidate + hovered', kind: 'combination', state: { role: 'candidate', hovered: true } },
    { label: 'Crashed + partitioned + selected', kind: 'combination', state: { status: 'crashed', role: null, partitioned: true, selected: true } },
    { label: 'Recovering + partitioned', kind: 'combination', state: { recovering: true, partitioned: true } },
  ];
  const columns = 5;
  const nodes: NodeSprite[] = [];
  const captions: { x: number; y: number; text: string; kind: string }[] = [];
  cells.forEach((cell, i) => {
    const x = 220 + (i % columns) * 290;
    const y = 190 + Math.floor(i / columns) * 290;
    nodes.push({ id: `s${i + 1}`, label: '', x, y, radius: 54, warmth, spark: 1, ports: [], state: { ...BASE, ...cell.state } });
    captions.push({ x, y: y + 105, text: cell.label, kind: cell.kind });
  });
  return { id: warmth === 1 ? 'states-warm' : 'states-neutral', title: `States (${warmth === 1 ? 'warm rim: Configure, Investigate' : 'neutral rim: Simulate'})`, nodes, links: [], panels: [], labels: 'inside', captions };
}

/** A live Simulate-like topology: hover, click and focus are real; protocol states are set by hand. */
export function interactive(states: Readonly<Record<string, Partial<NodeVisualInput>>>, hovered: string | null, selected: string | null): Scene {
  const g = completeGraph(simulateCentres, 0, 1, (id) => ({ ...BASE, ...states[id], hovered: hovered === id, selected: selected === id }), 0.60);
  return { id: 'interactive', title: 'Interactive (protocol states set by hand)', ...g, labels: 'inside', panels: [{ x: 373, y: 76, w: 817, h: 653, fill: '#0f1011' }] };
}

/** Scalability: n nodes with mixed states (shared geometry and materials, two draws). */
export function scale(n: number): Scene {
  const columns = Math.ceil(Math.sqrt(n * 1.6));
  const radius = n <= 1 ? 97 : n <= 5 ? 70 : 40;
  const spacing = radius * 3.2;
  const rows = Math.ceil(n / columns);
  const roles: Partial<NodeVisualInput>[] = [{}, { role: 'leader' }, { role: 'candidate' }, { status: 'crashed', role: null }, { partitioned: true }, { recovering: true }, { selected: true }];
  const nodes: NodeSprite[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i + 1}`,
    x: 793 + ((i % columns) - (Math.min(n, columns) - 1) / 2) * spacing,
    y: 480 + (Math.floor(i / columns) - (rows - 1) / 2) * spacing,
    radius,
    warmth: i % 2,
    spark: 1,
    ports: [],
    state: { ...BASE, ...roles[i % roles.length] },
  }));
  return { id: `scale-${n}`, title: `Scale: ${n} node${n === 1 ? '' : 's'}`, nodes, links: [], panels: [], labels: 'inside' };
}
