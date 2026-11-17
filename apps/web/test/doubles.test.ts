import { describe, expect, it } from 'vitest';
import { commit, expectedSeed, newRun, provideStage, start } from '@checkbreaker/run';
import { runConfig } from '../src/config';
import { STARTER_MATE, starterMateStage, testStageSource } from './doubles';

describe('STARTER_MATE', () => {
  it('mates through start + commit on a new run with the starter deck', () => {
    const s0 = newRun('7F3A-2210', runConfig);
    const p = provideStage(s0, starterMateStage(expectedSeed('7F3A-2210', 0, 0)), runConfig);
    if (!p.ok) throw new Error(JSON.stringify(p.error));
    const st = start(p.value.session, STARTER_MATE.placements, runConfig);
    if (!st.ok) throw new Error(JSON.stringify(st.error));
    const c = commit(st.value.session, [STARTER_MATE.move], runConfig);
    if (!c.ok) throw new Error(JSON.stringify(c.error));
    expect(c.value.session.run.history.at(-1)?.outcome).toBe('win');
    expect(c.value.session.phase).not.toBe('action');
  });
});

describe('testStageSource', () => {
  it('answers with the expected seed for any stage', async () => {
    const src = testStageSource();
    const s = newRun('7F3A-2210', runConfig);
    const a = await src.request(1, s.next!.request);
    expect(a.ok && a.stage.stageSeed).toBe(expectedSeed('7F3A-2210', 0, 0));
    const later = { ...s.next!.request, actIndex: 1, stageIndex: 2 };
    const b = await src.request(2, later);
    expect(b.ok && b.stage.stageSeed).toBe(expectedSeed('7F3A-2210', 1, 2));
  });
});
