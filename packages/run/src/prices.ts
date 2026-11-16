import type { DeckType, PieceInstance, Rarity } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';

/** docs/07 section 2.2: round(basePrice x rarityMultiplier x (1 + inflation x (act - 1))). */
export function piecePrice(type: DeckType, rarity: Rarity, act: 1 | 2 | 3, c: RunConfig): number {
  const r = c.run;
  return Math.round(r.basePrice[type] * r.rarityMultiplier[rarity] * (1 + r.priceInflationPerAct * (act - 1)));
}

/** docs/07 section 2.3: round(price x (1 + inflation x (act - 1))). */
export function skillPrice(skillId: string, act: 1 | 2 | 3, c: RunConfig): number {
  const skill = c.skills[skillId];
  if (!skill) throw new Error(`unknown skill ${skillId}`);
  return Math.round(skill.price * (1 + c.run.priceInflationPerAct * (act - 1)));
}

/** docs/07 section 4: min(floor(priceFactor x current price), pricePaid). Pieces without a rarity (King) sell for 0. */
export function sellPrice(p: PieceInstance, act: 1 | 2 | 3, c: RunConfig): number {
  if (p.pieceType === 'king' || p.rarity == null) return 0;
  const base = Math.floor(c.run.services.sell.priceFactor * piecePrice(p.pieceType, p.rarity, act, c));
  return c.run.services.sell.capAtPricePaid ? Math.min(base, p.pricePaid ?? Infinity) : base;
}
