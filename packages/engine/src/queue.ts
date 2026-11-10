import type {
  Action, BoardPiece, CommitError, EngineConfig, GameEvent, PieceInstance, Result, RunState, Square, StageState,
} from './types';
import { planPlayerMove } from './legality';
import { durabilityMaxOf, hasBonusMove } from './abilities';
import { isAttacked } from './movegen';
import { hash } from './rng';
import { KING, PAWN, fromBoard } from './position';
import { toSquare } from './square';
import { applySkill, checkSkill } from './skills/check';
import { pieceId } from './skills/registry';

type Board = StageState['board'];

/** The queue's working state while it resolves; skills and moves update it in order. */
export interface QueueCtx {
  run: RunState;
  board: Board;
  focus: number;
  /** Credits still unspent this turn. */
  moveCredits: number;
  modifiers: StageState['modifiers'];
  skillLog: StageState['skillLog'];
  /** The turn being played: `turnsUsed + 1`. */
  turn: number;
}

/**
 * The Legendary knight bonus (docs/02 §4) as the queue tracks it, by `instanceId`: 'earned' once the
 * piece has made a paid MOVE this turn (its next MOVE is free), 'spent' once it has made that free one.
 */
export type BonusLedger = Map<string, 'earned' | 'spent'>;

/** Whether the next MOVE by `piece` is its free bonus move. */
export function freeBonus(ledger: BonusLedger, piece: BoardPiece, config: EngineConfig): boolean {
  return hasBonusMove(piece, config) && ledger.get(piece.instanceId!) === 'earned';
}

/** Records a MOVE by `piece`: a free one spends the bonus; a paid one earns it, once per turn. */
export function recordMove(ledger: BonusLedger, piece: BoardPiece, config: EngineConfig, free: boolean): void {
  if (!hasBonusMove(piece, config)) return;
  if (free) ledger.set(piece.instanceId!, 'spent');
  else if (!ledger.has(piece.instanceId!)) ledger.set(piece.instanceId!, 'earned');
}

/**
 * Plays a MOVE on `board`. A multi-capture's first square is derived from the board (planPlayerMove);
 * both captured pieces emit a `capture` event, X then Y.
 */
export function applyPlayerMove(board: Board, from: Square, to: Square, config: EngineConfig): Applied {
  return playMove(board, from, to, planPlayerMove(board, from, to, config).via, config);
}

type Applied = {
  board: Board;
  events: GameEvent[];
  salvage: number;
  promoted?: { square: Square; promotesTo: NonNullable<BoardPiece['promotesTo']> };
};

