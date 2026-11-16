import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const ALLOWED = new Set([
  '@checkbreaker/engine',
  '@checkbreaker/run',
  '@checkbreaker/content/parse',
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]);
const GEN_FILE = 'state/generation.worker.ts';
const BENCH_FILE = 'screens/Bench.tsx';

const importRe = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(text: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = [];
  for (const m of text.matchAll(importRe)) out.push({ spec: m[2]!, typeOnly: m[1] !== undefined });
  for (const m of text.matchAll(dynamicRe)) out.push({ spec: m[1]!, typeOnly: false });
  return out;
}

function violation(file: string, spec: string, typeOnly: boolean): string | null {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    if (file === BENCH_FILE && spec.endsWith('engine/test/bench-positions')) return null;
    if (/\.(yaml|json)\?raw$/.test(spec)) return file === 'config.ts' ? null : `${file}: ?raw import outside config.ts: ${spec}`;
    if (/^(\.\.?\/)+(packages|apps|data|content)\//.test(spec)) return `${file}: relative import into repo data or another package: ${spec}`;
    return null;
  }
  if (spec === '@checkbreaker/gen') return file === GEN_FILE ? null : `${file}: only ${GEN_FILE} may import @checkbreaker/gen`;
  if (spec === '@checkbreaker/content') return typeOnly ? null : `${file}: @checkbreaker/content is type-only (use /parse)`;
  if (ALLOWED.has(spec)) return null;
  return `${file}: import not on the allowlist: ${spec}`;
}

describe('apps/web import allowlist', () => {
  const files = walk(SRC).map((p) => ({ rel: relative(SRC, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }));

  it('finds source files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every import specifier is allowed for its file', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const { spec, typeOnly } of specifiers(f.text)) {
        const v = violation(f.rel, spec, typeOnly);
        if (v) bad.push(v);
      }
    }
    expect(bad).toEqual([]);
  });

  it('encodes the rules: engine/internal and gen are fenced, exceptions are per file', () => {
    expect(violation('App.tsx', '@checkbreaker/engine/internal', false)).not.toBeNull();
    expect(violation('App.tsx', '@checkbreaker/gen', false)).not.toBeNull();
    expect(violation(GEN_FILE, '@checkbreaker/gen', false)).toBeNull();
    expect(violation('App.tsx', 'chess.js', false)).not.toBeNull();
    expect(violation('App.tsx', '@checkbreaker/content', false)).not.toBeNull();
    expect(violation('App.tsx', '@checkbreaker/content', true)).toBeNull();
    expect(violation('App.tsx', '../../../packages/engine/test/bench-positions', false)).not.toBeNull();
    expect(violation(BENCH_FILE, '../../../../packages/engine/test/bench-positions', false)).toBeNull();
    expect(violation('App.tsx', '../../../data/economy.yaml?raw', false)).not.toBeNull();
    expect(violation('config.ts', '../../../data/economy.yaml?raw', false)).toBeNull();
    expect(violation('App.tsx', './screens/Home', false)).toBeNull();
  });

  it('never uses Math.random', () => {
    const hits = files.filter((f) => /Math\s*\.\s*random/.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
});
