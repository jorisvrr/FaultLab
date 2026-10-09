import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** @faultlab/trace may only import engine TYPES and its own modules: no runtime dependency at all. */
const SRC = join(import.meta.dirname, '..', 'src');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts')).map((f) => ({ name: f, code: readFileSync(join(SRC, f), 'utf8') }));

describe('trace package architecture', () => {
  it('imports nothing at runtime except its own modules', () => {
    const offenders = files.flatMap((f) =>
      [...f.code.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)]
        .filter((m) => m[1] === undefined && !(m[2] as string).startsWith('./'))
        .map((m) => `${f.name} -> ${m[2]}`),
    );
    expect(offenders).toEqual([]);
  });

  it('declares no runtime dependencies and uses no ambient nondeterminism', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg['dependencies']).toBeUndefined();
    for (const f of files) expect(f.code).not.toMatch(/\bMath\.random\b|\bDate\b|\bperformance\b|\bsetTimeout\b/);
  });
});
