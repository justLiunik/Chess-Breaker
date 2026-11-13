import type { AbilityTable, EngineConfig, PieceType } from '../types';
import type { Move } from '../movegen';
import * as movegen from '../movegen';
import type { Safety } from '../legality';
import * as legality from '../legality';
import * as position from '../position';
import * as abilities from '../abilities';
import type { EvalTable } from './evaluate';
import * as evaluation from './evaluate';
import * as zobrist from './zobrist';

// Imported bindings are copied into module constants once: vitest's module runner turns every use
// of an imported binding into a getter call, which made the search's hot loops ~1.8x slower under
// test than under plain Node.
const {
  attackedAfterMove, attackedBy, makeMove, makeMoveTiered, promotionOf, targetsInto, unmakeMove,
  unmakeMoveTiered,
} = movegen;
const { analyse, inCheck, legalMoves, legalMovesInPlace, safeMove, safeMoveVia } = legality;
const { abilityAttacked, abilityTargetsInto, hasTiers } = abilities;
const { KING, PAWN } = position;
const { evalTable, evaluateInPlace } = evaluation;
const { zobristKey } = zobrist;

type Bound = 'exact' | 'lower' | 'upper';
type Entry = { depth: number; score: number; bound: Bound; best: Move | null };

/**
 * Scores at or beyond this magnitude depend on the ply and are stored node-relative in the TT. It is
 * the midpoint of the player-mated and out-of-clock scores, so mates (which sit within a few dozen
 * plies of playerMated) are ply-adjusted and out-of-clock scores are not.
 */
export function mateBound(config: EngineConfig): number {
  const t = config.enemyAI.terminal;
  return (t.playerMated + t.playerOutOfClock) / 2;
}
const INF = Number.POSITIVE_INFINITY;

const TYPE_OF_CODE: PieceType[] = ['pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

interface Ctx {
  b: Int8Array;
  /**
   * White's tiers beside `b` when the board has any, else null: then White replies with its rarity
   * abilities (one standard move: no bonus move, no skills) and Black's king safety follows them.
   */
  t: Int8Array | null;
  /** The ability table `t` is read with. */
  table: AbilityTable;
  weights: EvalTable;
  tt: Map<number, Entry> | null;
  /**
   * MVV/LVA rank (see ranks) per absolute piece code. The king's attacker value is +inf, so a king
   * capture sorts after every other attacker of an equally valuable victim.
   */
  victimRank: Int32Array;
  attackerRank: Int32Array;
  qmax: number;
  playerMated: number;
  playerOutOfClock: number;
  enemyMated: number;
  mateBound: number;
  /** Legality scratch per ply, so a node keeps its own across its children. */
  safety: Safety[];
  /** Move sort keys per ply, so a node keeps its own across its children. */
  keys: Int32Array[];
}

function safetyAt(ctx: Ctx, ply: number): Safety {
  while (ctx.safety.length <= ply) {
    ctx.safety.push({ king: -1, tryAll: false, t: ctx.t, table: ctx.t === null ? null : ctx.table });
  }
  return ctx.safety[ply]!;
}

/** Target scratch for quiesce, consumed before any child node runs (80: room for ability targets). */
const QBUF = new Int8Array(80);
const QVIA = new Int8Array(80);

const sameMove = (a: Move, m: Move): boolean =>
  a.from === m.from && a.to === m.to && a.promotion === m.promotion && a.via === m.via;

/** Plays `m` on the context's board, and on its tiers when it has them; returns what unmake needs. */
function make(ctx: Ctx, m: Move): number {
  const t = ctx.t;
  if (t === null) {
    makeMove(ctx.b, m);
    return 0;
  }
  return makeMoveTiered(ctx.b, t, m);
}

function unmake(ctx: Ctx, m: Move, saved: number): void {
  const t = ctx.t;
  if (t === null) unmakeMove(ctx.b, m);
  else unmakeMoveTiered(ctx.b, t, m, saved);
}

/**
 * The rank of each entry of `values` among its distinct values (0 = smallest). Comparing ranks
 * orders exactly as comparing the values does, so MVV/LVA can be packed into an integer key.
 */
function ranks(values: number[]): Int32Array {
  const distinct = [...new Set(values)].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return Int32Array.from(values, (v) => distinct.indexOf(v));
}

/**
 * Writes each move's sort key into `keys`; a higher key sorts first. The key packs, from the most
 * significant field down: `first` (the TT move), capture, victim rank (higher first), attacker rank
 * (lower first), check, from-index (lower first), to-index (lower first) - the order of orderMoves.
 * From and to identify a move, so no two keys are equal.
 */
function keyMoves(
  ctx: Ctx, moves: Move[], blackToMove: boolean, first: Move | null, keys: Int32Array,
): void {
  const b = ctx.b;
  // The mover never captures a king, so the opponent's king square (as inCheck finds it) is fixed.
  const oppKing = b.indexOf(blackToMove ? KING : -KING);
  const s = blackToMove ? -1 : 1;
  // Unless the opponent is already in check, only what a move changes can give check.
  const pre = oppKing >= 0 && attackedBy(b, oppKing, s);
  // White's ability moves give check as abilityAttacked sees it, tried in full.
  const t = blackToMove ? null : ctx.t;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]!;
    let key = ((63 - m.from) << 6) | (63 - m.to);
    if (first !== null && sameMove(first, m)) key |= 1 << 22;
    if (m.captured !== 0) {
      const a = ctx.attackerRank[Math.abs(b[m.from]!)]!;
      key |= (1 << 21) | (ctx.victimRank[Math.abs(m.captured)]! << 18) | ((7 - a) << 15);
    }
    if (oppKing >= 0) {
      let chk: boolean;
      if (t !== null) {
        const saved = makeMoveTiered(b, t, m);
        chk = abilityAttacked(b, t, oppKing, ctx.table);
        unmakeMoveTiered(b, t, m, saved);
      } else {
        makeMove(b, m);
        chk = pre ? attackedBy(b, oppKing, s) : attackedAfterMove(b, oppKing, s, m.from, m.to);
        unmakeMove(b, m);
      }
      if (chk) key |= 1 << 14;
    }
    keys[i] = key;
  }
}

