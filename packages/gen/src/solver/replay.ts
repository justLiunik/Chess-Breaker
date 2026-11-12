import { commitQueue, startStage } from '@checkbreaker/engine';
import type { RunState, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import type { SolveResult } from '../types';

/**
 * §9.4: plays `win` through the engine's own `startStage` and `commitQueue`. True only when every
 * queue is accepted, the stage stays active until the last queue, and the last queue ends it in a
 * checkmate win on turn `win.mateTurn`, no later than `stage.mateIn`. Replay stops at `mateIn`
 * and the enemy clock does not read the wallet inside the par (spec §7.3), so a line that
 * replays here holds for any `run.coins`.
 */
export function replayLine(
  run: RunState,
  stage: StageState,
  win: NonNullable<SolveResult['win']>,
  config: GenConfig,
): boolean {
  if (win.line.length === 0 || win.line.length !== win.mateTurn || win.mateTurn > stage.mateIn) return false;
  const started = startStage(run, stage, win.placements, config);
  if (!started.ok) return false;
  let cur = started.value;
  for (let i = 0; i < win.line.length; i++) {
    if (cur.stage.status !== 'active') return false; // ended before the last queue
    const out = commitQueue(cur.run, cur.stage, win.line[i]!, config);
    if (!out.ok) return false;
    cur = out.value;
  }
  const s = cur.stage;
  return s.status === 'won' && s.endReason === 'checkmate' && s.turnsUsed === win.mateTurn && s.turnsUsed <= s.mateIn;
}
