/**
 * Node visual model (CP6 Gate 1): a PURE mapping from what is true about a node to the numbers
 * the renderer draws. No Three.js here, so it is testable without WebGL and shared by every
 * fallback tier (3D, reduced 3D, flat).
 *
 * Two kinds of input, kept apart on purpose:
 * - PROTOCOL / DATA state comes from a reconstructed trace frame (role, status, partition,
 *   recovery, "active" = the entry at the cursor happened on this node). In the Gate 1
 *   prototype gallery these are chosen by hand and labelled as such; they are never presented
 *   as simulation results.
 * - INTERACTION state comes from the user (hover, selection). Keyboard focus is drawn by the
 *   DOM proxy (a real, focusable button), not by the shader.
 *
 * Every channel below is independent, so combinations never fight: a leader can be selected
 * (rim + selection ring), a crashed node can be selected and partitioned (broken amber rim +
 * selection ring + fence). Meaning never relies on colour alone: crash = broken rim, partition
 * = dotted fence, recovery = open arc, candidate = segmented rim, leader = brighter rim + crown.
 * A follower is the resting appearance of the references; its role is named by the DOM label.
 */
export type NodeRole = 'follower' | 'candidate' | 'leader' | null;

export interface NodeVisualInput {
  readonly role: NodeRole;
  /** idle = not started yet (no node.start at this position), up = running, crashed = down. */
  readonly status: 'idle' | 'up' | 'crashed';
  /** Restarted recently (node.recover) and not yet back in its normal role. */
  readonly recovering: boolean;
  /** Cut off from part of the cluster by an active partition. */
  readonly partitioned: boolean;
  /** The entry at the playback position happened on this node. */
  readonly active: boolean;
  readonly hovered: boolean;
  readonly selected: boolean;
}

/** Animatable channels, all plain numbers (0 = off unless noted). */
export interface NodeVisual {
  /** Brightness of the thin luminous rim (1 = the reference). */
  rim: number;
  /** Rim broken into dashes (crash). */
  broken: number;
  /** Rim modulated into segments (candidate: unsettled, asking for votes). */
  segmented: number;
  /** Soft glow just outside the silhouette (1 = the reference). */
  halo: number;
  /** Fresnel glow just inside the rim. */
  inner: number;
  /** Strength of the soft upper-left reflection on the body. */
  sheen: number;
  /** Fault tint (amber, #F8C781) of rim and halo. */
  fault: number;
  /** Recovery tint (cool blue) of rim and the open recovery arc. */
  recovery: number;
  /** Blue selection ring at ≈ 1.4 R. */
  selection: number;
  /** Dotted amber partition fence at ≈ 1.22 R. */
  fence: number;
}

export const REST: Readonly<NodeVisual> = Object.freeze({ rim: 1, broken: 0, segmented: 0, halo: 1, inner: 1, sheen: 1, fault: 0, recovery: 0, selection: 0, fence: 0 });

export function nodeVisual(input: NodeVisualInput): NodeVisual {
  const v: NodeVisual = { ...REST };
  if (input.status === 'crashed') {
    // A crashed node has no running protocol: role is ignored, light goes out, rim breaks.
    Object.assign(v, { rim: 0.9, broken: 1, halo: 0.25, inner: 0.15, sheen: 0.45, fault: 1 });
  } else if (input.status === 'idle') {
    // Not started: present but unlit; no role, no activity.
    Object.assign(v, { rim: 0.6, halo: 0.45, inner: 0.5, sheen: 0.8 });
  } else {
    if (input.role === 'leader') Object.assign(v, { rim: 1.35, halo: 1.45, inner: 1.2 });
    if (input.role === 'candidate') v.segmented = 1;
    if (input.recovering) v.recovery = 1;
  }
  if (input.partitioned) v.fence = 1;
  if (input.active && input.status === 'up') {
    v.inner += 1.0;
    v.rim *= 1.15;
  }
  if (input.hovered) {
    v.halo *= 1.2;
    v.rim *= 1.1;
    v.sheen += 0.12;
  }
  if (input.selected) v.selection = 1;
  return v;
}

export const CHANNELS = Object.keys(REST) as readonly (keyof NodeVisual)[];

/**
 * Move `current` toward `target` by an exponential (critically damped) step. Interruptible by
 * construction: a new target simply changes where the next step heads, from wherever the value
 * is now, so there is never a jump. Returns true while any channel is still moving.
 */
export function approach(current: NodeVisual, target: Readonly<NodeVisual>, dtSeconds: number, timeConstant = 0.09): boolean {
  const k = timeConstant <= 0 ? 1 : 1 - Math.exp(-dtSeconds / timeConstant);
  let moving = false;
  for (const key of CHANNELS) {
    const delta = target[key] - current[key];
    if (Math.abs(delta) < 1e-3) current[key] = target[key];
    else {
      current[key] += delta * k;
      moving = true;
    }
  }
  return moving;
}
