import { describe, expect, it } from 'vitest';
import { draw, rankOf, toIndex } from '@checkbreaker/engine';
import type { PieceType } from '@checkbreaker/engine';
import { enemyBoard, parsePlacement } from '../src/board';
import { config, stubFormations, tpl } from './helpers';

const types = (b: Record<string, { pieceType: PieceType }>) =>
  Object.fromEntries(Object.entries(b).map(([s, p]) => [s, p.pieceType]));
const mirrorSq = (s: string) => `${'abcdefgh'[7 - 'abcdefgh'.indexOf(s[0]!)]}${s[1]}`;
const run = (n: number, f: (a: number) => ReturnType<typeof enemyBoard>) => Array.from({ length: n }, (_, a) => f(a)!);

describe('parsePlacement', () => {
  it('reads a FEN placement field', () => {
    expect(parsePlacement('1n5k/pp3ppp/8/8/8/8/8/8')).toEqual({
      b8: 'knight', h8: 'king', a7: 'pawn', b7: 'pawn', f7: 'pawn', g7: 'pawn', h7: 'pawn',
    });
  });
});

describe('enemyBoard', () => {
  it('fixed templates give fixedEnemy exactly', () => {
    const t = tpl({ id: 'fx', placement: 'fixed', fixedEnemy: { g8: 'king', f7: 'pawn', a8: 'rook' } });
    const r = enemyBoard(t, [], 's', 0, config)!;
    expect(types(r.board)).toEqual(t.fixedEnemy);
    expect(r.formationId).toBeNull();
    expect(r.mirrored).toBe(false);
  });

  it('a formation board is the placement or its mirror, with ids s01.. in index order and no rarity', () => {
    const t = tpl({ id: 'g', enemyZone: [7, 8] });
    let sawMirror = false;
    let sawPlain = false;
    for (const r of run(40, (a) => enemyBoard(t, stubFormations, 'seed', a, config))) {
      const f = stubFormations.find((x) => x.id === r.formationId)!;
      const plain = parsePlacement(f.black);
      const expected = r.mirrored ? Object.fromEntries(Object.entries(plain).map(([s, p]) => [mirrorSq(s), p])) : plain;
      expect(types(r.board)).toEqual(expected);
      if (r.mirrored) sawMirror = true;
      else sawPlain = true;
      Object.keys(r.board)
        .sort((x, y) => toIndex(x) - toIndex(y))
        .forEach((s, i) => {
          const p = r.board[s]!;
          expect(p.stageId).toBe(`s${String(i + 1).padStart(2, '0')}`);
          expect(p.color).toBe('black');
          expect(p.rarity).toBeUndefined();
        });
    }
    expect(sawMirror && sawPlain).toBe(true);
  });

  it('formationId reads the formation stream and mirrored reads the mirror stream, nothing else', () => {
    const t = tpl({ id: 'g' });
    for (const seed of ['seed', 'other']) {
      run(60, (a) => enemyBoard(t, stubFormations, seed, a, config)).forEach((r, a) => {
        expect(r.formationId).toBe(stubFormations[Math.floor(draw(seed, 'formation', a) * 3)]!.id);
        expect(r.mirrored).toBe(draw(seed, 'mirror', a) < 0.5);
      });
    }
  });

  it('a fixed template without fixedEnemy throws', () => {
    expect(() => enemyBoard(tpl({ id: 'bad', placement: 'fixed' }), [], 's', 0, config)).toThrow('fixed template bad has no fixedEnemy');
  });

  it('random fallback stays in enemyZone with counts in range and one king', () => {
    const t = tpl({ id: 'r', enemyZone: [7, 8], enemyArmy: { pawn: [5, 6], knight: [1, 1], rook: [0, 2] } });
    for (const r of run(30, (a) => enemyBoard(t, [], 'seed', a, config))) {
      expect(r.formationId).toBeNull();
      const count: Record<string, number> = {};
      for (const [sq, p] of Object.entries(r.board)) {
        expect([7, 8]).toContain(rankOf(toIndex(sq)) + 1);
        if (p.pieceType === 'pawn') expect(sq[1]).not.toBe('8');
        count[p.pieceType] = (count[p.pieceType] ?? 0) + 1;
      }
      expect(count.king).toBe(1);
      expect(count.pawn).toBeGreaterThanOrEqual(5);
      expect(count.pawn).toBeLessThanOrEqual(6);
      expect(count.knight).toBe(1);
      expect(count.rook ?? 0).toBeGreaterThanOrEqual(0);
      expect(count.rook ?? 0).toBeLessThanOrEqual(2);
      expect(Object.keys(r.board)).toHaveLength(Object.values(count).reduce((x, y) => x + y, 0));
    }
  });

  it('returns null when the zone cannot hold the army', () => {
    const t = tpl({ id: 'full', enemyZone: [8], enemyArmy: { rook: [8, 8] } });
    expect(enemyBoard(t, [], 'seed', 0, config)).toBeNull();
  });

  it('the same inputs give a deep-equal board', () => {
    const t = tpl({ id: 'r', enemyZone: [7, 8], enemyArmy: { pawn: [5, 6], knight: [1, 1] } });
    expect(enemyBoard(t, [], 's', 3, config)).toEqual(enemyBoard(t, [], 's', 3, config));
    expect(enemyBoard(t, stubFormations, 's', 3, config)).toEqual(enemyBoard(t, stubFormations, 's', 3, config));
  });
});
