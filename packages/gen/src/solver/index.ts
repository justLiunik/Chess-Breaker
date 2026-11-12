import { startStage } from '@checkbreaker/engine';
import type { RunState, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import type { Placement, SolveResult } from '../types';
import { deploymentCandidates } from './deployment';
import { byText, newSearch, runBeam } from './beam';
import type { BeamState } from './beam';
import { replayLine } from './replay';

/** A deployment's text, for tie-breaks: `instanceId@square` per placement, in order, joined by `,`. */
const deploymentText = (placements: Placement[]): string => placements.map((p) => `${p.instanceId}@${p.to}`).join(',');

/**
 * §9.3-9.4: a deployment and a line of queues that mate within `stage.mateIn` turns and on turn
 * `minSolveTurns` or later, against the enemy `commitQueue` plays; `win: null` if none is found
 * within `nodeBudget` nodes (one node = one enemy reply needed, computed or memoized).
 *
 * Stage 1 screens every deployment candidate, in order, with a beam of `screen.width` for
 * `min(screen.turns, mateIn)` turns; a candidate ranks by the best score its beam kept. Stage 2 runs
 * the top `deep.candidates` (score descending, then deployment text) with a beam of `deep.width` to
 * `mateIn` turns. The first win ends the solve. Both stages share the budget and the reply memo,
 * so the result depends only on the run, the stage and the config.
 */
export function solveStage(run: RunState, stage: StageState, config: GenConfig): SolveResult {
  const { minSolveTurns, screen, deep } = config.gen.solver;
  const search = newSearch(config);
  const done = (win: SolveResult['win']): SolveResult => {
    // Replay before trusting a win: a line the engine does not confirm is a solver bug, reported as "not found".
    if (win !== null && !replayLine(run, stage, win, config)) {
      search.stats.replayFailures++;
      return { win: null, stats: { ...search.stats } };
    }
    return { win, stats: { ...search.stats } };
  };
  if (stage.mateIn < minSolveTurns) return done(null);

  // Stage 1: screening.
  const ranked: { placements: Placement[]; start: BeamState; text: string; score: number }[] = [];
  for (const placements of deploymentCandidates(run, stage, config)) {
    const started = startStage(run, stage, placements, config);
    if (!started.ok) {
      // deploymentCandidates keeps only what startStage accepts: a refusal is an engine or candidate bug.
      throw new Error(`startStage refused a deployment candidate: ${JSON.stringify(started.error)}`);
    }
    search.stats.deployments++;
    const { run: run0, stage: stage0 } = started.value;
    const start: BeamState = { run: run0, stage: stage0, line: [], text: '', score: -Infinity };
    const r = runBeam(search, start, Math.min(screen.turns, stage.mateIn), screen.width);
    if (r.kind === 'out_of_budget') return done(null);
    if (r.kind === 'win') return done({ placements, line: r.line, mateTurn: r.mateTurn });
    ranked.push({ placements, start, text: deploymentText(placements), score: r.best });
  }

  // Stage 2: deep search on the best candidates.
  ranked.sort((a, b) => b.score - a.score || byText(a.text, b.text));
  search.phase = 'deepNodes';
  for (const c of ranked.slice(0, deep.candidates)) {
    const r = runBeam(search, c.start, stage.mateIn, deep.width);
    if (r.kind === 'out_of_budget') return done(null);
    if (r.kind === 'win') return done({ placements: c.placements, line: r.line, mateTurn: r.mateTurn });
  }
  return done(null);
}
