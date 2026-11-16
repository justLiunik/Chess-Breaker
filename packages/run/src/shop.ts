import { TIERS, draw, durabilityMaxOf, hash, pickWeighted, retainTier, rollTier } from '@checkbreaker/engine';
import type { DeckType, PieceInstance, Result, RunState } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';
import type { Offer, RunError, ShopState } from './types';
import { piecePrice, skillPrice } from './prices';

type Slot = ShopState['slots'][number];
type Field = 'kind' | 'type' | 'tier' | 'retain' | 'skill';

const ok = <T>(value: T): Result<T, RunError> => ({ ok: true, value });
const fail = (error: RunError): Result<never, RunError> => ({ ok: false, error });

const DECK_TYPES: readonly DeckType[] = ['knight', 'bishop', 'rook', 'queen'];
const RECOVERY_TYPES: readonly DeckType[] = ['knight', 'bishop'];

const nonKingCount = (run: RunState): number => run.deck.filter(p => p.pieceType !== 'king').length;

/** An unsold recovery offer in slot 1 (docs/07 section 3). */
const liveRecovery = (slot: Slot | undefined): boolean => slot?.kind === 'piece' && slot.recovery === true && !slot.sold;

/**
 * Opens the shop after stage `stageNumber` (0-8) was cleared: the act of that stage sets prices and the
 * rarity pool; the recovery offer fires on a loss with the non-king deck below the threshold (docs/07 section 3).
 */
export function openShop(run: RunState, stageNumber: number, piecesLostLastStage: number, c: RunConfig): ShopState {
  const act = (Math.floor(stageNumber / c.run.stagesPerAct) + 1) as 1 | 2 | 3;
  const recovery = piecesLostLastStage >= 1 && nonKingCount(run) < c.run.shop.recoveryDeckThreshold;
  const shop: ShopState = { act, stageNumber, roll: 0, rerollsUsed: 0, recovery, slots: [] };
  return { ...shop, slots: rollSlots(run, shop, c) };
}

/**
 * The stock of slots 1-4 for `shop.roll` (spec section 8.4). Every draw reads its own named stream
 * `draw(seed, 'shop', stageNumber, roll, slot, field)`, so the stock depends only on those and on
 * `shop.act` / `shop.recovery`.
 */
export function rollSlots(run: RunState, shop: ShopState, c: RunConfig): ShopState['slots'] {
  const { act, stageNumber, roll } = shop;
  const u = (slot: number, field: Field): number => draw(run.seed, 'shop', stageNumber, roll, slot, field);
  const pool = c.run.rarityPool[`act${act}`];
  const ceiling = TIERS.indexOf(pool.ceiling);
  const weights = c.run.shop.pieceTypeWeights;

  const piece = (slot: number, types: readonly DeckType[]): Offer => {
    const pieceType = pickWeighted(types, weights, u(slot, 'type'));
    const rolled = TIERS[Math.min(TIERS.indexOf(rollTier(pool.weights, u(slot, 'tier'))), ceiling)]!;
    const rarity = retainTier(pieceType, rolled, c.run.retention, u(slot, 'retain'));
    return { kind: 'piece', pieceType, rarity, price: piecePrice(pieceType, rarity, act, c) };
  };

  const recoveryOffer = (): Offer => {
    const pieceType = pickWeighted(RECOVERY_TYPES, weights, u(1, 'type'));
    const price = Math.round(piecePrice(pieceType, 'normal', act, c) * c.run.shop.recoveryDiscount);
    return { kind: 'piece', pieceType, rarity: 'normal', price, recovery: true };
  };

  const mvpSkills = Object.keys(c.skills).filter(id => c.skills[id]!.status === 'mvp');
  const offers: Offer[] = [shop.recovery ? recoveryOffer() : piece(1, c.run.shop.slot1Types), piece(2, DECK_TYPES)];
  for (const slot of [3, 4]) {
    if (u(slot, 'kind') < c.run.shop.skillChance) {
      const left = mvpSkills.filter(id => !offers.some(o => o.kind === 'skill' && o.skillId === id));
      if (left.length > 0) {
        const skillId = left[Math.floor(u(slot, 'skill') * left.length)]!;
        offers.push({ kind: 'skill', skillId, price: skillPrice(skillId, act, c) });
        continue;
      }
    }
    offers.push(piece(slot, DECK_TYPES));
  }
  return offers.map(o => ({ ...o, sold: false }));
}

