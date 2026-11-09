import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/enemy/evaluate';
import { legalMoves } from '../src/legality';
import { isAttacked } from '../src/movegen';
import { config, randomBoard } from './helpers';
import { refAttacked, refLegalMoves } from './reference/movegen';
import { refEvaluate } from './reference/evaluate';

const sortMoves = (ms: { from: number; to: number }[]) =>
  ms.map(({ from, to }) => ({ from, to })).sort((a, b) => a.from - b.from || a.to - b.to);

describe('fast engine against the slow reference', () => {
  it('random boards are well formed and reproducible', () => {
    for (let i = 0; i < 200; i++) {
      const b = randomBoard('ref', i);
      expect(b.filter((c) => c === 6)).toHaveLength(1);
      expect(b.filter((c) => c === -6)).toHaveLength(1);
      expect(randomBoard('ref', i)).toEqual(b);
    }
  });

  it('legal moves match the reference on 5000 random boards', () => {
    for (let i = 0; i < 5000; i++) {
      const b = randomBoard('ref', i);
      for (const color of ['white', 'black'] as const) {
        expect(sortMoves(legalMoves(b, color))).toEqual(sortMoves(refLegalMoves(b, color)));
      }
    }
  });

  it('attack maps match the reference', () => {
    for (let i = 0; i < 1000; i++) {
      const b = randomBoard('ref-attack', i);
      for (let sq = 0; sq < 64; sq++) {
        for (const by of ['white', 'black'] as const) {
          expect(isAttacked(b, sq, by)).toBe(refAttacked(b, sq, by));
        }
      }
    }
  });

  it('evaluate matches the reference', () => {
    for (let i = 0; i < 3000; i++) {
      const b = randomBoard('ref-eval', i);
      expect(evaluate(b, config)).toBe(refEvaluate(b, config));
    }
  });
});
