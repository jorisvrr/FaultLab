import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { FlatNodes } from './FlatNodes';
import { NodeOverlay, type NodeOverlayProps } from './NodeOverlay';
import type { NodeSprite, StageMetrics, Tier } from './types';

/** three.js + React Three Fiber load only when a 3D tier is actually rendered (ADR-0025). */
const NodeCanvas = lazy(() => import('./NodeCanvas'));

export interface StageProps extends Omit<NodeOverlayProps, 'nodes'> {
  readonly nodes: readonly NodeSprite[];
  readonly tier: Tier;
  readonly reducedMotion: boolean;
  readonly metrics?: StageMetrics;
  /** Drawn below the nodes (links as SVG, ADR-0025: SVG for links, paths and markers). */
  readonly under?: ReactNode;
}

/**
 * The stage: links (SVG) below, nodes (3D, or flat) in the middle, the DOM overlay on top.
 * While the 3D chunk loads, or while a lost WebGL context is being restored, the flat tier is
 * shown, so the nodes and their meaning never disappear.
 */
export function Stage({ nodes, tier, reducedMotion, metrics, under, ...overlay }: StageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const flat = <FlatNodes nodes={nodes} width={size.width} height={size.height} />;
  return (
    <div ref={ref} className="stage" data-testid="stage" data-tier={lost ? 'flat' : tier} data-context-lost={lost}>
      {under}
      {tier === 'flat' || size.width === 0 ? (
        flat
      ) : (
        <Suspense fallback={flat}>
          {lost && flat}
          <NodeCanvas nodes={nodes} tier={tier} reducedMotion={reducedMotion} metrics={metrics} onContextLost={setLost} />
        </Suspense>
      )}
      <NodeOverlay nodes={nodes} {...overlay} />
    </div>
  );
}
