import { describe, expect, it } from 'vitest';
import { resolveQueue } from '../src/queue';
import type { Action } from '../src/types';
import { config, deepFreeze, runOf, stageOf } from './helpers';

const mv = (from: string, to: string): Action => ({ type: 'MOVE', from, to });
const run = runOf();

describe('resolveQueue errors', () => {
  const base = { e1: 'K', h8: 'k' };
  it('rejects malformed squares without touching the inputs', () => {
    const s = deepFreeze(stageOf({ ...base, a7: 'R' }, { moveCredits: 2 }));
    const r0 = deepFreeze(runOf());
    for (const to of ['a7x', 'a10']) {
      expect(resolveQueue(r0, s, [mv('a7', to)], config)).toEqual({
        ok: false, error: { kind: 'illegal_move', atStep: 0, from: 'a7', to, reason: 'unreachable' },
      });
    }
    expect(resolveQueue(r0, s, [mv('a1x', 'a8')], config)).toEqual({
      ok: false, error: { kind: 'illegal_move', atStep: 0, from: 'a1x', to: 'a8', reason: 'no_piece' },
    });
  });
  it('stage_not_active', () => {
    const s = stageOf(base, { status: 'won' });
    expect(resolveQueue(run, s, [mv('e1', 'e2')], config)).toEqual({ ok: false, error: { kind: 'stage_not_active' } });
  });
  it('wrong_phase', () => {
    const s = stageOf(base, { phase: 'deployment' });
    expect(resolveQueue(run, s, [mv('e1', 'e2')], config)).toEqual({
      ok: false, error: { kind: 'wrong_phase', expected: 'action' },
    });
  });
  it('empty_queue for [] and for a skill-only queue', () => {
    const s = stageOf(base);
    const e = { ok: false, error: { kind: 'empty_queue' } };
    expect(resolveQueue(run, s, [], config)).toEqual(e);
    expect(resolveQueue(run, s, [{ type: 'ACTIVATE_SKILL', skillId: 'x' }], config)).toEqual(e);
  });
  it('credits_exceeded at the step without a credit', () => {
    const s = stageOf(base);
    expect(resolveQueue(run, s, [mv('e1', 'e2'), mv('e2', 'e3')], config)).toEqual({
      ok: false, error: { kind: 'credits_exceeded', atStep: 1 },
    });
  });
  it('illegal_move with reason and step', () => {
    const s = stageOf(base, { moveCredits: 2 });
    expect(resolveQueue(run, s, [mv('e1', 'e2'), mv('e2', 'e5')], config)).toEqual({
      ok: false, error: { kind: 'illegal_move', atStep: 1, from: 'e2', to: 'e5', reason: 'unreachable' },
    });
    expect(resolveQueue(run, s, [mv('a1', 'a2')], config)).toEqual({
      ok: false, error: { kind: 'illegal_move', atStep: 0, from: 'a1', to: 'a2', reason: 'no_piece' },
    });
  });
  it('illegal_move is judged on the board as changed by earlier steps', () => {
    const s = stageOf({ e1: 'K', a1: 'R', h8: 'k' }, { moveCredits: 2 });
    const r = resolveQueue(run, s, [mv('a1', 'a5'), mv('a1', 'a2')], config);
    expect(r).toEqual({ ok: false, error: { kind: 'illegal_move', atStep: 1, from: 'a1', to: 'a2', reason: 'no_piece' } });
  });
  it('invariant_violation I3 when the Black king is absent, I1 for two White kings', () => {
    const r3 = resolveQueue(run, stageOf({ e1: 'K', a1: 'R' }), [mv('a1', 'a2')], config);
    expect(r3).toMatchObject({ ok: false, error: { kind: 'invariant_violation', invariant: 'I3' } });
    const r1 = resolveQueue(run, stageOf({ e1: 'K', a1: 'K', h8: 'k' }), [mv('a1', 'a2')], config);
    expect(r1).toMatchObject({ ok: false, error: { kind: 'invariant_violation', invariant: 'I1' } });
  });
  it('king_in_check_at_end lists every checker sorted by index', () => {
    const s = stageOf({ e1: 'K', h8: 'k', e8: 'r', h4: 'b', a2: 'P' });
    const r = resolveQueue(run, s, [mv('a2', 'a3')], config);
    expect(r).toEqual({ ok: false, error: { kind: 'king_in_check_at_end', square: 'e1', checkers: ['h4', 'e8'] } });
  });
  it('a piece behind another Black piece is not a checker', () => {
    const s = stageOf({ e1: 'K', h8: 'k', e5: 'r', e8: 'r', a2: 'P' });
    const r = resolveQueue(run, s, [mv('a2', 'a3')], config);
    expect(r).toMatchObject({ ok: false, error: { checkers: ['e5'] } });
  });
});

describe('resolveQueue deferred validation', () => {
  const s = () => stageOf({ e1: 'K', d8: 'r', h8: 'k' }, { moveCredits: 2 });
  it('accepts a queue whose first move enters check and second leaves it', () => {
    const r = resolveQueue(run, s(), [mv('e1', 'd2'), mv('d2', 'e2')], config);
    expect(r.ok).toBe(true);
  });
  it('refuses the same first move alone', () => {
    const r = resolveQueue(run, s(), [mv('e1', 'd2')], config);
    expect(r).toEqual({ ok: false, error: { kind: 'king_in_check_at_end', square: 'd2', checkers: ['d8'] } });
  });
});

describe('resolveQueue success', () => {
  it('reduces credits, adds salvage per capture, leaves turnsUsed, never mutates inputs', () => {
    const st = stageOf({ e1: 'K', a1: 'R', a5: 'q', h5: 'n', h8: 'k' }, { moveCredits: 2 });
    const rn = runOf({ coins: 4 });
    const r = resolveQueue(rn, st, [mv('a1', 'a5'), mv('a5', 'h5')], config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.run.coins).toBe(4 + 3 + 1);
    expect(r.value.stage.moveCredits).toBe(0);
    expect(r.value.stage.turnsUsed).toBe(0);
    expect(r.value.stage.board['h5']).toMatchObject({ pieceType: 'rook' });
    expect(r.value.stage.board['a1']).toBeUndefined();
    expect(r.value.events.filter((e) => e.type === 'capture')).toHaveLength(2);
    expect(st.board['a5']).toMatchObject({ pieceType: 'queen' });
    expect(rn.coins).toBe(4);
  });
  it('a refused queue returns only the error', () => {
    const st = stageOf({ e1: 'K', d8: 'r', h8: 'k' });
    const r = resolveQueue(run, st, [mv('e1', 'd2')], config);
    expect(Object.keys(r)).toEqual(['ok', 'error']);
  });
  it('a pawn reaching rank 8 vanishes and emits pawn_promoted', () => {
    const st = stageOf({ e1: 'K', c7: 'P', h5: 'k' });
    const r = resolveQueue(run, st, [mv('c7', 'c8')], config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stage.board['c8']).toBeUndefined();
    expect(r.value.stage.board['c7']).toBeUndefined();
    expect(r.value.events).toContainEqual({
      type: 'pawn_promoted', square: 'c8', promotesTo: { pieceType: 'knight', rarity: 'normal' },
      instanceId: expect.stringMatching(/^p_[0-9a-f]+$/),
    });
  });
});

describe('resolveQueue immutability', () => {
  it('works on deep-frozen inputs', () => {
    const st = deepFreeze(stageOf({ e1: 'K', h8: 'k' }));
    expect(resolveQueue(deepFreeze(runOf()), st, deepFreeze([mv('e1', 'e2')]), config).ok).toBe(true);
  });
});
