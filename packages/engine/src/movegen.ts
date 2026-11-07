import type { Color } from './types';
import { KING, PAWN, KNIGHT, BISHOP, ROOK, QUEEN } from './position';

export type Move = {
  from: number;
  to: number;
  captured: number;
  promotion: 'queen' | 'removed' | null;
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

const KNIGHT_T = leaper(KNIGHT_D);
const KING_T = leaper(KING_D);
const DIAG_R = rays(DIAG);
const ORTHO_R = rays(ORTHO);

const sign = (c: Color): number => (c === 'white' ? 1 : -1);

function pawnAttackSquares(from: number, white: boolean): number[] {
  const f = from % 8;
  const to = from + (white ? 8 : -8);
  if (to < 0 || to > 63) return [];
  const out: number[] = [];
  if (f > 0) out.push(to - 1);
  if (f < 7) out.push(to + 1);
  return out;
}

export function pieceTargets(b: Int8Array, from: number): number[] {
  const code = b[from]!;
  if (code === 0) return [];
  const own = code > 0 ? 1 : -1;
  const out: number[] = [];
  const canLand = (t: number): boolean => {
    const c = b[t]!;
    return Math.abs(c) !== KING && c * own <= 0;
  };
  const type = Math.abs(code);
  if (type === PAWN) {
    const white = own === 1;
    const step = white ? 8 : -8;
    const one = from + step;
    if (one < 0 || one > 63) return out;
    if (b[one] === 0) {
      out.push(one);
      const home = Math.floor(from / 8) === (white ? 1 : 6);
      const two = one + step;
      if (home && b[two] === 0) out.push(two);
    }
    for (const t of pawnAttackSquares(from, white)) {
      if (b[t]! * own < 0 && Math.abs(b[t]!) !== KING) out.push(t);
    }
    return out;
  }
  if (type === KNIGHT || type === KING) {
    for (const t of type === KNIGHT ? KNIGHT_T[from]! : KING_T[from]!) if (canLand(t)) out.push(t);
    return out;
  }
  const sets: number[][][] = [];
  if (type === BISHOP || type === QUEEN) sets.push(DIAG_R[from]!);
  if (type === ROOK || type === QUEEN) sets.push(ORTHO_R[from]!);
  for (const set of sets) {
    for (const ray of set) {
      for (const t of ray) {
        if (canLand(t)) out.push(t);
        if (b[t] !== 0) break;
      }
    }
  }
  return out;
}

export function pseudoMoves(b: Int8Array, color: Color): Move[] {
  const s = sign(color);
  const moves: Move[] = [];
  for (let from = 0; from < 64; from++) {
    const code = b[from]!;
    if (code * s <= 0) continue;
    const isPawn = Math.abs(code) === PAWN;
    for (const to of pieceTargets(b, from)) {
      let promotion: Move['promotion'] = null;
      if (isPawn) {
        const rank = Math.floor(to / 8);
        if (color === 'black' && rank === 0) promotion = 'queen';
        else if (color === 'white' && rank === 7) promotion = 'removed';
      }
      moves.push({ from, to, captured: b[to]!, promotion });
    }
  }
  return moves;
}

export function isAttacked(b: Int8Array, sq: number, by: Color): boolean {
  const s = sign(by);
  // A pawn of `by` attacks sq from the square one rank behind it.
  const behind = sq - 8 * s;
  if (behind >= 0 && behind <= 63) {
    const f = sq % 8;
    if (f > 0 && b[behind - 1] === PAWN * s) return true;
    if (f < 7 && b[behind + 1] === PAWN * s) return true;
  }
  for (const t of KNIGHT_T[sq]!) if (b[t] === KNIGHT * s) return true;
  for (const t of KING_T[sq]!) if (b[t] === KING * s) return true;
  for (const [rs, a, c] of [[DIAG_R, BISHOP, QUEEN], [ORTHO_R, ROOK, QUEEN]] as const) {
    for (const ray of rs[sq]!) {
      for (const t of ray) {
        const v = b[t]!;
        if (v === 0) continue;
        if (v === a * s || v === c * s) return true;
        break;
      }
    }
  }
  return false;
}

export function makeMove(b: Int8Array, m: Move): void {
  const code = b[m.from]!;
  b[m.to] = m.promotion === 'queen' ? -QUEEN : m.promotion === 'removed' ? 0 : code;
  b[m.from] = 0;
}

export function unmakeMove(b: Int8Array, m: Move): void {
  const moved = m.promotion === 'queen' ? -PAWN : m.promotion === 'removed' ? PAWN : b[m.to]!;
  b[m.from] = moved;
  b[m.to] = m.captured;
}
