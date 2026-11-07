import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import { config, deepFreeze } from './helpers';
import { makeCase } from './fuzzgen';

describe('parity: simulate is the first half of commitQueue', () => {
  it('holds on 1,000 random accepted queues', () => {
    let checked = 0;
    let ended = 0;
    for (let i = 0; checked < 1000; i++) {
      const { run, stage, queue } = makeCase('parity', i);
      deepFreeze(stage);
      const s = simulate(run, stage, queue, config);
      if (!s.ok) continue;
      const c = commitQueue(run, stage, queue, config);
      if (!c.ok) throw new Error(`commitQueue refused what simulate accepted at ${i}`);
      checked++;
      expect(c.value.events.slice(0, s.value.events.length)).toEqual(s.value.events);
      expect(c.value.award).toEqual(s.value.award);
      expect(c.value.run.coins).toBeGreaterThanOrEqual(s.value.run.coins);
      if (s.value.stage.status !== 'active') {
        ended++;
        expect(c.value.stage).toEqual(s.value.stage);
        expect(c.value.events).toEqual(s.value.events);
        expect(c.value.run).toEqual(s.value.run);
      } else {
        expect(c.value.stage.turnsUsed).toBe(s.value.stage.turnsUsed);
        expect(c.value.run).toEqual(s.value.run);
      }
    }
    expect(ended).toBeGreaterThan(0);
  });
});
