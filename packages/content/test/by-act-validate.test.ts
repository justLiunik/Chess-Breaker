import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const root = new URL('../../../', import.meta.url);
const economy = parse(readFileSync(new URL('data/economy.yaml', root), 'utf8')) as any;
const script = new URL('scripts/validate-content.mjs', root);

function validate(byAct: unknown): { code: number | null; out: string } {
  const doc = structuredClone(economy);
  doc.generation.solver.byAct = byAct;
  const file = join(mkdtempSync(join(tmpdir(), 'byact-')), 'economy.yaml');
  writeFileSync(file, stringify(doc));
  const r = spawnSync(process.execPath, [fileURLToPath(script)], {
    env: { ...process.env, CHECKBREAKER_ECONOMY: file },
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('validate-content: generation.solver.byAct', () => {
  it('accepts a tuning override', () => {
    const r = validate({ act1: { deployment: { kingSquares: 8 }, deep: { candidates: 64 } } });
    expect(r.out).not.toMatch(/byAct/);
    expect(r.code).toBe(0);
  }, 60_000);

  it('rejects minSolveTurns inside act1', () => {
    const r = validate({ act1: { minSolveTurns: 3 } });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/byAct\.act1\.minSolveTurns/);
  }, 60_000);

  it('rejects an unknown key', () => {
    const r = validate({ act1: { bogus: 1 } });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/byAct\.act1\.bogus/);
  }, 60_000);

  it('rejects a merged screen.turns of 6', () => {
    const r = validate({ act2: { screen: { turns: 6 } } });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/screen\.turns/);
  }, 60_000);

  it('rejects a merged deep.candidates above maxCandidates', () => {
    const r = validate({ act1: { deep: { candidates: 500 } } });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/deep\.candidates/);
  }, 60_000);

  it('rejects an unknown act key', () => {
    expect(validate({ act9: { expansion: 3 } }).code).not.toBe(0);
  }, 60_000);
});
