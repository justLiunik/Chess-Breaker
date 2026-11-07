import type { Color, PieceType, StageState } from './types';
import { toIndex } from './square';

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

const CODE: Record<PieceType, number> = {
  pawn: PAWN, knight: KNIGHT, bishop: BISHOP, rook: ROOK, queen: QUEEN, king: KING,
};

export function colorOfCode(code: number): Color | null {
  return code > 0 ? 'white' : code < 0 ? 'black' : null;
}

export function fromBoard(board: StageState['board']): Int8Array {
  const b = new Int8Array(64);
  for (const [sq, piece] of Object.entries(board)) {
    const type = piece.transformed?.pieceType ?? piece.pieceType;
    b[toIndex(sq)] = piece.color === 'white' ? CODE[type] : -CODE[type];
  }
  return b;
}
