import { describe, expect, it } from 'vitest';
import { draw, hash } from '@checkbreaker/engine';
import type { DeckType, PieceInstance, Result, RunState } from '@checkbreaker/engine';
import { buyOffer, openShop, rerollShop, rerollsLeft, rollSlots } from '../src/shop';
import { piecePrice, sellPrice } from '../src/prices';
import { sellPiece } from '../src/deck';
import type { Offer, RunError, ShopState } from '../src/types';
import { runConfig as c, starterRun } from './fixtures';

const pad4 = (n: number) => String(n).padStart(4, '0');
const KING = starterRun().deck[0]!;
const normal = (id: string, pieceType: DeckType): PieceInstance => ({
  instanceId: id, pieceType, rarity: 'normal', durability: 2, durabilityMax: 2,
  origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
});
/** A run whose non-king deck holds `n` Normal knights and bishops. */
const runWith = (n: number, coins = 100, seed = '7F3A-2210', loadout: RunState['loadout'] = []): RunState => ({
  ...starterRun(seed), coins, loadout,
  deck: [KING, ...Array.from({ length: n }, (_, i) => normal(`p_t_${pad4(i)}`, i % 2 ? 'bishop' : 'knight'))],
});
const shopOf = (offers: Offer[], over: Partial<ShopState> = {}): ShopState => ({
  act: 1, stageNumber: 1, roll: 0, rerollsUsed: 0, recovery: false, slots: offers.map(o => ({ ...o, sold: false })), ...over,
});
const value = <T>(r: Result<T, RunError>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const error = <T>(r: Result<T, RunError>): RunError | null => (r.ok ? null : r.error);
const nonKing = (run: RunState) => run.deck.filter(p => p.pieceType !== 'king').length;
const actOf = (stageNumber: number) => (Math.floor(stageNumber / 3) + 1) as 1 | 2 | 3;

describe('openShop', () => {
  it('takes the act of the stage just cleared and rolls a full, unsold stock', () => {
    for (let s = 0; s <= 8; s++) {
      const shop = openShop(runWith(4), s, 0, c);
      expect(shop).toMatchObject({ act: actOf(s), stageNumber: s, roll: 0, rerollsUsed: 0, recovery: false });
      expect(shop.slots).toHaveLength(4);
      expect(shop.slots.every(o => o.sold === false)).toBe(true);
      expect(shop.slots[0]!.kind).toBe('piece');
      expect(shop.slots[1]!.kind).toBe('piece');
    }
  });

  it('same (seed, stageNumber, roll) gives identical slots', () => {
    for (const seed of ['7F3A-2210', '0000-0001', 'ABCD-EF01']) {
      for (const s of [0, 4, 8]) {
        const a = openShop(runWith(4, 100, seed), s, 0, c);
        const b = openShop(runWith(4, 100, seed), s, 0, c);
        expect(a).toEqual(b);
        // the stock reads only the seed, stage, roll, act and recovery flag: not coins or the deck's contents
        expect(openShop(runWith(6, 0, seed), s, 0, c).slots).toEqual(a.slots);
        for (const roll of [1, 2, 3]) {
          expect(rollSlots(runWith(4, 100, seed), { ...a, roll }, c)).toEqual(rollSlots(runWith(4, 100, seed), { ...b, roll }, c));
        }
      }
    }
    const base = JSON.stringify(openShop(runWith(4), 4, 0, c).slots);
    expect(['0000-0001', 'ABCD-EF01', '1234-5678'].some(seed => JSON.stringify(openShop(runWith(4, 100, seed), 4, 0, c).slots) !== base)).toBe(true);
    const shop = openShop(runWith(4), 4, 0, c);
    expect([1, 2, 3].some(roll => JSON.stringify(rollSlots(runWith(4), { ...shop, roll }, c)) !== base)).toBe(true);
  });

  it('recovery fires with a piece lost and fewer than 4 non-king pieces, and only then', () => {
    expect(openShop(runWith(3), 1, 1, c).recovery).toBe(true);
    expect(openShop(runWith(3), 1, 2, c).recovery).toBe(true);
    expect(openShop(runWith(3), 1, 0, c).recovery).toBe(false);
    expect(openShop(runWith(4), 1, 1, c).recovery).toBe(false);
    const plain = openShop(runWith(3), 1, 0, c).slots[0]!;
    expect(plain.kind === 'piece' && plain.recovery).toBeFalsy();
    expect(c.run.shop.slot1Types).toContain(plain.kind === 'piece' ? plain.pieceType : 'skill');
  });

  it('the recovery offer is a Normal knight or bishop at half price', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (let s = 0; s <= 8; s++) {
        const shop = openShop(runWith(3, 0, `RC${pad4(i)}-0000`), s, 1, c);
        const o = shop.slots[0]!;
        if (o.kind !== 'piece') throw new Error('slot 1 must be a piece');
        expect(o.recovery).toBe(true);
        expect(o.rarity).toBe('normal');
        expect(['knight', 'bishop']).toContain(o.pieceType);
        expect(o.price).toBe(Math.round(piecePrice(o.pieceType, 'normal', shop.act, c) * c.run.shop.recoveryDiscount));
        seen.add(o.pieceType);
      }
    }
    expect([...seen].sort()).toEqual(['bishop', 'knight']);
    const act1 = openShop(runWith(3), 0, 1, c).slots[0]!;
    expect(act1.price).toBe(4);
  });
});

