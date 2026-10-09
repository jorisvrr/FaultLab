import { nodeVisual } from './node-visual';
import type { NodeSprite } from './types';

/**
 * Flat tier (ADR-0025): the same nodes without WebGL, as SVG. Used when WebGL 2 is missing,
 * while a lost context is being restored, and for comparison. It draws the same NodeVisual
 * channels (rim, broken rim, segments, halo, selection ring, partition fence, recovery arc,
 * ports) with gradients and strokes, so meaning is identical; the surface detail is simpler.
 */
const AMBER = '#f8c781';
const BLUE = '#adc8fe';

export function FlatNodes({ nodes, width, height }: { nodes: readonly NodeSprite[]; width: number; height: number }) {
  return (
    <svg className="stage-flat" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" data-testid="stage-flat">
      <defs>
        <radialGradient id="flat-body" cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#2a2a2a" />
          <stop offset="0.45" stopColor="#111" />
          <stop offset="1" stopColor="#080808" />
        </radialGradient>
        {[0, 1].map((warm) => (
          <radialGradient key={warm} id={`flat-glow-${warm}`} r="0.5">
            <stop offset="0.55" stopColor={warm ? '#6b5747' : '#3e4243'} stopOpacity="0" />
            <stop offset="0.57" stopColor={warm ? '#6b5747' : '#3e4243'} stopOpacity="0.55" />
            <stop offset="1" stopColor={warm ? '#6b5747' : '#3e4243'} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {nodes.map((n) => {
        const v = nodeVisual(n.state);
        const e = n.exposure ?? 1;
        const R = n.radius;
        const warm = n.warmth >= 0.5 ? 1 : 0;
        const rim = v.fault > 0.5 ? AMBER : v.recovery > 0.5 ? '#c9d8fb' : warm ? '#fff3e6' : '#eef1f4';
        const circumference = 2 * Math.PI * R;
        return (
          <g key={n.id} transform={`translate(${n.x} ${n.y})`} data-node={n.id}>
            <circle r={R * 1.75} fill={`url(#flat-glow-${warm})`} opacity={Math.min(1, 0.7 * v.halo * e)} />
            <circle r={R} fill="url(#flat-body)" />
            <circle
              r={R}
              fill="none"
              stroke={rim}
              strokeWidth={Math.max(1.2, R * 0.025)}
              opacity={Math.min(1, 0.75 * v.rim * e)}
              strokeDasharray={v.broken > 0.5 ? `${circumference / 28} ${circumference / 28}` : v.segmented > 0.5 ? `${circumference / 32 - 2.5} 2.5` : undefined}
            />
            {n.ports.map((a) => (
              <circle key={a} cx={R * Math.cos(a)} cy={-R * Math.sin(a)} r={Math.min(5, Math.max(2.6, R * 0.045))} fill="#f4f6ff" />
            ))}
            {v.selection > 0.5 && <circle r={R * 1.4} fill="none" stroke={BLUE} strokeWidth={Math.max(1.5, R * 0.032)} />}
            {v.fence > 0.5 && <circle r={R * 1.22} fill="none" stroke={AMBER} strokeWidth={Math.max(1.8, R * 0.032)} strokeLinecap="round" strokeDasharray="0 9" />}
            {v.recovery > 0.5 && (
              <circle r={R * (v.fence > 0.5 ? 1.31 : 1.22)} fill="none" stroke={BLUE} strokeWidth={Math.max(1.4, R * 0.028)} strokeDasharray={`${(2 * Math.PI * R * 1.22 * 300) / 360} 1e6`} transform="rotate(-60)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
