import { describe, expect, it } from 'vitest';
import { resolveQueue } from '../src/queue';
import { commitQueue, simulate } from '../src/rules';
import { PRIMITIVES, pieceId } from '../src/skills/registry';
import type { Action, CommitError, RunState, StageState } from '../src/types';
import { startStage } from '../src/deployment';
import { endStage } from '../src/stage-end';
import { config, deckFor, deepFreeze, deploymentStageOf, runOf, stageOf } from './helpers';

const mv = (from: string, to: string, promotion?: 'queen' | 'rook' | 'bishop' | 'knight'): Action =>
  ({ type: 'MOVE', from, to, ...(promotion !== undefined && { promotion }) });
const skill = (skillId: string, target?: string): Action => ({
  type: 'ACTIVATE_SKILL', skillId, ...(target !== undefined && { target }),
});
const runWith = (...ids: string[]): RunState => runOf({ loadout: ids.map((skillId) => ({ skillId })) });

/** White K e1, bishop c1, rook a1; Black k e8, rook a8, knight g8. */
const board = { e1: 'K', c1: 'B', a1: 'R', e8: 'k', a8: 'r', g8: 'n' };
const stage = (over: Partial<StageState> = {}) => stageOf(board, { focus: 3, ...over });

/** The error both `simulate` and `commitQueue` must return for the same queue. */
function refused(run: RunState, s: StageState, queue: Action[]): CommitError {
  deepFreeze(run);
  const a = simulate(run, s, queue, config);
  const b = commitQueue(run, s, queue, config);
  const c = resolveQueue(run, s, queue, config);
  if (a.ok || b.ok || c.ok) throw new Error('expected a refusal');
  expect(b.error).toEqual(a.error);
  expect(c.error).toEqual(a.error);
  return a.error;
}

