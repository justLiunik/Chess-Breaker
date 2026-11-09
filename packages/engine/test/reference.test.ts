import { describe, expect, it } from 'vitest';
import type { Color } from '../src/types';
import { evaluate } from '../src/enemy/evaluate';
import { legalMoves } from '../src/legality';
import { isAttacked } from '../src/movegen';
import { config, randomBoard } from './helpers';
import { refAttacked, refLegalMoves } from './reference/movegen';
import { refEvaluate } from './reference/evaluate';

const sortMoves = (ms: { from: number; to: number }[]) =>
  ms.map(({ from, to }) => ({ from, to })).sort((a, b) => a.from - b.from || a.to - b.to);

const COLORS = ['white', 'black'] as const;
const CHECK_BOARDS = 1000;

/** Every (board, side to move) the move differential covers: no check, then each side in check. */
function moveCases(): { b: Int8Array; color: Color }[] {
  const cases: { b: Int8Array; color: Color }[] = [];
  for (let i = 0; i < 5000; i++) {
    const b = randomBoard('ref', i);
    for (const color of COLORS) cases.push({ b, color });
  }
  for (const color of COLORS) {
    for (let i = 0; i < CHECK_BOARDS; i++) cases.push({ b: randomBoard(`ref-${color}-check`, i, { sideInCheck: color }), color });
  }
  return cases;
}

describe('fast engine against the slow reference', () => {
  it('random boards are well formed and reproducible', () => {
    for (let i = 0; i < 200; i++) {
      const b = randomBoard('ref', i);
      expect(b.filter((c) => c === 6)).toHaveLength(1);
      expect(b.filter((c) => c === -6)).toHaveLength(1);
      expect(randomBoard('ref', i)).toEqual(b);
      for (const color of COLORS) {
        const c = randomBoard('chk', i, { sideInCheck: color });
        expect(refAttacked(c, c.indexOf(color === 'white' ? 6 : -6), color === 'white' ? 'black' : 'white')).toBe(true);
        expect(refAttacked(c, c.indexOf(color === 'white' ? -6 : 6), color)).toBe(false);
      }
    }
  });

  it('legal moves match the reference, with and without check', () => {
    for (const { b, color } of moveCases()) {
      expect(sortMoves(legalMoves(b, color))).toEqual(sortMoves(refLegalMoves(b, color)));
    }
  });

  it('the move boards exercise the risky features (counted with the reference)', () => {
    const n = { pinned: 0, pawn7: 0, pawn2: 0, doubleStep: 0, inCheck: 0 };
    for (const { b, color } of moveCases()) {
      const s = color === 'white' ? 1 : -1;
      const enemy: Color = color === 'white' ? 'black' : 'white';
      const k = b.indexOf(6 * s);
      const checked = refAttacked(b, k, enemy);
      if (checked) n.inCheck++;
      if (!checked) {
        const pinned = b.some((v, sq) => {
          if (v * s <= 0 || sq === k) return false;
          const c = b.slice();
          c[sq] = 0;
          return refAttacked(c, k, enemy);
        });
        if (pinned) n.pinned++;
      }
      if (color === 'white' && b.some((v, sq) => v === 1 && (sq >> 3) === 6)) n.pawn7++;
      if (color === 'black' && b.some((v, sq) => v === -1 && (sq >> 3) === 1)) n.pawn2++;
      if (refLegalMoves(b, color).some((m) => Math.abs(b[m.from]!) === 1 && Math.abs(m.to - m.from) === 16)) n.doubleStep++;
    }
    for (const [name, count] of Object.entries(n)) expect(count, name).toBeGreaterThanOrEqual(50);
  });

  it('attack maps match the reference', () => {
    for (let i = 0; i < 1000; i++) {
      const b = randomBoard('ref-attack', i);
      for (let sq = 0; sq < 64; sq++) {
        for (const by of COLORS) {
          expect(isAttacked(b, sq, by)).toBe(refAttacked(b, sq, by));
        }
      }
    }
  });

  it('evaluate matches the reference, with Black not in check and in check', () => {
    for (let i = 0; i < 3000; i++) {
      const b = randomBoard('ref-eval', i);
      expect(evaluate(b, config)).toBe(refEvaluate(b, config));
    }
    for (let i = 0; i < CHECK_BOARDS; i++) {
      const b = randomBoard('ref-eval-check', i, { sideInCheck: 'black' });
      expect(evaluate(b, config)).toBe(refEvaluate(b, config));
    }
  });
});
