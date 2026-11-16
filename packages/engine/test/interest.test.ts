import { describe, expect, it } from 'vitest';
import { simulate } from '../src/rules';
import { interestOf } from '../src/economy';
import { config, runOf, stageOf } from './helpers';
import type { Action } from '../src/types';

const mv = (from: string, to: string): Action[] => [{ type: 'MOVE', from, to }];
const mateBoard = { e1: 'K', a1: 'R', h8: 'k', g7: 'p', h7: 'p' };

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe('interestOf', () => {
  it('pays 1 per 5 coins, capped at 5', () => {
    const wallets = [0, 4, 5, 9, 10, 14, 24, 25, 30, 100];
    expect(wallets.map((w) => interestOf(w, config))).toEqual([0, 0, 1, 1, 2, 2, 4, 5, 5, 5]);
  });
});

describe('interest in the award', () => {
  it('reads the wallet after salvage, before the award', () => {
    // Ra8 captures a knight (salvage 1): wallet at mate = 9 + 1 = 10 -> interest 2.
    const board = { ...mateBoard, a8: 'n' };
    const v = ok(simulate(runOf({ coins: 9 }), stageOf(board, { turnsUsed: 1 }), mv('a1', 'a8'), config));
    const salvage = Math.floor(config.pieceValues.knight / config.economy.salvage.divisor);
    expect(salvage).toBe(1);
    const a = v.award!;
    expect(a.interest).toBe(2);
    expect(a.coins).toBe(a.base + a.parBonus + 2);
    expect(v.run.coins).toBe(9 + salvage + a.coins);
  });

  it('wallet overtime lowers interest: it reads the wallet as passed', () => {
    const v = ok(simulate(
      runOf({ coins: 10 }),
      stageOf(mateBoard, { mateIn: 3, turnsUsed: 5, overtimePaid: 6 }),
      mv('a1', 'a8'),
      config,
    ));
    expect(v.award).toEqual({ coins: 2, base: 0, parBonus: 0, interest: 2 });
    expect(v.run.coins).toBe(12);
  });

  const acts = [0, 1, 2];
  const bosses = [false, true];
  const wallets = [0, 12, 30];
  for (const actIndex of acts) {
    for (const boss of bosses) {
      for (const delta of [-1, 0, 1, 2, 3]) {
        for (const wallet of wallets) {
          it(`stage pays base − overtime + par bonus + interest (act ${actIndex + 1}${boss ? ' boss' : ''}, mate ${delta >= 0 ? '+' : ''}${delta}, wallet ${wallet})`, () => {
            const mateIn = 3;
            const turnsUsed = mateIn + delta - 1; // the mating turn is turnsUsed + 1
            const act = `act${actIndex + 1}` as 'act1' | 'act2' | 'act3';
            const scale = boss ? config.economy.baseReward.bossMultiplier : 1;
            const baseFull = Math.round(config.economy.baseReward[act] * scale);
            const parFull = Math.round(config.economy.parBonus[act] * scale);
            const over = Math.max(0, turnsUsed + 1 - mateIn);
            const overtimePaid = Math.min(over * config.economy.overtimeCost[act], baseFull);
            const base = Math.max(0, baseFull - overtimePaid);
            const parBonus = turnsUsed + 1 <= mateIn ? parFull : 0;
            const { per, coins, max } = config.economy.interest;
            const interest = Math.min(max, Math.floor(wallet / per) * coins);
            const v = ok(simulate(
              runOf({ coins: wallet, actIndex, stageIndex: boss ? 2 : 0 }),
              stageOf(mateBoard, { mateIn, turnsUsed, overtimePaid }),
              mv('a1', 'a8'),
              config,
            ));
            expect(v.award).toEqual({ coins: base + parBonus + interest, base, parBonus, interest });
            expect(v.run.coins).toBe(wallet + base + parBonus + interest);
          });
        }
      }
    }
  }
});
