import { hash } from '@checkbreaker/engine';
import type { StageState } from '@checkbreaker/engine';
import type { ActKey, GenConfig } from '@checkbreaker/content';
import { enemyBoard } from './board';
import { checkPreconditions } from './preconditions';
import { selectTemplates } from './select';
import { solveStage } from './solver';
import { bonusPawnSquares, drawPar, makeBonusPawn, nextStageNumber, placeSpawnedPawns, stageId } from './spawn';
import { buildStage } from './stage';
import type { GenContent, GenInput, Provenance, SolveResult } from './types';

export type SolveFn = (run: GenInput['run'], stage: StageState, config: GenConfig) => SolveResult;

type Built = { stage: StageState; formationId: string | null; mirrored: boolean };

/** G0-G8: the stage for (run, act, stage index), with `solve` proving at most `maxBoards` candidate boards. */
export function generateWith(
  input: GenInput,
  content: GenContent,
  config: GenConfig,
  solve: SolveFn,
): { stage: StageState; provenance: Provenance } {
  const { run, actIndex, stageIndex, previousTemplateId } = input;
  // G0. The 32-bit hash as XXXX-XXXX, the seed format schemas/stage.schema.json requires.
  const h = hash(run.seed, actIndex, stageIndex).toString(16).toUpperCase().padStart(8, '0');
  const stageSeed = `${h.slice(0, 4)}-${h.slice(4)}`;
  const tier = stageIndex === 2 ? 'boss' : 'normal';
  const act = `act${actIndex + 1}` as ActKey;
  const { maxRegenerations, maxBoards } = config.gen;
  let attempts = 0;
  let solverNodes = 0;
  let last: (Built & { tpl: GenContent['templates'][number] }) | null = null;

  const emit = (
    b: Built,
    extra: { proven: boolean; bonusPawn: boolean; validationFailed?: true },
  ): { stage: StageState; provenance: Provenance } => {
    const templateId = b.stage.templateId;
    const stage: StageState = {
      ...b.stage,
      provenance: { templateId, seed: stageSeed, attempts, ...(extra.validationFailed ? { validationFailed: true } : {}) },
    };
    const provenance: Provenance = {
      templateId,
      seed: stageSeed,
      formationId: b.formationId,
      mirrored: b.mirrored,
      attempts,
      proven: extra.proven,
      bonusPawn: extra.bonusPawn,
      solverNodes,
      ...(extra.validationFailed ? { validationFailed: true as const } : {}),
    };
    return { stage, provenance };
  };

  for (const tpl of selectTemplates(content.templates, (actIndex + 1) as 1 | 2 | 3, tier, stageSeed, previousTemplateId)) {
    // G1
    const mateIn = drawPar(tpl, stageSeed); // G3, once per stage
    const passed: Built[] = [];
    for (let a = 0; a < maxRegenerations && passed.length < maxBoards; a++) {
      attempts++;
      const enemy = enemyBoard(tpl, content.formations[tpl.id] ?? [], stageSeed, a, config); // G2
      if (!enemy) continue;
      const board = placeSpawnedPawns(enemy.board, tpl, stageSeed, a, config); // G4
      const built: Built = {
        stage: buildStage(tpl, board ?? enemy.board, act, tier, stageSeed, mateIn, config),
        formationId: enemy.formationId,
        mirrored: enemy.mirrored,
      };
      last = { ...built, tpl };
      if (!board) continue;
      if (checkPreconditions(run, built.stage, tpl, { extraPawns: 0 }, config) === null) passed.push(built); // G5
    }
    if (passed.length === 0) continue; // next template
    for (const b of passed) {
      // G6
      const r = solve(run, b.stage, config);
      solverNodes += r.stats.screenNodes + r.stats.deepNodes;
      if (r.win) return emit(b, { proven: true, bonusPawn: false });
    }
    // G7
    const first = passed[0]!;
    for (const sq of bonusPawnSquares(first.stage.board, tpl, stageSeed)) {
      const pawn = { ...makeBonusPawn(sq, act, stageSeed, config), stageId: stageId(nextStageNumber(first.stage.board)) };
      const stage = { ...first.stage, board: { ...first.stage.board, [sq]: pawn } };
      if (checkPreconditions(run, stage, tpl, { extraPawns: 1 }, config) === null) {
        return emit({ ...first, stage }, { proven: false, bonusPawn: true });
      }
    }
    return emit(first, { proven: false, bonusPawn: false });
  }
  if (!last) throw new Error(`no enemy board for act ${actIndex + 1} ${tier}`);
  return emit(last, { proven: false, bonusPawn: false, validationFailed: true }); // all templates failed G5
}

export function generateStage(
  input: GenInput,
  content: GenContent,
  config: GenConfig,
): { stage: StageState; provenance: Provenance } {
  return generateWith(input, content, config, solveStage);
}
