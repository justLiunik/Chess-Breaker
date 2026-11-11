import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGenConfig, loadTemplates } from '@checkbreaker/content';
import type { Template } from '@checkbreaker/content';
import { hash, mix32 } from '@checkbreaker/engine';
import { defenderPlacement, extractFormations, main, mirrorPlacement, parseRow, rejectReason } from './extract';
import type { PuzzleRow } from './extract';

const FIXTURE = fileURLToPath(new URL('./fixture.csv', import.meta.url));
const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter((l) => l.length > 0).slice(1);
const config = loadGenConfig();
const templates = loadTemplates();
const tpl = (id: string): Template => {
  const t = templates.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};
const lineOf = (id: string): string => {
  const line = lines.find((l) => l.startsWith(`${id},`));
  if (!line) throw new Error(`fixture row ${id}`);
  return line;
};
const rowOf = (id: string): PuzzleRow => {
  const r = parseRow(lineOf(id));
  if (!r) throw new Error(`fixture row ${id} does not parse`);
  return r;
};
const placementOf = (id: string): string => {
  const p = defenderPlacement(rowOf(id));
  if (!p) throw new Error(`fixture row ${id} has no placement`);
  return p;
};
const byOrder = (a: string, b: string): number => mix32(hash(a)) - mix32(hash(b)) || (a < b ? -1 : a > b ? 1 : 0);

describe('parseRow', () => {
  it('reads id, FEN, moves and rating', () => {
    expect(rowOf('oF001')).toEqual({
      id: 'oF001',
      fen: '1n4k1/pp3ppp/8/8/8/8/8/3QK3 b - - 0 1',
      moves: 'g8h8 d1d8',
      rating: 1500,
    });
  });
  it('returns null for too few columns or a non-numeric rating', () => {
    expect(parseRow(lineOf('mC001'))).toBeNull();
    expect(parseRow(lineOf('mR001'))).toBeNull();
  });
});

describe('defenderPlacement', () => {
  it('keeps Black pieces when Black is the defender', () => {
    expect(placementOf('oF001')).toBe('1n5k/pp3ppp/8/8/8/8/8/8');
  });
  it('flips ranks and swaps colours when White is the defender', () => {
    expect(placementOf('wD001')).toBe('1n5k/p1p2ppp/8/8/8/8/8/8');
  });
  it('applies castling', () => {
    expect(placementOf('cB001')).toBe('r4rk1/ppp2ppp/8/8/8/8/8/8');
    expect(placementOf('cW001')).toBe('r4rk1/ppp2ppp/8/8/8/8/8/8');
  });
  it('applies en passant', () => {
    expect(placementOf('eB001')).toBe('4k3/8/8/8/8/4p3/8/8');
    expect(placementOf('eW001')).toBe('4k3/8/8/8/8/3p4/8/8');
  });
  it('applies promotion', () => {
    expect(placementOf('pB001')).toBe('4k3/8/8/8/8/8/8/q7');
  });
  it('returns null for a broken FEN or an illegal move', () => {
    expect(defenderPlacement(rowOf('mF001'))).toBeNull();
    expect(defenderPlacement(rowOf('mI001'))).toBeNull();
  });
});

describe('mirrorPlacement', () => {
  it('mirrors left to right and is an involution', () => {
    expect(mirrorPlacement('1n5k/pp3ppp/8/8/8/8/8/8')).toBe('k5n1/ppp3pp/8/8/8/8/8/8');
    expect(mirrorPlacement(mirrorPlacement('r4rk1/ppp2ppp/8/8/8/8/8/q7'))).toBe('r4rk1/ppp2ppp/8/8/8/8/8/q7');
  });
});

