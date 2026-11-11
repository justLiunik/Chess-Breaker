import type { BoardPiece, EnemyPolicy, Square, StageState } from '@checkbreaker/engine';
import type { ActKey, GenConfig, Template } from '@checkbreaker/content';

/** The Deployment-phase stage: the board holds only Stage Pieces; the player's King and summons come at Start. */
export function buildStage(
  tpl: Template,
  board: Record<Square, BoardPiece>,
  act: ActKey,
  tier: 'normal' | 'boss',
  stageSeed: string,
  mateIn: number,
  config: GenConfig,
): StageState {
  const budget = config.rules.spawnPoints[act][tier];
  const focus = tpl.focusPool ?? config.rules.focusPool;
  const enemyPolicy: EnemyPolicy = { ...tpl.enemyPolicy };
  if (enemyPolicy.type === 'scripted') enemyPolicy.cursor = 0;
  return {
    stageSeed,
    templateId: tpl.id,
    playerColor: 'white',
    phase: 'deployment',
    board,
    turnsUsed: 0,
    mateIn,
    overtimePaid: 0,
    focus,
    focusPool: focus,
    moveCredits: config.rules.freeMovesPerTurn,
    spawnPoints: Math.min(tpl.spawnPoints ?? budget, budget),
    modifiers: [],
    skillLog: [],
    enemyPolicy,
    status: 'active',
  };
}
