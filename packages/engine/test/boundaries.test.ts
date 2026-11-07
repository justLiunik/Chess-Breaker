import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(pkgDir, 'src');

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listTs(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('engine boundaries', () => {
  const files = listTs(srcDir);

  it('has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toEqual({});
  });

  it('imports only relative paths inside src', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const specs = [...text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)]
        .map((m) => m[1] ?? m[2]!);
      for (const s of specs) {
        expect(s.startsWith('.'), `${f}: ${s}`).toBe(true);
        const rel = relative(srcDir, resolve(dirname(f), s));
        expect(rel.startsWith('..'), `${f}: ${s}`).toBe(false);
      }
    }
  });

  it('uses no nondeterministic sources', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const banned of ['Math.random', 'Date.now', 'performance.now']) {
        expect(text.includes(banned), `${f} contains ${banned}`).toBe(false);
      }
    }
  });
});
