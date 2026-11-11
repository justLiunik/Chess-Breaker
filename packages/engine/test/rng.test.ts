import { describe, expect, it } from 'vitest';
import { draw, hash, mix32, rng } from '../src/rng';

describe('rng', () => {
  it('hashes with FNV-1a', () => {
    expect(hash('a')).toBe(3826002220);
    expect(hash('9C41-0B77', 2)).toBe(1697473919);
    expect(hash('7F3A-2210', 0, 0)).toBe(322901166);
  });
  it('draws from a seed and cursor', () => {
    expect(rng('9C41-0B77', 0)).toEqual({ value: 0.40303663280792534, next: 1 });
  });
  it('mix32 matches the murmur3 fmix32 reference', () => {
    expect(mix32(0)).toBe(0);
    expect(mix32(1)).toBe(0x514e28b7);
    expect(mix32(0xffffffff)).toBe(0x81f16f39);
  });
  it('draw is reproducible and in [0, 1)', () => {
    expect(draw('s', 'par')).toBe(draw('s', 'par'));
    expect(draw('s', 'par')).not.toBe(draw('s', 'spawn'));
  });
  it('draw passes chi-square over 8 buckets for 10,000 consecutive values', () => {
    const buckets = new Array(8).fill(0);
    for (let i = 0; i < 10_000; i++) buckets[Math.floor(draw('chi', 'formation', i) * 8)]++;
    const chi = buckets.reduce((s, n) => s + (n - 1250) ** 2 / 1250, 0);
    expect(chi).toBeLessThan(24.32); // p = 0.001, 7 degrees of freedom
  });
});
