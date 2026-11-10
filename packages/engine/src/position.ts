import type { Color, PieceType, Rarity, StageState } from './types';
import { toIndex } from './square';

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** Rarities in tier order: a tier is an index into this array (0 normal ... 3 legendary). */
export const TIERS: readonly Rarity[] = ['normal', 'rare', 'unique', 'legendary'];

const CODE: Record<PieceType, number> = {
  pawn: PAWN, knight: KNIGHT, bishop: BISHOP, rook: ROOK, queen: QUEEN, king: KING,
};

export function fromBoard(board: StageState['board']): Int8Array {
  const b = new Int8Array(64);
  for (const [sq, piece] of Object.entries(board)) {
    const type = piece.transformed?.pieceType ?? piece.pieceType;
    b[toIndex(sq)] = piece.color === 'white' ? CODE[type] : -CODE[type];
  }
  return b;
}

/** The tier of a rarity: its index in TIERS; 0 (Normal) for none (the King) or an unknown rarity. */
export function tierOf(rarity: Rarity | null | undefined): number {
  return rarity == null ? 0 : Math.max(0, TIERS.indexOf(rarity));
}

/** The tier of a White Hero Piece on the board: 0 when transformed, not a Hero Piece, or of unknown rarity. */
export function tierOfPiece(piece: StageState['board'][string]): number {
  if (piece.color !== 'white' || piece.instanceId === undefined || piece.transformed !== undefined) return 0;
  return tierOf(piece.rarity);
}

/**
 * The tier array beside `fromBoard`'s codes: the tier of each White Hero Piece (one with an
 * `instanceId`) that is not transformed, 0 everywhere else. A Hero Piece without `rarity` is Normal.
 * Spawned pawns and enemy pieces are always 0.
 */
export function tiersOf(board: StageState['board']): Int8Array {
  const t = new Int8Array(64);
  for (const [sq, piece] of Object.entries(board)) t[toIndex(sq)] = tierOfPiece(piece);
  return t;
}
