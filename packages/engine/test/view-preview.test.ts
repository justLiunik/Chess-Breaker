import { describe, expect, it } from 'vitest';
import { simulate } from '../src/rules';
import { hudEconomy, previewSteps } from '../src/view';
import { legalPlayerMoves } from '../src/legality';
import { pendingBase } from '../src/economy';
import type { Action, RunState } from '../src/types';
import { config, deepFreeze, runOf, stageOf } from './helpers';
import { makeCase } from './fuzzgen';

const mv = (from: string, to: string): Action => ({ type: 'MOVE', from, to });

describe('previewSteps', () => {
  it('preview equals simulate', () => {
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 2000; i++) {
      const { run, stage, queue } = makeCase('preview', i);
      deepFreeze(run);
      deepFreeze(stage);
      const sim = simulate(run, stage, queue, config);
      const p = previewSteps(run, stage, queue, config);
      expect(p.steps.length).toBe(queue.length);
      if (sim.ok) {
        accepted++;
        expect(p.error).toBeNull();
        expect(p.result).toEqual(sim.value);
        expect(p.steps.every((s) => s.ok)).toBe(true);
      } else {
        refused++;
        expect(p.error).toEqual(sim.error);
        expect(p.result).toBeNull();
      }
    }
    expect(accepted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });

  it('steps follow the queue', () => {
    const stage = deepFreeze(stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { moveCredits: 2 }));
    const p = previewSteps(runOf(), stage, [mv('a1', 'a2'), mv('a2', 'b2')], config);
    expect(p.error).toBeNull();
    expect(p.steps.map((s) => s.ok)).toEqual([true, true]);
    expect(p.steps[0]!.stage.board['a2']?.pieceType).toBe('rook');
    expect(p.steps[0]!.stage.board['a1']).toBeUndefined();
    expect(p.steps[1]!.stage.board['b2']?.pieceType).toBe('rook');
    expect(p.steps[0]!.stage.moveCredits).toBe(1);
    expect(p.steps[1]!.stage.moveCredits).toBe(0);
    expect(legalPlayerMoves(p.steps[0]!.stage, 'a2', config).length).toBeGreaterThan(0);
  });

  it('marks entries after the first failing one not ok', () => {
    const stage = deepFreeze(stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { moveCredits: 2 }));
    const p = previewSteps(runOf(), stage, [mv('a1', 'a2'), mv('a2', 'c3'), mv('a2', 'b2')], config);
    expect(p.steps.map((s) => s.ok)).toEqual([true, false, false]);
    expect(p.error).toMatchObject({ kind: 'illegal_move', atStep: 1 });
    expect(p.result).toBeNull();
    expect(p.steps[1]!.stage.board).toEqual(p.steps[0]!.stage.board);
  });

  it('a queue whose steps all resolve but ends in check is refused with simulate\'s error', () => {
    const stage = deepFreeze(stageOf({ e1: 'K', e2: 'R', e8: 'r', h8: 'k' }));
    const run = runOf();
    const q = [mv('e2', 'a2')];
    const sim = simulate(run, stage, q, config);
    expect(sim.ok).toBe(false);
    const p = previewSteps(run, stage, q, config);
    expect(p.steps.map((s) => s.ok)).toEqual([true]);
    expect(p.error).toEqual((sim as { error: unknown }).error);
    expect(p.error?.kind).toBe('king_in_check_at_end');
  });

  it('empty queue', () => {
    const stage = deepFreeze(stageOf({ e1: 'K', a1: 'R', e8: 'k' }));
    const p = previewSteps(runOf(), stage, [], config);
    expect(p.steps).toEqual([]);
    expect(p.error).toEqual({ kind: 'empty_queue' });
    expect(p.result).toBeNull();
  });

  it('skill-only queue', () => {
    const run = runOf({ loadout: [{ skillId: 'twin_step' }] });
    const stage = deepFreeze(stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { focus: 3 }));
    const p = previewSteps(run, stage, [{ type: 'ACTIVATE_SKILL', skillId: 'twin_step' }], config);
    expect(p.steps.map((s) => s.ok)).toEqual([true]);
    expect(p.error?.kind).toBe('empty_queue');
    expect(p.result).toBeNull();
  });

  it('stalemating queue', () => {
    const stage = deepFreeze(stageOf({ e1: 'K', b6: 'B', f7: 'Q', h8: 'k', a7: 'p' }));
    const p = previewSteps(runOf(), stage, [mv('b6', 'a7')], config);
    expect(p.error).toBeNull();
    expect(p.result?.stage.endReason).toBe('enemy_stalemated');
  });

  it('a non-active stage is refused, never thrown', () => {
    const stage = deepFreeze(stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { status: 'won' }));
    const p = previewSteps(runOf(), stage, [mv('a1', 'a2')], config);
    expect(p.error).toEqual({ kind: 'stage_not_active' });
    expect(p.steps.map((s) => s.ok)).toEqual([false]);
  });
});

