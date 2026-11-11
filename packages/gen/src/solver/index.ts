import type { RunState, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import type { SolveResult } from '../types';

/** Phase D replaces this stub with the real solver. */
export function solveStage(_run: RunState, _stage: StageState, _config: GenConfig): SolveResult {
  return { win: null, stats: { screenNodes: 0, deepNodes: 0, deployments: 0, enemyCalls: 0, memoHits: 0 } };
}
