import { loadEngineConfig } from '@checkbreaker/content';
import { rng } from '../src/rng';
import { isAttacked } from '../src/movegen';
import type {
  BoardPiece, Color, EngineConfig, PieceType, Rarity, RunState, Square, StageState,
} from '../src/types';

export const config: EngineConfig = loadEngineConfig();

export function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

const LETTERS: Record<string, PieceType> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};

/** Gives each Stage Piece (no instanceId) a stageId s01, s02, ... in square-index order (a1 first). */
export function assignStageIds(board: Record<Square, BoardPiece>): void {
  const index = (sq: Square): number => 'abcdefgh'.indexOf(sq[0]!) + 8 * (Number(sq[1]) - 1);
  let n = 0;
  for (const sq of Object.keys(board).sort((a, b) => index(a) - index(b))) {
    const piece = board[sq]!;
    if (piece.instanceId === undefined) piece.stageId = `s${String(++n).padStart(2, '0')}`;
  }
}

export function stageOf(
  pieces: Record<Square, string>,
  overrides: Partial<StageState> = {},
): StageState {
  const board: Record<Square, BoardPiece> = {};
  for (const [sq, letter] of Object.entries(pieces)) {
    const pieceType = LETTERS[letter.toLowerCase()];
    if (!pieceType) throw new Error(`stageOf: unknown piece letter '${letter}' on ${sq}`);
    if (letter === letter.toLowerCase()) {
      board[sq] = { pieceType, color: 'black' };
    } else if (pieceType === 'pawn') {
      board[sq] = {
        pieceType, color: 'white', spawned: true, rarity: 'normal',
        promotesTo: { pieceType: 'knight', rarity: 'normal' },
      };
    } else {
      board[sq] = { pieceType, color: 'white', instanceId: `p_${pieceType}_${sq}` };
    }
  }
  assignStageIds(board);
  return deepFreeze({
    stageSeed: '9C41-0B77',
    templateId: 'tpl-act1-open-field',
    playerColor: 'white',
    phase: 'action',
    board,
    turnsUsed: 0,
    turnLimit: 8,
    focus: 3,
    focusPool: 3,
    moveCredits: 1,
    spawnPoints: 9,
    modifiers: [],
    skillLog: [],
    enemyPolicy: { type: 'best_move', depth: 2 },
    status: 'active',
    ...overrides,
  } as StageState);
}

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

export function runOf(overrides: Partial<RunState> = {}): RunState {
  const mk = (id: string, pieceType: 'knight' | 'bishop') => ({
    instanceId: id, pieceType, rarity: 'normal' as const, durability: 2, durabilityMax: 2,
    origin: 'starter' as const, acquiredAtStage: 0, status: 'in_deck' as const,
  });
  return deepFreeze({
    version: 1,
    seed: '7F3A-2210',
    actIndex: 0,
    stageIndex: 0,
    coins: 0,
    deckCapacity: 8,
    deck: [
      {
        instanceId: 'p_king_01', pieceType: 'king', rarity: null, durability: null,
        durabilityMax: null, origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
      },
      mk('p_knight_02', 'knight'), mk('p_knight_03', 'knight'),
      mk('p_bishop_04', 'bishop'), mk('p_bishop_05', 'bishop'),
    ],
    loadout: [],
    history: [],
    rngCursor: 0,
    status: 'in_progress',
    ...overrides,
  } as RunState);
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

/** Sparse boards like real stages, Black to move: the enemy-search benchmark positions. */
export const GAME_FENS: string[] = [
  '4k3/ppp2pp1/2n5/8/2P5/5P2/8/RB2K3 b - - 0 1',
  '4k3/pp3ppp/2n1b3/8/3P4/2P5/3N4/R2BK3 b - - 0 1',
  '6k1/5ppp/3n4/2b5/8/2P1P3/1B6/R3K2N b - - 0 1',
  'r5k1/1p3ppp/2n1b3/8/8/2P2P2/3N4/R1B1KQ2 b - - 0 1',
  '2r3k1/pp1b1ppp/2n5/8/4P3/2P2N2/1B6/R3K3 b - - 0 1',
];

/**
 * The rarity benchmark positions: each GAME_FEN with every White knight, bishop, rook and queen
 * (all Hero Pieces) at Rare, at Unique and at Legendary. Build one with `rarityStage`.
 */
export const RARITY_FENS: { fen: string; rarity: Exclude<Rarity, 'normal'> }[] = GAME_FENS.flatMap(
  (fen) => (['rare', 'unique', 'legendary'] as const).map((rarity) => ({ fen, rarity })),
);

/** `fenToStage(fen)` with the White knights, bishops, rooks and queens at `rarity`. */
export function rarityStage(fen: string, rarity: Rarity): StageState {
  const stage = fenToStage(fen);
  const board: Record<Square, BoardPiece> = {};
  for (const [sq, piece] of Object.entries(stage.board)) {
    const tiered = piece.color === 'white' && piece.instanceId !== undefined && piece.pieceType !== 'king';
    board[sq] = tiered ? { ...piece, rarity } : piece;
  }
  return deepFreeze({ ...stage, board });
}

export function fenToStage(fen: string, overrides: Partial<StageState> = {}): StageState {
  const placement = fen.split(' ')[0]!;
  const pieces: Record<Square, string> = {};
  placement.split('/').forEach((row, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else pieces[`${'abcdefgh'[file]}${rank}`] = ch, file++;
    }
  });
  return stageOf(pieces, overrides);
}

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
