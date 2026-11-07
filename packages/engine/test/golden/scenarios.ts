import type { Action, RunState, StageState } from '../../src/types';
import { runOf, stageOf } from '../helpers';

export interface Scenario { name: string; run: RunState; stage: StageState; queue: Action[] }

const mv = (from: string, to: string): Action => ({ type: 'MOVE', from, to });
const script = (line: string[]) => ({ type: 'scripted' as const, line, fallbackDepth: 1 });
const d1 = { type: 'best_move' as const, depth: 1 };
const run = runOf();

// Back-rank mate: Ra1-a8# against Kh8 with pawns g7, h7.
const mateBoard = { e1: 'K', a1: 'R', h8: 'k', g7: 'p', h7: 'p' };
// tpl-act1-first-steps: the fixed enemy.
const firstSteps = { e8: 'k', a7: 'p', b7: 'p', c7: 'p', f7: 'p', g7: 'p', c6: 'n' };
const firstStepsLine = ['c6e5', 'e5c4', 'c4b6'];

export const scenarios: Scenario[] = [
  // --- errors (9) ---
  { name: 'err king_in_check_at_end', run, queue: [mv('g1', 'h1')],
    stage: stageOf({ g1: 'K', h8: 'r', a8: 'k' }) },
  { name: 'err credits_exceeded', run, queue: [mv('a1', 'a2'), mv('a2', 'a3')],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k' }) },
  { name: 'err illegal_move no_piece', run, queue: [mv('c3', 'c4')],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k' }) },
  { name: 'err illegal_move king_square', run, queue: [mv('h1', 'h8')],
    stage: stageOf({ e1: 'K', h1: 'R', h8: 'k' }) },
  { name: 'err empty_queue', run, queue: [],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k' }) },
  { name: 'err stage_not_active', run, queue: [mv('a1', 'a2')],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { status: 'won', endReason: 'checkmate' }) },
  { name: 'err wrong_phase', run, queue: [mv('a1', 'a2')],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { phase: 'deployment' }) },
  { name: 'err unsupported_action', run, queue: [mv('a1', 'a2'), { type: 'ACTIVATE_SKILL', skillId: 'sk_x' }],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k' }) },
  { name: 'err invariant_violation without a White king', run, queue: [mv('a1', 'a2')],
    stage: stageOf({ a1: 'R', e8: 'k' }) },

  // --- outcomes (21) ---
  { name: 'deferred check through an attacked square', run, queue: [mv('g1', 'h1'), mv('h1', 'g1')],
    stage: stageOf({ g1: 'K', h8: 'r', a8: 'k' }, { moveCredits: 2, enemyPolicy: d1 }) },
  { name: 'vanishing check', run, queue: [mv('b1', 'b8'), mv('b8', 'b1')],
    stage: stageOf({ e1: 'K', b1: 'R', h8: 'k' }, { moveCredits: 2, enemyPolicy: d1 }) },
  { name: 'capture with salvage', run, queue: [mv('a1', 'a7')],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k', a7: 'n' }, { enemyPolicy: d1 }) },
  { name: 'two captures (credits 2)', run, queue: [mv('a1', 'a7'), mv('a7', 'b7')],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k', a7: 'n', b7: 'r' }, { moveCredits: 2, enemyPolicy: d1 }) },
  { name: 'pawn promotion removal', run, queue: [mv('a7', 'a8')],
    stage: stageOf({ e1: 'K', a7: 'P', e8: 'k' }, { enemyPolicy: d1 }) },
  { name: 'checkmate win Act I', run, queue: [mv('a1', 'a8')],
    stage: stageOf(mateBoard, { turnsUsed: 1 }) },
  { name: 'checkmate win Act I boss', run: runOf({ stageIndex: 2 }), queue: [mv('a1', 'a8')],
    stage: stageOf(mateBoard, { turnsUsed: 6, turnLimit: 7 }) },
  { name: 'checkmate win Act II', run: runOf({ actIndex: 1 }), queue: [mv('a1', 'a8')],
    stage: stageOf(mateBoard, { turnLimit: 6 }) },
  { name: 'enemy stalemated', run, queue: [mv('b6', 'a7')],
    stage: stageOf({ e1: 'K', b6: 'B', f7: 'Q', h8: 'k', a7: 'p' }) },
  { name: 'out of turns', run, queue: [mv('h1', 'h2')],
    stage: stageOf({ e1: 'K', h1: 'R', a8: 'k' }, { turnsUsed: 7, turnLimit: 8 }) },
  { name: 'player mated after R5', run, queue: [mv('h1', 'g1')],
    stage: stageOf({ h1: 'K', b2: 'r', a8: 'r', e8: 'k' }, { enemyPolicy: script(['a8a1']) }) },
  { name: 'player stalemated after R5', run, queue: [mv('h2', 'h1')],
    stage: stageOf({ h2: 'K', g8: 'q', e8: 'k' }, { enemyPolicy: script(['g8g3']) }) },
  { name: 'enemy captures a White piece', run, queue: [mv('a1', 'a3')],
    stage: stageOf({ e1: 'K', a1: 'R', a8: 'r', e8: 'k' }, { enemyPolicy: script(['a8a3']) }) },
  { name: 'enemy pawn promotion', run, queue: [mv('g3', 'g4')],
    stage: stageOf({ g3: 'K', b2: 'p', e8: 'k' }, { enemyPolicy: script(['b2b1']) }) },
  { name: 'scripted move played', run, queue: [mv('a1', 'a2')],
    stage: stageOf({ e1: 'K', a1: 'R', ...firstSteps }, { enemyPolicy: script(firstStepsLine) }) },
  { name: 'scripted fallback (illegal)', run, queue: [mv('a1', 'a2')],
    stage: stageOf({ e1: 'K', a1: 'R', ...firstSteps }, { enemyPolicy: script(['c6c7', 'e5c4']) }) },
  { name: 'scripted fallback (exhausted)', run, queue: [mv('a1', 'a2')],
    stage: stageOf({ e1: 'K', a1: 'R', ...firstSteps }, {
      enemyPolicy: { ...script(firstStepsLine), cursor: 3 },
    }) },
  { name: 'check event on Black', run, queue: [mv('a1', 'a8')],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { enemyPolicy: d1 }) },
  { name: 'check event on White after R5', run, queue: [mv('h1', 'h2')],
    stage: stageOf({ f1: 'K', h1: 'R', a8: 'r', g8: 'k' }, { enemyPolicy: script(['a8f8']) }) },
  { name: 'quiet turn', run, queue: [mv('a1', 'a2')],
    stage: stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { enemyPolicy: d1 }) },
  { name: 'mate on the final turn (base only)', run, queue: [mv('a1', 'a8')],
    stage: stageOf(mateBoard, { turnsUsed: 7, turnLimit: 8 }) },
];