/** Moves the highest-keyed of `moves[i..]` into slot `i` (swapping keys along). */
function pickNext(moves: Move[], keys: Int32Array, i: number): void {
  let best = i;
  for (let j = i + 1; j < moves.length; j++) if (keys[j]! > keys[best]!) best = j;
  if (best === i) return;
  const m = moves[i]!;
  moves[i] = moves[best]!;
  moves[best] = m;
  const k = keys[i]!;
  keys[i] = keys[best]!;
  keys[best] = k;
}

/** Sort-key scratch for the node at `ply`, with room for `n` moves. */
function keysAt(ctx: Ctx, ply: number, n: number): Int32Array {
  while (ctx.keys.length <= ply) ctx.keys.push(new Int32Array(64));
  if (ctx.keys[ply]!.length < n) ctx.keys[ply] = new Int32Array(n);
  return ctx.keys[ply]!;
}

/**
 * Sorts `moves` in place: `first` (the TT move) if present, then captures by most valuable victim /
 * least valuable attacker, then checks, then from-index, then to-index. Nodes that may cut off early
 * use keyMoves and pickNext directly, which yields the same order one move at a time.
 */
function orderMoves(ctx: Ctx, moves: Move[], blackToMove: boolean, first: Move | null): void {
  const keys = new Int32Array(moves.length);
  keyMoves(ctx, moves, blackToMove, first, keys);
  for (let i = 0; i < moves.length; i++) pickNext(moves, keys, i);
}

/**
 * Terminal score of a node whose side to move has (`hasMove`) or lacks a legal move, or null if the
 * game goes on. White's out-of-clock check is made by the caller before any move is generated.
 */
function terminal(ctx: Ctx, blackToMove: boolean, hasMove: boolean, ply: number, turns: number): number | null {
  if (!hasMove) {
    if (blackToMove && blackInCheck(ctx)) return ctx.enemyMated + ply;
    return ctx.playerMated - ply; // player mated, or either side stalemated
  }
  if (turns <= 0) return ctx.playerOutOfClock;
  return null;
}