/** `applyPlayerMove` for a move already planned: `first` is the multi-capture's first square, else null. */
function playMove(board: Board, from: Square, to: Square, first: Square | null, config: EngineConfig): Applied {
  const mover = board[from] as BoardPiece;
  const next: Board = { ...board };
  delete next[from];
  const events: GameEvent[] = [
    { type: 'move', from, to, pieceType: mover.pieceType, color: mover.color },
  ];
  let salvage = 0;
  let promoted: { square: Square; promotesTo: NonNullable<BoardPiece['promotesTo']> } | undefined;

  for (const sq of first === null ? [to] : [first, to]) {
    const captured = board[sq];
    if (!captured || captured.color !== 'black') continue;
    const { enabled, divisor } = config.economy.salvage;
    const worth = enabled ? Math.floor(config.pieceValues[captured.pieceType] / divisor) : 0;
    salvage += worth;
    events.push({
      type: 'capture', square: sq, pieceType: captured.pieceType, color: captured.color, salvage: worth,
      ...(captured.instanceId !== undefined && { instanceId: captured.instanceId }),
      ...(captured.stageId !== undefined && { stageId: captured.stageId }),
    });
    if (sq !== to) delete next[sq];
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
  const begun = beginQueue(run, stage);
  if (!begun.ok) return begun;
  let moves = 0;
  for (const a of queue) if (a.type === 'MOVE') moves++;
  if (moves < Math.max(1, config.rules.minMovesPerQueue)) return { ok: false, error: { kind: 'empty_queue' } };
  let r = begun.value;
  for (const action of queue) {
    const next = resolveStep(r, action, config);
    if (!next.ok) return next;
    r = next.value;
  }
  const end = judgeEnd(r);
  if (end.kind === 'refused') return { ok: false, error: end.error };
  if (end.kind === 'king_attacked') return { ok: false, error: kingInCheckError(end.board, end.preRevert) };
  const { ctx, events } = end;
  return {
    ok: true,
    value: {
      run: { ...ctx.run, coins: ctx.run.coins + r.salvage, deck: [...ctx.run.deck, ...r.promotions] },
      stage: {
        ...stage, board: ctx.board, focus: ctx.focus, moveCredits: ctx.moveCredits,
        modifiers: ctx.modifiers, skillLog: ctx.skillLog,
      },
      events,
    },
  };
}

/**
 * A queue resolved up to some step (spec §8.3 Resolve): `resolveQueue` folds `resolveStep` over its
 * actions, and `hasLegalQueue` extends one prefix with many candidate next actions. Never mutated.
 */
export interface Resolving {
  readonly stage: StageState;
  readonly ctx: Readonly<QueueCtx>;
  readonly ledger: BonusLedger;
  readonly events: readonly GameEvent[];
  readonly salvage: number;
  readonly promotions: readonly PieceInstance[];
  /** Actions resolved so far: the next one's `atStep`. */
  readonly steps: number;
  /** MOVE actions among them. */
  readonly moves: number;
}

/** The empty queue on `stage`, or the refusal of a stage that takes no queue. */
export function beginQueue(run: RunState, stage: StageState): Result<Resolving, CommitError> {
  if (stage.status !== 'active') return { ok: false, error: { kind: 'stage_not_active' } };
  if (stage.phase !== 'action') return { ok: false, error: { kind: 'wrong_phase', expected: 'action' } };
  return {
    ok: true,
    value: {
      stage,
      ctx: {
        run, board: stage.board, focus: stage.focus, moveCredits: stage.moveCredits,
        modifiers: stage.modifiers, skillLog: stage.skillLog, turn: stage.turnsUsed + 1,
      },
      ledger: new Map(),
      events: [],
      salvage: 0,
      promotions: [],
      steps: 0,
      moves: 0,
    },
  };
}

/** Resolves `action` as the next step after `r`: the step's refusal, or the queue one step longer. */
export function resolveStep(r: Resolving, action: Action, config: EngineConfig): Result<Resolving, CommitError> {
  const atStep = r.steps;
  const ctx: QueueCtx = { ...r.ctx };
  if (action.type === 'ACTIVATE_SKILL') {
    const error = checkSkill(ctx, action, atStep, config);
    if (error) return { ok: false, error };
    const events = [...r.events, ...applySkill(ctx, action, atStep, config)];
    return { ok: true, value: { ...r, ctx, events, steps: atStep + 1 } };
  }
  const mover = ctx.board[action.from];
  const free = mover !== undefined && freeBonus(r.ledger, mover, config);
  if (!free && ctx.moveCredits < 1) return { ok: false, error: { kind: 'credits_exceeded', atStep } };
  const { reason, via } = planPlayerMove(ctx.board, action.from, action.to, config);
  if (reason) return { ok: false, error: { kind: 'illegal_move', atStep, from: action.from, to: action.to, reason } };
  const applied = playMove(ctx.board, action.from, action.to, via, config);
  ctx.board = applied.board;
  const events = [...r.events, ...applied.events];
  let promotions = r.promotions;
  if (applied.promoted) {
    const { stage } = r;
    const { square, promotesTo } = applied.promoted;
    const instanceId = 'p_' + hash(stage.stageSeed, stage.turnsUsed, atStep, square).toString(16);
    const durability = durabilityMaxOf(promotesTo.pieceType, promotesTo.rarity, config);
    promotions = [...promotions, {
      instanceId, pieceType: promotesTo.pieceType, rarity: promotesTo.rarity, durability,
      durabilityMax: durability, origin: 'promotion',
      acquiredAtStage: ctx.run.actIndex * 3 + ctx.run.stageIndex, status: 'in_deck',
    }];
    events.push({ type: 'pawn_promoted', square, promotesTo, instanceId });
  }
  const ledger: BonusLedger = new Map(r.ledger);
  recordMove(ledger, mover!, config, free);
  if (!free) ctx.moveCredits--;
  return {
    ok: true,
    value: {
      ...r, ctx, ledger, events, promotions, salvage: r.salvage + applied.salvage, steps: atStep + 1, moves: r.moves + 1,
    },
  };
}

/**
 * Whether `resolveQueue` accepts the queue `r` holds: enough MOVEs, then R1 and R2, without building
 * the accepted state or the detail of an I2 refusal (its checkers). For callers that judge many
 * candidate queues.
 */
export function queueAccepted(r: Resolving, config: EngineConfig): boolean {
  return r.moves >= Math.max(1, config.rules.minMovesPerQueue) && judgeEnd(r).kind === 'accepted';
}

type Judged =
  | { kind: 'accepted'; ctx: QueueCtx; events: GameEvent[] }
  | { kind: 'refused'; error: CommitError }
  /** I2 failed: the White king is attacked on `board` (after R1); `preRevert` is the board before R1. */
  | { kind: 'king_attacked'; board: Int8Array; preRevert: Board };

/** R1 and R2 (spec §8.3) on the end of the queue `r`. */
function judgeEnd(r: Resolving): Judged {
  const refuse = (error: CommitError): Judged => ({ kind: 'refused', error });
  const ctx: QueueCtx = { ...r.ctx };
  // R1: this_turn modifiers expire before anything is judged (docs/02 §6).
  const preRevert = ctx.board;
  const events = [...r.events, ...expireAtR1(ctx)];

  // R2: structural invariants on the end state.
  const b = fromBoard(ctx.board);
  for (const [color, code] of [['white', KING], ['black', -KING]] as const) {
    let kings = 0;
    for (let i = 0; i < 64; i++) if (b[i] === code) kings++;
    if (kings > 1) {
      return refuse({ kind: 'invariant_violation', invariant: 'I1', detail: `${kings} ${color} kings on the board` });
    }
    if (kings === 0) return refuse({ kind: 'invariant_violation', invariant: 'I3', detail: `${color} king removed` });
  }

  // I2, on the reverted board: the White king must not be attacked at the end of the queue.
  if (isAttacked(b, b.indexOf(KING), 'black')) return { kind: 'king_attacked', board: b, preRevert };
  return { kind: 'accepted', ctx, events };
}

/** The I2 refusal for the end board `b` (one White king, attacked), naming each attacker. */
function kingInCheckError(b: Int8Array, preRevert: Board): CommitError {
  const k = b.indexOf(KING);
  const checkers: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (b[i]! >= 0) continue;
    // Keep only piece i as a Black attacker; other Black pieces stay as blockers.
    const probe = b.map((v, j) => (v < 0 && j !== i ? PAWN : v)) as unknown as Int8Array;
    if (isAttacked(probe, k, 'black')) checkers.push(i);
  }
  // The pre-revert board has no White king only if the king itself was transformed.
  const before = fromBoard(preRevert);
  const kb = before.indexOf(KING);
  const afterRevert = kb < 0 || !isAttacked(before, kb, 'black');
  return { kind: 'king_in_check_at_end', square: toSquare(k), checkers: checkers.map(toSquare), afterRevert };
}

