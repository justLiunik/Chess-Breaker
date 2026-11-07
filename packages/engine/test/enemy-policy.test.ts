import { describe, expect, it } from 'vitest';
import { fromBoard } from '../src/position';
import { toSquare } from '../src/square';
import { scoreRootMoves } from '../src/enemy/search';
import { enemyMove } from '../src/enemy/policy';
import { config, deepFreeze, stageOf } from './helpers';

const FIRST_STEPS = { e8: 'k', a7: 'p', b7: 'p', c7: 'p', f7: 'p', g7: 'p', c6: 'n', e1: 'K' };

const tied = (stage: ReturnType<typeof stageOf>, depth: number): string[] => {
  const res = scoreRootMoves(fromBoard(stage.board), stage.turnLimit - stage.turnsUsed, depth, config);
  const best = Math.max(...res.map((r) => r.score));
  return res.filter((r) => r.score === best).map((r) => `${toSquare(r.move.from)}${toSquare(r.move.to)}`);
};
const str = (m: { from: string; to: string }) => `${m.from}${m.to}`;

const SPARSE = stageOf({ e8: 'k', e1: 'K', a1: 'R' }, { enemyPolicy: { type: 'best_move', depth: 1 } });

describe('enemyMove', () => {
  it('is deterministic, with no hidden state across calls', () => {
    const other = stageOf(FIRST_STEPS);
    const a = enemyMove(SPARSE, 7, config);
    enemyMove(other, 3, config);
    const c = enemyMove(SPARSE, 7, config);
    expect(c).toEqual(a);
    expect(a.policy).toEqual(SPARSE.enemyPolicy);
  });

  it('picks tied[seed % count]', () => {
    const t = tied(SPARSE, 1);
    expect(t.length).toBeGreaterThanOrEqual(2);
    for (const seed of [0, 1, 5, 12]) {
      expect(str(enemyMove(SPARSE, seed, config).move)).toBe(t[seed % t.length]);
    }
    expect(t[0 % t.length]).not.toBe(t[1 % t.length]);
  });

  it('plays a scripted line move and advances the cursor', () => {
    const stage = deepFreeze(stageOf(FIRST_STEPS, {
      enemyPolicy: { type: 'scripted', line: ['c6e5', 'e5c4'], fallbackDepth: 2 },
    }));
    const r = enemyMove(stage, 0, config);
    expect(str(r.move)).toBe('c6e5');
    expect(r.policy.cursor).toBe(1);
    expect(r.policy.fellBack).toBeFalsy();
  });

  it('falls back permanently when the line move is illegal', () => {
    const pieces = { ...FIRST_STEPS };
    delete (pieces as Record<string, string>).c6;
    const stage = deepFreeze(stageOf(pieces, {
      enemyPolicy: { type: 'scripted', line: ['c6e5', 'e5c4'], fallbackDepth: 2, cursor: 0 },
    }));
    const ref = enemyMove(
      { ...stage, enemyPolicy: { type: 'best_move', depth: 2 } }, 4, config);
    const r = enemyMove(stage, 4, config);
    expect(r.move).toEqual(ref.move);
    expect(r.policy.fellBack).toBe(true);
    expect(r.policy.cursor).toBe(0);
    const again = enemyMove({ ...stage, enemyPolicy: r.policy }, 4, config);
    expect(again.policy.fellBack).toBe(true);
    expect(again.policy.cursor).toBe(0);
  });

  it('falls back when the line is exhausted', () => {
    const stage = stageOf(FIRST_STEPS, {
      enemyPolicy: { type: 'scripted', line: ['c6e5'], cursor: 1, fallbackDepth: 2 },
    });
    const r = enemyMove(stage, 2, config);
    expect(r.policy.fellBack).toBe(true);
    expect(r.policy.cursor).toBe(1);
  });

  it('defaults the depth from config', () => {
    const stage = stageOf(FIRST_STEPS, { enemyPolicy: { type: 'best_move' } });
    expect(config.enemyAI.search.defaultFallbackDepth).toBeLessThanOrEqual(3);
    expect(enemyMove(stage, 0, config).move).toBeTruthy();
  });
});