describe('ACTIVATE_SKILL checks (spec 8.1, in order)', () => {
  it('not_in_loadout', () => {
    expect(refused(runOf(), stage(), [skill('twin_step'), mv('a1', 'a2')])).toEqual({
      kind: 'skill_unavailable', atStep: 0, skillId: 'twin_step', reason: 'not_in_loadout',
    });
  });
  it('not_in_loadout for an unknown skill id', () => {
    expect(refused(runWith('twin_step'), stage(), [skill('nope'), mv('a1', 'a2')])).toMatchObject({
      kind: 'skill_unavailable', reason: 'not_in_loadout',
    });
  });
  it('not_implemented for a future skill', () => {
    expect(refused(runWith('gallop'), stage(), [mv('a1', 'a2'), skill('gallop')])).toEqual({
      kind: 'skill_unavailable', atStep: 1, skillId: 'gallop', reason: 'not_implemented',
    });
  });
  it('not_in_loadout once the last copy is gone: later in the same queue, and on the next turn', () => {
    // The first use consumes the only copy, so the second finds none before once_per_turn is asked.
    expect(refused(runWith('twin_step'), stage(), [skill('twin_step'), skill('twin_step'), mv('a1', 'a2')])).toEqual({
      kind: 'skill_unavailable', atStep: 1, skillId: 'twin_step', reason: 'not_in_loadout',
    });
    const s = stage();
    const run = deckFor(runWith('twin_step'), s);
    const turn1 = commitQueue(run, s, [skill('twin_step'), mv('a1', 'a2'), mv('a2', 'a3')], config);
    if (!turn1.ok) throw new Error(JSON.stringify(turn1.error));
    expect(turn1.value.stage.status).toBe('active');
    expect(turn1.value.run.loadout).toEqual([]);
    expect(refused(turn1.value.run, turn1.value.stage, [skill('twin_step'), mv('e1', 'd1')])).toEqual({
      kind: 'skill_unavailable', atStep: 0, skillId: 'twin_step', reason: 'not_in_loadout',
    });
  });
  it('two copies cannot be used in one turn: once_per_turn counts earlier steps of the same queue', () => {
    const twice = [skill('twin_step'), skill('twin_step'), mv('a1', 'a2')];
    expect(refused(runWith('twin_step', 'twin_step'), stage(), twice)).toEqual({
      kind: 'skill_unavailable', atStep: 1, skillId: 'twin_step', reason: 'once_per_turn',
    });
  });
  it('once_per_turn reads the skillLog for the current turn only', () => {
    const s = stage({ turnsUsed: 1, skillLog: [{ skillId: 'twin_step', turn: 1 }] });
    expect(simulate(runWith('twin_step'), s, [skill('twin_step'), mv('a1', 'a2')], config).ok).toBe(true);
    const same = stage({ turnsUsed: 1, skillLog: [{ skillId: 'twin_step', turn: 2 }] });
    expect(refused(runWith('twin_step'), same, [skill('twin_step'), mv('a1', 'a2')])).toMatchObject({
      reason: 'once_per_turn',
    });
  });
  it('focus_exceeded is sequential: Lockdown (1) then Ascension (2) on Focus 2', () => {
    const q = [skill('lockdown', 'a8'), skill('ascension', 'c1'), mv('a1', 'a2')];
    expect(refused(runWith('lockdown', 'ascension'), stage({ focus: 2 }), q)).toEqual({
      kind: 'focus_exceeded', atStep: 1, needed: 2, available: 1,
    });
  });
  it('no_target when the skill needs one and none is given', () => {
    expect(refused(runWith('lockdown'), stage(), [skill('lockdown'), mv('a1', 'a2')])).toEqual({
      kind: 'invalid_target', atStep: 0, skillId: 'lockdown', reason: 'no_target',
    });
  });
  it('no_target on an empty square', () => {
    expect(refused(runWith('lockdown'), stage(), [skill('lockdown', 'd5'), mv('a1', 'a2')])).toEqual({
      kind: 'invalid_target', atStep: 0, skillId: 'lockdown', target: 'd5', reason: 'no_target',
    });
  });
  it('wrong_target: Ascension on a knight, Ascension on an enemy, Lockdown on an own piece', () => {
    const s = stageOf({ ...board, d1: 'N', f8: 'b' });
    const run = runWith('ascension', 'lockdown');
    for (const t of ['d1', 'f8']) {
      expect(refused(run, s, [skill('ascension', t), mv('a1', 'a2')])).toMatchObject({
        kind: 'invalid_target', reason: 'wrong_target', target: t,
      });
    }
    expect(refused(run, s, [skill('lockdown', 'a1'), mv('a1', 'a2')])).toMatchObject({
      kind: 'invalid_target', reason: 'wrong_target', target: 'a1',
    });
  });
  it('excluded: Lockdown on the king; Ascension on a Legendary bishop', () => {
    const run = runWith('lockdown', 'ascension');
    expect(refused(run, stage(), [skill('lockdown', 'e8'), mv('a1', 'a2')])).toMatchObject({
      kind: 'invalid_target', reason: 'excluded',
    });
    const s = stage();
    const legend = deepFreeze({ ...s, board: { ...s.board, c1: { ...s.board.c1!, rarity: 'legendary' as const } } });
    expect(refused(run, legend, [skill('ascension', 'c1'), mv('a1', 'a2')])).toMatchObject({
      kind: 'invalid_target', reason: 'excluded',
    });
  });
  it('a Hero bishop without rarity counts as normal (R1) and a Rare one is allowed', () => {
    const s = stage();
    const rare = deepFreeze({ ...s, board: { ...s.board, c1: { ...s.board.c1!, rarity: 'rare' as const } } });
    for (const st of [s, rare]) {
      expect(simulate(runWith('ascension'), st, [skill('ascension', 'c1'), mv('a1', 'a2')], config).ok).toBe(true);
    }
  });
  it('already_targeted: the same stageId on a later turn, even after it moved squares', () => {
    const s = stage();
    const id = s.board.a8!.stageId!;
    const moved = stageOf({ e1: 'K', c1: 'B', a1: 'R', e8: 'k', a5: 'r', g8: 'n' }, {
      focus: 3, turnsUsed: 1, skillLog: [{ skillId: 'lockdown', turn: 1, targetId: id }],
    });
    const rook = moved.board.a5!;
    const targeted = deepFreeze({ ...moved, board: { ...moved.board, a5: { ...rook, stageId: id } } });
    expect(refused(runWith('lockdown'), targeted, [skill('lockdown', 'a5'), mv('a1', 'a2')])).toEqual({
      kind: 'invalid_target', atStep: 0, skillId: 'lockdown', target: 'a5', reason: 'already_targeted',
    });
  });
  it('a Lockdown targeting a square emptied earlier in the queue is invalid_target no_target', () => {
    const s = stageOf({ e1: 'K', a7: 'P', b8: 'n', e8: 'k' }, { focus: 3 });
    expect(refused(runWith('lockdown'), s, [mv('a7', 'a8', 'queen'), skill('lockdown', 'a7')])).toEqual({
      kind: 'invalid_target', atStep: 1, skillId: 'lockdown', target: 'a7', reason: 'no_target',
    });
    // A pawn capturing on rank 8 leaves its promoted Hero Piece there, not an empty square.
    expect(refused(runWith('lockdown'), s, [mv('a7', 'b8', 'queen'), skill('lockdown', 'b8')])).toEqual({
      kind: 'invalid_target', atStep: 1, skillId: 'lockdown', target: 'b8', reason: 'wrong_target',
    });
  });
});

