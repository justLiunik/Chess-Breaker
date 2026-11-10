import type { ActiveModifier, BoardPiece, GameEvent, Square, StageState } from '../types';
import type { QueueCtx } from '../queue';
import { toIndex } from '../square';

/**
 * The id a modifier targets: a Hero Piece's `instanceId`, else a Stage Piece's `stageId`; null for a
 * piece with neither, which cannot be targeted and matches no modifier.
 */
export const pieceId = (p: BoardPiece): string | null => p.instanceId ?? p.stageId ?? null;

export interface SkillEffect {
  primitive: ActiveModifier['primitive'];
  params?: Record<string, unknown>;
  duration: ActiveModifier['duration'];
}

/** What a handler knows about the activation it serves. */
export interface SkillUse {
  skillId: string;
  effect: SkillEffect;
  modifierId: string;
  /** The targeted piece at the moment of activation, when the skill has a target. */
  target?: { square: Square; piece: BoardPiece; id: string };
}

export type Handler = (ctx: QueueCtx, use: SkillUse) => GameEvent[];

/** Stores the modifier `use` creates; an `instant` one applies and ends at once, so it is not stored. */
function record(ctx: QueueCtx, use: SkillUse): void {
  if (use.effect.duration === 'instant') return;
  ctx.modifiers = [...ctx.modifiers, {
    modifierId: use.modifierId,
    primitive: use.effect.primitive,
    source: use.skillId,
    ...(use.target && { target: use.target.id }),
    duration: use.effect.duration,
    appliedOnTurn: ctx.turn,
  }];
}

const grantMoveCredit: Handler = (ctx, use) => {
  ctx.moveCredits += Number(use.effect.params?.amount ?? 0);
  return [];
};

const setPieceType: Handler = (ctx, use) => {
  const { target } = use;
  const pieceType = use.effect.params?.pieceType as BoardPiece['pieceType'] | undefined;
  // An instant transform would end before any move reads it: it changes nothing.
  if (!target || !pieceType || use.effect.duration === 'instant') return [];
  ctx.board = {
    ...ctx.board,
    [target.square]: { ...target.piece, transformed: { pieceType, modifierId: use.modifierId } },
  };
  record(ctx, use);
  return [{ type: 'piece_transformed', target: target.id, pieceType }];
};

const suppressPiece: Handler = (ctx, use) => {
  if (!use.target) return [];
  record(ctx, use);
  return [{ type: 'piece_suppressed', target: use.target.id }];
};

/** One handler per primitive; a primitive without a handler is not implemented yet. */
export const PRIMITIVES: Record<ActiveModifier['primitive'], Handler | undefined> = {
  grant_move_credit: grantMoveCredit,
  grant_focus: undefined,
  set_piece_type: setPieceType,
  override_moveset: undefined,
  ignore_blockers: undefined,
  suppress_piece: suppressPiece,
  shield_king: undefined,
  remove_piece: undefined,
  place_piece: undefined,
  displace_piece: undefined,
  return_to_deck: undefined,
  shield_piece: undefined,
  reveal_intent: undefined,
  add_plan_undo: undefined,
};

/**
 * The primitives whose effect cannot change Resolve or R2 for any queue: they only record a modifier
 * that R3 and R5 read. A skill whose effects are all of these changes nothing `hasLegalQueue` judges
 * except the Focus and the charge it spends, so it never makes a queue legal.
 */
export const QUEUE_NEUTRAL: ReadonlySet<ActiveModifier['primitive']> = new Set(['suppress_piece']);

/**
 * 1 on the square of every piece a live `suppress_piece` modifier targets, found by id on the
 * current board (pieces move; a target no longer on the board freezes nothing).
 */
export function frozenMask(stage: StageState): Uint8Array {
  const mask = new Uint8Array(64);
  const ids = new Set<string>();
  for (const m of stage.modifiers) {
    if (m.primitive === 'suppress_piece' && m.target !== undefined) ids.add(m.target);
  }
  if (ids.size === 0) return mask;
  for (const [sq, piece] of Object.entries(stage.board)) {
    const id = pieceId(piece);
    if (id !== null && ids.has(id)) mask[toIndex(sq)] = 1;
  }
  return mask;
}
