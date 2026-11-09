import type { Color } from '../../src/types';

// A deliberately slow, obviously-correct move generator written from docs/02 §2. Boards use the
// engine's layout (Int8Array(64), index = file + 8 * rank, codes ±1..6 = pawn knight bishop rook
// queen king, White positive) but share no code with src/.

const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;

const file = (sq: number): number => sq % 8;
const rank = (sq: number): number => Math.floor(sq / 8);
const onBoard = (f: number, r: number): boolean => f >= 0 && f < 8 && r >= 0 && r < 8;
const sgn = (c: Color): number => (c === 'white' ? 1 : -1);

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHOGONALS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Whether a piece of colour `by` attacks `sq`: every square a piece covers, occupied or not. */
export function refAttacked(b: Int8Array, sq: number, by: Color): boolean {
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

/** Pseudo-legal destinations of the piece on `from`; never an own piece, never a king. */
function targets(b: Int8Array, from: number): number[] {
  const code = b[from]!;
  const s = code > 0 ? 1 : -1;
  const type = Math.abs(code);
  const f = file(from);
  const r = rank(from);
  const out: number[] = [];
  const canLand = (t: number): boolean => b[t]! * s <= 0 && Math.abs(b[t]!) !== KING;

  if (type === PAWN) {
    const startRank = s === 1 ? 1 : 6;
    if (onBoard(f, r + s) && b[f + 8 * (r + s)] === 0) {
      out.push(f + 8 * (r + s));
      if (r === startRank && b[f + 8 * (r + 2 * s)] === 0) out.push(f + 8 * (r + 2 * s));
    }
    for (const df of [-1, 1]) {
      if (!onBoard(f + df, r + s)) continue;
      const t = f + df + 8 * (r + s);
      if (b[t]! * s < 0 && Math.abs(b[t]!) !== KING) out.push(t);
    }
  } else if (type === KNIGHT || type === KING) {
    for (const [df, dr] of type === KNIGHT ? KNIGHT_STEPS : KING_STEPS) {
      if (!onBoard(f + df!, r + dr!)) continue;
      const t = f + df! + 8 * (r + dr!);
      if (canLand(t)) out.push(t);
    }
  } else {
    const dirs = type === BISHOP ? DIAGONALS : type === ROOK ? ORTHOGONALS : [...DIAGONALS, ...ORTHOGONALS];
    for (const [df, dr] of dirs) {
      let cf = f + df!;
      let cr = r + dr!;
      while (onBoard(cf, cr)) {
        const t = cf + 8 * cr;
        if (b[t] === 0) {
          out.push(t);
        } else {
          if (canLand(t)) out.push(t);
          break;
        }
        cf += df!;
        cr += dr!;
      }
    }
  }
  return out;
}

/** Plays from -> to on a copy: a White pawn reaching rank 8 vanishes, a Black pawn reaching rank 1 becomes a queen. */
function after(b: Int8Array, from: number, to: number): Int8Array {
  const c = b.slice();
  const code = c[from]!;
  c[from] = 0;
  if (code === PAWN && rank(to) === 7) c[to] = 0;
  else if (code === -PAWN && rank(to) === 0) c[to] = -QUEEN;
  else c[to] = code;
  return c;
}

export function refLegalMoves(b: Int8Array, color: Color): { from: number; to: number }[] {
  const s = sgn(color);
  const enemy: Color = color === 'white' ? 'black' : 'white';
  const moves: { from: number; to: number }[] = [];
  for (let from = 0; from < 64; from++) {
    if (b[from]! * s <= 0) continue;
    for (const to of targets(b, from)) {
      const next = after(b, from, to);
      let safe = true;
      for (let k = 0; k < 64; k++) {
        if (next[k] === KING * s && refAttacked(next, k, enemy)) safe = false;
      }
      if (safe) moves.push({ from, to });
    }
  }
  return moves;
}
