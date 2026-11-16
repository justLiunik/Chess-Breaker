import { loadEngineConfig } from '@checkbreaker/content';
import { rng } from '../src/rng';
import { isAttacked } from '../src/movegen';
import type { BoardPiece, Color, EngineConfig, RunState, Square, StageState } from '../src/types';
import { deepFreeze, stageOf } from './bench-positions';

export {
  GAME_FENS, RARITY_FENS, assignStageIds, deepFreeze, fenToStage, rarityStage, runOf, stageOf,
} from './bench-positions';

export const config: EngineConfig = loadEngineConfig();

/** A stage in the Deployment phase: `stageOf` without White Hero Pieces, with 9 spawn points. */
export function deploymentStageOf(
  pieces: Record<Square, string>,
  overrides: Partial<StageState> = {},
): StageState {
  const base = stageOf(pieces);
  const board: Record<Square, BoardPiece> = {};
  for (const [sq, piece] of Object.entries(base.board)) {
    if (!(piece.color === 'white' && piece.instanceId !== undefined)) board[sq] = { ...piece };
  }
  return deepFreeze({ ...base, board, phase: 'deployment', spawnPoints: 9, ...overrides } as StageState);
}

/**
 * `run` with a deck instance for every non-King Hero Piece on `stage`'s board that its deck lacks:
 * the piece's id and rarity (Normal when it has none), `deployed`, as `startStage` leaves a summon.
 * The R5 capture of a Hero Piece needs its instance (I15).
 */
export function deckFor(run: RunState, stage: StageState): RunState {
  const have = new Set(run.deck.map((p) => p.instanceId));
  const extra = Object.values(stage.board).flatMap((p) => {
    if (p.color !== 'white' || p.instanceId === undefined || p.pieceType === 'king' || p.pieceType === 'pawn') return [];
    if (have.has(p.instanceId)) return [];
    return [{
      instanceId: p.instanceId, pieceType: p.pieceType, rarity: p.rarity ?? 'normal', durability: 1, durabilityMax: 2,
      origin: 'starter' as const, acquiredAtStage: 0, status: 'deployed' as const,
    }];
  });
  return deepFreeze({ ...run, deck: [...run.deck, ...extra] });
}

export const MIDGAME_FENS: string[] = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R b - - 0 1',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 b - - 0 10',
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b - - 0 1',
  '2r3k1/pp3ppp/2n1b3/3p4/3P4/2NB1N2/PP3PPP/2R3K1 b - - 0 1',
];

/**
 * A deterministic random board: one king per side, 2-14 other pieces, no pawn on rank 1 or 8,
 * neither king in check, or with `sideInCheck` set, exactly that side in check (as M1 sees check).
 * The same (seed, i, option) always gives the same board. With `tiers`, that array is filled with a
 * random tier 0-3 for each White knight, bishop, rook and queen (0 elsewhere); the board is the same
 * as without it.
 */
export function randomBoard(
  seed: string, i: number, opts: { sideInCheck?: Color; tiers?: Int8Array } = {},
): Int8Array {
  let cursor = 0;
  const next = (n: number): number => {
    // The FNV hash's top bits barely move between consecutive cursors, so finish it with a
    // murmur-style mix before scaling.
    let h = rng(`${seed}|${i}`, cursor).value * 2 ** 32 >>> 0;
    cursor++;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return Math.floor(((h >>> 0) / 2 ** 32) * n);
  };
  for (;;) {
    const b = new Int8Array(64);
    const place = (code: number, pawn: boolean): void => {
      for (;;) {
        const sq = next(64);
        const rank = sq >> 3;
        if (b[sq] !== 0 || (pawn && (rank === 0 || rank === 7))) continue;
        b[sq] = code;
        return;
      }
    };
    place(6, false);
    place(-6, false);
    const others = 2 + next(13);
    for (let n = 0; n < others; n++) {
      const type = 1 + next(5);
      place(next(2) === 0 ? type : -type, type === 1);
    }
    const whiteChecked = isAttacked(b, b.indexOf(6), 'black');
    const blackChecked = isAttacked(b, b.indexOf(-6), 'white');
    const want = opts.sideInCheck;
    if (want === undefined ? !whiteChecked && !blackChecked
      : want === 'white' ? whiteChecked && !blackChecked : blackChecked && !whiteChecked) {
      const t = opts.tiers;
      if (t !== undefined) {
        for (let sq = 0; sq < 64; sq++) t[sq] = b[sq]! >= 2 && b[sq]! <= 5 ? next(4) : 0;
      }
      return b;
    }
  }
}
