import { describe, expect, it } from 'vitest';
import { abandon, devSkipStage, expectedSeed, leave, newRun, provideStage, restartStage, sell, start } from '../src/session';
import type { RunResult, RunSession } from '../src/types';
import { deepFreeze, mateInOneStage, runConfig as c } from './fixtures';

const SEED = '7F3A-2210';
const CLUE = [{ instanceId: 'p_king_01', to: 'e1' }, { instanceId: 'p_bishop_04', to: 'a3' }];

const value = (r: RunResult): RunSession => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return deepFreeze(r.value.session);
};
const seedOf = (s: RunSession): string => expectedSeed(s.run.seed, s.next!.request.actIndex, s.next!.request.stageIndex);
const deployment = (clue: typeof CLUE | null = CLUE): RunSession => {
  const s = newRun(SEED, c);
  return value(provideStage(s, mateInOneStage(seedOf(s)), c, clue));
};
const BISHOP = { instanceId: 'p_bishop_04', to: 'a3', pieceType: 'bishop', rarity: 'normal' };

describe('placement clue in the run layer', () => {
  it('provideStage in awaiting_stage resolves the clue into session.clue', () => {
    const s = deployment();
    expect(s.phase).toBe('deployment');
    expect(s.clue).toEqual([
      { instanceId: 'p_king_01', to: 'e1', pieceType: 'king' },
      { instanceId: 'p_bishop_04', to: 'a3', pieceType: 'bishop', rarity: 'normal' },
    ]);
  });

  it('provideStage without a clue gives clue null', () => {
    const s = newRun(SEED, c);
    expect(value(provideStage(s, mateInOneStage(seedOf(s)), c)).clue).toBeNull();
  });

  it('a clue naming an instance missing from the request deck becomes null', () => {
    const s = deployment([{ instanceId: 'p_nope_99', to: 'e1' }]);
    expect(s.clue).toBeNull();
    expect(s.phase).toBe('deployment');
  });

  it('start and restartStage keep the clue', () => {
    const d = deployment();
    const started = value(start(d, [{ instanceId: 'p_king_01', to: 'e1' }], c));
    expect(started.phase).toBe('action');
    expect(started.clue).toEqual(d.clue);
    const back = value(restartStage(started, c));
    expect(back.phase).toBe('deployment');
    expect(back.clue).toEqual(d.clue);
  });

  it('the clue is cleared when the stage ends', () => {
    const skipped = value(devSkipStage(deployment(), c));
    expect(skipped.clue).toBeNull();
    expect(skipped.next!.clue).toBeNull();
    expect(value(abandon(deployment())).clue).toBeNull();
  });

  it('in the shop the clue waits in next.clue and survives a sale made before the worker answered', () => {
    let s = value(devSkipStage(deployment(null), c));
    expect(s.phase).toBe('shop');
    s = value(sell(s, 'p_bishop_04', c));
    s = value(provideStage(s, mateInOneStage(seedOf(s)), c, CLUE));
    expect(s.phase).toBe('shop');
    expect(s.clue).toBeNull();
    expect(s.next!.clue).toContainEqual(BISHOP);
    const clue = s.next!.clue;
    s = value(leave(s, c));
    expect(s.phase).toBe('deployment');
    expect(s.next).toBeNull();
    expect(s.clue).toEqual(clue);
    expect(s.run.deck.some(p => p.instanceId === 'p_bishop_04')).toBe(false);
  });
});
