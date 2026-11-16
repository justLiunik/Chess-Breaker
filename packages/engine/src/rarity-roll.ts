import { TIERS } from './abilities';
import type { DeckType, Rarity } from './types';

/** A cumulative pick over `order`, skipping weights at or below zero; `u` is in [0, 1). */
export function pickWeighted<K extends string>(order: readonly K[], weights: Record<K, number>, u: number): K {
  const total = order.reduce((s, k) => s + weights[k], 0);
  let acc = 0;
  let last: K = order[0]!;
  for (const k of order) {
    if (weights[k] <= 0) continue;
    acc += weights[k];
    last = k;
    if (u * total < acc) return k;
  }
  return last;
}

/** A rarity tier drawn from per-tier weights. */
export function rollTier(weights: Record<Rarity, number>, u: number): Rarity {
  return pickWeighted(TIERS, weights, u);
}

/** Retention: when a keep-probability exists for this piece and tier and `u` misses it, one tier lower. */
export function retainTier(
  pieceType: DeckType,
  tier: Rarity,
  retention: Partial<Record<DeckType, Partial<Record<Rarity, number>>>>,
  u: number,
): Rarity {
  const keep = retention[pieceType]?.[tier];
  if (keep === undefined || u < keep) return tier;
  return TIERS[Math.max(TIERS.indexOf(tier) - 1, 0)]!;
}