/**
 * Redraws slots 1-4, sold ones included (docs/07 section 2). The first `freeRerollsPerVisit` are free, then
 * `services.reroll` each, at most `maxRerollsPerVisit`. An unsold, still-live recovery offer stays in slot 1;
 * once it was bought or withdrawn, slot 1 is drawn normally and `recovery` is false.
 */
export function rerollShop(
  run: RunState, shop: ShopState, c: RunConfig,
): Result<{ run: RunState; shop: ShopState; cost: number }, RunError> {
  const s = c.run.services;
  if (shop.rerollsUsed >= s.maxRerollsPerVisit) return fail({ kind: 'rerolls_exhausted' });
  const cost = shop.rerollsUsed < s.freeRerollsPerVisit ? 0 : s.reroll;
  if (run.coins < cost) return fail({ kind: 'insufficient_coins', price: cost, coins: run.coins });
  const kept = shop.recovery && liveRecovery(shop.slots[0]) ? shop.slots[0]! : null;
  const next: ShopState = { ...shop, roll: shop.roll + 1, rerollsUsed: shop.rerollsUsed + 1, recovery: kept !== null, slots: [] };
  const slots = rollSlots(run, next, c);
  if (kept) slots[0] = kept;
  return ok({ run: { ...run, coins: run.coins - cost }, shop: { ...next, slots }, cost });
}

/**
 * Buys slot `slot` (1-4). A piece needs room in the deck and becomes a new full-durability instance
 * recording `pricePaid`; a skill takes a free loadout slot, or with a full loadout needs `opts.replace` (the loadout index it
 * replaces; `replace` with room to spare is `replace_not_needed`). A piece purchase that brings the non-king deck back to the threshold withdraws an unsold
 * recovery offer (docs/07 section 3): slot 1 is then sold and `recovery` false.
 */
export function buyOffer(
  run: RunState, shop: ShopState, slot: number, opts: { replace?: number }, c: RunConfig,
): Result<{ run: RunState; shop: ShopState; instanceId?: string }, RunError> {
  if (!Number.isInteger(slot) || slot < 1 || slot > shop.slots.length) return fail({ kind: 'no_such_slot', slot });
  const offer = shop.slots[slot - 1]!;
  if (offer.sold) return fail({ kind: 'slot_sold', slot });
  if (run.coins < offer.price) return fail({ kind: 'insufficient_coins', price: offer.price, coins: run.coins });
  const coins = run.coins - offer.price;
  const slots = shop.slots.map((o, k) => (k === slot - 1 ? { ...o, sold: true } : o));

  if (offer.kind === 'skill') {
    const replace = opts.replace;
    const entry = { skillId: offer.skillId };
    let loadout: RunState['loadout'];
    if (replace !== undefined && run.loadout.length < c.run.loadoutSlots) return fail({ kind: 'replace_not_needed' });
    if (run.loadout.length < c.run.loadoutSlots) {
      loadout = [...run.loadout, entry];
    } else if (replace !== undefined && Number.isInteger(replace) && replace >= 0 && replace < run.loadout.length) {
      loadout = run.loadout.map((e, k) => (k === replace ? entry : e));
    } else {
      return fail({ kind: 'loadout_full' });
    }
    return ok({ run: { ...run, coins, loadout }, shop: { ...shop, slots } });
  }

  if (nonKingCount(run) >= c.deck.capacity) return fail({ kind: 'deck_full' });
  const instanceId = 'p_' + hash(run.seed, 'buy', shop.stageNumber, shop.roll, slot).toString(16);
  const durabilityMax = durabilityMaxOf(offer.pieceType, offer.rarity, c);
  const made: PieceInstance = {
    instanceId, pieceType: offer.pieceType, rarity: offer.rarity, durability: durabilityMax, durabilityMax,
    origin: 'shop', acquiredAtStage: shop.stageNumber, pricePaid: offer.price, status: 'in_deck',
  };
  const next: RunState = { ...run, coins, deck: [...run.deck, made] };
  let recovery = shop.recovery;
  if (recovery && nonKingCount(next) >= c.run.shop.recoveryDeckThreshold && liveRecovery(slots[0])) {
    slots[0] = { ...slots[0]!, sold: true };
    recovery = false;
  }
  return ok({ run: next, shop: { ...shop, recovery, slots }, instanceId });
}
