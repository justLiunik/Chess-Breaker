import type {
  Action, BoardPiece, CommitError, EngineConfig, GameEvent, PieceInstance, Result, RunState, Square, StageState,
} from './types';
import { checkPlayerMove } from './legality';
import { durabilityMaxOf } from './abilities';
import { isAttacked } from './movegen';
import { hash } from './rng';
import { KING, PAWN, fromBoard } from './position';
import { toSquare } from './square';

type Board = StageState['board'];

export function applyPlayerMove(
  board: Board,
  from: Square,
  to: Square,
  config: EngineConfig,
): { board: Board; events: GameEvent[]; salvage: number; promoted?: { square: Square; promotesTo: NonNullable<BoardPiece['promotesTo']> } } {
  const mover = board[from] as BoardPiece;
  const next: Board = { ...board };
  delete next[from];
  const events: GameEvent[] = [
    { type: 'move', from, to, pieceType: mover.pieceType, color: mover.color },
  ];
  let salvage = 0;
  let promoted: { square: Square; promotesTo: NonNullable<BoardPiece['promotesTo']> } | undefined;

  const captured = board[to];
  if (captured && captured.color === 'black') {
    const { enabled, divisor } = config.economy.salvage;
    salvage = enabled ? Math.floor(config.pieceValues[captured.pieceType] / divisor) : 0;
    events.push({
      type: 'capture', square: to, pieceType: captured.pieceType, color: captured.color, salvage,
      ...(captured.instanceId !== undefined && { instanceId: captured.instanceId }),
      ...(captured.stageId !== undefined && { stageId: captured.stageId }),
    });
  }

  if (mover.pieceType === 'pawn' && mover.color === 'white' && to.endsWith('8')) {
    delete next[to];
    if (mover.promotesTo) promoted = { square: to, promotesTo: mover.promotesTo };
  } else {
    next[to] = mover;
  }
  return { board: next, events, salvage, ...(promoted && { promoted }) };
}

export function resolveQueue(
  run: RunState,
  stage: StageState,
  queue: Action[],
  config: EngineConfig,
): Result<{ run: RunState; stage: StageState; events: GameEvent[] }, CommitError> {
  if (stage.status !== 'active') return { ok: false, error: { kind: 'stage_not_active' } };
  if (stage.phase !== 'action') {
    return { ok: false, error: { kind: 'wrong_phase', expected: 'action' } };
  }
  const moveCount = queue.filter((a) => a.type === 'MOVE').length;
  if (moveCount < Math.max(1, config.rules.minMovesPerQueue)) {
    return { ok: false, error: { kind: 'empty_queue' } };
  }

  let board: Board = stage.board;
  const events: GameEvent[] = [];
  let salvage = 0;
  let made = 0;
  const promotions: PieceInstance[] = [];
  for (let atStep = 0; atStep < queue.length; atStep++) {
    const action = queue[atStep]!;
    if (action.type === 'ACTIVATE_SKILL') {
      return { ok: false, error: { kind: 'unsupported_action', atStep, actionType: 'ACTIVATE_SKILL' } };
    }
    if (made >= stage.moveCredits) return { ok: false, error: { kind: 'credits_exceeded', atStep } };
    const reason = checkPlayerMove(board, action.from, action.to);
    if (reason) {
      return { ok: false, error: { kind: 'illegal_move', atStep, from: action.from, to: action.to, reason } };
    }
    const applied = applyPlayerMove(board, action.from, action.to, config);
    board = applied.board;
    events.push(...applied.events);
    if (applied.promoted) {
      const { square, promotesTo } = applied.promoted;
      const instanceId = 'p_' + hash(stage.stageSeed, stage.turnsUsed, atStep, square).toString(16);
      const durability = durabilityMaxOf(config, promotesTo.pieceType, promotesTo.rarity);
      promotions.push({
        instanceId, pieceType: promotesTo.pieceType, rarity: promotesTo.rarity, durability,
        durabilityMax: durability, origin: 'promotion',
        acquiredAtStage: run.actIndex * 3 + run.stageIndex, status: 'in_deck',
      });
      events.push({ type: 'pawn_promoted', square, promotesTo, instanceId });
    }
    salvage += applied.salvage;
    made++;
  }

  // R1: no modifiers exist in M1.
  // R2: structural invariants on the end state.
  const b = fromBoard(board);
  for (const [color, code] of [['white', KING], ['black', -KING]] as const) {
    let kings = 0;
    for (let i = 0; i < 64; i++) if (b[i] === code) kings++;
    if (kings > 1) {
      return { ok: false, error: { kind: 'invariant_violation', invariant: 'I1', detail: `${kings} ${color} kings on the board` } };
    }
    if (kings === 0) {
      return { ok: false, error: { kind: 'invariant_violation', invariant: 'I3', detail: `${color} king removed` } };
    }
  }

  // I2: the White king must not be attacked at the end of the queue.
  const k = b.indexOf(KING);
  if (isAttacked(b, k, 'black')) {
    const checkers: number[] = [];
    for (let i = 0; i < 64; i++) {
      if (b[i]! >= 0) continue;
      // Keep only piece i as a Black attacker; other Black pieces stay as blockers.
      const probe = b.map((v, j) => (v < 0 && j !== i ? PAWN : v)) as unknown as Int8Array;
      if (isAttacked(probe, k, 'black')) checkers.push(i);
    }
    return {
      ok: false,
      error: { kind: 'king_in_check_at_end', square: toSquare(k), checkers: checkers.map(toSquare) },
    };
  }

  return {
    ok: true,
    value: {
      run: { ...run, coins: run.coins + salvage, deck: [...run.deck, ...promotions] },
      stage: { ...stage, board, moveCredits: stage.moveCredits - made },
      events,
    },
  };
}
