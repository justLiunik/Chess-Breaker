import type {
  AbilityTable, Action, Color, EngineConfig, MoveRejection, RunState, Square, StageState,
} from './types';
import type { BonusLedger, QueueCtx } from './queue';
import { applyPlayerMove, freeBonus, recordMove, resolveQueue } from './queue';
import { applySkill, checkSkill } from './skills/check';
import * as position from './position';
import { isSquare, toIndex, toSquare } from './square';
import * as movegen from './movegen';
import * as abilities from './abilities';
import type { Move } from './movegen';

// Imported bindings are copied into module constants once: vitest's module runner turns every use
// of an imported binding into a getter call, which made the search's hot loops ~1.8x slower under
// test than under plain Node.
const { KING, PAWN, QUEEN, fromBoard, tiersOf } = position;
const {
  attackedAfterMove, attackedBy, onLine, pieceTargets, promotionOf, pseudoMoves, targetsInto,
} = movegen;
const { abilityAttacked, abilityTargets, abilityTargetsInto, hasTiers } = abilities;

function kingSquare(b: Int8Array, color: Color): number {
  const code = color === 'white' ? KING : -KING;
  return b.indexOf(code);
}

/**
 * Whether `color`'s king is attacked. With White's tier array `t` and the ability `table`, Black's
 * king is attacked as White's rarity abilities allow (docs/02 §2.3); White's never depends on them.
 */
export function inCheck(b: Int8Array, color: Color, t?: Int8Array, table?: AbilityTable): boolean {
  const k = kingSquare(b, color);
  if (k < 0) return false;
  if (color === 'black' && t !== undefined && table !== undefined && hasTiers(t)) {
    return abilityAttacked(b, t, k, table);
  }
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
  /**
   * White's tier array when the board has a tier, else null (the M1 rules). With it, White moves
   * with its rarity abilities and Black's king is attacked as they allow.
   */
  t: Int8Array | null;
  /** The ability table, set whenever `t` is. */
  table: AbilityTable | null;
};

/** Legality scratch; ability-aware when given a tier array that has a tier, and the ability `table`. */
export function newSafety(t?: Int8Array, table?: AbilityTable): Safety {
  const tiered = t !== undefined && table !== undefined && hasTiers(t);
  return { king: -1, tryAll: false, t: tiered ? t : null, table: tiered ? table : null };
}

/** Fills `out` for the side of colour sign `s` (1 White, -1 Black) on `b`. */
export function analyse(b: Int8Array, s: number, out: Safety): void {
  const kc = KING * s;
  const k = b.indexOf(kc);
  out.king = k;
  out.tryAll = k >= 0 && (b.lastIndexOf(kc) !== k
    || (s < 0 && out.t !== null ? abilityAttacked(b, out.t, k, out.table!) : attackedBy(b, k, -s)));
}

/**
 * Whether the move from `from` to `to` (pseudo-legal for the side `s`, not a multi-capture) leaves
 * its king safe. With `sf.t`, a Black move is judged against White's abilities: a move that empties
 * no square on a line through the king still exposes nothing (an extra leaper's attack needs no
 * empty line, and the mover only blocks more where it lands); the rest are tried with
 * `abilityAttacked`.
 */
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
  let ok: boolean;
  if (s < 0 && sf.t !== null) {
    ok = !abilityAttacked(b, sf.t, kingMove ? b.indexOf(KING * s) : k, sf.table!);
  } else {
    ok = sf.tryAll || kingMove ? !attackedBy(b, kingMove ? b.indexOf(KING * s) : k, -s)
      : !attackedAfterMove(b, k, -s, from, to);
  }
  b[from] = code;
  b[to] = captured;
  return ok;
}

/**
 * `safeMove` for a move that may be a multi-capture (`via` its first captured square, else -1).
 * A multi-capture (White's only) also empties `via`, so it is tried in full against Black's attacks.
 */
export function safeMoveVia(
  b: Int8Array, sf: Safety, s: number, from: number, to: number, via: number,
): boolean {
  if (via < 0) return safeMove(b, sf, s, from, to);
  const k = sf.king;
  if (k < 0) return true;
  const code = b[from]!;
  const captured = b[to]!;
  const viaCaptured = b[via]!;
  b[via] = 0;
  b[to] = code;
  b[from] = 0;
  const ok = !attackedBy(b, k, -s);
  b[from] = code;
  b[to] = captured;
  b[via] = viaCaptured;
  return ok;
}

