import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(import.meta.dirname, '..', '..');
const sources = (pkg: string) => {
  const dir = join(PACKAGES, pkg, 'src');
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));
  return walk(dir).map((path) => ({ path: path.slice(PACKAGES.length + 1), code: readFileSync(path, 'utf8') }));
};
const imports = (code: string) => [...code.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm), ...code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);

describe('runtime and layering architecture (CP5)', () => {
  it('@faultlab/runtime imports only the engine, experiments, trace and its own modules', () => {
    const offenders = sources('runtime').flatMap((f) =>
      imports(f.code)
        .filter((s) => !s.startsWith('./') && !['@faultlab/engine', '@faultlab/experiments', '@faultlab/trace'].includes(s))
        .map((s) => `${f.path} -> ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it('no simulation package depends on React or any UI framework (rendering never determines outcomes)', () => {
    const offenders = ['engine', 'trace', 'protocols', 'experiments', 'runtime'].flatMap((pkg) =>
      sources(pkg).flatMap((f) => imports(f.code).filter((s) => /^(react|react-dom|three|@react-three)/.test(s)).map((s) => `${f.path} -> ${s}`)),
    );
    expect(offenders).toEqual([]);
  });

  it('only host.ts touches host timing APIs directly (the guard needs a clock captured at load)', () => {
    const direct = sources('runtime').filter((f) => !f.path.endsWith('host.ts') && /(?<![.\w])(performance\.now|setInterval|setTimeout)\(/.test(f.code));
    expect(direct.map((f) => f.path)).toEqual([]);
  });
});
