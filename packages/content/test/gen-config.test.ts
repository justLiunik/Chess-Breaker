import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enemyArmyValue, loadGenConfig, solverSettingsFor, valueBandFor } from '../src/index';
import type { GenConfig } from '../src/index';

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

describe('solverSettingsFor', () => {
  const c = loadGenConfig();
  const withByAct = (byAct: unknown): GenConfig =>
    ({ ...c, gen: { ...c.gen, solver: { ...c.gen.solver, byAct } } }) as GenConfig;

  it('returns the global block when byAct has no entry for the act', () => {
    const { byAct: _drop, ...global } = c.gen.solver;
    expect(solverSettingsFor(0, c)).toEqual(global);
    expect(solverSettingsFor(1, withByAct({ act1: { expansion: 9 } }))).toEqual(global);
  });

  it('deep-merges a partial override and keeps the other keys', () => {
    const r = solverSettingsFor(0, withByAct({ act1: { deep: { candidates: 64 }, deployment: { kingSquares: 8 } } }));
    expect(r.deep).toEqual({ candidates: 64, width: c.gen.solver.deep.width });
    expect(r.deployment.kingSquares).toBe(8);
    expect(r.deployment.maxSubsets).toBe(c.gen.solver.deployment.maxSubsets);
    expect(r.deployment.score).toEqual(c.gen.solver.deployment.score);
    expect(r.nodeBudget).toBe(c.gen.solver.nodeBudget);
  });

  it('never leaks byAct into the result', () => {
    expect('byAct' in solverSettingsFor(0, withByAct({ act1: { expansion: 4 } }))).toBe(false);
    expect('byAct' in solverSettingsFor(2, c)).toBe(false);
  });

  it('does not mutate a frozen config', () => {
    const cfg = withByAct({ act1: { deep: { candidates: 64 } } });
    solverSettingsFor(0, cfg);
    expect(cfg.gen.solver.deep.candidates).toBe(c.gen.solver.deep.candidates);
  });

  it('loads byAct from economy.yaml, frozen; absent when the yaml has none', () => {
    expect(c.gen.solver.byAct).toBeUndefined();
    const file = join(mkdtempSync(join(tmpdir(), 'gen-config-')), 'economy.yaml');
    const text = readFileSync(new URL('../../../data/economy.yaml', import.meta.url), 'utf8');
    writeFileSync(file, text.replace('expansion: 3', 'expansion: 3\n    byAct: { act1: { expansion: 5 } }'));
    const loaded = loadGenConfig(file);
    expect(loaded.gen.solver.byAct).toEqual({ act1: { expansion: 5 } });
    expect(Object.isFrozen(loaded.gen.solver.byAct)).toBe(true);
    expect(solverSettingsFor(0, loaded).expansion).toBe(5);
    expect(solverSettingsFor(1, loaded).expansion).toBe(3);
  });
});