describe('buyOffer', () => {
  const stock: Offer[] = [
    { kind: 'piece', pieceType: 'knight', rarity: 'normal', price: 11 },
    { kind: 'piece', pieceType: 'queen', rarity: 'legendary', price: 67 },
    { kind: 'skill', skillId: 'lockdown', price: 4 },
    { kind: 'piece', pieceType: 'rook', rarity: 'rare', price: 21 },
  ];

  it('a piece purchase adds a full-durability shop instance, records pricePaid and charges the price', () => {
    const run = runWith(4, 100);
    const shop = shopOf(stock, { act: 3, stageNumber: 7, roll: 2 });
    const before = JSON.stringify({ run, shop });
    const r = value(buyOffer(run, shop, 2, {}, c));
    const id = 'p_' + hash(run.seed, 'buy', 7, 2, 2).toString(16);
    expect(r.instanceId).toBe(id);
    expect(id).toMatch(/^p_[0-9a-f]+$/);
    expect(r.run.deck.find(p => p.instanceId === id)).toEqual({
      instanceId: id, pieceType: 'queen', rarity: 'legendary', durability: 1, durabilityMax: 1,
      origin: 'shop', acquiredAtStage: 7, pricePaid: 67, status: 'in_deck',
    });
    expect(r.run.deck).toHaveLength(run.deck.length + 1);
    expect(r.run.coins).toBe(33);
    expect(r.shop.slots.map(o => o.sold)).toEqual([false, true, false, false]);
    expect(r.shop.slots[1]).toMatchObject(stock[1]!);
    expect(JSON.stringify({ run, shop })).toBe(before);
    const rook = value(buyOffer(r.run, r.shop, 4, {}, c));
    expect(rook.run.deck.find(p => p.instanceId === rook.instanceId)).toMatchObject({ rarity: 'rare', durability: 2, durabilityMax: 2, pricePaid: 21 });
  });

  it('refuses slots that do not exist or are sold', () => {
    const run = runWith(4);
    const shop = shopOf(stock);
    for (const slot of [0, 5, -1, 1.5]) expect(error(buyOffer(run, shop, slot, {}, c))).toEqual({ kind: 'no_such_slot', slot });
    const once = value(buyOffer(run, shop, 1, {}, c));
    expect(error(buyOffer(once.run, once.shop, 1, {}, c))).toEqual({ kind: 'slot_sold', slot: 1 });
  });

  it('a piece needs room in the deck; a skill does not', () => {
    const full = runWith(c.deck.capacity);
    expect(error(buyOffer(full, shopOf(stock), 1, {}, c))).toEqual({ kind: 'deck_full' });
    expect(value(buyOffer(full, shopOf(stock), 3, {}, c)).run.loadout).toEqual([{ skillId: 'lockdown' }]);
  });

  it('insufficient_coins changes nothing', () => {
    const run = runWith(4, 3);
    const shop = shopOf(stock);
    const before = JSON.stringify({ run, shop });
    expect(error(buyOffer(run, shop, 1, {}, c))).toEqual({ kind: 'insufficient_coins', price: 11, coins: 3 });
    expect(error(buyOffer(run, shop, 3, {}, c))).toEqual({ kind: 'insufficient_coins', price: 4, coins: 3 });
    expect(JSON.stringify({ run, shop })).toBe(before);
  });

  it('a skill needs a free loadout slot, or replaces the chosen entry', () => {
    const loadout = [{ skillId: 'twin_step' }, { skillId: 'ascension' }, { skillId: 'twin_step' }];
    const run = runWith(4, 10, '7F3A-2210', loadout);
    expect(loadout).toHaveLength(c.run.loadoutSlots);
    expect(error(buyOffer(run, shopOf(stock), 3, {}, c))).toEqual({ kind: 'loadout_full' });
    expect(error(buyOffer(run, shopOf(stock), 3, { replace: 3 }, c))).toEqual({ kind: 'loadout_full' });
    const r = value(buyOffer(run, shopOf(stock), 3, { replace: 0 }, c));
    expect(r.run.loadout).toEqual([{ skillId: 'lockdown' }, { skillId: 'ascension' }, { skillId: 'twin_step' }]);
    expect(r.instanceId).toBeUndefined();
    expect(r.run.coins).toBe(6);
    expect(r.run.deck).toEqual(run.deck);
    expect(r.shop.slots[2]!.sold).toBe(true);
  });

  it('replace with room is refused', () => {
    const run = runWith(4, 10, '7F3A-2210', [{ skillId: 'twin_step' }]);
    const before = JSON.stringify(run);
    expect(error(buyOffer(run, shopOf(stock), 3, { replace: 0 }, c))).toEqual({ kind: 'replace_not_needed' });
    expect(JSON.stringify(run)).toBe(before);
    expect(run.coins).toBe(10);
    const full = runWith(4, 10, '7F3A-2210', [{ skillId: 'twin_step' }, { skillId: 'ascension' }, { skillId: 'twin_step' }]);
    expect(error(buyOffer(full, shopOf(stock), 3, { replace: 5 }, c))).toEqual({ kind: 'loadout_full' });
  });

  it('a duplicate skill becomes a second entry', () => {
    const run = runWith(4, 10, '7F3A-2210', [{ skillId: 'lockdown' }]);
    const r = value(buyOffer(run, shopOf(stock), 3, {}, c));
    expect(r.run.loadout).toEqual([{ skillId: 'lockdown' }, { skillId: 'lockdown' }]);
  });

  it('the recovery purchase records the discounted pricePaid', () => {
    for (const [stage, price] of [[0, 4], [3, 5], [6, 6]] as const) {
      const run = runWith(3, 100);
      const shop = openShop(run, stage, 1, c);
      const offer = shop.slots[0]!;
      expect(offer).toMatchObject({ kind: 'piece', recovery: true, price });
      const r = value(buyOffer(run, shop, 1, {}, c));
      const p = r.run.deck.find(d => d.instanceId === r.instanceId)!;
      expect(p).toMatchObject({ rarity: 'normal', pricePaid: price, origin: 'shop', acquiredAtStage: stage, durability: 2 });
      expect(r.run.coins).toBe(100 - price);
    }
  });
});

