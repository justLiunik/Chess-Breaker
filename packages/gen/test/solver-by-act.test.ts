import { describe, expect, it } from 'vitest';
import type { GenConfig } from '@checkbreaker/content';
import { solveStage } from '../src/solver';
import { config, deckRun, deepFreeze, generatedStages } from './helpers';

const withByAct = (byAct: unknown): GenConfig =>
  deepFreeze({ ...config, gen: { ...config.gen, solver: { ...config.gen.solver, byAct } } }) as GenConfig;

const TIMEOUT = 120_000;

describe('solveStage with solver.byAct', () => {
  it('an act1 override changes an Act I solve: nodeBudget 1 finds nothing', () => {
    const { stage } = generatedStages('tpl-act1-first-steps', 1)[0]!;
    const run = deckRun('starter', 0, 0);
    const r = solveStage(run, stage, withByAct({ act1: { nodeBudget: 1 } }));
    expect(r.win).toBeNull();
    expect(r.stats.screenNodes + r.stats.deepNodes).toBeLessThanOrEqual(1);
  }, TIMEOUT);

  it('an act1 override leaves an Act II solve byte-identical', () => {
    const { stage } = generatedStages('tpl-act2-fortress', 1)[0]!;
    const run = deckRun('mid', 1, 0);
    const plain = solveStage(run, stage, config);
    const over = solveStage(run, stage, withByAct({ act1: { nodeBudget: 1, deep: { candidates: 1 } } }));
    expect(JSON.stringify(over)).toBe(JSON.stringify(plain));
  }, TIMEOUT);

  it('an empty byAct is byte-identical to none', () => {
    const { stage } = generatedStages('tpl-act1-first-steps', 1)[0]!;
    const run = deckRun('starter', 0, 0);
    const small = { nodeBudget: 300 };
    const a = solveStage(run, stage, deepFreeze({ ...config, gen: { ...config.gen, solver: { ...config.gen.solver, ...small } } }));
    const b = solveStage(run, stage, deepFreeze({ ...config, gen: { ...config.gen, solver: { ...config.gen.solver, ...small, byAct: {} } } }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, TIMEOUT);
});
