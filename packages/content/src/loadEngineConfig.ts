import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { compileAbilities } from '@checkbreaker/engine';
import type {
  AbilityTable, DeckType, EngineConfig, PieceType, Rarity, SkillDef,
} from '@checkbreaker/engine';

const DEFAULT_PATH = fileURLToPath(new URL('../../../data/economy.yaml', import.meta.url));
const DEFAULT_PIECES_PATH = fileURLToPath(new URL('../../../content/examples/pieces.yaml', import.meta.url));
const DEFAULT_SKILLS_PATH = fileURLToPath(new URL('../../../content/examples/skills.yaml', import.meta.url));
const DECK_TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];
const PIECE_TYPES: PieceType[] = ['king', 'pawn', 'knight', 'bishop', 'rook', 'queen'];

function need(root: unknown, path: string): unknown {
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

const num = (root: unknown, path: string): number => {
  const v = need(root, path);
  if (typeof v !== 'number') throw new Error(`economy.yaml field ${path} must be a number`);
  return v;
};
const bool = (root: unknown, path: string): boolean => {
  const v = need(root, path);
  if (typeof v !== 'boolean') throw new Error(`economy.yaml field ${path} must be a boolean`);
  return v;
};

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

function readYaml(path: string, label: string): unknown {
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${label} not found: ${path}`);
    }
    throw e;
  }
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

function loadAbilities(piecesPath: string): AbilityTable {
  const doc = readYaml(piecesPath, 'pieces.yaml') as { pieces?: { id: string; rarityAbilities?: unknown }[] };
  const raw = {} as RawAbilities;
  for (const t of DECK_TYPES) {
    const entry = doc?.pieces?.find((p) => p.id === t);
    if (!entry) throw new Error(`pieces.yaml is missing piece: ${t}`);
    raw[t] = (entry.rarityAbilities ?? {}) as RawAbilities[DeckType];
  }
  return compileAbilities(raw);
}

function loadSkills(skillsPath: string): Record<string, SkillDef> {
  const doc = readYaml(skillsPath, 'skills.yaml') as { skills?: SkillDef[] };
  if (!Array.isArray(doc?.skills)) throw new Error('skills.yaml is missing required field: skills');
  const out: Record<string, SkillDef> = {};
  for (const s of doc.skills) {
    out[s.id] = {
      id: s.id,
      status: s.status,
      cost: s.cost,
      charges: s.charges,
      price: s.price,
      target: s.target,
      effects: s.effects,
      restrictions: s.restrictions ?? [],
    };
  }
  return out;
}

export function loadEngineConfig(
  path: string = DEFAULT_PATH,
  piecesPath: string = DEFAULT_PIECES_PATH,
  skillsPath: string = DEFAULT_SKILLS_PATH,
): EngineConfig {
  const y: unknown = readYaml(path, 'economy.yaml');
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
    abilities: loadAbilities(piecesPath),
    skills: loadSkills(skillsPath),
    deck: { capacity: num(y, 'deck.capacity') },
    pieceValues,
    economy: {
      baseReward: {
        act1: num(y, 'economy.baseReward.act1'),
        act2: num(y, 'economy.baseReward.act2'),
        act3: num(y, 'economy.baseReward.act3'),
        bossMultiplier: num(y, 'economy.baseReward.bossMultiplier'),
      },
      coinRate: {
        act1: num(y, 'economy.coinRate.act1'),
        act2: num(y, 'economy.coinRate.act2'),
        act3: num(y, 'economy.coinRate.act3'),
      },
      salvage: {
        enabled: bool(y, 'economy.salvage.enabled'),
        divisor: num(y, 'economy.salvage.divisor'),
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
        playerOutOfTurns: num(y, 'enemyAI.terminal.playerOutOfTurns'),
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
