import type {
  CommitError, EngineConfig, GameEvent, PieceInstance, Result, RunState, StageState,
} from './types';
import { lifelineDurability } from './abilities';

/**
 * After a won stage: deployed pieces return with their durability, spent ones are removed, a
 * lifeline-saved piece returns at its lifeline's `returnDurability` (spec §7.4; 1 in pieces.yaml). `overCapacity` counts non-King
 * pieces above the deck capacity; resolving it is the run layer's job.
 */
export function endStage(
  run: RunState,
  stage: StageState,
  config: EngineConfig,
): Result<{ run: RunState; events: GameEvent[]; overCapacity: number }, CommitError> {
  if (stage.status !== 'won') return { ok: false, error: { kind: 'stage_not_won', status: stage.status } };

  const events: GameEvent[] = [];
  const deck: PieceInstance[] = [];
  for (const p of run.deck) {
    if (p.status === 'spent') {
      events.push({ type: 'piece_removed', instanceId: p.instanceId, reason: 'spent' });
      continue;
    }
    if (p.status === 'deployed' || p.status === 'captured') {
      const durability = p.status === 'captured' ? lifelineDurability(p, config) : p.durability;
      events.push({ type: 'piece_returned', instanceId: p.instanceId, durability });
      deck.push({ ...p, durability, status: 'in_deck' });
      continue;
    }
    deck.push(p);
  }
  const overCapacity = Math.max(0, deck.filter((p) => p.pieceType !== 'king').length - config.deck.capacity);
  return { ok: true, value: { run: { ...run, deck }, events, overCapacity } };
}
