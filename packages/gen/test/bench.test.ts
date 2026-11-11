import { describe, expect, it } from 'vitest';
import { checkPreconditions } from '../src/preconditions';
import { config, exampleRun, generatedStages } from './helpers';

const BOARDS = 50;
const WARMUP = 5;

describe('no_first_turn_mate speed', () => {
  it(`mean under 20 ms per board over ${BOARDS} generated boards, mid deck`, { timeout: 120_000 }, () => {
    const run = exampleRun('mid');
    const boards = generatedStages('tpl-act2-fortress', BOARDS);
    const only = { ...boards[0]!.tpl, preconditions: ['no_first_turn_mate' as const] };
    for (let i = 0; i < WARMUP; i++) checkPreconditions(run, boards[i]!.stage, only, { extraPawns: 0 }, config);
    const times: number[] = [];
    let failed = 0;
    for (const { stage } of boards) {
      const t0 = performance.now();
      if (checkPreconditions(run, stage, only, { extraPawns: 0 }, config) !== null) failed++;
      times.push(performance.now() - t0);
    }
    const mean = times.reduce((s, x) => s + x, 0) / times.length;
    const max = Math.max(...times);
    console.log(`no_first_turn_mate: mean ${mean.toFixed(2)} ms, max ${max.toFixed(2)} ms per board; ${failed}/${BOARDS} boards have a turn-1 mate`);
    expect(mean).toBeLessThan(20);
  });
});
