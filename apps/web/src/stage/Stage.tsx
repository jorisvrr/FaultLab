import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { FlatNodes } from './FlatNodes';
import { NodeOverlay, type NodeOverlayProps } from './NodeOverlay';
import type { NodeSprite, StageMetrics, Tier } from './types';
import './stage.css';

/** three.js + React Three Fiber load only when a 3D tier is actually rendered (ADR-0025). */
const NodeCanvas = lazy(() => import('./NodeCanvas'));

export interface StageProps extends Omit<NodeOverlayProps, 'nodes'> {
  /** Fixed pixel positions. Use `layout` instead when the composition must follow the size. */
  readonly nodes?: readonly NodeSprite[];
  /**
   * Called with the stage's measured size, so a caller can place nodes proportionally without
   * duplicating the size observer. Takes precedence over `nodes`.
   */
  readonly layout?: (size: { readonly width: number; readonly height: number }) => readonly NodeSprite[];
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
export function Stage({ nodes = [], layout, tier, reducedMotion, metrics, under, ...overlay }: StageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const placed = layout === undefined ? nodes : size.width === 0 ? [] : layout(size);
  const flat = <FlatNodes nodes={placed} width={size.width} height={size.height} />;
  return (
    <div ref={ref} className="stage" data-testid="stage" data-tier={lost ? 'flat' : tier} data-context-lost={lost}>
      {under}
      {tier === 'flat' || size.width === 0 ? (
        flat
      ) : (
        <Suspense fallback={flat}>
          {lost && flat}
          <NodeCanvas nodes={placed} tier={tier} reducedMotion={reducedMotion} metrics={metrics} onContextLost={setLost} />
        </Suspense>
      )}
      <NodeOverlay nodes={placed} {...overlay} />
    </div>
  );
}
