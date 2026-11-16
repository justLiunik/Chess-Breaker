import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(pkgDir, 'src');

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listTs(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('run boundaries', () => {
  const files = listTs(srcDir);

  it('depends on the engine only', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const extra = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@checkbreaker/engine');
    expect(extra).toEqual([]);
  });

  it('never imports gen, and imports content as types only', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text.includes('@checkbreaker/gen'), `${f} imports gen`).toBe(false);
      const stmts = [...text.matchAll(/(?:import|export)\s[^;]*?from\s*['"]@checkbreaker\/content['"]/g)].map((m) => m[0]);
      for (const s of stmts) expect(/^(import|export)\s+type\s/.test(s), `${f}: ${s}`).toBe(true);
      expect(/import\s*['"]@checkbreaker\/content['"]/.test(text), `${f} bare content import`).toBe(false);
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
