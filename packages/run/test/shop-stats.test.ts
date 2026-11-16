import { describe, expect, it } from 'vitest';
import { TIERS } from '@checkbreaker/engine';
import type { DeckType, PieceInstance, RunState } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';
import { openShop, rerollShop, rollSlots } from '../src/shop';
import type { ShopState } from '../src/types';
import { runConfig as c, starterRun } from './fixtures';

const pad4 = (n: number) => String(n).padStart(4, '0');
const VISITS = 10_000;
const DECK_TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];
const KING = starterRun().deck[0]!;
const normal = (id: string, pieceType: DeckType): PieceInstance => ({
  instanceId: id, pieceType, rarity: 'normal', durability: 2, durabilityMax: 2,
  origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
});
const THREE = [KING, normal('p_a', 'knight'), normal('p_b', 'bishop'), normal('p_c', 'knight')];
const FOUR = [...THREE, normal('p_d', 'bishop')];
const share = (counts: Record<string, number>, keys: string[]) => {
  const total = keys.reduce((s, k) => s + (counts[k] ?? 0), 0);
  return Object.fromEntries(keys.map(k => [k, (counts[k] ?? 0) / total]));
};

describe('shop stock statistics', () => {
  for (const act of [1, 2, 3] as const) {
    it(`act ${act}: ${VISITS} visits with 0-3 rerolls follow the pool, weights and guarantees`, () => {
      const ceiling = TIERS.indexOf(c.run.rarityPool[`act${act}`].ceiling);
      const slot1: Record<string, number> = {};
      const others: Record<string, number> = {};
      let skills = 0;
      let slots34 = 0;
      let recoveryOffers = 0;
      for (let i = 0; i < VISITS; i++) {
        const recoveryVisit = i % 5 === 0;
        const run: RunState = { ...starterRun(`S${pad4(i)}-0000`), coins: 100, deck: recoveryVisit ? THREE : FOUR };
        let shop: ShopState = openShop(run, (act - 1) * 3 + (i % 3), recoveryVisit ? 1 : 0, c);
        expect(shop.act).toBe(act);
        expect(shop.recovery).toBe(recoveryVisit);
        let cur = run;
        for (let roll = 0; ; roll++) {
          shop.slots.forEach((o, k) => {
            const slot = k + 1;
            if (slot >= 3) {
              slots34++;
              if (o.kind === 'skill') {
                skills++;
                expect(c.skills[o.skillId]!.status).toBe('mvp');
                return;
              }
            }
            if (o.kind !== 'piece') throw new Error(`slot ${slot} must be a piece`);
            if (!DECK_TYPES.includes(o.pieceType)) throw new Error(`non-deck piece offered: ${o.pieceType}`);
            const tier = TIERS.indexOf(o.rarity);
            if (tier < 0 || tier > ceiling) throw new Error(`tier ${o.rarity} above the act ${act} ceiling`);
            if (act === 1 && (o.rarity === 'unique' || o.rarity === 'legendary')) throw new Error('act 1 unique/legendary');
            if (o.recovery) {
              if (slot !== 1 || o.rarity !== 'normal') throw new Error(`bad recovery offer ${JSON.stringify(o)}`);
              recoveryOffers++;
              return;
            }
            const counts = slot === 1 ? slot1 : others;
            counts[o.pieceType] = (counts[o.pieceType] ?? 0) + 1;
          });
          if (roll === i % 4) break;
          const r = rerollShop(cur, shop, c);
          if (!r.ok) throw new Error(JSON.stringify(r.error));
          ({ run: cur, shop } = r.value);
        }
      }
      expect(recoveryOffers).toBeGreaterThan(VISITS / 5);
      expect(slot1.queen ?? 0).toBe(0);
      expect(Math.abs(skills / slots34 - c.run.shop.skillChance)).toBeLessThan(0.01);
      const w = c.run.shop.pieceTypeWeights;
      const totalW = DECK_TYPES.reduce((s, t) => s + w[t], 0);
      const s234 = share(others, DECK_TYPES);
      for (const t of DECK_TYPES) expect(Math.abs(s234[t]! - w[t] / totalW), `slots 2-4 ${t}`).toBeLessThan(0.01);
      const types1 = c.run.shop.slot1Types;
      const total1 = types1.reduce((s, t) => s + w[t], 0);
      const s1 = share(slot1, types1);
      for (const t of types1) expect(Math.abs(s1[t]! - w[t] / total1), `slot 1 ${t}`).toBeLessThan(0.01);    });
  }

  it('retention: an Act III Legendary queen is offered at 20% +/- 1% of its rate without retention', () => {
    const keep = c.run.retention.queen!.legendary!;
    const noRetention: RunConfig = { ...c, run: { ...c.run, retention: {} } };
    const run = { ...starterRun(), deck: FOUR };
    // 400,000 Act III rolls (~1.4M piece offers, ~6,400 unretained Legendary queens): the ratio's binomial
    // sigma is ~0.005, so the +/-0.01 band is about 2 sigma. Same (seed, stage, roll) draws for both configs.
    const ROLLS = 400_000;
    let offers = 0;
    let observed = 0;
    let unretained = 0;
    for (let i = 0; i < ROLLS; i++) {
      const shop: ShopState = {
        act: 3, stageNumber: 6 + (i % 3), roll: Math.floor(i / 3) % 4, rerollsUsed: 0, recovery: false, slots: [],
      };
      const r = { ...run, seed: `S${pad4(Math.floor(i / 12) % 10000)}-${pad4(Math.floor(i / 120000))}` };
      const a = rollSlots(r, shop, c);
      const b = rollSlots(r, shop, noRetention);
      for (let k = 0; k < 4; k++) {
        const x = a[k]!;
        const y = b[k]!;
        if (x.kind !== 'piece' || y.kind !== 'piece') continue;
        offers++;
        if (x.pieceType === 'queen' && x.rarity === 'legendary') observed++;
        if (y.pieceType === 'queen' && y.rarity === 'legendary') unretained++;
      }
    }
    expect(offers).toBeGreaterThanOrEqual(100_000);
    expect(unretained).toBeGreaterThan(5000);
    expect(Math.abs(observed / offers / (unretained / offers) - keep)).toBeLessThan(0.01);
  }, 60_000);
});
