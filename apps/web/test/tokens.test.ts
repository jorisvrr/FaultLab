import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOKENS, tokenNames } from '../src/design/tokens';

/**
 * The documented token list and the stylesheet are two artefacts describing one thing, so they
 * can drift. These tests make that impossible to do quietly.
 */
const css = readFileSync(join(import.meta.dirname, '../src/design/tokens.css'), 'utf8');
const declared = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]!));
const value = (name: string): string => {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(css);
  return match?.[1]?.trim() ?? '';
};

/** sRGB hex → relative luminance (WCAG 2.x). */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(n.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
/** Follows one level of `var(--…)` indirection to the reference layer. */
const resolve = (token: string): string => {
  const v = value(token);
  const ref = /var\((--[a-z0-9-]+)\)/.exec(v);
  return ref === null ? v : value(ref[1]!);
};

describe('design tokens', () => {
  it('every documented token is declared in tokens.css', () => {
    const missing = tokenNames().filter((name) => !declared.has(name));
    expect(missing, 'documented but not declared').toEqual([]);
  });

  it('every declared semantic token is documented', () => {
    const documented = new Set(tokenNames());
    const undocumented = [...declared].filter((name) => !name.startsWith('--ref-') && !documented.has(name));
    expect(undocumented, 'declared but not documented (add it to TOKENS or make it a --ref-)').toEqual([]);
  });

  it('components never reach past the semantic layer into --ref-*', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = join(import.meta.dirname, '../src/design');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.module.css'))
      .filter((f) => /var\(--ref-/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders, 'component CSS must use semantic tokens only').toEqual([]);
  });

  it('text on its background meets WCAG 2.2 AA', () => {
    const results = (
      [
        ['--color-text', '--color-surface-panel', 4.5],
        ['--color-text', '--color-void', 4.5],
        ['--color-text', '--color-surface-control', 4.5],
        ['--color-text-muted', '--color-surface-panel', 4.5],
        ['--color-text-muted', '--color-surface-raised', 4.5],
        ['--color-text-subtle', '--color-surface-panel', 3], // micro labels only: large/incidental
        ['--color-accent', '--color-surface-panel', 4.5],
        ['--color-state-fault', '--color-surface-panel', 4.5],
        ['--color-state-violation', '--color-surface-panel', 4.5],
        ['--color-text-on-accent', '--ref-blue-500', 4.5], // CTA label on the darkest part of its fill
      ] as const
    ).map(([fg, bg, min]) => ({ pair: `${fg} on ${bg}`, ratio: +ratio(resolve(fg), resolve(bg)).toFixed(2), min }));
    const failures = results.filter((r) => r.ratio < r.min);
    expect(failures, `contrast failures (measured: ${JSON.stringify(results)})`).toEqual([]);
  });

  it('the fault and violation hues are far enough apart to be told apart', () => {
    const hue = (hex: string) => {
      const n = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return ((h * 60) % 360 + 360) % 360;
    };
    // Amber ≈ 36°, ember ≈ 14°: a fault is not a bug, and the two must not be confusable.
    expect(Math.abs(hue(resolve('--color-state-fault')) - hue(resolve('--color-state-violation')))).toBeGreaterThan(15);
  });

  it('groups the tokens it documents', () => {
    expect(Object.keys(TOKENS)).toEqual(['colour', 'material', 'layout', 'typography', 'motion', 'layers', 'focus']);
  });
});
