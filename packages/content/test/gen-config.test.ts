import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enemyArmyValue, loadGenConfig, valueBandFor } from '../src/index';

describe('loadGenConfig', () => {
  const c = loadGenConfig();

  it('maps the generation keys and the engine config', () => {
    expect(c.gen.solver.deep.width).toBe(32);
    expect(c.gen.solver.nodeBudget).toBe(40000);
    expect(c.gen.formations).toEqual({ maxPerTemplate: 50, minPerTemplate: 20 });
    expect(c.gen.acceptance.medianMateTurnTolerance).toBe(1);
    expect(c.gen.retention.queen?.legendary).toBe(0.2);
    expect(c.gen.promotion.tierUpChance).toBe(0.75);
    expect(c.gen.rarityPool.act2.ceiling).toBe('unique');
    expect(c.gen.rarityPool.act3.weights.legendary).toBe(6);
    expect(c.pieceValues.queen).toBe(9);
  });

  it('is deep-frozen', () => {
    expect(Object.isFrozen(c.gen.solver.deep)).toBe(true);
    expect(Object.isFrozen(c.gen.valueBands.act1)).toBe(true);
  });

  it('computes value bands like the validator', () => {
    expect(valueBandFor(2, 'normal', c)).toEqual([10, 14]);
    expect(valueBandFor(2, 'boss', c)).toEqual([12.5, 17.5]);
  });

  it('sums piece values, king excluded', () => {
    expect(enemyArmyValue(['king', 'rook', 'knight', 'pawn'], c)).toBe(
      c.pieceValues.rook + c.pieceValues.knight + c.pieceValues.pawn,
    );
  });

  it('throws on a missing generation key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-config-'));
    const file = join(dir, 'economy.yaml');
    const text = readFileSync(new URL('../../../data/economy.yaml', import.meta.url), 'utf8');
    writeFileSync(file, text.replace('nodeBudget:', 'nodeBudgetX:'));
    expect(() => loadGenConfig(file)).toThrow('economy.yaml is missing required field: generation.solver.nodeBudget');
  });
});
