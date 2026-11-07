import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEngineConfig } from '../src/index';

describe('loadEngineConfig', () => {
  const config = loadEngineConfig();

  it('maps economy.yaml values', () => {
    expect(config.rules.freeMovesPerTurn).toBe(1);
    expect(config.rules.minMovesPerQueue).toBe(1);
    expect(config.pieceValues.queen).toBe(9);
    expect(config.economy.baseReward.act1).toBe(4);
    expect(config.economy.salvage.divisor).toBe(3);
    expect(config.enemyAI.terminal.playerMated).toBe(100000);
    expect(config.enemyAI.search.quiescenceMaxDepth).toBe(2);
  });

  it('is deep-frozen', () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.enemyAI.weights)).toBe(true);
  });

  it('throws a named error when a section is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-'));
    const real = readFileSync(join(import.meta.dirname, '../../../data/economy.yaml'), 'utf8');
    const stripped = real.replace(/^enemyAI:[\s\S]*?^(?=# -{10,}\r?\n# Skills)/m, '');
    expect(stripped).not.toContain('\nenemyAI:'); // the strip must actually remove the section
    const p = join(dir, 'economy.yaml');
    writeFileSync(p, stripped);
    expect(() => loadEngineConfig(p)).toThrow(/enemyAI/);
  });
});
