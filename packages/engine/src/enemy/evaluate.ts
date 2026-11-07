import type { EngineConfig, PieceType } from '../types';
import * as position from '../position';
import * as movegen from '../movegen';
import * as legality from '../legality';

// Imported bindings are copied into module constants once: vitest's module runner turns every use
// of an imported binding into a getter call, which made the search's hot loops ~1.8x slower under
// test than under plain Node.
const { BISHOP, KING, KNIGHT, PAWN, ROOK } = position;
const { DIAG_R, KING_T, KNIGHT_T, ORTHO_R, pinnedOn, targetsInto } = movegen;
const { COUNTS, countLegalInPlace, newSafety, safeMove } = legality;

const TYPE_OF_CODE: PieceType[] = ['pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/** Static evaluation from the enemy's (Black's) point of view; higher is better for Black. */
export function evaluate(b: Int8Array, config: EngineConfig): number {
  return evaluateInPlace(b.slice(), evalTable(config));
}

/** The config numbers `evaluate` uses, read once: piece value by absolute code, and the weights. */
export type EvalTable = {
  value: Float64Array;
  kingEscapeSquare: number;
  kingZoneAttacked: number;
  kingInCheck: number;
  materialPerPoint: number;
  mobilityPerMove: number;
};

export function evalTable(config: EngineConfig): EvalTable {
  const w = config.enemyAI.weights;
  const value = new Float64Array(7);
  for (let code = PAWN; code < KING; code++) value[code] = config.pieceValues[TYPE_OF_CODE[code]!];
  return {
    value,
    kingEscapeSquare: w.kingEscapeSquare,
    kingZoneAttacked: w.kingZoneAttacked,
    kingInCheck: w.kingInCheck,
    materialPerPoint: w.materialPerPoint,
    mobilityPerMove: w.mobilityPerMove,
  };
}

// Scratch, filled afresh by every call.
const ATTACKED = new Uint8Array(64);
const TARGETS = new Int8Array(32);
const SAFETY = newSafety();

/** Marks on `ATTACKED` every square the White piece `code` on `from` attacks. */
function markAttacks(b: Int8Array, from: number, code: number): void {
  if (code === PAWN) {
    const f = from & 7;
    if (f > 0 && from <= 55) ATTACKED[from + 7] = 1;
    if (f < 7 && from <= 54) ATTACKED[from + 9] = 1;
    return;
  }
  if (code === KNIGHT || code === KING) {
    const ts = code === KNIGHT ? KNIGHT_T[from]! : KING_T[from]!;
    for (let i = 0; i < ts.length; i++) ATTACKED[ts[i]!] = 1;
    return;
  }
  if (code !== ROOK) markRays(b, DIAG_R[from]!);
  if (code !== BISHOP) markRays(b, ORTHO_R[from]!);
}

function markRays(b: Int8Array, set: number[][]): void {
  for (let r = 0; r < set.length; r++) {
    const ray = set[r]!;
    for (let i = 0; i < ray.length; i++) {
      const t = ray[i]!;
      ATTACKED[t] = 1;
      if (b[t] !== 0) break;
    }
  }
}

/**
 * `evaluate` on a board it may use as scratch (restored before it returns). One pass sums the
 * material and marks every square White attacks (the same squares `isAttacked(…, 'white')` reports),
 * which gives the king-zone and check terms. With one Black king not in check, a king move is legal
 * exactly when its target is unattacked (no line runs through the king, so lifting it uncovers
 * nothing), and only pinned pieces' moves need trying; otherwise the moves are counted by
 * `countLegalInPlace`, which tries them as `legalMoves` does.
 */
export function evaluateInPlace(b: Int8Array, w: EvalTable): number {
  const pv = w.value;
  ATTACKED.fill(0);
  let material = 0;
  let k = -1;
  let kings = 0;
  for (let i = 0; i < 64; i++) {
    const code = b[i]!;
    if (code === 0) continue;
    if (code > 0) {
      markAttacks(b, i, code);
      if (code !== KING) material -= pv[code]!;
    } else if (code === -KING) {
      if (k < 0) k = i;
      kings++;
    } else {
      material += pv[-code]!;
    }
  }

  let mobility = 0;
  let escape = 0;
  let zoneAttacked = 0;
  let check = false;
  if (k < 0) {
    mobility = countLegalInPlace(b, -1, -1, SAFETY);
  } else {
    check = ATTACKED[k] === 1;
    // KING_T[k] lists exactly the on-board squares next to the king.
    const zone = KING_T[k]!;
    for (let i = 0; i < zone.length; i++) zoneAttacked += ATTACKED[zone[i]!]!;
    if (check || kings !== 1) {
      mobility = countLegalInPlace(b, -1, k, SAFETY);
      escape = COUNTS.king;
    } else {
      SAFETY.king = k;
      SAFETY.tryAll = false;
      for (let from = 0; from < 64; from++) {
        if (b[from]! >= 0) continue;
        const n = targetsInto(b, from, TARGETS);
        if (from === k) {
          for (let i = 0; i < n; i++) if (ATTACKED[TARGETS[i]!] === 0) escape++;
          mobility += escape;
        } else if (pinnedOn(b, k, from, -1)) {
          for (let i = 0; i < n; i++) if (safeMove(b, SAFETY, -1, from, TARGETS[i]!)) mobility++;
        } else {
          mobility += n;
        }
      }
    }
  }

  return escape * w.kingEscapeSquare
    + zoneAttacked * w.kingZoneAttacked
    + (check ? w.kingInCheck : 0)
    + material * w.materialPerPoint
    + mobility * w.mobilityPerMove;
}
