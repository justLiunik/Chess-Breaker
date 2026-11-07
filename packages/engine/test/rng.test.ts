import { describe, expect, it } from 'vitest';
import { hash, rng } from '../src/rng';

describe('rng', () => {
  it('hashes with FNV-1a', () => {
    expect(hash('a')).toBe(3826002220);
    expect(hash('9C41-0B77', 2)).toBe(1697473919);
    expect(hash('7F3A-2210', 0, 0)).toBe(322901166);
  });
  it('draws from a seed and cursor', () => {
    expect(rng('9C41-0B77', 0)).toEqual({ value: 0.40303663280792534, next: 1 });
  });
});
