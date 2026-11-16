// Node-free: shared by the Node loaders and the browser / Web Worker. Never import node:* here.
import { parse } from 'yaml';
import { compileAbilities } from '@checkbreaker/engine';
import type {
  AbilityTable, DeckType, EngineConfig, PieceType, Rarity, SkillDef, Square,
} from '@checkbreaker/engine';

/** Raw text of the three config files. */
export type ConfigTexts = { economy: string; pieces: string; skills: string };

const DECK_TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];
const ACTS: ActKey[] = ['act1', 'act2', 'act3'];
const RARITIES: Rarity[] = ['normal', 'rare', 'unique', 'legendary'];
const PIECE_TYPES: PieceType[] = ['king', 'pawn', 'knight', 'bishop', 'rook', 'queen'];

export function need(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(key in cur)) {
      throw new Error(`economy.yaml is missing required field: ${path}`);
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur === undefined || cur === null) {
    throw new Error(`economy.yaml is missing required field: ${path}`);
  }
  return cur;
}

export const num = (root: unknown, path: string): number => {
  const v = need(root, path);
  if (typeof v !== 'number') throw new Error(`economy.yaml field ${path} must be a number`);
  return v;
};
export const bool = (root: unknown, path: string): boolean => {
  const v = need(root, path);
  if (typeof v !== 'boolean') throw new Error(`economy.yaml field ${path} must be a boolean`);
  return v;
};

export function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

function pieceEconomy(y: unknown, type: 'king' | DeckType) {
  const byRarity = (key: string): Partial<Record<Rarity, number>> => {
    const raw = (y as { pieces: Record<string, Record<string, unknown>> }).pieces[type]?.[key];
    return (raw ?? {}) as Partial<Record<Rarity, number>>;
  };
  const dur = type === 'king' ? null : num(y, `pieces.${type}.durabilityMax`);
  return {
    spawnCost: num(y, `pieces.${type}.spawnCost`),
    spawnCostByRarity: byRarity('spawnCostByRarity'),
    durabilityMax: dur,
    durabilityMaxByRarity: byRarity('durabilityMaxByRarity'),
  };
}

type RawAbilities = Parameters<typeof compileAbilities>[0];

function parseAbilities(text: string): AbilityTable {
  const doc = parse(text) as { pieces?: { id: string; rarityAbilities?: unknown }[] };
  const raw = {} as RawAbilities;
  for (const t of DECK_TYPES) {
    const entry = doc?.pieces?.find((p) => p.id === t);
    if (!entry) throw new Error(`pieces.yaml is missing piece: ${t}`);
    raw[t] = (entry.rarityAbilities ?? {}) as RawAbilities[DeckType];
  }
  return compileAbilities(raw);
}

function parseSkills(text: string): Record<string, SkillDef> {
  const doc = parse(text) as { skills?: SkillDef[] };
  if (!Array.isArray(doc?.skills)) throw new Error('skills.yaml is missing required field: skills');
  const out: Record<string, SkillDef> = {};
  for (const s of doc.skills) {
    out[s.id] = {
      id: s.id,
      status: s.status,
      cost: s.cost,
      price: s.price,
      target: s.target,
      effects: s.effects,
      restrictions: s.restrictions ?? [],
    };
  }
  return out;
}

