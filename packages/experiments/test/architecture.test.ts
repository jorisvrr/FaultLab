import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** @faultlab/experiments: runs in the Worker and on the main thread; no DOM, no ambient nondeterminism. */
const SRC = join(import.meta.dirname, '..', 'src');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts')).map((f) => ({ name: f, code: readFileSync(join(SRC, f), 'utf8') }));

describe('experiments package architecture', () => {
  it('imports only the engine, the protocols and its own modules', () => {
    const offenders = files.flatMap((f) =>
      [...f.code.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)]
        .map((m) => m[1] as string)
        .filter((source) => !source.startsWith('./') && !['@faultlab/engine', '@faultlab/engine/fixtures', '@faultlab/protocols'].includes(source))
        .map((source) => `${f.name} -> ${source}`),
    );
    expect(offenders).toEqual([]);
  });

  it('uses no ambient nondeterminism', () => {
    for (const f of files) expect(f.code, f.name).not.toMatch(/\bMath\.random\b|\bDate\b|\bperformance\b|\bsetTimeout\b|\bsetInterval\b/);
  });
});
