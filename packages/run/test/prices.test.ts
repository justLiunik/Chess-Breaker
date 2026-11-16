import { describe, expect, it } from 'vitest';
import type { DeckType, PieceInstance, Rarity } from '@checkbreaker/engine';
import { piecePrice, sellPrice, skillPrice } from '../src/prices';
import { runConfig } from './fixtures';

const TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];
const TIERS: Rarity[] = ['normal', 'rare', 'unique', 'legendary'];
const BASE: Record<DeckType, number> = { knight: 8, bishop: 8, rook: 10, queen: 16 };
const MULT: Record<Rarity, number> = { normal: 1, rare: 1.5, unique: 2, legendary: 3 };

describe('piecePrice', () => {
  it('matches the docs/07 section 2.2 table for every type, tier and act', () => {
    for (const t of TYPES) for (const r of TIERS) for (const act of [1, 2, 3] as const) {
      expect(piecePrice(t, r, act, runConfig)).toBe(Math.round(BASE[t] * MULT[r] * (1 + 0.2 * (act - 1))));
    }
  });
  it('spot checks', () => {
    expect(piecePrice('knight', 'normal', 1, runConfig)).toBe(8);
    expect(piecePrice('knight', 'rare', 2, runConfig)).toBe(14);
    expect(piecePrice('queen', 'legendary', 3, runConfig)).toBe(67);
    expect(piecePrice('rook', 'unique', 2, runConfig)).toBe(24);
  });
});

describe('skillPrice', () => {
  it('matches docs/07 section 2.3', () => {
    const table: Record<string, [number, number, number]> = {
      lockdown: [3, 4, 4], gallop: [3, 4, 4], bulwark: [3, 4, 4],
      twin_step: [4, 5, 6], ascension: [4, 5, 6], recall: [4, 5, 6], phase_step: [5, 6, 7],
    };
    for (const [id, p] of Object.entries(table)) {
      expect([1, 2, 3].map(a => skillPrice(id, a as 1 | 2 | 3, runConfig))).toEqual(p);
    }
  });
});

describe('sellPrice', () => {
  const piece = (type: DeckType, rarity: Rarity, durability: number, extra: object = {}): PieceInstance => ({
    instanceId: 'x', pieceType: type, rarity, durability, durabilityMax: 2, origin: 'shop',
    acquiredAtStage: 1, status: 'in_deck', ...extra,
  });
  it('is floor(half the current price) regardless of durability', () => {
    for (const t of TYPES) for (const r of TIERS) for (const act of [1, 2, 3] as const) for (const d of [1, 2]) {
      expect(sellPrice(piece(t, r, d), act, runConfig)).toBe(Math.floor(0.5 * piecePrice(t, r, act, runConfig)));
    }
  });
  it('is capped by pricePaid', () => {
    expect(sellPrice(piece('knight', 'normal', 2, { pricePaid: 4 }), 3, runConfig)).toBe(4);
  });
});
