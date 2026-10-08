import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture fitness tests: cheap, dependency-free guards that keep the engine portable and
 * deterministic. The tsconfig already makes DOM/Node globals (setTimeout, performance, process,
 * console) compile errors in src/; these tests cover what the type system cannot.
 */
const SRC = join(import.meta.dirname, '..', 'src');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
  );

/** Remove comments so documentation may mention forbidden APIs by name. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const files = sourceFiles(SRC).map((file) => ({ name: relative(SRC, file), code: code(file) }));

describe('engine architecture', () => {
  it('finds the engine sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each([
    ['Math.random (use a seeded RandomSource)', /\bMath\.random\b/],
    ['Date (simulation time is virtual)', /\bDate\b/],
    ['performance timers', /\bperformance\b/],
    ['real timers', /\b(setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame)\b/],
    ['async code (handlers and the loop are synchronous)', /\b(async|await)\b|\bPromise\b/],
    ['crypto randomness', /\bcrypto\b/],
  ])('does not use %s', (_label, pattern) => {
    const offenders = files.filter((f) => pattern.test(f.code)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('imports only its own modules (no React, no Node built-ins, no runtime dependencies)', () => {
    const offenders = files.flatMap((f) =>
      [...f.code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1] as string)
        .filter((specifier) => !specifier.startsWith('./') && !specifier.startsWith('../'))
        .map((specifier) => `${f.name} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it('declares no runtime dependencies in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg['dependencies']).toBeUndefined();
    expect(pkg['peerDependencies']).toBeUndefined();
  });
});
