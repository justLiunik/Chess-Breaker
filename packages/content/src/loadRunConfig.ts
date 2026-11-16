import type { DeckType, EngineConfig, Rarity } from '@checkbreaker/engine';
import type { ActKey } from './loadGenConfig';
import { DEFAULT_PATH, bool, deepFreeze, loadEngineConfig, need, num, readYaml } from './loadEngineConfig';

export interface RunSettings {
  acts: number;
  stagesPerAct: number;
  starterCoins: number;
  starterDeck: Record<'knight' | 'bishop' | 'rook' | 'queen', number>;
  basePrice: Record<DeckType, number>;
  priceInflationPerAct: number;
  rarityMultiplier: Record<Rarity, number>;
  rarityPool: Record<ActKey, { ceiling: Rarity; weights: Record<Rarity, number> }>;
  retention: Partial<Record<DeckType, Partial<Record<Rarity, number>>>>;
  shop: {
    skillChance: number;
    pieceTypeWeights: Record<DeckType, number>;
    slot1Types: DeckType[];
    recoveryDeckThreshold: number;
    recoveryDiscount: number;
  };
  services: {
    repair: number;
    reroll: number;
    freeRerollsPerVisit: number;
    maxRerollsPerVisit: number;
    sell: { priceFactor: number; capAtPricePaid: boolean };
  };
  merge: { inputs: number; maxInputTier: Rarity };
  loadoutSlots: number;
  freeSkill: { stageNumber: number; skillId: string } | null;
}

export type RunConfig = EngineConfig & { run: RunSettings };

const ACTS: ActKey[] = ['act1', 'act2', 'act3'];
const RARITIES: Rarity[] = ['normal', 'rare', 'unique', 'legendary'];
const DECK_TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];

export function loadRunConfig(path: string = DEFAULT_PATH): RunConfig {
  const base = loadEngineConfig(path);
  const y: unknown = readYaml(path, 'economy.yaml');

  const basePrice = {} as Record<DeckType, number>;
  const pieceTypeWeights = {} as Record<DeckType, number>;
  for (const t of DECK_TYPES) {
    basePrice[t] = num(y, `pieces.${t}.cost`);
    pieceTypeWeights[t] = num(y, `economy.shop.pieceTypeWeights.${t}`);
  }
  const rarityMultiplier = {} as Record<Rarity, number>;
  for (const r of RARITIES) rarityMultiplier[r] = num(y, `rarity.priceMultiplier.${r}`);
  const rarityPool = {} as RunSettings['rarityPool'];
  for (const act of ACTS) {
    const weights = {} as Record<Rarity, number>;
    for (const r of RARITIES) weights[r] = num(y, `rarity.pool.${act}.weights.${r}`);
    rarityPool[act] = { ceiling: need(y, `rarity.pool.${act}.ceiling`) as Rarity, weights };
  }
  const starterDeck = {
    knight: num(y, 'deck.starterDeck.knight'),
    bishop: num(y, 'deck.starterDeck.bishop'),
    rook: optionalNum(y, 'deck.starterDeck.rook'),
    queen: optionalNum(y, 'deck.starterDeck.queen'),
  };
  const free = optional(y, 'onboarding.freeSkill');
  const freeSkill = free === undefined || free === null
    ? null
    : { stageNumber: num(y, 'onboarding.freeSkill.stageNumber'), skillId: need(y, 'onboarding.freeSkill.skillId') as string };

  const run: RunSettings = {
    acts: num(y, 'stages.acts'),
    stagesPerAct: num(y, 'stages.stagesPerAct'),
    starterCoins: num(y, 'economy.starterCoins'),
    starterDeck,
    basePrice,
    priceInflationPerAct: num(y, 'economy.priceInflationPerAct'),
    rarityMultiplier,
    rarityPool,
    retention: structuredClone(need(y, 'rarity.retention')) as RunSettings['retention'],
    shop: {
      skillChance: num(y, 'economy.shop.skillChance'),
      pieceTypeWeights,
      slot1Types: [...(need(y, 'economy.shop.slot1Types') as DeckType[])],
      recoveryDeckThreshold: num(y, 'economy.shop.recoveryDeckThreshold'),
      recoveryDiscount: num(y, 'economy.shop.recoveryDiscount'),
    },
    services: {
      repair: num(y, 'economy.services.repair'),
      reroll: num(y, 'economy.services.reroll'),
      freeRerollsPerVisit: num(y, 'economy.services.freeRerollsPerVisit'),
      maxRerollsPerVisit: num(y, 'economy.services.maxRerollsPerVisit'),
      sell: {
        priceFactor: num(y, 'economy.services.sell.priceFactor'),
        capAtPricePaid: bool(y, 'economy.services.sell.capAtPricePaid'),
      },
    },
    merge: { inputs: num(y, 'deck.merge.inputs'), maxInputTier: need(y, 'deck.merge.maxInputTier') as Rarity },
    loadoutSlots: num(y, 'skills.loadoutSlots'),
    freeSkill,
  };
  return deepFreeze({ ...base, run });
}

function optional(y: unknown, path: string): unknown {
  let cur: unknown = y;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function optionalNum(y: unknown, path: string): number {
  const v = optional(y, path);
  return typeof v === 'number' ? v : 0;
}
