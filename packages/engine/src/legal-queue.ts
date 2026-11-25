import type { Action, EngineConfig, RunState, StageState } from './types';
import type { Resolving } from './queue';
import { beginQueue, freeBonus, queueAccepted, resolveStep } from './queue';
import { legalPlayerMoves } from './legality';
import { WHITE_PROMOTIONS } from './movegen';
import { QUEUE_NEUTRAL } from './skills/registry';

/**
 * Whether the player has a legal queue (spec §8.4): some set of distinct usable skills, each with a
 * target, followed by up to the resulting credits in moves (plus Legendary-knight bonus moves), that
 * `resolveQueue` accepts. Candidates (skill targets of the right colour, `legalPlayerMoves`) are
 * resolved by the queue's own steps (`resolveStep`) and judged by `queueAccepted`, so "legal" means
 * exactly what commit means; a shared prefix is resolved once. A pawn reaching rank 8 is tried with
 * each promotion choice. Stops at the first success.
 *
 * Three reductions keep it exact:
 * - A skill made only of `QUEUE_NEUTRAL` primitives is never tried: it only spends Focus and its
 *   loadout entry, so any queue legal with it is legal without it.
 * - Each distinct skill id is tried at most once, however many copies the loadout holds: every
 *   implemented skill is `once_per_turn`, so a second copy can never act in the same turn.
 * - Each set of skills is tried once, in loadout order, not in every order. With the implemented
 *   primitives a skill's checks (in the loadout, `once_per_turn`, Focus, its target's colour, type
 *   and rarity) do not depend on which other skills came first: no primitive moves a piece, grants
 *   Focus or changes a piece's own type and rarity, and Focus costs add up the same in any order.
 * Skills before moves is complete for them (spec §8.4): a credit must be granted before the move it
 * pays for, and a transform must precede its piece's moves. The brute-force test in
 * `legal-queue.test.ts` checks both claims against every interleaving.
 */
export function hasLegalQueue(run: RunState, stage: StageState, config: EngineConfig): boolean {
  const begun = beginQueue(run, stage);
  if (!begun.ok) return false;
  const skillIds = [...new Set(run.loadout.map((l) => l.skillId))].filter((id) => {
    const def = config.skills[id];
    return def?.status === 'mvp' && def.effects.some((e) => !QUEUE_NEUTRAL.has(e.primitive));
  });
  const squares = Object.keys(stage.board);

  /** Whether some MOVE after the queue `r`, then perhaps more, ends in a queue commit accepts. */
  const movesFrom = (r: Resolving): boolean => {
    const { board } = r.ctx;
    const here = { ...stage, board };
    for (const from of Object.keys(board)) {
      const piece = board[from]!;
      if (piece.color !== 'white') continue;
      if (r.ctx.moveCredits < 1 && !freeBonus(r.ledger, piece, config)) continue;
      const promotes = (piece.transformed?.pieceType ?? piece.pieceType) === 'pawn';
      for (const to of legalPlayerMoves(here, from, config)) {
        const actions: Action[] = promotes && to.endsWith('8')
          ? WHITE_PROMOTIONS.map((promotion) => ({ type: 'MOVE', from, to, promotion }))
          : [{ type: 'MOVE', from, to }];
        for (const action of actions) {
          const next = resolveStep(r, action, config);
          if (!next.ok) continue;
          if (queueAccepted(next.value, config)) return true;
          const more = next.value.ctx.moveCredits >= 1 || [...next.value.ledger.values()].includes('earned');
          if (more && movesFrom(next.value)) return true;
        }
      }
    }
    return false;
  };

  /** Tries the moves after the skills queued in `r`, then each larger set adding skills from `first` on. */
  const skillsFrom = (r: Resolving, first: number): boolean => {
    if (movesFrom(r)) return true;
    for (let i = first; i < skillIds.length; i++) {
      const skillId = skillIds[i]!;
      const kind = config.skills[skillId]!.target.kind;
      const color = kind === 'own_piece' ? 'white' : kind === 'enemy_piece' ? 'black' : null;
      const targets = kind === 'none' ? [undefined] : squares.filter((sq) => color === null || r.ctx.board[sq]?.color === color);
      for (const target of targets) {
        const next = resolveStep(r, { type: 'ACTIVATE_SKILL', skillId, ...(target !== undefined && { target }) }, config);
        if (next.ok && skillsFrom(next.value, i + 1)) return true;
      }
    }
    return false;
  };

  return skillsFrom(begun.value, 0);
}
