import type { Color } from './types';
import * as position from './position';

// Imported bindings are copied into module constants once: vitest's module runner turns every use
// of an imported binding into a getter call, which made the search's hot loops ~1.8x slower under
// test than under plain Node.
const { KING, PAWN, KNIGHT, BISHOP, ROOK, QUEEN } = position;

export type Move = {
  from: number;
  to: number;
  captured: number;
  promotion: 'queen' | 'removed' | null;
  /** A multi-capture's first captured square (the mover ends on `to`, directly beyond it), else -1. */
  via: number;
  /** The code captured on `via`, else 0. */
  viaCaptured: number;
};

const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING_D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function leaper(deltas: readonly (readonly [number, number])[]): number[][] {
  return Array.from({ length: 64 }, (_, i) => {
    const out: number[] = [];
    for (const [df, dr] of deltas) {
      const f = (i % 8) + df;
      const r = Math.floor(i / 8) + dr;
      if (f >= 0 && f < 8 && r >= 0 && r < 8) out.push(f + 8 * r);
    }
    return out;
  });
}

function rays(dirs: readonly (readonly [number, number])[]): number[][][] {
  return Array.from({ length: 64 }, (_, i) =>
    dirs.map(([df, dr]) => {
      const ray: number[] = [];
      let f = (i % 8) + df;
      let r = Math.floor(i / 8) + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        ray.push(f + 8 * r);
        f += df;
        r += dr;
      }
      return ray;
    }));
}

export const KNIGHT_T = leaper(KNIGHT_D);
export const KING_T = leaper(KING_D);
export const DIAG_R = rays(DIAG);
export const ORTHO_R = rays(ORTHO);

/** The eight rays from each square: DIAG_R's four (0..3), then ORTHO_R's four (4..7). */
const RAYS8: number[][][] = Array.from({ length: 64 }, (_, i) => [...DIAG_R[i]!, ...ORTHO_R[i]!]);
/** LINE[a * 64 + b]: the RAYS8 index of the ray from a that passes b, or -1. */
const LINE = new Int8Array(64 * 64).fill(-1);
/** 1 where a knight (KNIGHT_ADJ) or king (KING_ADJ) on a attacks b, at a * 64 + b. */
const KNIGHT_ADJ = new Uint8Array(64 * 64);
const KING_ADJ = new Uint8Array(64 * 64);
for (let a = 0; a < 64; a++) {
  RAYS8[a]!.forEach((ray, d) => { for (const t of ray) LINE[a * 64 + t] = d; });
  for (const t of KNIGHT_T[a]!) KNIGHT_ADJ[a * 64 + t] = 1;
  for (const t of KING_T[a]!) KING_ADJ[a * 64 + t] = 1;
}

/** Whether squares `a` and `b` share a rank, file or diagonal (and differ). */
export function onLine(a: number, b: number): boolean {
  return LINE[a * 64 + b]! >= 0;
}

/**
 * Whether the piece on `sq` is the sole blocker between the king of side `s` on `k` and an enemy
 * slider moving along that line (so that emptying `sq` would expose the king). The king must not be
 * in check.
 */
export function pinnedOn(b: Int8Array, k: number, sq: number, s: number): boolean {
  if (LINE[k * 64 + sq]! < 0) return false;
  const code = b[sq]!;
  b[sq] = 0;
  const pinned = sliderBeyond(b, k, sq, -s);
  b[sq] = code;
  return pinned;
}

/** The first piece on the ray from `k` that passes `e`, if it is a slider of sign `s` moving along it. */
function sliderBeyond(b: Int8Array, k: number, e: number, s: number): boolean {
  const d = LINE[k * 64 + e]!;
  if (d < 0) return false;
  const ray = RAYS8[k]![d]!;
  for (let i = 0; i < ray.length; i++) {
    const v = b[ray[i]!]! * s;
    if (v === 0) continue;
    return v === QUEEN || v === (d < 4 ? BISHOP : ROOK);
  }
  return false;
}

/**
 * Whether `k` is attacked by side `s` (1 White, -1 Black) after that side's move from `from` to `to`,
 * given that it was not attacked before the move and `b` is the board after it. Only the piece now on
 * `to` can be a new attacker, or an unmoved slider whose line to `k` crosses a square the move
 * emptied (`from`, or `to` when the moving pawn vanished): the same answer as `attackedBy`.
 */
export function attackedAfterMove(b: Int8Array, k: number, s: number, from: number, to: number): boolean {
  const c = b[to]! * s;
  if (c > 0) {
    if (c === PAWN) {
      const behind = k - 8 * s;
      if (behind >= 0 && behind <= 63) {
        const f = k & 7;
        if ((f > 0 && to === behind - 1) || (f < 7 && to === behind + 1)) return true;
      }
    } else if (c === KNIGHT) {
      if (KNIGHT_ADJ[to * 64 + k] === 1) return true;
    } else if (c === KING) {
      if (KING_ADJ[to * 64 + k] === 1) return true;
    } else {
      const d = LINE[k * 64 + to]!;
      if (d >= 0 && (c === QUEEN || c === (d < 4 ? BISHOP : ROOK))) {
        const ray = RAYS8[k]![d]!;
        for (let i = 0; i < ray.length; i++) {
          const t = ray[i]!;
          if (t === to) return true;
          if (b[t] !== 0) break;
        }
      }
    }
  }
  if (sliderBeyond(b, k, from, s)) return true;
  return c === 0 && sliderBeyond(b, k, to, s);
}

const sign = (c: Color): number => (c === 'white' ? 1 : -1);

