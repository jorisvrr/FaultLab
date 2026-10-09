import type { NodeVisualInput } from './node-visual';

/**
 * A node as the stage draws it. Positions are CSS pixels from the stage's top-left corner, so
 * the WebGL layer, the DOM overlay (labels, focus proxies) and the flat fallback share one
 * coordinate system without projection maths.
 */
export interface NodeSprite {
  readonly id: string;
  /** Text shown in the DOM label (default: the id). */
  readonly label?: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 1 = warm rim (Configure, Investigate), 0 = neutral rim (Simulate). */
  readonly warmth: number;
  /**
   * Scene lighting for this node (1 = normal). A composition choice, not protocol state: the
   * Investigate rail dims the nodes you are not inspecting, as the reference does.
   */
  readonly exposure?: number;
  /** Key-light spark at the top of the rim (0–1). */
  readonly spark: number;
  /** Angles (radians, 0 = right, counter-clockwise) where links meet the rim; at most four. */
  readonly ports: readonly number[];
  readonly state: NodeVisualInput;
}

/**
 * Rendering tiers (ADR-0025): full 3D → reduced 3D (DPR 1, no micro-texture) → flat (SVG, no
 * WebGL). Every tier draws the same NodeVisual channels from the same data.
 */
export type Tier = 'full' | 'reduced' | 'flat';

export interface StageMetrics {
  tier: Tier;
  dpr: number;
  frames: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  /** CPU time of the last renderer.render call (ms). */
  cpuMs: number;
  /** GPU time of the last measured frame (ms), where EXT_disjoint_timer_query_webgl2 exists. */
  gpuMs: number | null;
  /** First render including shader compilation (ms). */
  firstRenderMs: number | null;
  contextLost: number;
  /** Request one frame (benchmarks; the stage itself renders only on change). */
  requestFrame?: () => void;
}