describe('hudEconomy', () => {
  // Non-capturing back-rank mate: Ra1-a8# against Kh8 with pawns g7, h7.
  const mateBoard = { e1: 'K', a1: 'R', h8: 'k', g7: 'p', h7: 'p' };
  const mateIn = 4;

  for (const actIndex of [0, 1, 2]) {
    for (const stageIndex of [0, 2]) {
      for (const coins of [0, 12, 30]) {
        for (let turnsUsed = mateIn - 2; turnsUsed <= mateIn + 2; turnsUsed++) {
          it(`I10: act ${actIndex + 1} stage ${stageIndex} wallet ${coins} turnsUsed ${turnsUsed}`, () => {
            const run: RunState = runOf({ actIndex, stageIndex, coins });
            const overtimePaid = Math.max(0, turnsUsed - mateIn) * 2;
            const stage = deepFreeze(stageOf(mateBoard, { mateIn, turnsUsed, overtimePaid }));
            const h = hudEconomy(run, stage, config);
            const sim = simulate(run, stage, [mv('a1', 'a8')], config);
            if (!sim.ok) throw new Error(JSON.stringify(sim.error));
            expect(sim.value.stage.status).toBe('won');
            expect(h.parBonusIfMateNow + h.pendingBase + h.interestIfMateNow).toBe(sim.value.award!.coins);
            expect(h.pendingBase).toBe(pendingBase(run, stage, config));
            expect(h.lastParTurn).toBe(turnsUsed + 1 === mateIn);
            expect(h.mateIn).toBe(mateIn);
            expect(h.turn).toBe(turnsUsed + 1);
            expect(h.freeTurnsLeft).toBe(Math.max(0, mateIn - turnsUsed));
          });
        }
      }
    }
  }

  it('next-turn potential: within par it is the full mate; past par it nets the overtime bill', () => {
    const stage = stageOf(mateBoard, { mateIn: 4, turnsUsed: 0 });
    const h0 = hudEconomy(runOf({ coins: 12 }), stage, config);
    expect(h0.nextTurnPotential).toBe(h0.parBonusIfMateNow + h0.pendingBase + h0.interestIfMateNow);
    // Act 1: base 4, overtime 2. At turnsUsed 4 the next turn is overtime turn 1: 2 from the reward.
    const past = hudEconomy(runOf({ coins: 0 }), stageOf(mateBoard, { mateIn: 4, turnsUsed: 4 }), config);
    expect(past.nextTurnPotential).toBe(2);
    // Reward spent: the bill comes from the wallet (12 -> 10), interest on 10.
    const spent = hudEconomy(runOf({ coins: 12 }), stageOf(mateBoard, { mateIn: 4, turnsUsed: 6, overtimePaid: 4 }), config);
    expect(spent.nextTurnPotential).toBe(Math.floor(10 / config.economy.interest.per) * config.economy.interest.coins);
    // Cannot pay: the stage would be lost, nothing to win.
    const broke = hudEconomy(runOf({ coins: 1 }), stageOf(mateBoard, { mateIn: 4, turnsUsed: 6, overtimePaid: 4 }), config);
    expect(broke.nextTurnPotential).toBe(0);
  });
});
