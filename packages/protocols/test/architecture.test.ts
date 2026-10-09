import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * @faultlab/protocols may import only engine TYPES and its own modules. Protocols run inside the
 * engine's deterministic step, so they must not reach Math.random, clocks, timers or I/O; all
 * randomness and time come from the NodeContext the engine provides.
 */
const SRC = join(import.meta.dirname, '..', 'src');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));
const files = walk(SRC).map((path) => ({ name: relative(SRC, path), code: readFileSync(path, 'utf8') }));

describe('protocols package architecture', () => {
  it('imports engine types only, and otherwise only its own modules', () => {
    const offenders = files.flatMap((f) =>
      [...f.code.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)]
        .filter((m) => !(m[2] as string).startsWith('./') && !(m[1] !== undefined && m[2] === '@faultlab/engine'))
        .map((m) => `${f.name} -> ${m[2]}${m[1] === undefined ? ' (runtime import)' : ''}`),
    );
    expect(offenders).toEqual([]);
  });

  it('declares no runtime dependencies and uses no ambient nondeterminism', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg['dependencies']).toBeUndefined();
    for (const f of files) expect(f.code, f.name).not.toMatch(/\bMath\.random\b|\bDate\b|\bperformance\b|\bsetTimeout\b|\bsetInterval\b|\bprocess\b/);
  });
});
