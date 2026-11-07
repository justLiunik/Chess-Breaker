import { rng } from '../rng';

const SEED = 'checkbreaker-zobrist';
const TURNS = 21;

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

function pieceIndex(code: number): number {
  return code < 0 ? code + 6 : code + 5; // -6..-1 -> 0..5, 1..6 -> 6..11
}

export function zobristKey(b: Int8Array, blackToMove: boolean, playerTurnsLeft: number): number {
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
  }
  if (blackToMove) {
    hi ^= SIDE_KEY.hi;
    lo ^= SIDE_KEY.lo;
  }
  const t = TURN_KEYS[playerTurnsLeft]!;
  hi ^= t.hi;
  lo ^= t.lo;
  return (hi & 0x1fffff) * 2 ** 32 + (lo >>> 0);
}
