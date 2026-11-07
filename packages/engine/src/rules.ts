import type {
  Action, Award, CommitError, EngineConfig, GameEvent, Result, RunState, StageState,
} from './types';
import { hasLegalQueue, inCheck, legalMoves } from './legality';
import { enemyMove } from './enemy/policy';
import { hash } from './rng';
import { KING, fromBoard } from './position';
import { toSquare } from './square';
import { resolveQueue } from './queue';

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

  // R3: evaluate Black's position.
  const b = fromBoard(next.board);
  const checked = inCheck(b, 'black');
  let award: Award | null = null;
  if (legalMoves(b, 'black').length === 0) {
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
  if (next.status === 'active' && next.turnsUsed === next.turnLimit) {
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

/**
 * `simulate` followed by the enemy's reply (R5) and the start of the next turn. A stage that
 * `simulate` already ended gets no reply.
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

  // R5: the enemy replies.
  const picked = enemyMove(next, hash(next.stageSeed, next.turnsUsed), config);
  if (picked.move) {
    const { from, to } = picked.move;
    const board = { ...next.board };
    const mover = board[from]!;
    delete board[from];
    events.push({ type: 'enemy_move', from, to });
    const taken = board[to];
    if (taken) {
      events.push({
        type: 'capture', square: to, pieceType: taken.pieceType, color: taken.color, salvage: 0,
      });
    }
    if (mover.pieceType === 'pawn' && to.endsWith('1')) {
      board[to] = { ...mover, pieceType: 'queen' };
      events.push({ type: 'enemy_promoted', square: to });
    } else {
      board[to] = mover;
    }
    next = { ...next, board };
  }
  if (picked.policy.fellBack && !next.enemyPolicy.fellBack) {
    events.push({ type: 'enemy_fell_back', cursor: picked.policy.cursor ?? 0 });
  }
  next = {
    ...next,
    enemyPolicy: picked.policy,
    moveCredits: config.rules.freeMovesPerTurn,
    focus: next.focusPool,
  };
  events.push({ type: 'turn_started', turn: next.turnsUsed + 1 });

  const b = fromBoard(next.board);
  const checked = inCheck(b, 'white');
  if (checked) events.push({ type: 'check', king: 'white', square: toSquare(b.indexOf(KING)) });
  if (!hasLegalQueue(next, config)) {
    const endReason = checked ? 'player_mated' : 'player_stalemated';
    next = { ...next, status: 'lost', endReason };
    events.push({ type: 'stage_lost', endReason });
  }
  return { ok: true, value: { run: sim.value.run, stage: next, events, award: null } };
}