export function parseEngineConfig(t: ConfigTexts): EngineConfig {
  const y: unknown = parse(t.economy);
  const pieceValues = {} as Record<PieceType, number>;
  for (const t of PIECE_TYPES) pieceValues[t] = num(y, `pieces.${t}.value`);

  const config: EngineConfig = {
    rules: {
      freeMovesPerTurn: num(y, 'rules.freeMovesPerTurn'),
      focusPool: num(y, 'rules.focusPool'),
      minMovesPerQueue: num(y, 'rules.minMovesPerQueue'),
      deploymentRanks: need(y, 'rules.deploymentRanks') as number[],
      summonCostsDurability: num(y, 'rules.summonCostsDurability'),
      spawnPoints: {
        act1: need(y, 'rules.spawnPoints.act1') as { normal: number; boss: number },
        act2: need(y, 'rules.spawnPoints.act2') as { normal: number; boss: number },
        act3: need(y, 'rules.spawnPoints.act3') as { normal: number; boss: number },
      },
    },
    pieces: {
      king: pieceEconomy(y, 'king'),
      knight: pieceEconomy(y, 'knight'),
      bishop: pieceEconomy(y, 'bishop'),
      rook: pieceEconomy(y, 'rook'),
      queen: pieceEconomy(y, 'queen'),
    },
    abilities: parseAbilities(t.pieces),
    skills: parseSkills(t.skills),
    deck: { capacity: num(y, 'deck.capacity') },
    pieceValues,
    economy: {
      baseReward: {
        act1: num(y, 'economy.baseReward.act1'),
        act2: num(y, 'economy.baseReward.act2'),
        act3: num(y, 'economy.baseReward.act3'),
        bossMultiplier: num(y, 'economy.baseReward.bossMultiplier'),
      },
      parBonus: {
        act1: num(y, 'economy.parBonus.act1'),
        act2: num(y, 'economy.parBonus.act2'),
        act3: num(y, 'economy.parBonus.act3'),
      },
      overtimeCost: {
        act1: num(y, 'economy.overtimeCost.act1'),
        act2: num(y, 'economy.overtimeCost.act2'),
        act3: num(y, 'economy.overtimeCost.act3'),
      },
      salvage: {
        enabled: bool(y, 'economy.salvage.enabled'),
        divisor: num(y, 'economy.salvage.divisor'),
      },
      interest: {
        per: num(y, 'economy.interest.per'),
        coins: num(y, 'economy.interest.coins'),
        max: num(y, 'economy.interest.max'),
      },
    },
    enemyAI: {
      search: {
        transpositionTable: bool(y, 'enemyAI.search.transpositionTable'),
        quiescenceMaxDepth: num(y, 'enemyAI.search.quiescence.maxDepth'),
        defaultFallbackDepth: num(y, 'enemyAI.search.defaultFallbackDepth'),
        maxDepthWithRarity: num(y, 'enemyAI.search.maxDepthWithRarity'),
      },
      terminal: {
        playerMated: num(y, 'enemyAI.terminal.playerMated'),
        playerOutOfClock: num(y, 'enemyAI.terminal.playerOutOfClock'),
        enemyMated: num(y, 'enemyAI.terminal.enemyMated'),
      },
      weights: {
        kingEscapeSquare: num(y, 'enemyAI.weights.kingEscapeSquare'),
        kingZoneAttacked: num(y, 'enemyAI.weights.kingZoneAttacked'),
        kingInCheck: num(y, 'enemyAI.weights.kingInCheck'),
        materialPerPoint: num(y, 'enemyAI.weights.materialPerPoint'),
        mobilityPerMove: num(y, 'enemyAI.weights.mobilityPerMove'),
      },
    },
  };
  return deepFreeze(config);
}

export type ActKey = 'act1' | 'act2' | 'act3';

/** The solver block without the override maps. */
export type SolverBlock = Omit<GenSettings['solver'], 'byAct' | 'byTemplate'>;

/** The solver's tuning keys, partial; what a per-act override may change (docs/04 §5). */
export interface SolverOverride {
  nodeBudget?: number;
  deployment?: Partial<Pick<GenSettings['solver']['deployment'], 'maxSubsets' | 'kingSquares' | 'squaresPerPiece' | 'maxCandidates'>>;
  screen?: Partial<GenSettings['solver']['screen']>;
  deep?: Partial<GenSettings['solver']['deep']>;
  expansion?: number;
}

