import { describe, expect, it } from 'vitest';
import { fromBoard } from '../src/position';
import { evaluate } from '../src/enemy/evaluate';
import { zobristKey } from '../src/enemy/zobrist';
import { config, stageOf } from './helpers';

const b = (p: Record<string, string>) => fromBoard(stageOf(p).board);

describe('evaluate', () => {
  it('scores lone kings by escape squares and mobility', () => {
    expect(evaluate(b({ h8: 'k', a1: 'K' }), config)).toBe(96);
  });
  it('penalises attacked zone squares and material deficit', () => {
    expect(evaluate(b({ h8: 'k', a1: 'K', g1: 'R' }), config)).toBe(-68);
  });
  it('rewards a Black knight', () => {
    expect(evaluate(b({ h8: 'k', a1: 'K', a5: 'n' }), config)).toBe(134);
  });
});

describe('zobristKey', () => {
  const board = b({ h8: 'k', a1: 'K', g1: 'R' });
  it('differs by side to move and turns left', () => {
    expect(zobristKey(board, true, 3)).not.toBe(zobristKey(board, false, 3));
    expect(zobristKey(board, true, 3)).not.toBe(zobristKey(board, true, 4));
  });
  it('ignores insertion order and is a safe integer', () => {
    const other = b({ g1: 'R', a1: 'K', h8: 'k' });
    expect(zobristKey(other, true, 3)).toBe(zobristKey(board, true, 3));
    expect(Number.isSafeInteger(zobristKey(board, true, 3))).toBe(true);
  });
  it('throws RangeError outside 0..20', () => {
    expect(() => zobristKey(board, true, 21)).toThrow(RangeError);
    expect(() => zobristKey(board, true, -1)).toThrow(RangeError);
  });
});
