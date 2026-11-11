import type {
  Action, Award, CommitError, EngineConfig, GameEvent, Result, RunState, StageState,
} from './types';
import { inCheck, legalMoves } from './legality';
import { hasLegalQueue } from './legal-queue';
import { enemyMove } from './enemy/policy';
import type { EnemyPick } from './enemy/policy';
import { hash } from './rng';
import { KING, fromBoard, tiersOf } from './position';
import { toSquare } from './square';
import { resolveQueue } from './queue';
import { frozenMask } from './skills/registry';
import { lifelineSaves } from './abilities';
import { enemyClock, pendingBase, stageEconomy } from './economy';

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

  if (next.status === 'won') {
    const { parBonusFull } = stageEconomy(run, config);
    const base = pendingBase(run, next, config);
    const parBonus = next.turnsUsed <= next.mateIn ? parBonusFull : 0;
    award = { coins: base + parBonus, base, parBonus };
    nextRun = { ...nextRun, coins: nextRun.coins + award.coins };
    events.push({ type: 'stage_won', award });
  } else if (next.status === 'lost') {
    events.push({ type: 'stage_lost', endReason: next.endReason! });
  }

  return { ok: true, value: { run: nextRun, stage: next, events, award } };
}

/**
 * An enemy capture of a Hero Piece: the instance leaves the deck, unless a lifeline saves it (docs/06).
 * A Hero Piece without a deck instance cannot have entered the board at Deployment (I15): refused.
 */
function loseInstance(
  run: RunState,
  instanceId: string,
  config: EngineConfig,
): Result<{ run: RunState; saved: boolean }, CommitError> {
  const inst = run.deck.find((i) => i.instanceId === instanceId);
  if (!inst) {
    return {
      ok: false,
      error: { kind: 'invariant_violation', invariant: 'I15', detail: `captured Hero Piece ${instanceId} has no deck instance` },
    };
  }
  if (lifelineSaves(inst, config)) {
    const deck = run.deck.map((i) => (i.instanceId === instanceId
      ? { ...i, status: 'captured' as const, usedOnce: [...(i.usedOnce ?? []), 'lifeline' as const] }
      : i));
    return { ok: true, value: { run: { ...run, deck }, saved: true } };
  }
  return { ok: true, value: { run: { ...run, deck: run.deck.filter((i) => i.instanceId !== instanceId) }, saved: false } };
}

/**
 * `simulate` (Resolve to R4) followed by the enemy's reply: `enemyMove` with the player's clock,
 * then `applyEnemyTurn`. A stage that `simulate` already ended gets no reply.
 */
export function commitQueue(
  run: RunState,
  stage: StageState,
  queue: Action[],
  config: EngineConfig,
): Result<{ run: RunState; stage: StageState; events: GameEvent[]; award: Award | null }, CommitError> {
  const sim = simulate(run, stage, queue, config);
  if (!sim.ok || sim.value.stage.status !== 'active') return sim;

  const { run: simRun, stage: next } = sim.value;
  const pick = enemyMove(next, hash(next.stageSeed, next.turnsUsed), enemyClock(simRun, next, config), config);
  const turn = applyEnemyTurn(simRun, next, pick, config);
  if (!turn.ok) return turn;
  return {
    ok: true,
    value: {
      run: turn.value.run, stage: turn.value.stage, events: [...sim.value.events, ...turn.value.events], award: null,
    },
  };
}

/**
 * The enemy's half of a committed turn, given its pick: the move (R5), the expiry of
 * next_enemy_turn modifiers, the start of the next turn, White's check, the loss when no legal
 * queue remains, and the overtime charge for a turn past the par. The solver reuses it with
 * memoized picks.
 */
export function applyEnemyTurn(
  run: RunState,
  stage: StageState,
  picked: EnemyPick,
  config: EngineConfig,
): Result<{ run: RunState; stage: StageState; events: GameEvent[] }, CommitError> {
  const events: GameEvent[] = [];
  let next: StageState = stage;
  let nextRun = run;

  // R5: the enemy replies; suppressed pieces do not move.
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
        if (!lost.ok) return lost;
        nextRun = lost.value.run;
        if (lost.value.saved) events.push({ type: 'lifeline_saved', instanceId: taken.instanceId });
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
  } else if (next.turnsUsed + 1 > next.mateIn) {
    // Past the par every turn costs overtime: from the pending reward first, then from the wallet.
    const { overtimeCost: cost } = stageEconomy(nextRun, config);
    const fromReward = Math.min(cost, pendingBase(nextRun, next, config));
    const fromWallet = cost - fromReward;
    if (nextRun.coins < fromWallet) {
      next = { ...next, status: 'lost', endReason: 'out_of_coins' };
      events.push({ type: 'stage_lost', endReason: 'out_of_coins' });
    } else {
      nextRun = { ...nextRun, coins: nextRun.coins - fromWallet };
      next = { ...next, overtimePaid: next.overtimePaid + cost };
      events.push({ type: 'overtime_paid', turn: next.turnsUsed + 1, fromReward, fromWallet });
    }
  }
  return { ok: true, value: { run: nextRun, stage: next, events } };
}
