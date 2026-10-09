import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { approach, nodeVisual, REST, type NodeVisual } from './node-visual';
import { auraFragment, auraVertex, bodyFragment, bodyVertex } from './shaders';
import type { NodeSprite } from './types';

/** Instances per scene; the network view stays far below this. */
export const CAPACITY = 64;
/** Aura quad half-size in node radii (selection ring 1.4 R plus its glow). */
const AURA_EXTENT = 1.75;
const SPHERE_SEGMENTS: readonly [number, number] = [64, 48];

function instanced(geometry: THREE.BufferGeometry, name: string): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
}

/** GPU resources shared by every node (one geometry and one material per pass). */
function createResources(micro: boolean) {
  const sphere = new THREE.SphereGeometry(1, ...SPHERE_SEGMENTS);
  const quad = new THREE.PlaneGeometry(2, 2);
  const body = new THREE.ShaderMaterial({
    vertexShader: bodyVertex,
    fragmentShader: bodyFragment,
    uniforms: { uMicro: { value: micro ? 1 : 0 }, // Light direction, fitted to all six reference nodes (mean of their least-squares fits).
      uSoftbox: { value: new THREE.Vector3(-0.61, 0.67, -0.4).normalize() } },
  });
  const aura = new THREE.ShaderMaterial({
    vertexShader: auraVertex,
    fragmentShader: auraFragment,
    uniforms: { uExtent: { value: AURA_EXTENT }, uDpr: { value: 1 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // Premultiplied "light over the page": out = aura + below · (1 − a).
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  return {
    sphere,
    quad,
    body,
    aura,
    bodyLight: instanced(sphere, 'aLight'),
    bodyTone: instanced(sphere, 'aTone'),
    auraA: instanced(quad, 'aA'),
    auraB: instanced(quad, 'aB'),
    auraC: instanced(quad, 'aC'),
    auraPorts: instanced(quad, 'aPorts'),
  };
}

/**
 * All nodes of a scene: two instanced draws (bodies, then auras). Renders on demand: a frame is
 * requested only when the nodes change or a transition is still moving, so an idle stage costs
 * nothing. Visual channels approach their targets per frame (interruptible, see node-visual).
 */
export function NodeField({ nodes, micro, reducedMotion }: { nodes: readonly NodeSprite[]; micro: boolean; reducedMotion: boolean }) {
  const { size, invalidate, gl } = useThree();
  const r = useMemo(() => createResources(micro), [micro]);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const auras = useRef<THREE.InstancedMesh>(null);
  const current = useRef(new Map<string, NodeVisual>());
  const exposure = useRef(new Float32Array(CAPACITY).fill(1)).current;

  useEffect(
    () => () => {
      // Release GPU memory when the stage goes away (ADR-0025, resource hygiene).
      r.sphere.dispose();
      r.quad.dispose();
      r.body.dispose();
      r.aura.dispose();
    },
    [r],
  );

  // Layout: instance matrices follow positions, radii and the stage size.
  useLayoutEffect(() => {
    if (nodes.length > CAPACITY) throw new Error(`NodeField: ${nodes.length} nodes exceed capacity ${CAPACITY}`);
    const m = new THREE.Matrix4();
    nodes.forEach((n, i) => {
      const x = n.x - size.width / 2;
      const y = size.height / 2 - n.y;
      m.makeScale(n.radius, n.radius, n.radius).setPosition(x, y, 0);
      bodies.current!.setMatrixAt(i, m);
      m.makeScale(n.radius, n.radius, 1).setPosition(x, y, n.radius + 1);
      auras.current!.setMatrixAt(i, m);
      exposure[i] = n.exposure ?? 1;
      r.auraC.setXYZW(i, n.warmth, n.radius, n.spark, 0);
      r.bodyTone.setY(i, n.warmth);
      r.bodyTone.setZ(i, n.radius);
      const p = [...n.ports, -10, -10, -10, -10];
      r.auraPorts.setXYZW(i, p[0]!, p[1]!, p[2]!, p[3]!);
    });
    for (const mesh of [bodies.current!, auras.current!]) {
      mesh.count = nodes.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    r.auraC.needsUpdate = true;
    r.auraPorts.needsUpdate = true;
    r.aura.uniforms['uDpr']!.value = gl.getPixelRatio();
    // Nodes that left the scene drop their transition state.
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of current.current.keys()) if (!ids.has(id)) current.current.delete(id);
    invalidate();
  }, [nodes, size, r, gl, invalidate]);

  useFrame((_, dt) => {
    let moving = false;
    const e = exposure;
    nodes.forEach((n, i) => {
      const target = nodeVisual(n.state);
      let v = current.current.get(n.id);
      if (v === undefined) current.current.set(n.id, (v = { ...REST, ...target }));
      // Clamp dt: after an idle period the first frame must not see a huge step (no jump either way).
      if (approach(v, target, Math.min(dt, 1 / 30), reducedMotion ? 0 : 0.09)) moving = true;
      r.bodyLight.setXYZW(i, v.rim * e[i]!, v.inner * e[i]!, v.sheen * (0.45 + 0.55 * e[i]!), v.fault);
      r.bodyTone.setX(i, v.recovery);
      r.bodyTone.setW(i, v.broken);
      r.auraA.setXYZW(i, v.rim * e[i]!, v.broken, v.segmented, v.halo * e[i]!);
      r.auraB.setXYZW(i, v.fault, v.recovery, v.selection, v.fence);
    });
    for (const a of [r.bodyLight, r.bodyTone, r.auraA, r.auraB]) a.needsUpdate = true;
    if (moving) invalidate();
  });

  return (
    <>
      <instancedMesh ref={bodies} args={[r.sphere, r.body, CAPACITY]} frustumCulled={false} />
      <instancedMesh ref={auras} args={[r.quad, r.aura, CAPACITY]} frustumCulled={false} renderOrder={1} />
    </>
  );
}
