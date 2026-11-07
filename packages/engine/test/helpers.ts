import { loadEngineConfig } from '@checkbreaker/content';
import type {
  BoardPiece, EngineConfig, PieceType, RunState, Square, StageState,
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
    summonLimit: 3,
    deploymentRanks: [1, 2],
    modifiers: [],
    enemyPolicy: { type: 'best_move', depth: 2 },
    status: 'active',
    ...overrides,
  } as StageState);
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
