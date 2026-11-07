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
