import type { DeckType, EngineConfig, PieceType, Rarity } from '@checkbreaker/engine';
import { bool, deepFreeze, loadEngineConfig, need, num, readYaml, DEFAULT_PATH } from './loadEngineConfig';

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

const ACTS: ActKey[] = ['act1', 'act2', 'act3'];
const RARITIES: Rarity[] = ['normal', 'rare', 'unique', 'legendary'];
const DECK_TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];

export function loadGenConfig(path: string = DEFAULT_PATH): GenConfig {
  const base = loadEngineConfig(path);
  const y: unknown = readYaml(path, 'economy.yaml');

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
