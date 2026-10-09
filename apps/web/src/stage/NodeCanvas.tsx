import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { NodeField } from './NodeField';
import type { NodeSprite, StageMetrics, Tier } from './types';

/**
 * The 3D stage (ADR-0025). Lazy-loaded: importing this module is what pulls in three.js and
 * React Three Fiber, so pages without a stage never download them.
 *
 * - One WebGL context per page: this is the only <Canvas>; scenes change, the context stays.
 * - On-demand rendering (frameloop "demand"): no frame unless something changed.
 * - Shaders are compiled before the first frame (compileAsync), never during interaction.
 * - Context loss: reported to the parent, which shows the flat tier until it is restored.
 * - Never coupled to the simulation: it draws the NodeSprites it is given, nothing else.
 */
export interface NodeCanvasProps {
  readonly nodes: readonly NodeSprite[];
  readonly tier: Exclude<Tier, 'flat'>;
  readonly reducedMotion: boolean;
  /** Mutable metrics record (updated without re-rendering React). */
  readonly metrics?: StageMetrics | undefined;
  readonly onContextLost?: (lost: boolean) => void;
}

export default function NodeCanvas({ nodes, tier, reducedMotion, metrics, onContextLost }: NodeCanvasProps) {
  const dpr = tier === 'full' ? Math.min(devicePixelRatio, 2) : 1;
  return (
    <Canvas
      className="stage-canvas"
      orthographic
      camera={{ position: [0, 0, 500], near: 1, far: 1000, zoom: 1 }}
      frameloop="demand"
      dpr={dpr}
      flat
      linear
      gl={{ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' }}
      // The canvas is decorative for assistive technology: the DOM overlay carries names and roles.
      aria-hidden="true"
      tabIndex={-1}
      onCreated={({ gl }) => {
        const canvas = gl.domElement;
        canvas.addEventListener('webglcontextlost', (event) => {
          event.preventDefault(); // allow restoration
          if (metrics !== undefined) metrics.contextLost++;
          onContextLost?.(true);
        });
        canvas.addEventListener('webglcontextrestored', () => onContextLost?.(false));
      }}
    >
      <NodeField nodes={nodes} micro={tier === 'full'} reducedMotion={reducedMotion} />
      <Renderer tier={tier} metrics={metrics} />
    </Canvas>
  );
}

/** Takes over rendering (useFrame priority 1) to measure CPU and, where available, GPU time. */
function Renderer({ tier, metrics }: { tier: Tier; metrics: StageMetrics | undefined }) {
  const { gl, scene, camera, invalidate } = useThree();
  const ready = useRef(false);
  const timer = useRef<{ ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null; pending: WebGLQuery | null }>({ ext: null, pending: null });

  useEffect(() => {
    let cancelled = false;
    const context = gl.getContext() as WebGL2RenderingContext;
    timer.current.ext = context.getExtension('EXT_disjoint_timer_query_webgl2');
    if (metrics !== undefined) metrics.requestFrame = invalidate;
    const t0 = performance.now();
    // Warm-up: compile every program before the first visible frame.
    void gl.compileAsync(scene, camera).then(() => {
      if (cancelled) return;
      ready.current = true;
      if (metrics !== undefined) metrics.firstRenderMs = performance.now() - t0;
      invalidate();
    });
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera, invalidate, metrics]);

  useFrame(() => {
    if (!ready.current) return;
    const context = gl.getContext() as WebGL2RenderingContext;
    const t = timer.current;
    let query: WebGLQuery | null = null;
    if (t.ext !== null && t.pending === null) {
      query = context.createQuery();
      if (query !== null) context.beginQuery(t.ext.TIME_ELAPSED_EXT, query);
    }
    const t0 = performance.now();
    gl.render(scene, camera);
    const cpu = performance.now() - t0;
    if (query !== null && t.ext !== null) {
      context.endQuery(t.ext.TIME_ELAPSED_EXT);
      t.pending = query;
    }
    if (t.pending !== null && t.ext !== null && context.getQueryParameter(t.pending, context.QUERY_RESULT_AVAILABLE)) {
      const disjoint = context.getParameter(t.ext.GPU_DISJOINT_EXT) as boolean;
      if (metrics !== undefined && !disjoint) metrics.gpuMs = (context.getQueryParameter(t.pending, context.QUERY_RESULT) as number) / 1e6;
      context.deleteQuery(t.pending);
      t.pending = null;
    }
    if (metrics !== undefined) {
      const info = gl.info;
      Object.assign(metrics, {
        tier,
        dpr: gl.getPixelRatio(),
        frames: metrics.frames + 1,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs?.length ?? 0,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        cpuMs: cpu,
      });
    }
  }, 1);
  return null;
}
