import { describe, expect, it } from 'vitest';
import { pickWeighted, retainTier, rollTier } from '../src/rarity-roll';

const w = { normal: 0, rare: 2, unique: 1, legendary: 1 };

describe('pickWeighted', () => {
  it('u=0 gives the first positive weight, u near 1 the last positive', () => {
    expect(pickWeighted(['normal', 'rare', 'unique', 'legendary'], w, 0)).toBe('rare');
    expect(pickWeighted(['normal', 'rare', 'unique', 'legendary'], w, 0.9999)).toBe('legendary');
  });
  it('rollTier picks in tier order by cumulative weight', () => {
    expect(rollTier(w, 0.49)).toBe('rare');
    expect(rollTier(w, 0.5)).toBe('unique');
    expect(rollTier(w, 0.75)).toBe('legendary');
  });
});

describe('retainTier', () => {
  const ret = { queen: { legendary: 0.2 } };
  it('keeps the tier below the keep probability, drops one at or above it', () => {
    expect(retainTier('queen', 'legendary', ret, 0.1)).toBe('legendary');
    expect(retainTier('queen', 'legendary', ret, 0.2)).toBe('unique');
  });
  it('leaves pieces and tiers without an entry alone', () => {
    expect(retainTier('rook', 'legendary', ret, 0.99)).toBe('legendary');
    expect(retainTier('queen', 'unique', ret, 0.99)).toBe('unique');
  });
  it('never drops below normal', () => {
    expect(retainTier('queen', 'normal', { queen: { normal: 0.1 } }, 0.9)).toBe('normal');
  });
});
