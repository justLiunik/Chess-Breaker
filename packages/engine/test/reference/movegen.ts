import type { Color } from '../../src/types';

// A deliberately slow, obviously-correct move generator written from docs/02 §2. Boards use the
// engine's layout (Int8Array(64), index = file + 8 * rank, codes ±1..6 = pawn knight bishop rook
// queen king, White positive) but share no code with src/.
//
// Rarity (docs/02 §2.3): an optional tier array `t` beside the board (0 Normal, 1 Rare, 2 Unique,
// 3 Legendary) gives the tier of each White piece; Black pieces are always Normal. The abilities
// below are written from the docs/02 §2.3 tables by piece and tier, not read from pieces.yaml.

const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
const RARE = 1, UNIQUE = 2, LEGENDARY = 3;

const file = (sq: number): number => sq % 8;
const rank = (sq: number): number => Math.floor(sq / 8);
const onBoard = (f: number, r: number): boolean => f >= 0 && f < 8 && r >= 0 && r < 8;
const sgn = (c: Color): number => (c === 'white' ? 1 : -1);

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHOGONALS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Rare knight: exactly two squares orthogonally. Unique knight: exactly two squares diagonally. */
const STRAIGHT_LEAPS = [[2, 0], [-2, 0], [0, 2], [0, -2]];
const DIAGONAL_LEAPS = [[2, 2], [2, -2], [-2, 2], [-2, -2]];

/** A destination; `via` is the first square captured by a multi-capture ending on `to`, else -1. */
export type RefTarget = { to: number; via: number };

/** Whether a piece of colour `by` attacks `sq` as in M1: every square a piece covers, occupied or not. */
function normalAttacked(b: Int8Array, sq: number, by: Color): boolean {
  const s = sgn(by);
  const f = file(sq);
  const r = rank(sq);
  // pawns attack one rank forward, so the attacker stands one rank back from sq
  for (const df of [-1, 1]) {
    if (onBoard(f + df, r - s) && b[f + df + 8 * (r - s)] === PAWN * s) return true;
  }
  for (const [df, dr] of KNIGHT_STEPS) {
    if (onBoard(f + df!, r + dr!) && b[f + df! + 8 * (r + dr!)] === KNIGHT * s) return true;
  }
  for (const [df, dr] of KING_STEPS) {
    if (onBoard(f + df!, r + dr!) && b[f + df! + 8 * (r + dr!)] === KING * s) return true;
  }
  for (const [dirs, own] of [[DIAGONALS, BISHOP], [ORTHOGONALS, ROOK]] as const) {
    for (const [df, dr] of dirs) {
      let cf = f + df!;
      let cr = r + dr!;
      while (onBoard(cf, cr)) {
        const v = b[cf + 8 * cr]!;
        if (v !== 0) {
          if (v === own * s || v === QUEEN * s) return true;
          break;
        }
        cf += df!;
        cr += dr!;
      }
    }
  }
  return false;
}

/**
 * Whether a piece of colour `by` attacks `sq`. Without tiers, every square a piece covers. With
 * tiers, "attacks follow moves" (docs/02 §2.3): a White piece with a tier also attacks `sq` when one
 * of its single-capture moves could land there, were a (non-king) enemy piece standing on it.
 * Multi-capture never adds an attacked square.
 */
export function refAttacked(b: Int8Array, sq: number, by: Color, t?: Int8Array): boolean {
  if (normalAttacked(b, sq, by)) return true;
  if (by !== 'white' || t === undefined) return false;
  const withEnemy = b.slice();
  withEnemy[sq] = -PAWN;
  for (let from = 0; from < 64; from++) {
    if (from === sq || b[from]! <= 0 || t[from] === 0) continue;
    if (targets(withEnemy, from, t).some((m) => m.to === sq && m.via < 0)) return true;
  }
  return false;
}

/** Slide along `dirs`, with the docs/02 §2.3 slider abilities. */
function slides(
  b: Int8Array, from: number, dirs: number[][],
  a: { leaps: boolean; captureAfterLeap: boolean; multi: 'never' | 'without_leap' | 'always' },
): RefTarget[] {
  const s = b[from]! > 0 ? 1 : -1;
  const out: RefTarget[] = [];
  for (const [df, dr] of dirs) {
    let cf = file(from) + df!;
    let cr = rank(from) + dr!;
    let passedAlly = false;
    while (onBoard(cf, cr)) {
      const x = cf + 8 * cr;
      const v = b[x]! * s;
      if (v === 0) {
        out.push({ to: x, via: -1 });
      } else if (v > 0) {
        // an own piece: a leaping slider passes over it, any other stops before it
        if (!a.leaps) break;
        passedAlly = true;
      } else {
        // an enemy piece always ends the line; a king is never captured
        if (v === -KING) break;
        if (passedAlly && !a.captureAfterLeap) break;
        out.push({ to: x, via: -1 });
        const multi = a.multi === 'always' || (a.multi === 'without_leap' && !passedAlly);
        const yf = cf + df!;
        const yr = cr + dr!;
        if (multi && onBoard(yf, yr)) {
          const y = yf + 8 * yr;
          const w = b[y]! * s;
          if (w < 0 && w !== -KING) out.push({ to: y, via: x });
        }
        break;
      }
      cf += df!;
      cr += dr!;
    }
  }
  return out;
}

