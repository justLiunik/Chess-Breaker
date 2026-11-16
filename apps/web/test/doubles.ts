import { expectedSeed } from '@checkbreaker/run';
import type { GenRequest } from '@checkbreaker/run';
import type { Action, BoardPiece, PieceType, Square, StageState } from '@checkbreaker/engine';
import type { StageSource } from '../src/state/stageSource';

const LETTERS: Record<string, PieceType> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/** A Deployment-phase stage in the style of packages/run/test/fixtures.ts: lowercase = Black, uppercase = White Stage Pieces. */
function deploymentStage(pieces: Record<Square, string>, overrides: Partial<StageState> = {}): StageState {
  const board: Record<Square, BoardPiece> = {};
  for (const [sq, letter] of Object.entries(pieces)) {
    const pieceType = LETTERS[letter.toLowerCase()]!;
    board[sq] = letter === letter.toLowerCase()
      ? { pieceType, color: 'black' }
      : { pieceType, color: 'white', spawned: true, rarity: 'normal', promotesTo: { pieceType: 'knight', rarity: 'normal' } };
  }
  const index = (sq: Square): number => 'abcdefgh'.indexOf(sq[0]!) + 8 * (Number(sq[1]) - 1);
  let n = 0;
  for (const sq of Object.keys(board).sort((a, b) => index(a) - index(b))) board[sq]!.stageId = `s${String(++n).padStart(2, '0')}`;
  return {
    stageSeed: '9C41-0B77', templateId: 'tpl-act1-open-field', playerColor: 'white', phase: 'deployment', board,
    turnsUsed: 0, mateIn: 1, overtimePaid: 0, focus: 3, focusPool: 3, moveCredits: 1, spawnPoints: 9,
    modifiers: [], skillLog: [], enemyPolicy: { type: 'best_move', depth: 2 }, status: 'active', ...overrides,
  } as StageState;
}

/**
 * Black king h8, pawn h7, bishop g8 (light-squared: it can never block the a1-h8 diagonal). The starter
 * deck's King (p_king_01) deploys on e1 and its first bishop (p_bishop_04) on a3; Ba3-b2 is mate.
 */
export const STARTER_MATE: { placements: { instanceId: string; to: Square }[]; move: Action } = {
  placements: [
    { instanceId: 'p_king_01', to: 'e1' },
    { instanceId: 'p_bishop_04', to: 'a3' },
  ],
  move: { type: 'MOVE', from: 'a3', to: 'b2' },
};

export function starterMateStage(seed: string): StageState {
  return deploymentStage({ h8: 'k', h7: 'p', g8: 'b' }, {
    stageSeed: seed, mateIn: 1, enemyPolicy: { type: 'scripted', line: ['h7h6'], fallbackDepth: 1 },
  });
}

/** Resolves on a microtask with a hand-made stage carrying the seed the request expects. */
export function testStageSource(): StageSource {
  return {
    request(id: number, req: GenRequest) {
      const seed = expectedSeed(req.run.seed, req.actIndex, req.stageIndex);
      // Stage 0 is the mate-in-one the starter deck can deliver; later stages are a small legal position.
      const stage = req.actIndex === 0 && req.stageIndex === 0
        ? starterMateStage(seed)
        : deploymentStage({ h8: 'k', g7: 'p', h7: 'p' }, {
          stageSeed: seed, mateIn: 4, enemyPolicy: { type: 'scripted', line: ['h7h6'], fallbackDepth: 1 },
        });
      return Promise.resolve({ id, ok: true as const, stage, ms: 0 });
    },
  };
}