describe('rejectReason', () => {
  const open = tpl('tpl-act1-open-field');
  it('accepts a matching formation', () => {
    expect(rejectReason(placementOf('oF001'), open, config)).toBeNull();
  });
  it('rejects zone', () => {
    expect(rejectReason(placementOf('zN001'), open, config)).toBe('zone');
  });
  it('rejects army', () => {
    expect(rejectReason(placementOf('aR001'), open, config)).toBe('army');
    expect(rejectReason(placementOf('qQ001'), open, config)).toBe('army');
    expect(rejectReason(placementOf('kO001'), open, config)).toBe('army');
  });
  it('rejects value (synthetic template with a loose army; real armies always fit their band)', () => {
    const redoubt = tpl('tpl-act3-boss-redoubt');
    const loose: Template = {
      ...redoubt,
      act: 1,
      tier: 'normal',
      enemyArmy: { pawn: [0, 8], knight: [0, 2], bishop: [0, 1], rook: [0, 1] },
    };
    expect(rejectReason(placementOf('rD001'), redoubt, config)).toBeNull();
    expect(rejectReason(placementOf('rD001'), loose, config)).toBe('value');
  });
  it('rejects a pawn on rank 8 (chess.js cannot produce one, so the placement is given directly)', () => {
    expect(rejectReason('pn4k1/pp3ppp/8/8/8/8/8/8', { ...open, enemyArmy: { pawn: [6, 6], knight: [1, 1] } }, config)).toBe('pawn_rank8');
  });
});

describe('extractFormations', () => {
  const out = extractFormations(lines.map(parseRow), templates, config);
  const open = out.byTemplate['tpl-act1-open-field']!;

  it('counts malformed rows (broken FEN, illegal move, too few columns, bad rating) without throwing', () => {
    expect(out.stats.rows).toBe(lines.length);
    expect(out.stats.malformed).toBe(4);
  });

  it('skips fixed templates', () => {
    expect(out.byTemplate['tpl-act1-first-steps']).toBeUndefined();
  });

  it('keeps only the first of mirrored (and identical) formations in mix32 order', () => {
    const first = ['oF001', 'oF002', 'oF003'].sort(byOrder)[0]!;
    expect(open.map((f) => f.id).filter((i) => i.startsWith('oF'))).toEqual([first]);
  });

  it('sorts survivors by (mix32(hash(id)), id) and stores the black placement', () => {
    const ids = open.map((f) => f.id);
    expect(ids).toEqual([...ids].sort(byOrder));
    expect(open.find((f) => f.id === 'wD001')).toEqual({ id: 'wD001', rating: 1400, black: '1n5k/p1p2ppp/8/8/8/8/8/8' });
  });

  it('finds survivors for the other templates and records rejections', () => {
    expect(out.byTemplate['tpl-act1-boss-gatehouse']!.map((f) => f.id).sort()).toEqual(['gH001', 'gH002']);
    expect(out.byTemplate['tpl-act2-fortress']!.map((f) => f.id).sort()).toEqual(['fT001', 'fT002']);
    expect(out.byTemplate['tpl-act3-boss-redoubt']!.map((f) => f.id).sort()).toEqual(['rD001', 'rD002']);
    expect(out.stats.rejected['tpl-act1-open-field']!['zone']).toBeGreaterThan(0);
    expect(out.stats.rejected['tpl-act1-open-field']!['army']).toBeGreaterThan(0);
  });
});

describe('main', () => {
  it('writes byte-identical files on two runs, in the specified layout', async () => {
    const a = mkdtempSync(join(tmpdir(), 'form-a-'));
    const b = mkdtempSync(join(tmpdir(), 'form-b-'));
    try {
      await main(['--source', FIXTURE, '--out', a]);
      await main(['--source', FIXTURE, '--out', b]);
      const files = readdirSync(a).sort();
      expect(files).toEqual(readdirSync(b).sort());
      expect(files).toEqual([
        'tpl-act1-boss-gatehouse.json',
        'tpl-act1-open-field.json',
        'tpl-act2-fortress.json',
        'tpl-act3-boss-redoubt.json',
      ]);
      for (const f of files) expect(readFileSync(join(a, f))).toEqual(readFileSync(join(b, f)));
      const text = readFileSync(join(a, 'tpl-act1-open-field.json'), 'utf8');
      expect(text.endsWith('}\n')).toBe(true);
      const json = JSON.parse(text);
      expect(Object.keys(json)).toEqual(['templateId', 'source', 'filters', 'formations']);
      expect(Object.keys(json.source)).toEqual(['url', 'licence', 'date', 'sha256']);
      expect(json.source.licence).toBe('CC0');
      expect(json.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(json.filters)).toEqual(['enemyZone', 'enemyArmy', 'valueBand', 'noPawnOnRank8']);
      expect(json.filters.valueBand).toEqual([7, 9]);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});