describe('recovery withdrawal', () => {
  it('buying slot 2 when the deck reaches 4 withdraws the recovery offer', () => {
    const run = runWith(3);
    const shop = openShop(run, 1, 1, c);
    expect(shop.recovery).toBe(true);
    const r = value(buyOffer(run, shop, 2, {}, c));
    expect(nonKing(r.run)).toBe(4);
    expect(r.shop.recovery).toBe(false);
    expect(r.shop.slots[0]).toEqual({ ...shop.slots[0], sold: true });
    expect(error(buyOffer(r.run, r.shop, 1, {}, c))).toEqual({ kind: 'slot_sold', slot: 1 });
  });

  it('selling back below 4 does not restore it', () => {
    const run = runWith(3);
    const bought = value(buyOffer(run, openShop(run, 1, 1, c), 2, {}, c));
    const sold = value(sellPiece(bought.run, bought.instanceId!, 1, c));
    expect(nonKing(sold.run)).toBe(3);
    const r = value(rerollShop(sold.run, bought.shop, c));
    expect(r.shop.recovery).toBe(false);
    const slot1 = r.shop.slots[0]!;
    expect(slot1.kind === 'piece' && slot1.recovery).toBeFalsy();
    expect(slot1.sold).toBe(false);
    expect(r.shop.slots).toEqual(rollSlots(sold.run, { ...bought.shop, roll: 1 }, c));
  });

  it('a purchase that leaves the deck below 4 keeps the offer', () => {
    const run = runWith(2);
    const r = value(buyOffer(run, openShop(run, 1, 1, c), 2, {}, c));
    expect(nonKing(r.run)).toBe(3);
    expect(r.shop.recovery).toBe(true);
    expect(r.shop.slots[0]).toMatchObject({ recovery: true, sold: false });
  });
});

