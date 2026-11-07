import type { EngineConfig, PieceType } from '../types';
import type { Move } from '../movegen';
import { makeMove, pseudoMoves, unmakeMove } from '../movegen';
import { inCheck, legalMoves } from '../legality';
import { KING } from '../position';
import { evaluate } from './evaluate';
import { zobristKey } from './zobrist';

type Bound = 'exact' | 'lower' | 'upper';
type Entry = { depth: number; score: number; bound: Bound; best: Move | null };

/** Scores at or beyond this magnitude depend on the ply and are stored node-relative in the TT. */
const MATE_BOUND = 90000;
const INF = Number.POSITIVE_INFINITY;

const TYPE_OF_CODE: PieceType[] = ['pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

interface Ctx {
  b: Int8Array;
  config: EngineConfig;
  tt: Map<number, Entry> | null;
  /**
   * MVV/LVA value per absolute piece code. The king's attacker value is +inf, so a king capture
   * sorts after every other attacker of an equally valuable victim.
   */
  victim: number[];
  attacker: number[];
  qmax: number;
  playerMated: number;
  playerOutOfTurns: number;
  enemyMated: number;
}

const sameMove = (a: Move, m: Move): boolean =>
  a.from === m.from && a.to === m.to && a.promotion === m.promotion;

/**
 * Sorts `moves` in place: `first` (the TT move) if present, then captures by most valuable victim /
 * least valuable attacker, then checks, then from-index, then to-index.
 */
function orderMoves(ctx: Ctx, moves: Move[], blackToMove: boolean, first: Move | null): void {
  const n = moves.length;
  if (n < 2) return;
  const b = ctx.b;
  const opponent = blackToMove ? 'white' : 'black';
  const keyed = new Array<{ m: Move; tt: number; cap: number; v: number; a: number; chk: number }>(n);
  for (let i = 0; i < n; i++) {
    const m = moves[i]!;
    makeMove(b, m);
    const chk = inCheck(b, opponent) ? 1 : 0;
    unmakeMove(b, m);
    const cap = m.captured !== 0 ? 1 : 0;
    keyed[i] = {
      m,
      tt: first !== null && sameMove(first, m) ? 1 : 0,
      cap,
      v: cap ? ctx.victim[Math.abs(m.captured)]! : 0,
      a: cap ? ctx.attacker[Math.abs(b[m.from]!)]! : 0,
      chk,
    };
  }
  keyed.sort((x, y) => (y.tt - x.tt) || (y.cap - x.cap) || (y.v - x.v) || (x.a - y.a)
    || (y.chk - x.chk) || (x.m.from - y.m.from) || (x.m.to - y.m.to));
  for (let i = 0; i < n; i++) moves[i] = keyed[i]!.m;
}

/**
 * Terminal score of a node whose side to move has (`hasMove`) or lacks a legal move, or null if the
 * game goes on. White's out-of-turns check is made by the caller before any move is generated.
 */
function terminal(ctx: Ctx, blackToMove: boolean, hasMove: boolean, ply: number, turns: number): number | null {
  if (!hasMove) {
    if (blackToMove && inCheck(ctx.b, 'black')) return ctx.enemyMated + ply;
    return ctx.playerMated - ply; // player mated, or either side stalemated
  }
  if (turns <= 0) return ctx.playerOutOfTurns;
  return null;
}

/** Whether pseudo-legal `m` leaves the mover's king safe. */
function isLegal(b: Int8Array, m: Move, color: 'white' | 'black'): boolean {
  makeMove(b, m);
  const ok = !inCheck(b, color);
  unmakeMove(b, m);
  return ok;
}

/**
 * Quiescence: terminal checks, then stand pat on `evaluate`, then legal captures only, for both
 * sides, for at most `qleft` more plies. Legality is tested lazily on pseudo-legal moves, since most
 * nodes need only "is there any legal move" before standing pat.
 */
function quiesce(
  ctx: Ctx, blackToMove: boolean, alpha: number, beta: number, ply: number, turns: number,
  qleft: number,
): number {
  if (!blackToMove && turns <= 0) return ctx.playerOutOfTurns;
  const b = ctx.b;
  const color = blackToMove ? 'black' : 'white';
  const pseudo = pseudoMoves(b, color);
  let hasMove = false;
  for (let i = 0; i < pseudo.length; i++) {
    if (isLegal(b, pseudo[i]!, color)) { hasMove = true; break; }
  }
  const t = terminal(ctx, blackToMove, hasMove, ply, turns);
  if (t !== null) return t;

  const stand = evaluate(b, ctx.config);
  if (qleft <= 0) return stand;
  if (blackToMove) {
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
  } else {
    if (stand <= alpha) return stand;
    if (stand < beta) beta = stand;
  }
  const captures: Move[] = [];
  for (let i = 0; i < pseudo.length; i++) {
    const m = pseudo[i]!;
    if (m.captured !== 0 && isLegal(b, m, color)) captures.push(m);
  }
  if (captures.length === 0) return stand;
  orderMoves(ctx, captures, blackToMove, null);

  const nextTurns = blackToMove ? turns : turns - 1;
  let best = stand;
  for (const m of captures) {
    makeMove(b, m);
    const s = quiesce(ctx, !blackToMove, alpha, beta, ply + 1, nextTurns, qleft - 1);
    unmakeMove(b, m);
    if (blackToMove) {
      if (s > best) best = s;
      if (best > alpha) alpha = best;
    } else {
      if (s < best) best = s;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

const toStored = (s: number, ply: number): number =>
  s >= MATE_BOUND ? s + ply : s <= -MATE_BOUND ? s - ply : s;
const fromStored = (s: number, ply: number): number =>
  s >= MATE_BOUND ? s - ply : s <= -MATE_BOUND ? s + ply : s;

/** Fail-soft alpha-beta. Black maximises, White minimises; scores are from Black's view. */
function search(
  ctx: Ctx, blackToMove: boolean, depth: number, alpha: number, beta: number, ply: number,
  turns: number,
): number {
  // At the horizon, quiescence makes the same terminal checks first, so a mate or stalemate on the
  // horizon is scored as a terminal.
  if (depth <= 0) return quiesce(ctx, blackToMove, alpha, beta, ply, turns, ctx.qmax);
  if (!blackToMove && turns <= 0) return ctx.playerOutOfTurns;
  const b = ctx.b;
  const moves = legalMoves(b, blackToMove ? 'black' : 'white');
  const t = terminal(ctx, blackToMove, moves.length > 0, ply, turns);
  if (t !== null) return t;

  // Only reached with turns >= 1, so the key's turns-left stays in range.
  const tt = ctx.tt;
  const key = tt ? zobristKey(b, blackToMove, turns) : 0;
  let ttBest: Move | null = null;
  if (tt) {
    const e = tt.get(key);
    if (e) {
      ttBest = e.best;
      if (e.depth >= depth) {
        const s = fromStored(e.score, ply);
        if (e.bound === 'exact') return s;
        if (e.bound === 'lower' && s >= beta) return s;
        if (e.bound === 'upper' && s <= alpha) return s;
      }
    }
  }

  orderMoves(ctx, moves, blackToMove, ttBest);
  const alpha0 = alpha;
  const beta0 = beta;
  const nextTurns = blackToMove ? turns : turns - 1;
  let best = blackToMove ? -INF : INF;
  let bestMove: Move | null = null;
  for (const m of moves) {
    makeMove(b, m);
    const s = search(ctx, !blackToMove, depth - 1, alpha, beta, ply + 1, nextTurns);
    unmakeMove(b, m);
    if (blackToMove) {
      if (s > best) { best = s; bestMove = m; }
      if (best > alpha) alpha = best;
    } else {
      if (s < best) { best = s; bestMove = m; }
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }

  if (tt) {
    const bound: Bound = best <= alpha0 ? 'upper' : best >= beta0 ? 'lower' : 'exact';
    tt.set(key, { depth, score: toStored(best, ply), bound, best: bestMove });
  }
  return best;
}

function hashable(turns: number): boolean {
  try {
    zobristKey(new Int8Array(64), true, turns);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scores every legal Black move at the root, Black to move, in the stable order (captures by most
 * valuable victim / least valuable attacker, then checks, then from-index, then to-index). Moves that
 * tie the best score get exact scores; every other move gets an upper bound below the best.
 */
export function scoreRootMoves(
  board: Int8Array, playerTurnsLeft: number, depth: number, config: EngineConfig,
): { move: Move; score: number }[] {
  const b = board.slice();
  const moves = legalMoves(b, 'black');
  if (moves.length === 0) return [];

  const pv = config.pieceValues;
  const victim = TYPE_OF_CODE.map((t) => pv[t]);
  const attacker = TYPE_OF_CODE.map((t, code) => (code === KING ? INF : pv[t]));
  const useTT = config.enemyAI.search.transpositionTable && hashable(playerTurnsLeft);
  const term = config.enemyAI.terminal;
  const ctx: Ctx = {
    b,
    config,
    tt: useTT ? new Map<number, Entry>() : null,
    victim,
    attacker,
    qmax: config.enemyAI.search.quiescenceMaxDepth,
    playerMated: term.playerMated,
    playerOutOfTurns: term.playerOutOfTurns,
    enemyMated: term.enemyMated,
  };

  orderMoves(ctx, moves, true, null);
  const finalDepth = Number.isFinite(depth) ? Math.max(1, Math.floor(depth)) : 1;
  const scores = new Array<number>(moves.length).fill(0);
  // Iterative deepening: each iteration searches the previous iteration's best move first (full
  // window), then the rest in the stable order with (best - 1, +inf), and fills the TT that orders the
  // tree. Scores land in their stable-order slots; the last iteration's scores stand.
  let prevBest = 0;
  for (let d = 1; d <= finalDepth; d++) {
    let best = -INF;
    let bestIdx = prevBest;
    for (let k = 0; k < moves.length; k++) {
      // k = 0 is the previous best; then every other move in the stable order.
      const i = k === 0 ? prevBest : k <= prevBest ? k - 1 : k;
      const m = moves[i]!;
      makeMove(b, m);
      const s = search(ctx, false, d - 1, k === 0 ? -INF : best - 1, INF, 1, playerTurnsLeft);
      unmakeMove(b, m);
      scores[i] = s;
      if (s > best) { best = s; bestIdx = i; }
    }
    prevBest = bestIdx;
  }
  return moves.map((move, i) => ({ move, score: scores[i]! }));
}
