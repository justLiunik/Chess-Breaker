import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import { stageEconomy } from '../src/economy';
import { config, deepFreeze, runOf, stageOf } from './helpers';
import type { Action, Award, GameEvent, RunState, StageState } from '../src/types';

const mv = (from: string, to: string): Action[] => [{ type: 'MOVE', from, to }];
// Back-rank mate: Ra1-a8# against Kh8 with pawns g7, h7.
const mateBoard = { e1: 'K', a1: 'R', h8: 'k', g7: 'p', h7: 'p' };
// A quiet, non-mating position: the rook shuffles, Black's king has room.
const quietBoard = { e1: 'K', a1: 'R', e8: 'k' };
const d1 = { type: 'best_move' as const, depth: 1 };

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function win(run: RunState, stage: StageState): Award {
  const v = ok(simulate(run, stage, mv('a1', 'a8'), config));
  expect(v.stage.status).toBe('won');
  return v.award!;
}

describe('stageEconomy', () => {
  it('reads the act amounts, boss-scaling base and par bonus but never the overtime cost', () => {
    expect(stageEconomy(runOf(), config)).toEqual({ baseFull: 4, parBonusFull: 6, overtimeCost: 2 });
    expect(stageEconomy(runOf({ actIndex: 1, stageIndex: 2 }), config)).toEqual({ baseFull: 9, parBonusFull: 14, overtimeCost: 3 });
    expect(stageEconomy(runOf({ actIndex: 2, stageIndex: 2 }), config)).toEqual({ baseFull: 12, parBonusFull: 18, overtimeCost: 4 });
  });
});

describe('the award', () => {
  it('a mate within the par pays base + parBonus', () => {
    const a = win(runOf(), stageOf(mateBoard, { mateIn: 3, turnsUsed: 1 }));
    expect(a).toEqual({ coins: 10, base: 4, parBonus: 6 });
  });

  it('a mate on the par turn still pays parBonus', () => {
    expect(win(runOf(), stageOf(mateBoard, { mateIn: 3, turnsUsed: 2 })).parBonus).toBe(6);
  });

  it('a mate past the par pays base net of overtime and no parBonus', () => {
    const a = win(runOf(), stageOf(mateBoard, { mateIn: 3, turnsUsed: 3, overtimePaid: 2 }));
    expect(a).toEqual({ coins: 2, base: 2, parBonus: 0 });
  });

  it('a win after the reward is spent pays 0 base, never negative', () => {
    const v = ok(simulate(runOf({ coins: 7 }), stageOf(mateBoard, { mateIn: 3, turnsUsed: 5, overtimePaid: 6 }), mv('a1', 'a8'), config));
    expect(v.award).toEqual({ coins: 0, base: 0, parBonus: 0 });
    expect(v.run.coins).toBe(7);
  });

  it('boss amounts are rounded: act2 boss 9 + 14, act3 boss 12 + 18', () => {
    const a2 = win(runOf({ actIndex: 1, stageIndex: 2 }), stageOf(mateBoard, { mateIn: 3, turnsUsed: 1 }));
    expect(a2).toEqual({ coins: 23, base: 9, parBonus: 14 });
    const a3 = win(runOf({ actIndex: 2, stageIndex: 2 }), stageOf(mateBoard, { mateIn: 3, turnsUsed: 1 }));
    expect(a3).toEqual({ coins: 30, base: 12, parBonus: 18 });
  });
});

describe('overtime', () => {
  it('R4 never ends the stage', () => {
    const stage = stageOf(quietBoard, { mateIn: 2, turnsUsed: 6 });
    const v = ok(simulate(runOf(), stage, mv('a1', 'a2'), config));
    expect(v.stage.status).toBe('active');
    expect(v.stage.turnsUsed).toBe(7);
  });

  it('the first turn past the par is charged from the reward', () => {
    const run = deepFreeze(runOf({ coins: 5 }));
    const stage = stageOf(quietBoard, { mateIn: 3, turnsUsed: 2, enemyPolicy: d1 });
    const v = ok(commitQueue(run, stage, mv('a1', 'a2'), config));
    expect(v.events).toContainEqual({ type: 'overtime_paid', turn: 4, fromReward: 2, fromWallet: 0 });
    expect(v.stage.overtimePaid).toBe(2);
    expect(v.run.coins).toBe(5);
    expect(v.stage.status).toBe('active');
  });

  it('a turn within the par is not charged', () => {
    const stage = stageOf(quietBoard, { mateIn: 3, turnsUsed: 1, enemyPolicy: d1 });
    const v = ok(commitQueue(runOf({ coins: 5 }), stage, mv('a1', 'a2'), config));
    expect(v.events.map((e: GameEvent) => e.type)).not.toContain('overtime_paid');
    expect(v.stage.overtimePaid).toBe(0);
  });

  it('a charge straddling the reward splits reward and wallet', () => {
    const stage = stageOf(quietBoard, { mateIn: 3, turnsUsed: 3, overtimePaid: 3, enemyPolicy: d1 });
    const v = ok(commitQueue(runOf({ coins: 5 }), stage, mv('a1', 'a2'), config));
    expect(v.events).toContainEqual({ type: 'overtime_paid', turn: 5, fromReward: 1, fromWallet: 1 });
    expect(v.run.coins).toBe(4);
    expect(v.stage.overtimePaid).toBe(5);
  });

  it('a turn neither can pay ends the stage with out_of_coins', () => {
    const stage = stageOf(quietBoard, { mateIn: 3, turnsUsed: 3, overtimePaid: 4, enemyPolicy: d1 });
    const v = ok(commitQueue(runOf({ coins: 1 }), stage, mv('a1', 'a2'), config));
    expect(v.stage.status).toBe('lost');
    expect(v.stage.endReason).toBe('out_of_coins');
    expect(v.run.coins).toBe(1);
    expect(v.events).toContainEqual({ type: 'stage_lost', endReason: 'out_of_coins' });
    expect(v.events.map((e: GameEvent) => e.type)).not.toContain('overtime_paid');
  });

  it('player_mated outranks out_of_coins', () => {
    // Ra8 mates the White king on h1 after Kg1; the next turn would be unpayable.
    const stage = stageOf(
      { h1: 'K', b2: 'r', a8: 'r', e8: 'k' },
      { mateIn: 3, turnsUsed: 3, overtimePaid: 4, enemyPolicy: { type: 'scripted', line: ['a8a1'], fallbackDepth: 1 } },
    );
    const v = ok(commitQueue(runOf({ coins: 0 }), stage, mv('h1', 'g1'), config));
    expect(v.stage.endReason).toBe('player_mated');
    expect(v.events.map((e: GameEvent) => e.type)).not.toContain('overtime_paid');
  });
});