const SAFETY = newSafety();

/**
 * The legal moves of `color`, in `pseudoMoves` order, appended to `out`. Uses `b` as scratch and
 * restores it. With `sf.t`, White's moves are its ability moves (in `abilityTargetsInto` order per
 * piece, multi-captures included) and Black's are judged against White's abilities.
 */
export function legalMovesInPlace(b: Int8Array, color: Color, out: Move[], sf: Safety = SAFETY): Move[] {
  const s = color === 'white' ? 1 : -1;
  analyse(b, s, sf);
  if (s > 0 && sf.t !== null) return abilityLegalMovesInPlace(b, sf, out);
  const pseudo = pseudoMoves(b, color);
  for (let i = 0; i < pseudo.length; i++) {
    const m = pseudo[i]!;
    if (safeMove(b, sf, s, m.from, m.to)) out.push(m);
  }
  return out;
}

const ABILITY_TO = new Int8Array(80);
const ABILITY_VIA = new Int8Array(80);

/** White's legal moves with its abilities, for a `sf` that `analyse` has filled for White. */
function abilityLegalMovesInPlace(b: Int8Array, sf: Safety, out: Move[]): Move[] {
  const t = sf.t!;
  const table = sf.table!;
  for (let from = 0; from < 64; from++) {
    const code = b[from]!;
    if (code <= 0) continue;
    const n = abilityTargetsInto(b, t, from, table, ABILITY_TO, ABILITY_VIA);
    for (let i = 0; i < n; i++) {
      const to = ABILITY_TO[i]!;
      const via = ABILITY_VIA[i]!;
      if (!safeMoveVia(b, sf, 1, from, to, via)) continue;
      out.push({
        from, to, captured: b[to]!, promotion: code === PAWN ? promotionOf(1, to) : null,
        via, viaCaptured: via >= 0 ? b[via]! : 0,
      });
    }
  }
  return out;
}

/**
 * The legal moves of `color`. With `frozen`, a piece on a square where `frozen[i]` is 1 has no
 * moves (Lockdown); it still attacks, blocks and can be captured, so other moves are unaffected.
 * With White's tier array `t` and the ability `table`, the moves follow the rarity abilities (White's
 * own moves, and Black's king safety); a tier-free `t` gives the M1 moves.
 */
export function legalMoves(
  b: Int8Array, color: Color, frozen?: Uint8Array, t?: Int8Array, table?: AbilityTable,
): Move[] {
  const moves = legalMovesInPlace(b.slice(), color, [], t === undefined ? SAFETY : newSafety(t, table));
  return frozen ? moves.filter((m) => frozen[m.from] !== 1) : moves;
}

/**
 * Counts the legal moves of the side `s` on `b` without building them; also counts, into
 * `COUNTS.king`, those made by the piece on `kingFrom`. Uses `b` as scratch and restores it. With
 * `sf.t`, counts what `legalMovesInPlace` would list.
 */
export function countLegalInPlace(b: Int8Array, s: number, kingFrom: number, sf: Safety = SAFETY): number {
  analyse(b, s, sf);
  let total = 0;
  let fromKing = 0;
  const buf = COUNT_BUF;
  const via = COUNT_VIA;
  const abilityMoves = s > 0 && sf.t !== null;
  for (let from = 0; from < 64; from++) {
    if (b[from]! * s <= 0) continue;
    const n = abilityMoves ? abilityTargetsInto(b, sf.t!, from, sf.table!, buf, via) : targetsInto(b, from, buf);
    for (let i = 0; i < n; i++) {
      if (abilityMoves ? safeMoveVia(b, sf, s, from, buf[i]!, via[i]!) : safeMove(b, sf, s, from, buf[i]!)) {
        total++;
        if (from === kingFrom) fromKing++;
      }
    }
  }
  COUNTS.king = fromKing;
  return total;
}

const COUNT_BUF = new Int8Array(80);
const COUNT_VIA = new Int8Array(80);
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