export interface GenSettings {
  valueBands: Record<ActKey, [number, number]>;
  bossValueMultiplier: number;
  rarityPool: Record<ActKey, { ceiling: Rarity; weights: Record<Rarity, number> }>;
  retention: Partial<Record<DeckType, Partial<Record<Rarity, number>>>>;
  promotion: { resultTypeWeights: Record<DeckType, number>; tierUpChance: number };
  maxRegenerations: number;
  maxPlacementTries: number;
  maxBoards: number;
  formations: { maxPerTemplate: number; minPerTemplate: number };
  solver: {
    nodeBudget: number;
    minSolveTurns: number;
    memoizeEnemyReplies: boolean;
    deployment: {
      maxSubsets: number;
      kingSquares: number;
      squaresPerPiece: number;
      maxCandidates: number;
      score: { kingZone: number; advance: number; attacked: number };
      advanceRanks: number[];
    };
    screen: { width: number; turns: number };
    deep: { candidates: number; width: number };
    expansion: number;
    /** Per-act overrides of the tuning keys; read through solverSettingsFor. */
    byAct?: Partial<Record<ActKey, SolverOverride>>;
    /** Per-template overrides, applied after byAct; read through solverSettingsFor. */
    byTemplate?: Record<string, SolverOverride>;
  };
  acceptance: { minSolvableRate: number; medianMateTurnTolerance: number };
}

export type GenConfig = EngineConfig & { gen: GenSettings };


export function parseGenConfig(t: ConfigTexts): GenConfig {
  const base = parseEngineConfig(t);
  const y: unknown = parse(t.economy);

  const valueBands = {} as Record<ActKey, [number, number]>;
  const rarityPool = {} as GenSettings['rarityPool'];
  for (const act of ACTS) {
    const band = need(y, `stages.enemyArmyValueBand.${act}`) as [number, number];
    valueBands[act] = [band[0], band[1]];
    const weights = {} as Record<Rarity, number>;
    for (const r of RARITIES) weights[r] = num(y, `rarity.pool.${act}.weights.${r}`);
    rarityPool[act] = { ceiling: need(y, `rarity.pool.${act}.ceiling`) as Rarity, weights };
  }
  const resultTypeWeights = {} as Record<DeckType, number>;
  for (const t of DECK_TYPES) resultTypeWeights[t] = num(y, `promotion.resultTypeWeights.${t}`);

  const gen: GenSettings = {
    valueBands,
    bossValueMultiplier: num(y, 'stages.enemyArmyValueBand.bossMultiplier'),
    rarityPool,
    retention: structuredClone(need(y, 'rarity.retention')) as GenSettings['retention'],
    promotion: { resultTypeWeights, tierUpChance: num(y, 'promotion.tierUpChance') },
    maxRegenerations: num(y, 'generation.maxRegenerations'),
    maxPlacementTries: num(y, 'generation.maxPlacementTries'),
    maxBoards: num(y, 'generation.maxBoards'),
    formations: {
      maxPerTemplate: num(y, 'generation.formations.maxPerTemplate'),
      minPerTemplate: num(y, 'generation.formations.minPerTemplate'),
    },
    solver: {
      nodeBudget: num(y, 'generation.solver.nodeBudget'),
      minSolveTurns: num(y, 'generation.solver.minSolveTurns'),
      memoizeEnemyReplies: bool(y, 'generation.solver.memoizeEnemyReplies'),
      deployment: {
        maxSubsets: num(y, 'generation.solver.deployment.maxSubsets'),
        kingSquares: num(y, 'generation.solver.deployment.kingSquares'),
        squaresPerPiece: num(y, 'generation.solver.deployment.squaresPerPiece'),
        maxCandidates: num(y, 'generation.solver.deployment.maxCandidates'),
        score: {
          kingZone: num(y, 'generation.solver.deployment.score.kingZone'),
          advance: num(y, 'generation.solver.deployment.score.advance'),
          attacked: num(y, 'generation.solver.deployment.score.attacked'),
        },
        advanceRanks: [...(need(y, 'generation.solver.deployment.advanceRanks') as number[])],
      },
      screen: {
        width: num(y, 'generation.solver.screen.width'),
        turns: num(y, 'generation.solver.screen.turns'),
      },
      deep: {
        candidates: num(y, 'generation.solver.deep.candidates'),
        width: num(y, 'generation.solver.deep.width'),
      },
      expansion: num(y, 'generation.solver.expansion'),
      ...(optional(y, 'generation.solver.byAct') === undefined
        ? {}
        : { byAct: structuredClone(optional(y, 'generation.solver.byAct')) as NonNullable<GenSettings['solver']['byAct']> }),
      ...(optional(y, 'generation.solver.byTemplate') === undefined
        ? {}
        : { byTemplate: structuredClone(optional(y, 'generation.solver.byTemplate')) as NonNullable<GenSettings['solver']['byTemplate']> }),
    },
    acceptance: {
      minSolvableRate: num(y, 'generation.acceptance.minSolvableRate'),
      medianMateTurnTolerance: num(y, 'generation.acceptance.medianMateTurnTolerance'),
    },
  };
  return deepFreeze({ ...base, gen });
}