describe('ACTIVATE_SKILL effects', () => {
  it('Twin Step then two moves is legal and ends with no credits', () => {
    const run = deepFreeze(runWith('twin_step'));
    const s = stage();
    const r = simulate(run, s, [skill('twin_step'), mv('a1', 'a2'), mv('a2', 'a3')], config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stage.board.a3?.pieceType).toBe('rook');
    expect(r.value.stage.moveCredits).toBe(0);
    expect(r.value.events.map((e) => e.type)).toEqual(['skill_activated', 'move', 'move']);
    expect(r.value.events[0]).toEqual({ type: 'skill_activated', skillId: 'twin_step' });
    expect(commitQueue(deckFor(run, s), s, [skill('twin_step'), mv('a1', 'a2'), mv('a2', 'a3')], config).ok).toBe(true);
  });
  it('Twin Step after the move it would pay for is credits_exceeded', () => {
    expect(refused(runWith('twin_step'), stage(), [mv('a1', 'a2'), mv('a2', 'a3'), skill('twin_step')])).toEqual({
      kind: 'credits_exceeded', atStep: 1,
    });
  });
  it('consumes each used skill, spends the cost, and logs the use', () => {
    const run = deepFreeze(runWith('twin_step', 'lockdown'));
    const s = stage();
    const id = s.board.a8!.stageId!;
    const r = simulate(run, s, [skill('twin_step'), skill('lockdown', 'a8'), mv('a1', 'a2'), mv('a2', 'a3')], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.run.loadout).toEqual([]);
    expect(run.loadout).toEqual([{ skillId: 'twin_step' }, { skillId: 'lockdown' }]);
    expect(r.value.stage.focus).toBe(1);
    expect(s.focus).toBe(3);
    expect(r.value.stage.skillLog).toEqual([
      { skillId: 'twin_step', turn: 1 },
      { skillId: 'lockdown', turn: 1, targetId: id },
    ]);
  });
  it('Lockdown records a next_enemy_turn modifier on the stageId and emits piece_suppressed', () => {
    const s = stage({ turnsUsed: 2 });
    const id = s.board.a8!.stageId!;
    const r = simulate(deepFreeze(runWith('lockdown')), s, [mv('a1', 'a2'), skill('lockdown', 'a8')], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.stage.modifiers).toEqual([{
      modifierId: 'm3_1', primitive: 'suppress_piece', source: 'lockdown', target: id,
      duration: 'next_enemy_turn', appliedOnTurn: 3,
    }]);
    expect(r.value.events).toContainEqual({ type: 'piece_suppressed', target: id });
    expect(r.value.events).toContainEqual({ type: 'skill_activated', skillId: 'lockdown', target: 'a8' });
  });
  it('Ascension transforms the bishop, which then moves as a queen; the modifier targets its instanceId', () => {
    const s = stage();
    const id = s.board.c1!.instanceId!;
    // c1 -> c5 is a queen's file move, impossible for a bishop.
    const r = simulate(deepFreeze(runWith('ascension')), s, [skill('ascension', 'c1'), mv('c1', 'c5')], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    // R1 has reverted the transform and expired its this_turn modifier by the end of the queue.
    expect(r.value.stage.board.c5).toEqual({ pieceType: 'bishop', color: 'white', instanceId: id });
    expect(r.value.stage.modifiers).toEqual([]);
    expect(r.value.events).toContainEqual({ type: 'piece_transformed', target: id, pieceType: 'queen' });
    expect(r.value.events).toContainEqual({ type: 'transform_reverted', target: id });
    expect(r.value.events).toContainEqual({ type: 'modifier_expired', modifierId: 'm1_0' });
    expect(refused(runWith('twin_step'), s, [mv('c1', 'c5')])).toMatchObject({ kind: 'illegal_move' });
  });
  it('set_piece_type records a this_turn modifier on the instanceId (seen before R1 expires it)', () => {
    const s = stage();
    const piece = s.board.c1!;
    const ctx = {
      run: runWith('ascension'), board: s.board, focus: 3, moveCredits: 1, modifiers: [], skillLog: [], turn: 1,
    };
    const effect = config.skills.ascension!.effects[0]!;
    PRIMITIVES.set_piece_type!(ctx, {
      skillId: 'ascension', effect, modifierId: 'm1_0', target: { square: 'c1', piece, id: piece.instanceId! },
    });
    expect(ctx.modifiers).toEqual([{
      modifierId: 'm1_0', primitive: 'set_piece_type', source: 'ascension', target: piece.instanceId,
      duration: 'this_turn', appliedOnTurn: 1,
    }]);
    expect(ctx.board.c1).toEqual({ ...piece, transformed: { pieceType: 'queen', modifierId: 'm1_0' } });
  });
  it('the registry implements exactly the three MVP primitives', () => {
    const implemented = Object.entries(PRIMITIVES).filter(([, h]) => h).map(([p]) => p).sort();
    expect(implemented).toEqual(['grant_move_credit', 'set_piece_type', 'suppress_piece']);
  });
  it('a skill-only queue is still empty_queue', () => {
    expect(refused(runWith('twin_step'), stage(), [skill('twin_step')])).toEqual({ kind: 'empty_queue' });
  });
});

describe('single use (M4): a skill is consumed when the turn that uses it is committed', () => {
  const twinMoves = [skill('twin_step'), mv('a1', 'a2'), mv('a2', 'a3')];

  it('a used skill leaves the loadout on commit', () => {
    const s = stage();
    const run = deckFor(runWith('twin_step', 'lockdown'), s);
    const r = commitQueue(run, s, twinMoves, config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.run.loadout).toEqual([{ skillId: 'lockdown' }]);
  });

  it('simulate result is a preview: the input run keeps the skill', () => {
    const run = deepFreeze(runWith('twin_step', 'lockdown'));
    const r = simulate(run, stage(), twinMoves, config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.run.loadout).toEqual([{ skillId: 'lockdown' }]);
    expect(run.loadout).toEqual([{ skillId: 'twin_step' }, { skillId: 'lockdown' }]);
  });

  it('a refused commit consumes nothing', () => {
    const s = stage();
    const run = deckFor(runWith('twin_step', 'lockdown'), s); // deep-frozen
    // c1 -> c5 is a queen's move, illegal for the bishop: the refusal comes after Twin Step resolved.
    const r = commitQueue(run, s, [skill('twin_step'), mv('a1', 'a2'), mv('c1', 'c5')], config);
    expect(r.ok ? null : r.error).toMatchObject({ kind: 'illegal_move', atStep: 2 });
    expect(run.loadout).toEqual([{ skillId: 'twin_step' }, { skillId: 'lockdown' }]);
  });

  it('duplicates are separate: one of two copies is consumed', () => {
    const r = simulate(deepFreeze(runWith('twin_step', 'twin_step')), stage(), twinMoves, config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.run.loadout).toEqual([{ skillId: 'twin_step' }]);
  });

  it('the first copy in loadout order is the one consumed', () => {
    const r = simulate(deepFreeze(runWith('twin_step', 'lockdown', 'twin_step')), stage(), twinMoves, config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.run.loadout).toEqual([{ skillId: 'lockdown' }, { skillId: 'twin_step' }]);
  });

  it('an unused skill is untouched by a turn that uses another', () => {
    const r = simulate(deepFreeze(runWith('ascension', 'lockdown')), stage(), [skill('lockdown', 'a8'), mv('a1', 'a2')], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.run.loadout).toEqual([{ skillId: 'ascension' }]);
  });
});

describe('ACTIVATE_SKILL check order (earlier check wins)', () => {
  const twinLogged = { skillId: 'twin_step', turn: 1 };
  it('not_in_loadout beats not_implemented: a future skill nobody holds', () => {
    expect(refused(runOf(), stage(), [skill('gallop'), mv('a1', 'a2')])).toMatchObject({ reason: 'not_in_loadout' });
  });
  it('not_implemented beats once_per_turn', () => {
    const s = stage({ skillLog: [{ skillId: 'gallop', turn: 1 }] });
    expect(refused(runWith('gallop'), s, [skill('gallop'), mv('a1', 'a2')])).toMatchObject({ reason: 'not_implemented' });
  });
  it('once_per_turn beats focus_exceeded', () => {
    const s = stage({ focus: 0, skillLog: [twinLogged] });
    expect(refused(runWith('twin_step'), s, [skill('twin_step'), mv('a1', 'a2')])).toMatchObject({
      reason: 'once_per_turn',
    });
  });
  it('focus_exceeded beats no_target', () => {
    expect(refused(runWith('lockdown'), stage({ focus: 0 }), [skill('lockdown'), mv('a1', 'a2')])).toEqual({
      kind: 'focus_exceeded', atStep: 0, needed: 1, available: 0,
    });
  });
  it('wrong_target beats excluded', () => {
    const s = stage();
    const legendKnight = deepFreeze({ ...s, board: { ...s.board, g8: { ...s.board.g8!, rarity: 'legendary' as const } } });
    expect(refused(runWith('ascension'), legendKnight, [skill('ascension', 'g8'), mv('a1', 'a2')])).toMatchObject({
      reason: 'wrong_target',
    });
  });
  it('excluded beats already_targeted', () => {
    const s0 = stage();
    const s = stage({ skillLog: [{ skillId: 'lockdown', turn: 0, targetId: s0.board.e8!.stageId! }] });
    expect(refused(runWith('lockdown'), s, [skill('lockdown', 'e8'), mv('a1', 'a2')])).toMatchObject({
      reason: 'excluded',
    });
  });
  it('a credit granted mid-queue applies from its step on: MOVE, Twin Step, MOVE is legal', () => {
    const r = simulate(runWith('twin_step'), stage(), [mv('a1', 'a2'), skill('twin_step'), mv('a2', 'a3')], config);
    expect(r.ok).toBe(true);
  });
});

describe('I12: rarity is fixed at creation', () => {
  it("Ascension never changes a Rare bishop's rarity, and the King's rarity stays null through startStage and endStage", () => {
    const base = runWith('ascension');
    const rare = deepFreeze({
      ...base, deck: base.deck.map((p) => (p.instanceId === 'p_bishop_04' ? { ...p, rarity: 'rare' as const } : p)),
    });
    const started = startStage(rare, deploymentStageOf({ e8: 'k', a8: 'r' }), [
      { instanceId: 'p_king_01', to: 'e1' }, { instanceId: 'p_bishop_04', to: 'c1' },
    ], config);
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const { run, stage: s0 } = started.value;
    expect(s0.board.c1).toMatchObject({ pieceType: 'bishop', rarity: 'rare' });
    expect(run.deck.find((p) => p.instanceId === 'p_king_01')!.rarity).toBeNull();

    // c1 -> c5 is a queen move: the bishop is a queen for this step, then R1 reverts it.
    const r = simulate(run, deepFreeze({ ...s0, focus: 3 }), [skill('ascension', 'c1'), mv('c1', 'c5')], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.events).toContainEqual({ type: 'piece_transformed', target: 'p_bishop_04', pieceType: 'queen' });
    expect(r.value.events).toContainEqual({ type: 'transform_reverted', target: 'p_bishop_04' });
    expect(r.value.stage.board.c5).toMatchObject({ pieceType: 'bishop', rarity: 'rare', instanceId: 'p_bishop_04' });
    expect(r.value.run.deck.find((p) => p.instanceId === 'p_bishop_04')!.rarity).toBe('rare');

    const ended = endStage(r.value.run, deepFreeze({ ...r.value.stage, status: 'won' as const }), config);
    if (!ended.ok) throw new Error(JSON.stringify(ended.error));
    expect(ended.value.run.deck.find((p) => p.instanceId === 'p_king_01')!.rarity).toBeNull();
    expect(ended.value.run.deck.find((p) => p.instanceId === 'p_bishop_04')!.rarity).toBe('rare');
  });
});

describe('targets and durations at the edges', () => {
  /** `config` plus test-only skills: an instant suppress and an instant transform. */
  const cfg = {
    ...config,
    skills: {
      ...config.skills,
      flash: {
        ...config.skills.lockdown!, id: 'flash',
        effects: [{ primitive: 'suppress_piece' as const, duration: 'instant' as const }],
      },
      blink: {
        ...config.skills.ascension!, id: 'blink',
        effects: [{ primitive: 'set_piece_type' as const, params: { pieceType: 'queen' }, duration: 'instant' as const }],
      },
    },
  };

  it('an instant modifier applies and ends at once: nothing is stored', () => {
    const r = simulate(deepFreeze(runWith('flash')), stage(), [skill('flash', 'a8'), mv('a1', 'a2')], cfg);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.stage.modifiers).toEqual([]);
    expect(r.value.events.some((e) => e.type === 'modifier_expired')).toBe(false);
  });

  it('an instant transform ends before any move reads it: the bishop still moves as a bishop', () => {
    const run = deepFreeze(runWith('blink'));
    const r = simulate(run, stage(), [skill('blink', 'c1'), mv('c1', 'c5')], cfg);
    expect(r.ok ? null : r.error).toMatchObject({ kind: 'illegal_move', atStep: 1, reason: 'unreachable' });
    const ok = simulate(run, stage(), [skill('blink', 'c1'), mv('c1', 'd2')], cfg);
    if (!ok.ok) throw new Error(JSON.stringify(ok.error));
    expect(ok.value.stage.modifiers).toEqual([]);
    expect(ok.value.stage.board.d2).toEqual(stage().board.c1);
  });

  it('a target given to a kind: none skill is ignored', () => {
    const r = simulate(deepFreeze(runWith('twin_step')), stage(), [skill('twin_step', 'a8'), mv('a1', 'a2'), mv('a2', 'a3')], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.stage.skillLog).toEqual([{ skillId: 'twin_step', turn: 1 }]);
    expect(r.value.events[0]).toEqual({ type: 'skill_activated', skillId: 'twin_step' });
  });

  it('a piece with neither id has no pieceId and cannot be targeted', () => {
    expect(pieceId({ pieceType: 'rook', color: 'black' })).toBeNull();
    const s = stage();
    const { stageId: _, ...bare } = s.board.a8!;
    const noIds = deepFreeze({ ...s, board: { ...s.board, a8: bare } });
    expect(refused(runWith('lockdown'), noIds, [skill('lockdown', 'a8'), mv('a1', 'a2')])).toEqual({
      kind: 'invalid_target', atStep: 0, skillId: 'lockdown', target: 'a8', reason: 'no_target',
    });
  });
});
