import { useEffect, useMemo, useRef, useState } from 'react';
import { detectTier, prefersReducedMotion } from '../stage/capabilities';
import type { NodeVisualInput } from '../stage/node-visual';
import { Stage } from '../stage/Stage';
import type { NodeSprite, StageMetrics, Tier } from '../stage/types';
import { configureReference, interactive, investigateReference, scale, simulateReference, stateSheet, type Scene } from './scenes';

/**
 * CP6 Gate 1: the sculptural node prototype (node-lab.html). Not part of the application: a
 * controlled gallery for visual review, screenshots and performance measurement. One stage, one
 * WebGL context; scenes replace each other inside it.
 *
 * URL parameters: scene=<id>, tier=full|reduced|flat, motion=reduce, chrome=0 (hide controls,
 * for reference screenshots).
 */
const SCENES = ['investigate-ref', 'simulate-ref', 'configure-ref', 'states-warm', 'states-neutral', 'interactive', 'scale-1', 'scale-5', 'scale-20'] as const;
type SceneId = (typeof SCENES)[number];

const emptyMetrics = (tier: Tier): StageMetrics => ({ tier, dpr: 0, frames: 0, drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, cpuMs: 0, gpuMs: null, firstRenderMs: null, contextLost: 0 });

export function NodeLab() {
  const params = new URLSearchParams(location.search);
  const [sceneId, setSceneId] = useState<SceneId>((SCENES as readonly string[]).includes(params.get('scene') ?? '') ? (params.get('scene') as SceneId) : 'states-warm');
  const [tier, setTier] = useState<Tier>(() => detectTier());
  const [reducedMotion, setReducedMotion] = useState(() => params.get('motion') === 'reduce' || prefersReducedMotion());
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, Partial<NodeVisualInput>>>({ n1: { role: 'leader' } });
  const chrome = params.get('chrome') !== '0';
  const metrics = useRef<StageMetrics>(emptyMetrics(tier)).current;

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const scene: Scene = useMemo(() => {
    const base = (() => {
      switch (sceneId) {
        case 'investigate-ref':
          return investigateReference();
        case 'simulate-ref':
          return simulateReference();
        case 'configure-ref':
          return configureReference();
        case 'states-warm':
          return stateSheet(1);
        case 'states-neutral':
          return stateSheet(0);
        case 'interactive':
          return interactive(manual, hovered, selected);
        default:
          return scale(Number(sceneId.split('-')[1]));
      }
    })();
    if (sceneId === 'interactive') return base;
    // Live hover and selection on every scene (interaction states are always real).
    const nodes: NodeSprite[] = base.nodes.map((n) => ({ ...n, state: { ...n.state, hovered: n.state.hovered || hovered === n.id, selected: n.state.selected || selected === n.id } }));
    return { ...base, nodes };
  }, [sceneId, manual, hovered, selected]);

  // Test and measurement hooks (Playwright).
  useEffect(() => {
    (globalThis as { nodeLab?: unknown }).nodeLab = { metrics, setScene: setSceneId, setTier, setReducedMotion, setSelected, setManual, scenes: SCENES };
  }, [metrics]);

  const describe = (n: NodeSprite) => {
    const s = n.state;
    const parts = [n.id, s.status === 'crashed' ? 'crashed' : s.status === 'idle' ? 'not started' : (s.role ?? 'no role')];
    if (s.partitioned) parts.push('partitioned');
    if (s.recovering) parts.push('recovering');
    if (s.active) parts.push('event at this position');
    return parts.join(', ');
  };

  const selectedNode = scene.nodes.find((n) => n.id === selected);
  return (
    <div className="lab">
      {scene.panels.map((p, i) => (
        <div key={i} className="lab__panel" style={{ left: p.x, top: p.y, width: p.w, height: p.h, background: p.fill }} />
      ))}
      <Stage
        nodes={scene.nodes}
        tier={tier}
        reducedMotion={reducedMotion}
        metrics={metrics}
        labels={scene.labels}
        describe={describe}
        onHover={setHovered}
        onSelect={(id) => setSelected((s) => (s === id ? null : id))}
        under={
          <svg className="lab__links" aria-hidden="true">
            {scene.links.map((l, i) => (
              <line key={i} {...l} />
            ))}
          </svg>
        }
      />
      {scene.captions?.map((c) => (
        <p key={c.text} className="lab__caption" style={{ left: c.x - 130, top: c.y }}>
          {c.text}
          <span data-kind={c.kind}>{c.kind === 'protocol' ? 'protocol state (set by hand)' : c.kind}</span>
        </p>
      ))}
      {chrome && (
        <aside className="lab__controls" aria-label="Prototype controls">
          <h1>Sculptural node · Gate 1 prototype</h1>
          <p className="lab__notice" role="note">
            Visual states on this page are selected by hand. They are not simulation results.
          </p>
          <label>
            Scene{' '}
            <select value={sceneId} onChange={(e) => setSceneId(e.currentTarget.value as SceneId)} data-testid="lab-scene">
              {SCENES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Tier{' '}
            <select value={tier} onChange={(e) => setTier(e.currentTarget.value as Tier)} data-testid="lab-tier">
              <option value="full">full 3D</option>
              <option value="reduced">reduced 3D</option>
              <option value="flat">flat (no WebGL)</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.currentTarget.checked)} /> reduced motion
          </label>
          {sceneId === 'interactive' && selectedNode !== undefined && (
            <fieldset>
              <legend>{selectedNode.id}: protocol state (manual)</legend>
              {(['follower', 'candidate', 'leader'] as const).map((role) => (
                <label key={role}>
                  <input type="radio" name="role" checked={selectedNode.state.role === role && selectedNode.state.status === 'up'} onChange={() => setManual((m) => ({ ...m, [selectedNode.id]: { ...m[selectedNode.id], role, status: 'up' } }))} /> {role}
                </label>
              ))}
              <label>
                <input type="radio" name="role" checked={selectedNode.state.status === 'crashed'} onChange={() => setManual((m) => ({ ...m, [selectedNode.id]: { ...m[selectedNode.id], role: null, status: 'crashed' } }))} /> crashed
              </label>
              {(['partitioned', 'recovering', 'active'] as const).map((flag) => (
                <label key={flag}>
                  <input type="checkbox" checked={selectedNode.state[flag]} onChange={(e) => setManual((m) => ({ ...m, [selectedNode.id]: { ...m[selectedNode.id], [flag]: e.currentTarget.checked } }))} /> {flag}
                </label>
              ))}
            </fieldset>
          )}
        </aside>
      )}
    </div>
  );
}
