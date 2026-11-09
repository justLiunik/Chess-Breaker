import type { Action, Color, EngineConfig, MoveRejection, RunState, Square, StageState } from './types';
import type { BonusLedger, QueueCtx } from './queue';
import { applyPlayerMove, freeBonus, recordMove, resolveQueue } from './queue';
import { applySkill, checkSkill } from './skills/check';
import * as position from './position';
import { isSquare, toIndex, toSquare } from './square';
import * as movegen from './movegen';
import { abilityTargets, hasTiers } from './abilities';
import type { Move } from './movegen';

// Imported bindings are copied into module constants once: vitest's module runner turns every use
// of an imported binding into a getter call, which made the search's hot loops ~1.8x slower under
// test than under plain Node.
const { KING, PAWN, QUEEN, fromBoard, tiersOf } = position;
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

/** A destination of a player's piece and, for a multi-capture ending on it, the first captured square (else -1). */
type PlayerTarget = { to: number; via: number };

/**
 * The destinations of the piece on `from`, one per square: the M1 targets when the board has no
 * tiers, else the ability targets. A square reachable both as a single move and as a multi-capture's
 * second square counts as the single move.
 */
function playerTargets(b: Int8Array, t: Int8Array, from: number, config: EngineConfig): PlayerTarget[] {
  if (!hasTiers(t)) return pieceTargets(b, from).map((to) => ({ to, via: -1 }));
  const byTo = new Map<number, PlayerTarget>();
  for (const m of abilityTargets(b, t, from, config.abilities)) {
    const prev = byTo.get(m.to);
    if (prev === undefined || (prev.via >= 0 && m.via < 0)) byTo.set(m.to, m);
  }
  return [...byTo.values()];
}

/**
 * Judges a player's `MOVE` and, when it is legal, names the square it captures first: the `via` of
 * a multi-capture ending on `to` (docs/02 §2.3), else null.
 */
export function planPlayerMove(
  board: StageState['board'], from: Square, to: Square, config: EngineConfig,
): { reason: MoveRejection | null; via: Square | null } {
  const refuse = (reason: MoveRejection) => ({ reason, via: null });
  if (!isSquare(from)) return refuse('no_piece');
  if (!isSquare(to)) return refuse('unreachable');
  const piece = board[from];
  if (!piece) return refuse('no_piece');
  if (piece.color !== 'white') return refuse('not_your_piece');
  const dest = board[to];
  const destType = dest ? (dest.transformed?.pieceType ?? dest.pieceType) : null;
  if (dest && dest.color === 'black' && destType === 'king') return refuse('king_square');
  const b = fromBoard(board);
  const t = tiersOf(board);
  const f = toIndex(from);
  const x = toIndex(to);
  if (dest && dest.color === 'white') return refuse('own_piece');
  const target = playerTargets(b, t, f, config).find((m) => m.to === x);
  if (target === undefined) return refuse('unreachable');
  return { reason: null, via: target.via >= 0 ? toSquare(target.via) : null };
}

export function checkPlayerMove(
  board: StageState['board'], from: Square, to: Square, config: EngineConfig,
): MoveRejection | null {
  return planPlayerMove(board, from, to, config).reason;
}

export function legalPlayerMoves(stage: StageState, from: Square, config: EngineConfig): Square[] {
  if (!isSquare(from)) return [];
  const b = fromBoard(stage.board);
  const f = toIndex(from);
  if (b[f]! <= 0) return [];
  return playerTargets(b, tiersOf(stage.board), f, config).map((m) => toSquare(m.to));
}

/**
 * Whether the player has a legal queue (spec 8.4): some ordered set of distinct usable skills, each
 * with a target, followed by up to the resulting credits in moves, that `resolveQueue` accepts.
 * Candidates are built from the queue's own checks (`checkSkill`, `legalPlayerMoves`) and always
 * judged by `resolveQueue`, so "legal" means exactly what commit means. Stops at the first success.
 */
export function hasLegalQueue(run: RunState, stage: StageState, config: EngineConfig): boolean {
  const skillIds = run.loadout
    .filter((l) => l.charges >= 1 && config.skills[l.skillId]?.status === 'mvp')
    .map((l) => l.skillId);
  const squares = Object.keys(stage.board);
  const queue: Action[] = [];

  const movesFrom = (board: StageState['board'], credits: number, ledger: BonusLedger): boolean => {
    const here = { ...stage, board };
    for (const from of Object.keys(board)) {
      const piece = board[from]!;
      if (piece.color !== 'white') continue;
      const free = freeBonus(ledger, piece, config);
      if (credits < 1 && !free) continue;
      for (const to of legalPlayerMoves(here, from, config)) {
        queue.push({ type: 'MOVE', from, to });
        let done = resolveQueue(run, stage, queue, config).ok;
        if (!done) {
          const nextLedger: BonusLedger = new Map(ledger);
          recordMove(nextLedger, piece, config, free);
          const left = free ? credits : credits - 1;
          if (left >= 1 || [...nextLedger.values()].includes('earned')) {
            done = movesFrom(applyPlayerMove(board, from, to, config).board, left, nextLedger);
          }
        }
        queue.pop();
        if (done) return true;
      }
    }
    return false;
  };

  const skillsFrom = (ctx: QueueCtx, used: Set<string>): boolean => {
    if (movesFrom(ctx.board, ctx.moveCredits, new Map())) return true;
    for (const skillId of skillIds) {
      if (used.has(skillId)) continue;
      const kind = config.skills[skillId]!.target.kind;
      const color = kind === 'own_piece' ? 'white' : kind === 'enemy_piece' ? 'black' : null;
      const targets = kind === 'none' ? [undefined] : squares.filter((sq) => color === null || ctx.board[sq]?.color === color);
      for (const target of targets) {
        const action: Action = { type: 'ACTIVATE_SKILL', skillId, ...(target !== undefined && { target }) };
        const next = { ...ctx };
        if (checkSkill(next, action, queue.length, config)) continue;
        applySkill(next, action, queue.length, config);
        queue.push(action);
        used.add(skillId);
        const done = skillsFrom(next, used);
        used.delete(skillId);
        queue.pop();
        if (done) return true;
      }
    }
    return false;
  };

  return skillsFrom({
    run, board: stage.board, focus: stage.focus, moveCredits: stage.moveCredits,
    modifiers: stage.modifiers, skillLog: stage.skillLog, turn: stage.turnsUsed + 1,
  }, new Set());
}
