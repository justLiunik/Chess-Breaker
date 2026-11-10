import type {
  Action, Award, CommitError, EngineConfig, GameEvent, Result, RunState, StageState,
} from './types';
import { inCheck, legalMoves } from './legality';
import { hasLegalQueue } from './legal-queue';
import { enemyMove } from './enemy/policy';
import { hash } from './rng';
import { KING, fromBoard, tiersOf } from './position';
import { toSquare } from './square';
import { resolveQueue } from './queue';
import { frozenMask } from './skills/registry';

export function simulate(
  run: RunState,
  stage: StageState,
  queue: Action[],
  config: EngineConfig,
): Result<{ run: RunState; stage: StageState; events: GameEvent[]; award: Award | null }, CommitError> {
  const resolved = resolveQueue(run, stage, queue, config);
  if (!resolved.ok) return resolved;
  const events = [...resolved.value.events];
  let nextRun = resolved.value.run;
  let next: StageState = resolved.value.stage;

  // R3: evaluate Black's position, with suppressed pieces unable to move, against White's abilities.
  const b = fromBoard(next.board);
  const tiers = { t: tiersOf(next.board), table: config.abilities };
  const checked = inCheck(b, 'black', tiers);
  let award: Award | null = null;
  if (legalMoves(b, 'black', frozenMask(next), tiers).length === 0) {
    if (checked) {
      next = { ...next, status: 'won', endReason: 'checkmate' };
    } else {
      next = { ...next, status: 'lost', endReason: 'enemy_stalemated' };
    }
  } else if (checked) {
    events.push({ type: 'check', king: 'black', square: toSquare(b.indexOf(-KING)) });
  }

  // R4: the turn is spent.
  next = { ...next, turnsUsed: next.turnsUsed + 1 };
  if (next.status === 'active' && next.turnsUsed >= next.turnLimit) {
    next = { ...next, status: 'lost', endReason: 'out_of_turns' };
  }

  if (next.status === 'won') {
    const act = `act${run.actIndex + 1}` as 'act1' | 'act2' | 'act3';
    const { baseReward, coinRate } = config.economy;
    const base = Math.round(baseReward[act] * (run.stageIndex === 2 ? baseReward.bossMultiplier : 1));
    const turnBonus = (next.turnLimit - next.turnsUsed) * coinRate[act];
    award = { coins: base + turnBonus, base, turnBonus };
    nextRun = { ...nextRun, coins: nextRun.coins + award.coins };
    events.push({ type: 'stage_won', award });
  } else if (next.status === 'lost') {
    events.push({ type: 'stage_lost', endReason: next.endReason! });
  }

  return { ok: true, value: { run: nextRun, stage: next, events, award } };
}

const TIERS = ['normal', 'rare', 'unique', 'legendary'] as const;

/** An enemy capture of a Hero Piece: the instance leaves the deck, unless a lifeline saves it (docs/06). */
function loseInstance(
  run: RunState,
  instanceId: string,
  config: EngineConfig,
): { run: RunState; saved: boolean } {
  const inst = run.deck.find((i) => i.instanceId === instanceId);
  if (!inst) return { run, saved: false };
  if (
    inst.pieceType !== 'king' && inst.rarity !== null
    && config.abilities[inst.pieceType][TIERS.indexOf(inst.rarity)]!.lifeline
    && !inst.usedOnce?.includes('lifeline')
  ) {
    const deck = run.deck.map((i) => (i.instanceId === instanceId
      ? { ...i, status: 'captured' as const, usedOnce: [...(i.usedOnce ?? []), 'lifeline' as const] }
      : i));
    return { run: { ...run, deck }, saved: true };
  }
  return { run: { ...run, deck: run.deck.filter((i) => i.instanceId !== instanceId) }, saved: false };
}

/**
 * `simulate` (Resolve to R4) followed by the enemy's reply (R5), the expiry of next_enemy_turn
 * modifiers, and the start of the next turn. A stage that `simulate` already ended gets no reply.
 */
export function commitQueue(
  run: RunState,
  stage: StageState,
  queue: Action[],
  config: EngineConfig,
): Result<{ run: RunState; stage: StageState; events: GameEvent[]; award: Award | null }, CommitError> {
  const sim = simulate(run, stage, queue, config);
  if (!sim.ok || sim.value.stage.status !== 'active') return sim;

  const events = [...sim.value.events];
  let next: StageState = sim.value.stage;
  let nextRun = sim.value.run;

  // R5: the enemy replies; suppressed pieces do not move.
  const picked = enemyMove(next, hash(next.stageSeed, next.turnsUsed), config);
  if (picked.policy.fellBack && !next.enemyPolicy.fellBack) {
    events.push({ type: 'enemy_fell_back', cursor: picked.policy.cursor ?? 0 });
  }
  const mover = picked.move ? next.board[picked.move.from] : undefined;
  if (picked.move && mover) {
    const { from, to } = picked.move;
    const board = { ...next.board };
    delete board[from];
    events.push({ type: 'enemy_move', from, to });
    const taken = board[to];
    if (taken) {
      events.push({
        type: 'capture', square: to, pieceType: taken.pieceType, color: taken.color, salvage: 0,
        ...(taken.instanceId !== undefined && { instanceId: taken.instanceId }),
        ...(taken.stageId !== undefined && { stageId: taken.stageId }),
      });
      if (taken.instanceId !== undefined) {
        const lost = loseInstance(nextRun, taken.instanceId, config);
        nextRun = lost.run;
        if (lost.saved) events.push({ type: 'lifeline_saved', instanceId: taken.instanceId });
      }
    }
    if (mover.pieceType === 'pawn' && to.endsWith('1')) {
      board[to] = { ...mover, pieceType: 'queen' };
      events.push({ type: 'enemy_promoted', square: to });
    } else {
      board[to] = mover;
    }
    next = { ...next, board };
  }
  // After R5: next_enemy_turn modifiers expire.
  const expired = next.modifiers.filter((m) => m.duration === 'next_enemy_turn');
  for (const m of expired) events.push({ type: 'modifier_expired', modifierId: m.modifierId });
  next = {
    ...next,
    modifiers: expired.length === 0 ? next.modifiers : next.modifiers.filter((m) => m.duration !== 'next_enemy_turn'),
    enemyPolicy: picked.policy,
    moveCredits: config.rules.freeMovesPerTurn,
    focus: next.focusPool,
  };
  events.push({ type: 'turn_started', turn: next.turnsUsed + 1 });

  const b = fromBoard(next.board);
  const checked = inCheck(b, 'white');
  if (checked) events.push({ type: 'check', king: 'white', square: toSquare(b.indexOf(KING)) });
  if (!hasLegalQueue(nextRun, next, config)) {
    const endReason = checked ? 'player_mated' : 'player_stalemated';
    next = { ...next, status: 'lost', endReason };
    events.push({ type: 'stage_lost', endReason });
  }
  return { ok: true, value: { run: nextRun, stage: next, events, award: null } };
}
