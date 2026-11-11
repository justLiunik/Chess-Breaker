import { rng } from '../rng';

const SEED = 'checkbreaker-zobrist';
const TURNS = 21;
/** The largest clock the table holds (turns 0..MAX_CLOCK); callers clamp to it. */
export const MAX_CLOCK = TURNS - 1;

let cursor = 0;
function draw32(): number {
  const r = rng(SEED, cursor);
  cursor = r.next;
  return Math.floor(r.value * 2 ** 32);
}
function drawKey(): { hi: number; lo: number } {
  const hi = draw32() & 0x1fffff;
  const lo = draw32() | 0;
  return { hi, lo };
}

// Order: piece codes -6..-1, 1..6 (12) x 64 squares, side to move, turns left 0..20.
const PIECE_KEYS: { hi: number; lo: number }[] = [];
for (let i = 0; i < 12 * 64; i++) PIECE_KEYS.push(drawKey());
const SIDE_KEY = drawKey();
const TURN_KEYS: { hi: number; lo: number }[] = [];
for (let i = 0; i < TURNS; i++) TURN_KEYS.push(drawKey());
// Drawn after every key above, so the M1 keys are unchanged: (tier - 1) * 64 + square, tiers 1..3.
const TIER_KEYS: { hi: number; lo: number }[] = [];
for (let i = 0; i < 3 * 64; i++) TIER_KEYS.push(drawKey());

function pieceIndex(code: number): number {
  return code < 0 ? code + 6 : code + 5; // -6..-1 -> 0..5, 1..6 -> 6..11
}

/**
 * The position's key. With the tier array `t`, each White piece with a tier also XORs its
 * (tier, square) key, so a tier-free `t` gives the M1 key.
 */
export function zobristKey(b: Int8Array, blackToMove: boolean, playerTurnsLeft: number, t?: Int8Array): number {
  if (!Number.isInteger(playerTurnsLeft) || playerTurnsLeft < 0 || playerTurnsLeft >= TURNS) {
    throw new RangeError(`playerTurnsLeft ${playerTurnsLeft} outside 0..${TURNS - 1}`);
  }
  let hi = 0;
  let lo = 0;
  for (let sq = 0; sq < 64; sq++) {
    const code = b[sq]!;
    if (code === 0) continue;
    const k = PIECE_KEYS[pieceIndex(code) * 64 + sq]!;
    hi ^= k.hi;
    lo ^= k.lo;
    if (t !== undefined && code > 0) {
      const tier = t[sq]!;
      if (tier > 0) {
        const tk = TIER_KEYS[(tier - 1) * 64 + sq]!;
        hi ^= tk.hi;
        lo ^= tk.lo;
      }
    }
  }
  if (blackToMove) {
    hi ^= SIDE_KEY.hi;
    lo ^= SIDE_KEY.lo;
  }
  const turn = TURN_KEYS[playerTurnsLeft]!;
  hi ^= turn.hi;
  lo ^= turn.lo;
  return (hi & 0x1fffff) * 2 ** 32 + (lo >>> 0);
}
