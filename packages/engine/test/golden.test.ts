import { describe, expect, it } from 'vitest';
import { commitQueue } from '../src/rules';
import { config, deepFreeze } from './helpers';
import { scenarios } from './golden/scenarios';

describe('golden commitQueue scenarios', () => {
  it('has 33 uniquely named cases', () => {
    expect(scenarios).toHaveLength(33);
    expect(new Set(scenarios.map((s) => s.name)).size).toBe(33);
  });
  for (const s of scenarios) {
    it(s.name, () => {
      const result = commitQueue(deepFreeze(s.run), deepFreeze(s.stage), deepFreeze(s.queue), config);
      expect(result).toMatchSnapshot();
    });
  }
});
