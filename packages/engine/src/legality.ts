import type { Color, EngineConfig, MoveRejection, Square, StageState } from './types';
import { KING } from './position';
import { fromBoard } from './position';
import { toIndex, toSquare } from './square';
import { isAttacked, makeMove, pieceTargets, pseudoMoves, unmakeMove } from './movegen';
import type { Move } from './movegen';

function kingSquare(b: Int8Array, color: Color): number {
  const code = color === 'white' ? KING : -KING;
  return b.indexOf(code);
}

export function inCheck(b: Int8Array, color: Color): boolean {
  const k = kingSquare(b, color);
  if (k < 0) return false;
  return isAttacked(b, k, color === 'white' ? 'black' : 'white');
}

export function legalMoves(b: Int8Array, color: Color): Move[] {
  const work = b.slice();
  const out: Move[] = [];
  for (const m of pseudoMoves(work, color)) {
    makeMove(work, m);
    if (!inCheck(work, color)) out.push(m);
    unmakeMove(work, m);
  }
  return out;
}

export function checkPlayerMove(
  board: StageState['board'], from: Square, to: Square,
): MoveRejection | null {
  const piece = board[from];
  if (!piece) return 'no_piece';
  if (piece.color !== 'white') return 'not_your_piece';
  const dest = board[to];
  const destType = dest ? (dest.transformed?.pieceType ?? dest.pieceType) : null;
  if (dest && dest.color === 'black' && destType === 'king') return 'king_square';
  if (dest && dest.color === 'white') return 'own_piece';
  const b = fromBoard(board);
  if (!pieceTargets(b, toIndex(from)).includes(toIndex(to))) return 'unreachable';
  return null;
}

export function legalPlayerMoves(stage: StageState, from: Square): Square[] {
  const b = fromBoard(stage.board);
  const f = toIndex(from);
  if (b[f]! <= 0) return [];
  return pieceTargets(b, f).map(toSquare);
}

export function hasLegalQueue(stage: StageState, _config: EngineConfig): boolean {
  return legalMoves(fromBoard(stage.board), 'white').length > 0;
}
