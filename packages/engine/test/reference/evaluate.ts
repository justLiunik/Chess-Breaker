import type { EngineConfig } from '../../src/types';
import { refAttacked, refLegalMoves } from './movegen';

const VALUE_KEYS = ['pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen'] as const;

/**
 * docs/02 §8.1 from scratch, from Black's side (higher is better for Black). With White tiers `t`,
 * Black's moves and the White attacks follow the rarity abilities (docs/02 §2.3).
 */
export function refEvaluate(b: Int8Array, config: EngineConfig, t?: Int8Array): number {
  const w = config.enemyAI.weights;

  let material = 0;
  for (let sq = 0; sq < 64; sq++) {
    const code = b[sq]!;
    const abs = Math.abs(code);
    if (code === 0 || abs === 6) continue;
    const value = config.pieceValues[VALUE_KEYS[abs]!]!;
    material += code < 0 ? value : -value;
  }

  const blackMoves = refLegalMoves(b, 'black', t);
  let kingSq = -1;
  for (let sq = 0; sq < 64; sq++) if (b[sq] === -6) kingSq = sq;

  let escape = 0;
  let zoneAttacked = 0;
  let check = false;
  if (kingSq >= 0) {
    for (const m of blackMoves) if (m.from === kingSq) escape++;
    check = refAttacked(b, kingSq, 'white', t);
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const f = (kingSq % 8) + df;
        const r = Math.floor(kingSq / 8) + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        if (refAttacked(b, f + 8 * r, 'white', t)) zoneAttacked++;
      }
    }
  }

  return escape * w.kingEscapeSquare
    + zoneAttacked * w.kingZoneAttacked
    + (check ? w.kingInCheck : 0)
    + material * w.materialPerPoint
    + blackMoves.length * w.mobilityPerMove;
}