function blackInCheck(ctx: Ctx): boolean {
  if (ctx.t === null) return inCheck(ctx.b, 'black');
  const k = ctx.b.indexOf(-KING);
  return k >= 0 && abilityAttacked(ctx.b, ctx.t, k, ctx.table);
}

/**
 * Quiescence: terminal checks, then stand pat on `evaluate`, then legal captures only, for both
 * sides, for at most `qleft` more plies. Legality is tested lazily, target by target, since most
 * nodes need only "is there any legal move" before standing pat; the captures are then built in
 * pseudoMoves order for orderMoves to sort.
 */
function quiesce(
  ctx: Ctx, blackToMove: boolean, alpha: number, beta: number, ply: number, turns: number,
  qleft: number,
): number {
  if (!blackToMove && turns <= 0) return ctx.playerOutOfClock;
  const b = ctx.b;
  const side = blackToMove ? -1 : 1;
  const sf = safetyAt(ctx, ply);
  analyse(b, side, sf);
  // White's moves with its abilities when the board has tiers (multi-captures carry a via).
  const tw = blackToMove ? null : ctx.t;
  let hasMove = false;
  for (let from = 0; from < 64 && !hasMove; from++) {
    if (b[from]! * side <= 0) continue;
    if (tw !== null) {
      const n = abilityTargetsInto(b, tw, from, ctx.table, QBUF, QVIA);
      for (let i = 0; i < n; i++) {
        if (safeMoveVia(b, sf, side, from, QBUF[i]!, QVIA[i]!)) { hasMove = true; break; }
      }
      continue;
    }
    const n = targetsInto(b, from, QBUF);
    for (let i = 0; i < n; i++) {
      if (safeMove(b, sf, side, from, QBUF[i]!)) { hasMove = true; break; }
    }
  }
  const term = terminal(ctx, blackToMove, hasMove, ply, turns);
  if (term !== null) return term;

  const stand = evaluateInPlace(b, ctx.weights, ctx.t);
  if (qleft <= 0) return stand;
  if (blackToMove) {
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
  } else {
    if (stand <= alpha) return stand;
    if (stand < beta) beta = stand;
  }
  const captures: Move[] = [];
  for (let from = 0; from < 64; from++) {
    const code = b[from]!;
    if (code * side <= 0) continue;
    if (tw !== null) {
      const n = abilityTargetsInto(b, tw, from, ctx.table, QBUF, QVIA);
      for (let i = 0; i < n; i++) {
        const to = QBUF[i]!;
        const via = QVIA[i]!;
        const captured = b[to]!;
        if (captured === 0 || !safeMoveVia(b, sf, side, from, to, via)) continue;
        captures.push({
          from, to, captured, promotion: code === PAWN ? promotionOf(side, to) : null,
          via, viaCaptured: via >= 0 ? b[via]! : 0,
        });
      }
      continue;
    }
    const n = targetsInto(b, from, QBUF);
    for (let i = 0; i < n; i++) {
      const to = QBUF[i]!;
      const captured = b[to]!;
      if (captured === 0 || !safeMove(b, sf, side, from, to)) continue;
      captures.push({
        from, to, captured, promotion: code === PAWN * side ? promotionOf(side, to) : null,
        via: -1, viaCaptured: 0,
      });
    }
  }
  if (captures.length === 0) return stand;
  const keys = keysAt(ctx, ply, captures.length);
  keyMoves(ctx, captures, blackToMove, null, keys);

  const nextTurns = blackToMove ? turns : turns - 1;
  let best = stand;
  for (let i = 0; i < captures.length; i++) {
    pickNext(captures, keys, i);
    const m = captures[i]!;
    const saved = make(ctx, m);
    const s = quiesce(ctx, !blackToMove, alpha, beta, ply + 1, nextTurns, qleft - 1);
    unmake(ctx, m, saved);
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

const toStored = (s: number, ply: number, bound: number): number =>
  s >= bound ? s + ply : s <= -bound ? s - ply : s;
const fromStored = (s: number, ply: number, bound: number): number =>
  s >= bound ? s - ply : s <= -bound ? s + ply : s;

/** Fail-soft alpha-beta. Black maximises, White minimises; scores are from Black's view. */
function search(
  ctx: Ctx, blackToMove: boolean, depth: number, alpha: number, beta: number, ply: number,
  turns: number,
): number {
  // At the horizon, quiescence makes the same terminal checks first, so a mate or stalemate on the
  // horizon is scored as a terminal.
  if (depth <= 0) return quiesce(ctx, blackToMove, alpha, beta, ply, turns, ctx.qmax);
  if (!blackToMove && turns <= 0) return ctx.playerOutOfClock;
  const b = ctx.b;
  const moves = legalMovesInPlace(b, blackToMove ? 'black' : 'white', [], safetyAt(ctx, ply));
  const t = terminal(ctx, blackToMove, moves.length > 0, ply, turns);
  if (t !== null) return t;

  // Only reached with turns >= 1, so the key's turns-left stays in range.
  const tt = ctx.tt;
  const key = tt ? zobristKey(b, blackToMove, turns, ctx.t ?? undefined) : 0;
  let ttBest: Move | null = null;
  if (tt) {
    const e = tt.get(key);
    if (e) {
      ttBest = e.best;
      if (e.depth >= depth) {
        const s = fromStored(e.score, ply, ctx.mateBound);
        if (e.bound === 'exact') return s;
        if (e.bound === 'lower' && s >= beta) return s;
        if (e.bound === 'upper' && s <= alpha) return s;
      }
    }
  }

  const keys = keysAt(ctx, ply, moves.length);
  keyMoves(ctx, moves, blackToMove, ttBest, keys);
  const alpha0 = alpha;
  const beta0 = beta;
  const nextTurns = blackToMove ? turns : turns - 1;
  let best = blackToMove ? -INF : INF;
  let bestMove: Move | null = null;
  for (let i = 0; i < moves.length; i++) {
    pickNext(moves, keys, i);
    const m = moves[i]!;
    const saved = make(ctx, m);
    const s = search(ctx, !blackToMove, depth - 1, alpha, beta, ply + 1, nextTurns);
    unmake(ctx, m, saved);
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
    tt.set(key, { depth, score: toStored(best, ply, ctx.mateBound), bound, best: bestMove });
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
 * `frozen` (Lockdown) removes the moves of the pieces it marks at the root only: deeper plies are
 * later turns, when the suppression has expired. `tiers` (White's tier array beside `board`) makes
 * the imagined player reply one standard move with the rarity abilities (docs/02 §8.1); without
 * tiers, or with none set, the search is the M1 search exactly.
 */
export function scoreRootMoves(
  board: Int8Array, playerTurnsLeft: number, depth: number, config: EngineConfig, frozen?: Uint8Array,
  tiers?: Int8Array,
): { move: Move; score: number }[] {
  const b = board.slice();
  const t = tiers !== undefined && hasTiers(tiers) ? tiers.slice() : null;
  const moves = legalMoves(b, 'black', frozen, t === null ? undefined : { t, table: config.abilities });
  if (moves.length === 0) return [];

  const pv = config.pieceValues;
  const victim = TYPE_OF_CODE.map((t) => pv[t]);
  const attacker = TYPE_OF_CODE.map((t, code) => (code === KING ? INF : pv[t]));
  const useTT = config.enemyAI.search.transpositionTable && hashable(playerTurnsLeft);
  const term = config.enemyAI.terminal;
  const ctx: Ctx = {
    b,
    t,
    table: config.abilities,
    weights: evalTable(config),
    tt: useTT ? new Map<number, Entry>() : null,
    victimRank: ranks(victim),
    attackerRank: ranks(attacker),
    qmax: config.enemyAI.search.quiescenceMaxDepth,
    playerMated: term.playerMated,
    playerOutOfClock: term.playerOutOfClock,
    enemyMated: term.enemyMated,
    mateBound: mateBound(config),
    safety: [],
    keys: [],
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
      const saved = make(ctx, m);
      const s = search(ctx, false, d - 1, k === 0 ? -INF : best - 1, INF, 1, playerTurnsLeft);
      unmake(ctx, m, saved);
      scores[i] = s;
      if (s > best) { best = s; bestIdx = i; }
    }
    prevBest = bestIdx;
  }
  return moves.map((move, i) => ({ move, score: scores[i]! }));
}