describe('rerollShop', () => {
  it('one free reroll, then 2 coins each, at most 3 per visit', () => {
    const run0 = runWith(4, 10);
    const shop0 = openShop(run0, 1, 0, c);
    const r1 = value(rerollShop(run0, shop0, c));
    expect([r1.cost, r1.run.coins, r1.shop.roll, r1.shop.rerollsUsed]).toEqual([0, 10, 1, 1]);
    const r2 = value(rerollShop(r1.run, r1.shop, c));
    expect([r2.cost, r2.run.coins, r2.shop.roll, r2.shop.rerollsUsed]).toEqual([2, 8, 2, 2]);
    const r3 = value(rerollShop(r2.run, r2.shop, c));
    expect([r3.cost, r3.run.coins, r3.shop.roll, r3.shop.rerollsUsed]).toEqual([2, 6, 3, 3]);
    expect(error(rerollShop(r3.run, r3.shop, c))).toEqual({ kind: 'rerolls_exhausted' });
  });

  it('a paid reroll needs the coins', () => {
    const run0 = runWith(4, 1);
    const r1 = value(rerollShop(run0, openShop(run0, 1, 0, c), c));
    const before = JSON.stringify(r1);
    expect(error(rerollShop(r1.run, r1.shop, c))).toEqual({ kind: 'insufficient_coins', price: 2, coins: 1 });
    expect(JSON.stringify(r1)).toBe(before);
  });

  it('redraws every slot, sold ones included', () => {
    const run = runWith(4, 100);
    const shop = openShop(run, 4, 0, c);
    const a = value(buyOffer(run, shop, 2, {}, c));
    const b = value(buyOffer(a.run, a.shop, 1, {}, c));
    const r = value(rerollShop(b.run, b.shop, c));
    expect(r.shop.slots.every(o => !o.sold)).toBe(true);
    expect(r.shop.slots).toEqual(rollSlots(b.run, { ...shop, roll: 1 }, c));
  });

  it('keeps an unsold recovery offer in slot 1', () => {
    const run = runWith(3, 100);
    const shop = openShop(run, 1, 1, c);
    let cur = { run, shop };
    for (let roll = 1; roll <= 3; roll++) {
      cur = value(rerollShop(cur.run, cur.shop, c));
      expect(cur.shop.recovery).toBe(true);
      expect(cur.shop.slots[0]).toEqual(shop.slots[0]);
      expect(cur.shop.slots.slice(1)).toEqual(rollSlots(run, { ...shop, roll }, c).slice(1));
    }
  });

  it('draws slot 1 normally once the recovery offer is bought', () => {
    const run = runWith(2, 100);
    const shop = openShop(run, 1, 1, c);
    const b = value(buyOffer(run, shop, 1, {}, c));
    const r = value(rerollShop(b.run, b.shop, c));
    expect(r.shop.recovery).toBe(false);
    const slot1 = r.shop.slots[0]!;
    expect(slot1.kind === 'piece' && slot1.recovery).toBeFalsy();
    expect(r.shop.slots).toEqual(rollSlots(run, { ...shop, roll: 1, recovery: false }, c));
  });
});

describe('sale cap property (Review Focus 5)', () => {
  it('for 1,000 seeded purchases, selling in the same or any later act never pays more than pricePaid', () => {
    let pairs = 0;
    let recoveries = 0;
    for (let i = 0; i < 1000; i++) {
      const seed = `PP${pad4(i)}-0000`;
      const buyAct = (1 + (i % 3)) as 1 | 2 | 3;
      const stage = (buyAct - 1) * 3 + (Math.floor(i / 3) % 3);
      const run = runWith(i % 2 ? 3 : 4, 1000, seed);
      const shop = openShop(run, stage, 1, c);
      const pieceSlots = shop.slots.flatMap((o, k) => (o.kind === 'piece' ? [k + 1] : []));
      const slot = pieceSlots[Math.floor(draw(seed, 'prop') * pieceSlots.length)]!;
      const offer = shop.slots[slot - 1]!;
      if (offer.kind === 'piece' && offer.recovery) recoveries++;
      const r = value(buyOffer(run, shop, slot, {}, c));
      const p = r.run.deck.find(d => d.instanceId === r.instanceId)!;
      expect(p.pricePaid).toBe(offer.price);
      for (let saleAct = buyAct; saleAct <= 3; saleAct++) {
        const act = saleAct as 1 | 2 | 3;
        expect(sellPrice(p, act, c)).toBeLessThanOrEqual(p.pricePaid!);
        expect(value(sellPiece(r.run, p.instanceId, act, c)).coins).toBeLessThanOrEqual(p.pricePaid!);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(1000);
    expect(recoveries).toBeGreaterThan(50);
  });
});

describe('rerollsLeft', () => {
  it('counts down from the per-visit maximum and never goes below zero', () => {
    const max = c.run.services.maxRerollsPerVisit;
    expect(rerollsLeft(shopOf([]), c)).toBe(max);
    expect(rerollsLeft(shopOf([], { rerollsUsed: 1 }), c)).toBe(max - 1);
    expect(rerollsLeft(shopOf([], { rerollsUsed: max }), c)).toBe(0);
    expect(rerollsLeft(shopOf([], { rerollsUsed: max + 2 }), c)).toBe(0);
  });
});
