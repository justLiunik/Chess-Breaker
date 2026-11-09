import type { Color, EngineConfig, MoveRejection, Square, StageState } from './types';
import * as position from './position';
import { isSquare, toIndex, toSquare } from './square';
import * as movegen from './movegen';
import type { Move } from './movegen';

// Imported bindings are copied into module constants once: vitest's module runner turns every use
// of an imported binding into a getter call, which made the search's hot loops ~1.8x slower under
// test than under plain Node.
const { KING, PAWN, QUEEN, fromBoard } = position;
const {
  attackedAfterMove, attackedBy, onLine, pieceTargets, promotionOf, pseudoMoves, targetsInto,
} = movegen;

function kingSquare(b: Int8Array, color: Color): number {
  const code = color === 'white' ? KING : -KING;
  return b.indexOf(code);
}

export function inCheck(b: Int8Array, color: Color): boolean {
  const k = kingSquare(b, color);
  if (k < 0) return false;
  return attackedBy(b, k, color === 'white' ? -1 : 1);
}

/**
 * What a side's moves need for a cheap legality test, filled by `analyse`. When the side has one
 * king and it is not in check, a move by any other piece can only expose the king through a square
 * the move empties: its own `from`, or `to` when the moving pawn vanished (a White pawn reaching
 * rank 8). A move whose emptied squares share no line with the king is legal without being tried;
 * the rest are tried with `attackedAfterMove`. King moves, and every move when the side is in check
 * or has no single king, are tried in full, as `inCheck` would judge them.
 */
export type Safety = {
  /** The side's king square (first by index, as `inCheck` reads it), or -1. */
  king: number;
  /** True when every move must be tried in full: in check, or not exactly one king. */
  tryAll: boolean;
};

export function newSafety(): Safety {
  return { king: -1, tryAll: false };
}

/** Fills `out` for the side of colour sign `s` (1 White, -1 Black) on `b`. */
export function analyse(b: Int8Array, s: number, out: Safety): void {
  const kc = KING * s;
  const k = b.indexOf(kc);
  out.king = k;
  out.tryAll = k >= 0 && (b.lastIndexOf(kc) !== k || attackedBy(b, k, -s));
}

/** Whether the move from `from` to `to` (pseudo-legal for the side `s`) leaves its king safe. */
export function safeMove(
  b: Int8Array, sf: Safety, s: number, from: number, to: number,
): boolean {
  const k = sf.king;
  if (k < 0) return true;
  const code = b[from]!;
  const captured = b[to]!;
  const promotion = code === PAWN * s ? promotionOf(s, to) : null;
  const vanishes = promotion === 'removed';
  const kingMove = code === KING * s;
  if (!sf.tryAll && !kingMove && !onLine(k, from) && !(vanishes && onLine(k, to))) return true;
  b[to] = promotion === 'queen' ? -QUEEN : vanishes ? 0 : code;
  b[from] = 0;
  const ok = sf.tryAll || kingMove ? !attackedBy(b, kingMove ? b.indexOf(KING * s) : k, -s)
    : !attackedAfterMove(b, k, -s, from, to);
  b[from] = code;
  b[to] = captured;
  return ok;
}

const SAFETY = newSafety();

/**
 * The legal moves of `color`, in `pseudoMoves` order, appended to `out`. Uses `b` as scratch and
 * restores it.
 */
export function legalMovesInPlace(b: Int8Array, color: Color, out: Move[], sf: Safety = SAFETY): Move[] {
  const s = color === 'white' ? 1 : -1;
  analyse(b, s, sf);
  const pseudo = pseudoMoves(b, color);
  for (let i = 0; i < pseudo.length; i++) {
    const m = pseudo[i]!;
    if (safeMove(b, sf, s, m.from, m.to)) out.push(m);
  }
  return out;
}

/**
 * The legal moves of `color`. With `frozen`, a piece on a square where `frozen[i]` is 1 has no
 * moves (Lockdown); it still attacks, blocks and can be captured, so other moves are unaffected.
 */
export function legalMoves(b: Int8Array, color: Color, frozen?: Uint8Array): Move[] {
  const moves = legalMovesInPlace(b.slice(), color, []);
  return frozen ? moves.filter((m) => frozen[m.from] !== 1) : moves;
}

/**
 * Counts the legal moves of the side `s` on `b` without building them; also counts, into
 * `COUNTS.king`, those made by the piece on `kingFrom`. Uses `b` as scratch and restores it.
 */
export function countLegalInPlace(b: Int8Array, s: number, kingFrom: number, sf: Safety = SAFETY): number {
  analyse(b, s, sf);
  let total = 0;
  let fromKing = 0;
  const buf = COUNT_BUF;
  for (let from = 0; from < 64; from++) {
    if (b[from]! * s <= 0) continue;
    const n = targetsInto(b, from, buf);
    for (let i = 0; i < n; i++) {
      if (safeMove(b, sf, s, from, buf[i]!)) {
        total++;
        if (from === kingFrom) fromKing++;
      }
    }
  }
  COUNTS.king = fromKing;
  return total;
}

const COUNT_BUF = new Int8Array(32);
/** Side output of `countLegalInPlace`. */
export const COUNTS = { king: 0 };

export function checkPlayerMove(
  board: StageState['board'], from: Square, to: Square,
): MoveRejection | null {
  if (!isSquare(from)) return 'no_piece';
  if (!isSquare(to)) return 'unreachable';
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
  if (!isSquare(from)) return [];
  const b = fromBoard(stage.board);
  const f = toIndex(from);
  if (b[f]! <= 0) return [];
  return pieceTargets(b, f).map(toSquare);
}

export function hasLegalQueue(stage: StageState, _config: EngineConfig): boolean {
  return legalMoves(fromBoard(stage.board), 'white').length > 0;
}