/**
 * R1: every `this_turn` modifier expires, and the piece carrying its `transformed.modifierId`
 * reverts. A modifier whose target is no longer on the board (captured in the queue) is dropped
 * without a revert. Other modifiers stay, unless their target is gone: a suppressed piece the
 * player captured has nothing left to suppress.
 */
function expireAtR1(ctx: QueueCtx): GameEvent[] {
  if (ctx.modifiers.length === 0) return [];
  const events: GameEvent[] = [];
  const board: Board = { ...ctx.board };
  const onBoard = new Set<string | null>(Object.values(board).map(pieceId));
  onBoard.delete(null);
  const kept: StageState['modifiers'] = [];
  for (const m of ctx.modifiers) {
    if (m.duration === 'this_turn') {
      const sq = Object.keys(board).find((s) => board[s]!.transformed?.modifierId === m.modifierId);
      if (sq !== undefined) {
        const { transformed: _, ...piece } = board[sq]!;
        board[sq] = piece;
        events.push({ type: 'transform_reverted', target: pieceId(piece)! });
      }
      events.push({ type: 'modifier_expired', modifierId: m.modifierId });
    } else if (m.target !== undefined && !onBoard.has(m.target)) {
      events.push({ type: 'modifier_expired', modifierId: m.modifierId });
    } else {
      kept.push(m);
    }
  }
  ctx.board = board;
  ctx.modifiers = kept;
  return events;
}
