import { describe, expect, it } from 'vitest';
import type { GenConfig } from '@checkbreaker/content';
import { solveStage } from '../src/solver';
import { config, deckRun, deepFreeze, generatedStages } from './helpers';

const withByAct = (byAct: unknown): GenConfig =>
  deepFreeze({ ...config, gen: { ...config.gen, solver: { ...config.gen.solver, byAct, byTemplate: undefined } } }) as GenConfig;

const withBy = (byAct: unknown, byTemplate: unknown, solver: object = {}): GenConfig =>
  deepFreeze({ ...config, gen: { ...config.gen, solver: { ...config.gen.solver, ...solver, byAct, byTemplate } } }) as GenConfig;

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
    const plain = solveStage(run, stage, withByAct(undefined));
    const over = solveStage(run, stage, withByAct({ act1: { nodeBudget: 1, deep: { candidates: 1 } } }));
    expect(JSON.stringify(over)).toBe(JSON.stringify(plain));
  }, TIMEOUT);

  it('an empty byAct is byte-identical to none', () => {
    const { stage } = generatedStages('tpl-act1-first-steps', 1)[0]!;
    const run = deckRun('starter', 0, 0);
    const small = { nodeBudget: 300 };
    const a = solveStage(run, stage, withBy(undefined, undefined, small));
    const b = solveStage(run, stage, withBy({}, {}, small));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, TIMEOUT);

  it('a byTemplate override for one template leaves another template of the same act byte-identical', () => {
    const { stage } = generatedStages('tpl-act1-open-field', 1)[0]!;
    const run = deckRun('starter', 0, 0);
    const small = { nodeBudget: 300 };
    const plain = solveStage(run, stage, withBy(undefined, undefined, small));
    const over = solveStage(run, stage, withBy(undefined, { 'tpl-act1-first-steps': { nodeBudget: 1 } }, small));
    expect(JSON.stringify(over)).toBe(JSON.stringify(plain));
  }, TIMEOUT);

  it('a byTemplate override changes its own template and wins over byAct', () => {
    const { stage } = generatedStages('tpl-act1-first-steps', 1)[0]!;
    const run = deckRun('starter', 0, 0);
    const r = solveStage(run, stage, withBy({ act1: { nodeBudget: 40000 } }, { 'tpl-act1-first-steps': { nodeBudget: 1 } }));
    expect(r.win).toBeNull();
    expect(r.stats.screenNodes + r.stats.deepNodes).toBeLessThanOrEqual(1);
  }, TIMEOUT);
});
