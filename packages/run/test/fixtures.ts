import { loadRunConfig } from '@checkbreaker/content';
import type { BoardPiece, PieceType, RunState, Square, StageState } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';

export const runConfig: RunConfig = loadRunConfig();

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

const LETTERS: Record<string, PieceType> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/** A Deployment-phase stage: lowercase = Black, uppercase = White Stage Pieces (pawns only); no Hero Pieces. */
function deploymentStage(pieces: Record<Square, string>, overrides: Partial<StageState> = {}): StageState {
  const board: Record<Square, BoardPiece> = {};
  for (const [sq, letter] of Object.entries(pieces)) {
    const pieceType = LETTERS[letter.toLowerCase()]!;
    board[sq] = letter === letter.toLowerCase()
      ? { pieceType, color: 'black' }
      : { pieceType, color: 'white', spawned: true, rarity: 'normal' };
  }
  const index = (sq: Square): number => 'abcdefgh'.indexOf(sq[0]!) + 8 * (Number(sq[1]) - 1);
  let n = 0;
  for (const sq of Object.keys(board).sort((a, b) => index(a) - index(b))) board[sq]!.stageId = `s${String(++n).padStart(2, '0')}`;
  return deepFreeze({
    stageSeed: '9C41-0B77', templateId: 'tpl-act1-open-field', playerColor: 'white', phase: 'deployment', board,
    turnsUsed: 0, mateIn: 4, overtimePaid: 0, focus: 3, focusPool: 3, moveCredits: 1, spawnPoints: 9,
    modifiers: [], skillLog: [], enemyPolicy: { type: 'best_move', depth: 2 }, status: 'active', ...overrides,
  } as StageState);
}

const inDeck = (id: string, pieceType: 'knight' | 'bishop' | 'rook' | 'queen') => ({
  instanceId: id, pieceType, rarity: 'normal' as const, durability: 2, durabilityMax: 2,
  origin: 'starter' as const, acquiredAtStage: 0, status: 'in_deck' as const,
});

/** The starter run: king, 2 knights, 2 bishops (all Normal), starter coins. */
export function starterRun(seed = '7F3A-2210'): RunState {
  const s = runConfig.run.starterDeck;
  const deck: RunState['deck'] = [{
    instanceId: 'p_king_01', pieceType: 'king', rarity: null, durability: null, durabilityMax: null,
    origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
  }];
  let n = 1;
  for (const t of ['knight', 'bishop', 'rook', 'queen'] as const) {
    for (let i = 0; i < s[t]; i++) deck.push(inDeck(`p_${t}_${String(++n).padStart(2, '0')}`, t));
  }
  return deepFreeze({
    version: 1, seed, actIndex: 0, stageIndex: 0, coins: runConfig.run.starterCoins, deckCapacity: 8, deck,
    loadout: [], history: [], rngCursor: 0, status: 'in_progress',
  } as RunState);
}

export const ROOK_ID = 'p_rook_90';

/** `run` plus a Normal rook (id ROOK_ID) in the deck. */
export function runWithRook(run: RunState): RunState {
  return deepFreeze({ ...run, deck: [...run.deck, inDeck(ROOK_ID, 'rook')] });
}

/** Deployment: Black king h8 with pawns g7/h7. King d1 + rook e1 deployed; Re1-e8 mates on turn 1. */
export function mateInOneStage(seed: string): StageState {
  return deploymentStage({ h8: 'k', g7: 'p', h7: 'p' }, {
    stageSeed: seed, enemyPolicy: { type: 'scripted', line: ['h7h6'], fallbackDepth: 1 },
  });
}

/** Deployment: the king alone d1/e1-ish loses to Black rooks a2 and b8 (b8-b1 mates after Kf1). */
export function losingStage(seed: string): StageState {
  return deploymentStage({ e8: 'k', a2: 'r', b8: 'r' }, {
    stageSeed: seed, mateIn: 1, enemyPolicy: { type: 'scripted', line: ['b8b1'], fallbackDepth: 1 },
  });
}

/**
 * Deployment: a spawned pawn on b7 promotes on turn 1 (b7-b8), then Re1-e8 mates on turn 2
 * (Black king h8, pawns g7/h7, a7 pawn whose only move a7a6 the scripted enemy plays).
 */
export function promotionOverflowStage(seed: string): StageState {
  return deploymentStage({ h8: 'k', g7: 'p', h7: 'p', a7: 'p', b7: 'P' }, {
    stageSeed: seed, enemyPolicy: { type: 'scripted', line: ['a7a6'], fallbackDepth: 1 },
  });
}

/**
 * Deployment: spawned pawns on b7 and c7 promote on turns 1 and 2 (b7-b8, c7-c8), then Re1-e8 mates on
 * turn 3 (Black king h8, pawns g7/h7, an a7 pawn the scripted enemy pushes a7-a6-a5).
 */
export function doublePromotionStage(seed: string): StageState {
  return deploymentStage({ h8: 'k', g7: 'p', h7: 'p', a7: 'p', b7: 'P', c7: 'P' }, {
    stageSeed: seed, enemyPolicy: { type: 'scripted', line: ['a7a6', 'a6a5'], fallbackDepth: 1 },
  });
}

export { deepFreeze };