function leaps(b: Int8Array, from: number, steps: number[][]): RefTarget[] {
  const s = b[from]! > 0 ? 1 : -1;
  const out: RefTarget[] = [];
  for (const [df, dr] of steps) {
    const f = file(from) + df!;
    const r = rank(from) + dr!;
    if (!onBoard(f, r)) continue;
    const x = f + 8 * r;
    if (b[x]! * s <= 0 && Math.abs(b[x]!) !== KING) out.push({ to: x, via: -1 });
  }
  return out;
}

/** Pseudo-legal destinations of the piece on `from`; never an own piece, never a king. */
function targets(b: Int8Array, from: number, t?: Int8Array): RefTarget[] {
  const code = b[from]!;
  const s = code > 0 ? 1 : -1;
  const type = Math.abs(code);
  const tier = code > 0 && t !== undefined ? t[from]! : 0;
  const f = file(from);
  const r = rank(from);

  if (type === PAWN) {
    const out: RefTarget[] = [];
    const startRank = s === 1 ? 1 : 6;
    if (onBoard(f, r + s) && b[f + 8 * (r + s)] === 0) {
      out.push({ to: f + 8 * (r + s), via: -1 });
      if (r === startRank && b[f + 8 * (r + 2 * s)] === 0) out.push({ to: f + 8 * (r + 2 * s), via: -1 });
    }
    for (const df of [-1, 1]) {
      if (!onBoard(f + df, r + s)) continue;
      const x = f + df + 8 * (r + s);
      if (b[x]! * s < 0 && Math.abs(b[x]!) !== KING) out.push({ to: x, via: -1 });
    }
    return out;
  }
  if (type === KING) return leaps(b, from, KING_STEPS);
  if (type === KNIGHT) {
    // Rare: also two squares straight. Unique: also two squares diagonally. Legendary: the bonus
    // move, which is queue accounting, not a movement pattern.
    return [
      ...leaps(b, from, KNIGHT_STEPS),
      ...(tier >= RARE ? leaps(b, from, STRAIGHT_LEAPS) : []),
      ...(tier >= UNIQUE ? leaps(b, from, DIAGONAL_LEAPS) : []),
    ];
  }
  if (type === BISHOP) {
    // Rare leaps allies, no capture after; Unique captures after; Legendary adds the orthogonals.
    const a = { leaps: tier >= RARE, captureAfterLeap: tier >= UNIQUE, multi: 'never' as const };
    return slides(b, from, tier >= LEGENDARY ? [...DIAGONALS, ...ORTHOGONALS] : DIAGONALS, a);
  }
  if (type === ROOK) {
    // Rare leaps allies, no capture after; Unique adds a one-square diagonal step; Legendary
    // captures one piece after a leap and multi-captures on a move that passed no ally.
    const a = {
      leaps: tier >= RARE, captureAfterLeap: tier >= LEGENDARY,
      multi: tier >= LEGENDARY ? 'without_leap' as const : 'never' as const,
    };
    return [...slides(b, from, ORTHOGONALS, a), ...(tier >= UNIQUE ? leaps(b, from, DIAGONALS) : [])];
  }
  // queen: Rare leaps allies, no capture after; Unique has lifeline (not movement); Legendary
  // captures after a leap and multi-captures on any move.
  const a = {
    leaps: tier >= RARE, captureAfterLeap: tier >= LEGENDARY,
    multi: tier >= LEGENDARY ? 'always' as const : 'never' as const,
  };
  return slides(b, from, [...DIAGONALS, ...ORTHOGONALS], a);
}

/** Plays a move on copies: a White pawn reaching rank 8 vanishes, a Black pawn reaching rank 1 becomes a queen; tiers move with the piece. */
function after(
  b: Int8Array, t: Int8Array | undefined, from: number, m: RefTarget,
): { b: Int8Array; t: Int8Array | undefined } {
  const c = b.slice();
  const code = c[from]!;
  c[from] = 0;
  if (m.via >= 0) c[m.via] = 0;
  if (code === PAWN && rank(m.to) === 7) c[m.to] = 0;
  else if (code === -PAWN && rank(m.to) === 0) c[m.to] = -QUEEN;
  else c[m.to] = code;
  if (t === undefined) return { b: c, t };
  const u = t.slice();
  u[m.to] = c[m.to]! > 0 ? t[from]! : 0;
  u[from] = 0;
  if (m.via >= 0) u[m.via] = 0;
  return { b: c, t: u };
}

/** Pseudo-legal moves of `color`, with the abilities of White pieces' tiers. */
export function refPseudoMoves(b: Int8Array, color: Color, t?: Int8Array): { from: number; to: number; via: number }[] {
  const s = sgn(color);
  const moves: { from: number; to: number; via: number }[] = [];
  for (let from = 0; from < 64; from++) {
    if (b[from]! * s <= 0) continue;
    for (const m of targets(b, from, t)) moves.push({ from, to: m.to, via: m.via });
  }
  return moves;
}

export function refLegalMoves(b: Int8Array, color: Color, t?: Int8Array): { from: number; to: number; via: number }[] {
  const s = sgn(color);
  const enemy: Color = color === 'white' ? 'black' : 'white';
  const moves: { from: number; to: number; via: number }[] = [];
  for (let from = 0; from < 64; from++) {
    if (b[from]! * s <= 0) continue;
    for (const m of targets(b, from, t)) {
      const next = after(b, t, from, m);
      let safe = true;
      for (let k = 0; k < 64; k++) {
        if (next.b[k] === KING * s && refAttacked(next.b, k, enemy, next.t)) safe = false;
      }
      if (safe) moves.push({ from, to: m.to, via: m.via });
    }
  }
  return moves;
}
