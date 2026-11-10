import type { Action, CommitError, EngineConfig, GameEvent, Rarity } from '../types';
import type { QueueCtx } from '../queue';
import { PRIMITIVES, pieceId } from './registry';

type SkillAction = Extract<Action, { type: 'ACTIVATE_SKILL' }>;

/** Spec §8.1: the checks for one ACTIVATE_SKILL, in order, against the queue's state at this step. */
export function checkSkill(
  ctx: QueueCtx,
  action: SkillAction,
  atStep: number,
  config: EngineConfig,
): CommitError | null {
  const { skillId } = action;
  const unavailable = (reason: Extract<CommitError, { kind: 'skill_unavailable' }>['reason']): CommitError =>
    ({ kind: 'skill_unavailable', atStep, skillId, reason });
  const invalid = (reason: Extract<CommitError, { kind: 'invalid_target' }>['reason']): CommitError =>
    ({ kind: 'invalid_target', atStep, skillId, ...(action.target !== undefined && { target: action.target }), reason });

  const slot = ctx.run.loadout.find((l) => l.skillId === skillId);
  const def = config.skills[skillId];
  if (!slot || !def) return unavailable('not_in_loadout');
  if (def.status !== 'mvp') return unavailable('not_implemented');
  if (slot.charges < 1) return unavailable('no_charges');
  if (
    def.restrictions.includes('once_per_turn')
    && ctx.skillLog.some((e) => e.skillId === skillId && e.turn === ctx.turn)
  ) return unavailable('once_per_turn');
  if (ctx.focus < def.cost) return { kind: 'focus_exceeded', atStep, needed: def.cost, available: ctx.focus };

  if (def.target.kind === 'none') return null;
  const piece = action.target === undefined ? undefined : ctx.board[action.target];
  // A piece with neither id cannot be targeted (pieceId).
  if (!piece || pieceId(piece) === null) return invalid('no_target');
  const wantColor = def.target.kind === 'own_piece' ? 'white' : def.target.kind === 'enemy_piece' ? 'black' : null;
  if (wantColor !== null && piece.color !== wantColor) return invalid('wrong_target');
  if (def.target.pieceType !== undefined && piece.pieceType !== def.target.pieceType) return invalid('wrong_target');
  // Ruling R1: a board piece without `rarity` counts as normal.
  const rarity: Rarity = piece.rarity ?? 'normal';
  if (def.target.excludes?.includes(piece.pieceType) || def.target.excludesRarity?.includes(rarity)) {
    return invalid('excluded');
  }
  if (
    def.restrictions.includes('distinct_targets')
    && ctx.skillLog.some((e) => e.skillId === skillId && e.targetId === pieceId(piece))
  ) return invalid('already_targeted');
  return null;
}

/** Spends Focus and a charge, logs the use and runs the effects. Call only after `checkSkill` passed. */
export function applySkill(
  ctx: QueueCtx,
  action: SkillAction,
  atStep: number,
  config: EngineConfig,
): GameEvent[] {
  const def = config.skills[action.skillId]!;
  // A target given to a `kind: none` skill is ignored.
  const square = def.target.kind === 'none' ? undefined : action.target;
  const piece = square === undefined ? undefined : ctx.board[square];
  const id = piece === undefined ? null : pieceId(piece);
  const target = piece !== undefined && square !== undefined && id !== null ? { square, piece, id } : undefined;

  ctx.focus -= def.cost;
  ctx.run = {
    ...ctx.run,
    loadout: ctx.run.loadout.map((l) => (l.skillId === action.skillId ? { ...l, charges: l.charges - 1 } : l)),
  };
  ctx.skillLog = [...ctx.skillLog, {
    skillId: action.skillId, turn: ctx.turn, ...(target && { targetId: target.id }),
  }];

  const events: GameEvent[] = [{
    type: 'skill_activated', skillId: action.skillId, ...(square !== undefined && { target: square }),
  }];
  const modifierId = `m${ctx.turn}_${atStep}`;
  for (const effect of def.effects) {
    const handler = PRIMITIVES[effect.primitive];
    if (handler) events.push(...handler(ctx, { skillId: action.skillId, effect, modifierId, ...(target && { target }) }));
  }
  return events;
}
