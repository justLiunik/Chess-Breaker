import type { EngineConfig, PieceType } from '../types';
import { KING } from '../position';
import { isAttacked } from '../movegen';
import { inCheck, legalMoves } from '../legality';

const TYPE_OF_CODE: PieceType[] = ['pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/** Static evaluation from the enemy's (Black's) point of view; higher is better for Black. */
export function evaluate(b: Int8Array, config: EngineConfig): number {
  const w = config.enemyAI.weights;
  let material = 0;
  for (let i = 0; i < 64; i++) {
    const code = b[i]!;
    const abs = Math.abs(code);
    if (abs === 0 || abs === KING) continue;
    const v = config.pieceValues[TYPE_OF_CODE[abs]!];
    material += code < 0 ? v : -v;
  }

  const moves = legalMoves(b, 'black');
  const k = b.indexOf(-KING);
  let escape = 0;
  let zoneAttacked = 0;
  if (k >= 0) {
    for (const m of moves) if (m.from === k) escape++;
    const kf = k % 8;
    const kr = k >> 3;
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const f = kf + df;
        const r = kr + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        if (isAttacked(b, f + 8 * r, 'white')) zoneAttacked++;
      }
    }
  }

  return escape * w.kingEscapeSquare
    + zoneAttacked * w.kingZoneAttacked
    + (inCheck(b, 'black') ? w.kingInCheck : 0)
    + material * w.materialPerPoint
    + moves.length * w.mobilityPerMove;
}
