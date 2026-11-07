import type { EngineConfig, EnemyPolicy, Square, StageState } from '../types';
import { fromBoard } from '../position';
import { legalMoves } from '../legality';
import { isSquare, toIndex, toSquare } from '../square';
import { scoreRootMoves } from './search';

type Pick = { move: { from: Square; to: Square }; policy: EnemyPolicy };

function searchMove(
  stage: StageState, seed: number, depth: number, policy: EnemyPolicy, config: EngineConfig,
): Pick {
  const b = fromBoard(stage.board);
  const scored = scoreRootMoves(b, stage.turnLimit - stage.turnsUsed, depth, config);
  if (scored.length === 0) throw new Error('enemyMove: Black has no legal move');
  let best = -Infinity;
  for (const r of scored) if (r.score > best) best = r.score;
  const tied = scored.filter((r) => r.score === best);
  const m = tied[seed % tied.length]!.move;
  return { move: { from: toSquare(m.from), to: toSquare(m.to) }, policy };
}

/**
 * The enemy's move for this stage. Never mutates `stage`; returns the updated policy: a scripted
 * line advances `cursor`, and a line that cannot be played falls back to search for good.
 */
export function enemyMove(stage: StageState, seed: number, config: EngineConfig): Pick {
  const policy = stage.enemyPolicy;
  const fallbackDepth = config.enemyAI.search.defaultFallbackDepth;

  if (policy.type === 'scripted' && !policy.fellBack) {
    const cursor = policy.cursor ?? 0;
    const text = policy.line?.[cursor];
    if (text !== undefined) {
      const from = text.slice(0, 2);
      const to = text.slice(2, 4);
      if (text.length === 4 && isSquare(from) && isSquare(to)) {
        const fi = toIndex(from);
        const ti = toIndex(to);
        if (legalMoves(fromBoard(stage.board), 'black').some((m) => m.from === fi && m.to === ti)) {
          return { move: { from, to }, policy: { ...policy, cursor: cursor + 1 } };
        }
      }
    }
    const next: EnemyPolicy = { ...policy, fellBack: true, cursor };
    return searchMove(stage, seed, policy.fallbackDepth ?? fallbackDepth, next, config);
  }

  const depth = policy.type === 'scripted'
    ? (policy.fallbackDepth ?? fallbackDepth)
    : (policy.depth ?? fallbackDepth);
  return searchMove(stage, seed, depth, { ...policy }, config);
}
