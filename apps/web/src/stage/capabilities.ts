import type { Tier } from './types';

/**
 * Choose a rendering tier (ADR-0025). No WebGL 2 → flat. A software renderer
 * (failIfMajorPerformanceCaveat) or a small device → reduced. An explicit `?tier=` overrides
 * (tests, comparisons). The probe context is released immediately, so it never counts as a
 * second active context.
 */
export function detectTier(search = location.search): Tier {
  const forced = new URLSearchParams(search).get('tier');
  if (forced === 'full' || forced === 'reduced' || forced === 'flat') return forced;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  if (gl === null) {
    const slow = document.createElement('canvas').getContext('webgl2');
    slow?.getExtension('WEBGL_lose_context')?.loseContext();
    return slow === null ? 'flat' : 'reduced';
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if ((memory !== undefined && memory <= 2) || navigator.hardwareConcurrency <= 2) return 'reduced';
  return 'full';
}

export const prefersReducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
