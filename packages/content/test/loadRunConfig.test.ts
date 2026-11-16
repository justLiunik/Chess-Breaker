import { describe, expect, it } from 'vitest';
import { loadRunConfig } from '../src/loadRunConfig';

describe('loadRunConfig', () => {
  const c = loadRunConfig();
  it('reads the yaml values', () => {
    expect(c.run.shop.skillChance).toBe(0.2);
    expect(c.run.basePrice.queen).toBe(16);
    expect(c.run.freeSkill?.skillId).toBe('twin_step');
    expect(c.run.services.maxRerollsPerVisit).toBe(3);
    expect(c.run.acts).toBe(3);
    expect(c.run.starterDeck.knight).toBe(2);
    expect(c.run.merge).toEqual({ inputs: 3, maxInputTier: 'unique' });
    expect(c.run.rarityMultiplier.rare).toBe(1.5);
    expect(c.run.services.sell.capAtPricePaid).toBe(true);
    expect(c.run.rarityPool.act1.ceiling).toBe('rare');
  });
  it('is deep-frozen and extends the engine config', () => {
    expect(Object.isFrozen(c.run)).toBe(true);
    expect(Object.isFrozen(c.run.shop.slot1Types)).toBe(true);
    expect(c.rules).toBeDefined();
  });
});