function optional(y: unknown, path: string): unknown {
  let cur: unknown = y;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function mergeOverride(base: SolverBlock, o: SolverOverride | undefined): SolverBlock {
  if (!o) return base;
  return {
    ...base,
    nodeBudget: o.nodeBudget ?? base.nodeBudget,
    deployment: { ...base.deployment, ...o.deployment },
    screen: { ...base.screen, ...o.screen },
    deep: { ...base.deep, ...o.deep },
    expansion: o.expansion ?? base.expansion,
  };
}

/**
 * The solver settings for a stage of template `templateId` in act `actIndex` (0-based): the global block, then
 * `byAct[act<n>]`, then `byTemplate[templateId]`, deep-merged in that order, without `byAct` or `byTemplate`.
 */
export function solverSettingsFor(actIndex: number, templateId: string, config: GenConfig): SolverBlock {
  const { byAct, byTemplate, ...global } = config.gen.solver;
  const withAct = mergeOverride(global, byAct?.[`act${actIndex + 1}` as ActKey]);
  return mergeOverride(withAct, byTemplate?.[templateId]);
}

/** Sum of piece values over an enemy army; the king is excluded (mirrors scripts/validate-content.mjs). */
export function enemyArmyValue(pieces: PieceType[], config: EngineConfig): number {
  let sum = 0;
  for (const p of pieces) if (p !== 'king') sum += config.pieceValues[p];
  return sum;
}

/** Act value band; a boss band is scaled by bossValueMultiplier, unrounded (as the validator does). */
export function valueBandFor(act: 1 | 2 | 3, tier: 'normal' | 'boss', config: GenConfig): [number, number] {
  const [lo, hi] = config.gen.valueBands[`act${act}`];
  const factor = tier === 'boss' ? config.gen.bossValueMultiplier : 1;
  return [lo * factor, hi * factor];
}

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

export function parseRunConfig(t: ConfigTexts): RunConfig {
  const base = parseEngineConfig(t);
  const y: unknown = parse(t.economy);

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


function optionalNum(y: unknown, path: string): number {
  const v = optional(y, path);
  return typeof v === 'number' ? v : 0;
}

export type PreconditionId =
  | 'enemy_king_on_board'
  | 'safe_king_square'
  | 'no_first_turn_mate'
  | 'enemy_has_moves'
  | 'deployment_squares_available'
  | 'enemy_value_in_band'
  | 'spawned_pawns_placed';

export type EnemyPolicySpec = {
  type: 'best_move' | 'scripted';
  depth?: number;
  seed?: string;
  line?: string[];
  fallbackDepth?: number;
};

/** One stage template; mirrors schemas/template.schema.json field for field. */
export interface Template {
  id: string;
  title: string;
  act: 1 | 2 | 3;
  tier: 'normal' | 'boss';
  mateIn: [number, number];
  spawnPoints?: number;
  placement?: 'generated' | 'fixed';
  enemyArmy?: Partial<Record<PieceType, [number, number]>>;
  enemyZone?: number[];
  fixedEnemy?: Record<Square, PieceType>;
  spawnedPawns: { count: [number, number]; ranks: number[] };
  focusPool: number;
  enemyPolicy: EnemyPolicySpec;
  preconditions: PreconditionId[];
  designNote?: string;
}

/** Parses `<id>.yaml` files (one template per file), keeping only `.yaml` names, sorted by id. */
export function parseTemplates(files: { name: string; text: string }[]): Template[] {
  const templates = files
    .filter((f) => f.name.endsWith('.yaml'))
    .map((f) => {
      const t = parse(f.text) as Template;
      if (f.name !== `${t.id}.yaml`) throw new Error(`${f.name}: file name must equal the template id`);
      return t;
    });
  return templates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One enemy starting formation: the defending side of a Lichess puzzle, as Black-only FEN placement. */
export type Formation = { id: string; rating: number; black: string };

/** content/formations/<templateId>.json, as written by tools/formations/extract.ts; mirrors schemas/formation.schema.json. */
export type FormationFile = {
  templateId: string;
  source: { url: string; licence: 'CC0'; date: string; sha256: string };
  filters: {
    enemyZone?: number[];
    enemyArmy?: Partial<Record<'pawn' | 'knight' | 'bishop' | 'rook' | 'queen', [number, number]>>;
    valueBand: [number, number];
    noPawnOnRank8: true;
  };
  formations: Formation[];
};

/** Formations keyed by template id; `files` maps a template id to its JSON text, a missing id maps to []. */
export function parseFormations(files: Record<string, string>, templates: Template[]): Record<string, Formation[]> {
  const out: Record<string, Formation[]> = {};
  for (const t of templates) {
    const text = files[t.id];
    out[t.id] = text === undefined ? [] : (JSON.parse(text) as FormationFile).formations;
  }
  return out;
}

/** The player-facing text of one skill (for a UI: names and rule sentences are not rules data). */
export interface SkillText { id: string; name: string; ruleBroken: string; text: string }

/** Names and sentences of every skill in `skills.yaml`, in file order. */
export function parseSkillTexts(text: string): SkillText[] {
  const doc = parse(text) as { skills?: Partial<SkillText>[] };
  if (!Array.isArray(doc?.skills)) throw new Error('skills.yaml is missing required field: skills');
  return doc.skills.map((s) => ({
    id: String(s.id), name: String(s.name ?? s.id), ruleBroken: String(s.ruleBroken ?? ''), text: String(s.text ?? ''),
  }));
}

/** What each tier of one deck piece type adds, as the sentences written in `pieces.yaml`. */
export interface PieceText { pieceType: DeckType; tiers: Partial<Record<'rare' | 'unique' | 'legendary', string[]>> }

/** The rarity-ability sentences of the four deck piece types, in file order. */
export function parsePieceTexts(text: string): PieceText[] {
  const doc = parse(text) as { pieces?: { pieceType: string; rarityAbilities?: Record<string, { text?: string }[]> }[] };
  if (!Array.isArray(doc?.pieces)) throw new Error('pieces.yaml is missing required field: pieces');
  const out: PieceText[] = [];
  for (const p of doc.pieces) {
    if (!DECK_TYPES.includes(p.pieceType as DeckType)) continue;
    const tiers: PieceText['tiers'] = {};
    for (const tier of ['rare', 'unique', 'legendary'] as const) {
      const lines = (p.rarityAbilities?.[tier] ?? []).map((a) => String(a.text ?? '')).filter((t) => t !== '');
      if (lines.length > 0) tiers[tier] = lines;
    }
    out.push({ pieceType: p.pieceType as DeckType, tiers });
  }
  return out;
}
