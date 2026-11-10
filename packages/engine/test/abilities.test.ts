import { describe, expect, it } from 'vitest';
import { compileAbilities, durabilityMaxOf, spawnCostOf } from '../src/abilities';
import { config } from './helpers';

const has = (l: [number, number][], df: number, dr: number) => l.some(([a, b]) => a === df && b === dr);
const t = config.abilities;

describe('compileAbilities', () => {
  it('knight leapers accumulate by tier', () => {
    expect(t.knight[0].leapers).toEqual([]);
    for (const [a, b] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) expect(has(t.knight[1].leapers, a, b)).toBe(true);
    expect(t.knight[1].leapers).toHaveLength(4);
    for (const [a, b] of [[2, 2], [-2, 2], [2, -2], [-2, -2]] as const) expect(has(t.knight[2].leapers, a, b)).toBe(true);
    expect(t.knight[2].leapers).toHaveLength(8);
    expect(has(t.knight[2].leapers, 2, 0)).toBe(true);
    expect(t.knight[3].bonusSelfMove).toBe(true);
    expect(t.knight[2].bonusSelfMove).toBe(false);
  });
  it('bishop leapAllies 1 -> 2, then orthogonal ray', () => {
    expect(t.bishop.map((f) => f.leapAllies)).toEqual([0, 1, 2, 2]);
    expect(t.bishop[2].extraRays).toEqual([]);
    expect(t.bishop[3].extraRays).toEqual(['orthogonal']);
  });
  it('rook and queen leapAllies: none, no capture after (rare, unique), capture after (legendary)', () => {
    expect(t.rook.map((f) => f.leapAllies)).toEqual([0, 1, 1, 2]);
    expect(t.queen.map((f) => f.leapAllies)).toEqual([0, 1, 1, 2]);
  });
  it('rook: unique adds diagonal step, legendary leapAllies 2 and multiCapture 1', () => {
    expect(t.rook[2].leapers).toHaveLength(4);
    expect(has(t.rook[2].leapers, 1, -1)).toBe(true);
    expect(t.rook[3].leapAllies).toBe(2);
    expect(t.rook[3].multiCapture).toBe(1);
  });
  it('queen: lifeline at unique, multiCapture 2 at legendary', () => {
    expect(t.queen[1].lifeline).toBe(false);
    expect(t.queen[2].lifeline).toBe(true);
    expect(t.queen[3].lifeline).toBe(true);
    expect(t.queen[2].multiCapture).toBe(0);
    expect(t.queen[3].multiCapture).toBe(2);
  });
  it('does not share arrays between tiers', () => {
    expect(t.knight[1].leapers).not.toBe(t.knight[2].leapers);
    expect(t.knight[1].leapers).toHaveLength(4);
  });
  it('throws on an unknown ability', () => {
    expect(() =>
      compileAbilities({
        knight: { rare: [{ ability: 'teleport', params: {} }] }, bishop: {}, rook: {}, queen: {},
      }),
    ).toThrow(/teleport/);
  });
});

describe('lookups', () => {
  it('spawnCostOf', () => {
    expect(spawnCostOf('bishop', 'legendary', config)).toBe(5);
    expect(spawnCostOf('bishop', 'unique', config)).toBe(3);
    expect(spawnCostOf('knight', 'legendary', config)).toBe(3);
  });
  it('durabilityMaxOf', () => {
    expect(durabilityMaxOf('queen', 'legendary', config)).toBe(1);
    expect(durabilityMaxOf('queen', 'rare', config)).toBe(2);
    expect(durabilityMaxOf('king', 'normal', config)).toBeNull();
  });
});
