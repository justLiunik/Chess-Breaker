import { describe, expect, it } from 'vitest';
import { enemyClock } from '../src/economy';
import { enemyMove } from '../src/enemy/policy';
import { MAX_CLOCK } from '../src/enemy/zobrist';
import { hash } from '../src/rng';
import { applyEnemyTurn, commitQueue, simulate } from '../src/rules';
import { makeCase } from './fuzzgen';
import { config, deepFreeze, runOf, stageOf } from './helpers';

const b = { e8: 'k', e1: 'K', a1: 'R' };

describe('enemyClock', () => {
  it('within the par the clock is turns to the par, whatever the wallet', () => {
    expect(enemyClock(runOf({ coins: 0 }), stageOf(b, { mateIn: 4, turnsUsed: 1 }), config)).toBe(3);
    expect(enemyClock(runOf({ coins: 999 }), stageOf(b, { mateIn: 4, turnsUsed: 1 }), config)).toBe(3);
  });

  it('past the par the clock is the affordable overtime turns', () => {
    // act1: baseFull 4, overtimePaid 2, coins 5, cost 2 -> floor((2 + 5) / 2) = 3
    const stage = stageOf(b, { mateIn: 4, turnsUsed: 4, overtimePaid: 2 });
    expect(enemyClock(runOf({ coins: 5 }), stage, config)).toBe(3);
  });

  it('the pending reward is spent before the wallet', () => {
    const stage = stageOf(b, { mateIn: 4, turnsUsed: 5, overtimePaid: 0 });
    expect(enemyClock(runOf({ coins: 0 }), stage, config)).toBe(2); // floor(4 / 2)
    expect(enemyClock(runOf({ coins: 4 }), stage, config)).toBe(4); // floor(8 / 2)
  });

  it('past the par with nothing left the clock is 1', () => {
    const stage = stageOf(b, { mateIn: 4, turnsUsed: 6, overtimePaid: 8 });
    expect(enemyClock(runOf({ coins: 0 }), stage, config)).toBe(1);
    expect(enemyClock(runOf({ coins: 1 }), stage, config)).toBe(1);
  });

  it('enemyMove within the par does not depend on run.coins', () => {
    let n = 0;
    for (let i = 0; n < 200; i++) {
      const { run, stage } = makeCase('enemy-clock', i);
      const s = { ...stage, mateIn: Math.max(stage.mateIn, stage.turnsUsed + 1) };
      expect(enemyClock({ ...run, coins: 0 }, s, config)).toBe(enemyClock({ ...run, coins: 500 }, s, config));
      const seed = i * 7919;
      const poor = enemyMove(s, seed, enemyClock({ ...run, coins: 0 }, s, config), config);
      const rich = enemyMove(s, seed, enemyClock({ ...run, coins: 500 }, s, config), config);
      expect(rich).toEqual(poor);
      n++;
    }
  }, 120_000);

  it('a clock above the Zobrist range neither throws nor changes the pick', () => {
    const s = stageOf(b, { enemyPolicy: { type: 'best_move', depth: 2 } });
    expect(MAX_CLOCK).toBe(20);
    expect(enemyMove(s, 7, 250, config)).toEqual(enemyMove(s, 7, 20, config));
  });

  it('commitQueue is simulate, enemyMove with enemyClock, then applyEnemyTurn', () => {
    const queue = [{ type: 'MOVE' as const, from: 'a1', to: 'a2' }];
    for (const turnsUsed of [0, 4]) {
      const run = runOf({ coins: 3 });
      const stage = deepFreeze(stageOf(b, { turnsUsed, enemyPolicy: { type: 'best_move', depth: 2 } }));
      const whole = commitQueue(run, stage, queue, config);
      const sim = simulate(run, stage, queue, config);
      if (!whole.ok || !sim.ok) throw new Error('unexpected refusal');
      const pick = enemyMove(sim.value.stage, hash(stage.stageSeed, sim.value.stage.turnsUsed),
        enemyClock(sim.value.run, sim.value.stage, config), config);
      const turn = applyEnemyTurn(sim.value.run, sim.value.stage, pick, config);
      if (!turn.ok) throw new Error('unexpected refusal');
      expect(whole.value).toEqual({
        run: turn.value.run, stage: turn.value.stage, events: [...sim.value.events, ...turn.value.events], award: null,
      });
    }
  });
});