/**
 * Writes the squares the piece on `from` can move to into `out` and returns how many: pawn pushes
 * (one, then two from home), then pawn captures toward the lower then the higher file; leaper
 * targets in table order; slider targets ray by ray (diagonals before orthogonals), outward. Never
 * a king's square or a square of the mover's own colour.
 */
export function targetsInto(b: Int8Array, from: number, out: Int8Array): number {
  const code = b[from]!;
  if (code === 0) return 0;
  const own = code > 0 ? 1 : -1;
  const type = code > 0 ? code : -code;
  let n = 0;
  if (type === PAWN) {
    const white = own === 1;
    const one = from + (white ? 8 : -8);
    if (one < 0 || one > 63) return 0;
    if (b[one] === 0) {
      out[n++] = one;
      const two = one + (white ? 8 : -8);
      if ((from >> 3) === (white ? 1 : 6) && b[two] === 0) out[n++] = two;
    }
    const f = from & 7;
    if (f > 0) {
      const c = b[one - 1]! * own;
      if (c < 0 && c !== -KING) out[n++] = one - 1;
    }
    if (f < 7) {
      const c = b[one + 1]! * own;
      if (c < 0 && c !== -KING) out[n++] = one + 1;
    }
    return n;
  }
  if (type === KNIGHT || type === KING) {
    const ts = type === KNIGHT ? KNIGHT_T[from]! : KING_T[from]!;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]!;
      const c = b[t]! * own;
      if (c <= 0 && c !== -KING) out[n++] = t;
    }
    return n;
  }
  if (type !== ROOK) n = slide(b, DIAG_R[from]!, own, out, n);
  if (type !== BISHOP) n = slide(b, ORTHO_R[from]!, own, out, n);
  return n;
}

function slide(b: Int8Array, set: number[][], own: number, out: Int8Array, n: number): number {
  for (let r = 0; r < set.length; r++) {
    const ray = set[r]!;
    for (let i = 0; i < ray.length; i++) {
      const t = ray[i]!;
      const c = b[t]! * own;
      if (c === 0) { out[n++] = t; continue; }
      if (c < 0 && c !== -KING) out[n++] = t;
      break;
    }
  }
  return n;
}

/** Scratch buffer for `targetsInto` callers that consume the targets before the next call. */
const TARGETS = new Int8Array(32);

export function pieceTargets(b: Int8Array, from: number): number[] {
  const n = targetsInto(b, from, TARGETS);
  return Array.from(TARGETS.subarray(0, n));
}

/** What a pawn of colour sign `s` moving to `to` becomes: 'queen' (Black, rank 1), 'removed' (White, rank 8). */
export function promotionOf(s: number, to: number): Move['promotion'] {
  if (s < 0) return to < 8 ? 'queen' : null;
  return to > 55 ? 'removed' : null;
}

export function pseudoMoves(b: Int8Array, color: Color): Move[] {
  const s = sign(color);
  const moves: Move[] = [];
  for (let from = 0; from < 64; from++) {
    const code = b[from]!;
    if (code * s <= 0) continue;
    const isPawn = code === PAWN * s;
    const n = targetsInto(b, from, TARGETS);
    for (let i = 0; i < n; i++) {
      const to = TARGETS[i]!;
      moves.push({
        from, to, captured: b[to]!, promotion: isPawn ? promotionOf(s, to) : null, via: -1, viaCaptured: 0,
      });
    }
  }
  return moves;
}

/** Whether square `sq` is attacked by a piece of colour sign `s` (1 White, -1 Black). */
export function attackedBy(b: Int8Array, sq: number, s: number): boolean {
  // A pawn of colour `s` attacks sq from the square one rank behind it.
  const behind = sq - 8 * s;
  if (behind >= 0 && behind <= 63) {
    const f = sq & 7;
    const p = PAWN * s;
    if (f > 0 && b[behind - 1] === p) return true;
    if (f < 7 && b[behind + 1] === p) return true;
  }
  const n = KNIGHT * s;
  const kt = KNIGHT_T[sq]!;
  for (let i = 0; i < kt.length; i++) if (b[kt[i]!] === n) return true;
  const k = KING * s;
  const kg = KING_T[sq]!;
  for (let i = 0; i < kg.length; i++) if (b[kg[i]!] === k) return true;
  const q = QUEEN * s;
  if (slidesTo(b, DIAG_R[sq]!, BISHOP * s, q)) return true;
  return slidesTo(b, ORTHO_R[sq]!, ROOK * s, q);
}

function slidesTo(b: Int8Array, set: number[][], a: number, q: number): boolean {
  for (let r = 0; r < set.length; r++) {
    const ray = set[r]!;
    for (let i = 0; i < ray.length; i++) {
      const v = b[ray[i]!]!;
      if (v === 0) continue;
      if (v === a || v === q) return true;
      break;
    }
  }
  return false;
}

export function isAttacked(b: Int8Array, sq: number, by: Color): boolean {
  return attackedBy(b, sq, sign(by));
}

export function makeMove(b: Int8Array, m: Move): void {
  const code = b[m.from]!;
  if (m.via >= 0) b[m.via] = 0;
  b[m.to] = m.promotion === 'queen' ? -QUEEN : m.promotion === 'removed' ? 0 : code;
  b[m.from] = 0;
}

export function unmakeMove(b: Int8Array, m: Move): void {
  const moved = m.promotion === 'queen' ? -PAWN : m.promotion === 'removed' ? PAWN : b[m.to]!;
  b[m.from] = moved;
  b[m.to] = m.captured;
  if (m.via >= 0) b[m.via] = m.viaCaptured;
}
