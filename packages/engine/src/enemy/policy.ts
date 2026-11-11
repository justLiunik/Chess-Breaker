import type { EngineConfig, EnemyPolicy, Square, StageState } from '../types';
import { fromBoard, tiersOf } from '../position';
import { hasTiers } from '../abilities';
import { legalMoves } from '../legality';
import { frozenMask } from '../skills/registry';
import { isSquare, toIndex, toSquare } from '../square';
import { scoreRootMoves } from './search';
import { MAX_CLOCK } from './zobrist';

export type EnemyPick = { move: { from: Square; to: Square } | null; policy: EnemyPolicy };

function searchMove(
  b: Int8Array, t: Int8Array, frozen: Uint8Array, seed: number, clock: number, depth: number,
  policy: EnemyPolicy, config: EngineConfig,
): EnemyPick {
  // Rarity abilities enlarge the tree: while any player piece has a tier, the depth is capped.
  const capped = hasTiers(t) ? Math.min(depth, config.enemyAI.search.maxDepthWithRarity) : depth;
  const scored = scoreRootMoves(b, Math.min(clock, MAX_CLOCK), capped, config, frozen, t);
  let best = -Infinity;
  for (const r of scored) if (r.score > best) best = r.score;
  const tied = scored.filter((r) => r.score === best);
  const m = tied[(seed >>> 0) % tied.length]!.move;
  return { move: { from: toSquare(m.from), to: toSquare(m.to) }, policy };
}

/**
 * The enemy's move for this stage. Never mutates `stage`; returns the updated policy: a scripted
 * line advances `cursor`, and a line that cannot be played falls back to search for good. Pieces
 * under a live `suppress_piece` modifier do not move; `clock` is the player's turns left (`enemyClock`); a scripted move by one is unplayable (Ruling R7).
 */
export function enemyMove(stage: StageState, seed: number, clock: number, config: EngineConfig): EnemyPick {
  const policy = stage.enemyPolicy;
  const b = fromBoard(stage.board);
  const t = tiersOf(stage.board);
  const frozen = frozenMask(stage);
  const legal = legalMoves(b, 'black', frozen, { t, table: config.abilities });
  if (legal.length === 0) return { move: null, policy: { ...policy } };
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
        if (legal.some((m) => m.from === fi && m.to === ti)) {
          return { move: { from, to }, policy: { ...policy, cursor: cursor + 1 } };
        }
      }
    }
    const next: EnemyPolicy = { ...policy, fellBack: true, cursor };
    return searchMove(b, t, frozen, seed, clock, policy.fallbackDepth ?? fallbackDepth, next, config);
  }

  const depth = policy.type === 'scripted'
    ? (policy.fallbackDepth ?? fallbackDepth)
    : (policy.depth ?? fallbackDepth);
  return searchMove(b, t, frozen, seed, clock, depth, { ...policy }, config);
}
