import type { ActiveModifier, BoardPiece, GameEvent, Square } from '../types';
import type { QueueCtx } from '../queue';

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

function record(ctx: QueueCtx, use: SkillUse): void {
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
  if (!target || !pieceType) return [];
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
