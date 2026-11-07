import { describe, expect, it } from 'vitest';
import { simulate } from '../src/rules';
import { config, runOf, stageOf } from './helpers';
import type { Action } from '../src/types';

const mv = (from: string, to: string): Action[] => [{ type: 'MOVE', from, to }];
// Back-rank mate: Ra1-a8# against Kh8 with pawns g7, h7.
const mateBoard = { e1: 'K', a1: 'R', h8: 'k', g7: 'p', h7: 'p' };

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe('simulate', () => {
  it('awards a one-move mate in Act I', () => {
    const v = ok(simulate(runOf({ coins: 10 }), stageOf(mateBoard, { turnsUsed: 1, turnLimit: 8 }), mv('a1', 'a8'), config));
    expect(v.stage.status).toBe('won');
    expect(v.stage.endReason).toBe('checkmate');
    expect(v.award).toEqual({ coins: 16, base: 4, turnBonus: 12 });
    expect(v.run.coins).toBe(26);
    expect(v.events).toContainEqual({ type: 'stage_won', award: { coins: 16, base: 4, turnBonus: 12 } });
    expect(v.stage.turnsUsed).toBe(2);
  });

  it('adds salvage on top of the award', () => {
    const board = { ...mateBoard, a8: 'p' };
    const v = ok(simulate(runOf({ coins: 0 }), stageOf(board, { turnsUsed: 1 }), mv('a1', 'a8'), config));
    const salvage = Math.floor(config.pieceValues.pawn / config.economy.salvage.divisor);
    expect(v.award?.coins).toBe(16);
    expect(v.run.coins).toBe(16 + salvage);
  });

  it('applies the boss multiplier', () => {
    const v = ok(simulate(runOf({ stageIndex: 2 }), stageOf(mateBoard, { turnsUsed: 6, turnLimit: 7 }), mv('a1', 'a8'), config));
    expect(v.award).toEqual({ coins: 6, base: 6, turnBonus: 0 });
  });

  it('uses Act II rates', () => {
    const v = ok(simulate(runOf({ actIndex: 1 }), stageOf(mateBoard, { turnsUsed: 0, turnLimit: 6 }), mv('a1', 'a8'), config));
    expect(v.award).toEqual({ coins: 21, base: 6, turnBonus: 15 });
  });

  it('loses when White stalemates Black', () => {
    // Bb6xa7 removes the last mobile Black pawn; Kh8 is boxed by Qf7 and not in check.
    const stage = stageOf({ e1: 'K', b6: 'B', f7: 'Q', h8: 'k', a7: 'p' });
    const v = ok(simulate(runOf({ coins: 5 }), stage, mv('b6', 'a7'), config));
    expect(v.stage.status).toBe('lost');
    expect(v.stage.endReason).toBe('enemy_stalemated');
    expect(v.award).toBeNull();
    expect(v.events).toContainEqual({ type: 'stage_lost', endReason: 'enemy_stalemated' });
  });

  it('ends a malformed stage whose turnsUsed already exceeds the limit', () => {
    const stage = stageOf({ e1: 'K', h1: 'R', a8: 'k' }, { turnsUsed: 9, turnLimit: 8 });
    const v = ok(simulate(runOf(), stage, mv('h1', 'h2'), config));
    expect(v.stage.status).toBe('lost');
    expect(v.stage.endReason).toBe('out_of_turns');
  });

  it('loses on the last turn without mate', () => {
    const stage = stageOf({ e1: 'K', h1: 'R', a8: 'k' }, { turnsUsed: 7, turnLimit: 8 });
    const v = ok(simulate(runOf(), stage, mv('h1', 'h2'), config));
    expect(v.stage.status).toBe('lost');
    expect(v.stage.endReason).toBe('out_of_turns');
    expect(v.stage.turnsUsed).toBe(8);
    expect(v.award).toBeNull();
    expect(v.events).toContainEqual({ type: 'stage_lost', endReason: 'out_of_turns' });
  });

  it('is non-terminal otherwise, and reports check', () => {
    const stage = stageOf({ e1: 'K', h1: 'R', a8: 'k' });
    const v = ok(simulate(runOf(), stage, mv('h1', 'h8'), config));
    expect(v.stage.status).toBe('active');
    expect(v.stage.turnsUsed).toBe(1);
    expect(v.award).toBeNull();
    expect(v.events).toContainEqual({ type: 'check', king: 'black', square: 'a8' });
  });

  it('propagates queue errors', () => {
    const r = simulate(runOf(), stageOf(mateBoard), [], config);
    expect(r).toEqual({ ok: false, error: { kind: 'empty_queue' } });
  });
});
