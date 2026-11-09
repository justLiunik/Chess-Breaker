import type { AbilityFlags, AbilityTable, DeckType, EngineConfig, Rarity } from './types';

const TIERS: Rarity[] = ['normal', 'rare', 'unique', 'legendary'];
const DECK_TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];

type RarityAbilities = Record<
  DeckType,
  Partial<Record<Rarity, { ability: string; params: Record<string, unknown> }[]>>
>;

const emptyFlags = (): AbilityFlags => ({
  leapAllies: 0,
  leapers: [],
  extraRays: [],
  multiCapture: 0,
  bonusSelfMove: false,
  lifeline: false,
});

const cloneFlags = (f: AbilityFlags): AbilityFlags => ({
  ...f,
  leapers: f.leapers.map(([a, b]) => [a, b] as [number, number]),
  extraRays: [...f.extraRays],
});

/** Every sign and axis-swap image of (df, dr), deduplicated. */
function images(df: number, dr: number): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (const [a, b] of [[df, dr], [dr, df]] as const) {
    for (const sa of [1, -1]) {
      for (const sb of [1, -1]) {
        const p: [number, number] = [a * sa + 0, b * sb + 0]; // + 0 normalises -0
        out.set(`${p[0]},${p[1]}`, p);
      }
    }
  }
  return [...out.values()];
}

function applyAbility(flags: AbilityFlags, ability: string, params: Record<string, unknown>): void {
  switch (ability) {
    case 'leap_allies':
      flags.leapAllies = params.captureAfterLeap === true ? 2 : Math.max(flags.leapAllies, 1) as 1 | 2;
      break;
    case 'add_leaper': {
      const offsets = params.offsets as [number, number][];
      for (const [df, dr] of offsets) {
        for (const img of images(df, dr)) {
          if (!flags.leapers.some(([a, b]) => a === img[0] && b === img[1])) flags.leapers.push(img);
        }
      }
      break;
    }
    case 'add_rider': {
      const dir = params.directions as 'orthogonal' | 'diagonal';
      if (!flags.extraRays.includes(dir)) flags.extraRays.push(dir);
      break;
    }
    case 'bonus_self_move':
      flags.bonusSelfMove = true;
      break;
    case 'multi_capture':
      flags.multiCapture = params.afterLeap === true ? 2 : (Math.max(flags.multiCapture, 1) as 1 | 2);
      break;
    case 'lifeline':
      flags.lifeline = true;
      break;
    default:
      throw new Error(`unknown rarity ability: ${ability}`);
  }
}

/** Fold each type's rarityAbilities into cumulative per-tier flags. */
export function compileAbilities(rarityAbilities: RarityAbilities): AbilityTable {
  const table = {} as AbilityTable;
  for (const type of DECK_TYPES) {
    const flags: AbilityFlags[] = [];
    let cur = emptyFlags();
    for (const tier of TIERS) {
      cur = cloneFlags(cur);
      for (const { ability, params } of rarityAbilities[type]?.[tier] ?? []) {
        applyAbility(cur, ability, params ?? {});
      }
      flags.push(cur);
    }
    table[type] = flags as AbilityTable[DeckType];
  }
  return table;
}

export function spawnCostOf(config: EngineConfig, type: 'king' | DeckType, rarity: Rarity): number {
  const p = config.pieces[type];
  return p.spawnCostByRarity[rarity] ?? p.spawnCost;
}

export function durabilityMaxOf(
  config: EngineConfig,
  type: 'king' | DeckType,
  rarity: Rarity,
): number | null {
  const p = config.pieces[type];
  return p.durabilityMaxByRarity[rarity] ?? p.durabilityMax;
}
