import type { NodeSprite } from './types';

/**
 * DOM layer over the stage (ADR-0025: text and controls stay in the DOM). One real button per
 * node: it receives hover, click and keyboard focus in every tier, carries the accessible name,
 * and draws the keyboard focus ring (CSS :focus-visible). Labels are DOM text, never textures.
 */
export interface NodeOverlayProps {
  readonly nodes: readonly NodeSprite[];
  /** Where the label sits: inside the sphere (Simulate), below it (Investigate rail) or none. */
  readonly labels: 'inside' | 'below' | 'none';
  readonly describe: (node: NodeSprite) => string;
  readonly onHover?: (id: string | null) => void;
  readonly onSelect?: (id: string) => void;
}

export function NodeOverlay({ nodes, labels, describe, onHover, onSelect }: NodeOverlayProps) {
  return (
    <div className="stage-overlay">
      {nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          className="stage-node"
          data-testid={`stage-node-${n.id}`}
          style={{ left: n.x - n.radius, top: n.y - n.radius, width: 2 * n.radius, height: 2 * n.radius }}
          aria-label={describe(n)}
          aria-pressed={n.state.selected}
          onPointerEnter={() => onHover?.(n.id)}
          onPointerLeave={() => onHover?.(null)}
          onFocus={() => onHover?.(n.id)}
          onBlur={() => onHover?.(null)}
          onClick={() => onSelect?.(n.id)}
        >
          {labels !== 'none' && (
            <span className={`stage-node__label stage-node__label--${labels}`} style={{ fontSize: labels === 'inside' ? Math.round(n.radius * 0.42) : 14 }} aria-hidden="true">
              {n.state.role === 'leader' && <span className="stage-node__crown">♛</span>}
              {n.label ?? n.id}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
