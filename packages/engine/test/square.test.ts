import { describe, expect, it } from 'vitest';
import { fileOf, isSquare, rankOf, toIndex, toSquare } from '../src/square';

describe('square', () => {
  it('maps squares to indices', () => {
    expect(toIndex('a1')).toBe(0);
    expect(toIndex('h8')).toBe(63);
    expect(toIndex('e4')).toBe(28);
  });
  it('round-trips all 64 squares', () => {
    for (const f of 'abcdefgh') for (const r of '12345678') {
      const s = `${f}${r}`;
      expect(toSquare(toIndex(s))).toBe(s);
    }
  });
  it('gives file and rank', () => {
    expect(fileOf(28)).toBe(4);
    expect(rankOf(28)).toBe(3);
  });
  it('validates squares', () => {
    expect(isSquare('i9')).toBe(false);
    expect(isSquare('e4')).toBe(true);
    expect(isSquare('e44')).toBe(false);
  });
});
