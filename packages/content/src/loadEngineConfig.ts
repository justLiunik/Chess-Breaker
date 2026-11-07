import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { EngineConfig, PieceType } from '../../engine/src/types';

const DEFAULT_PATH = fileURLToPath(new URL('../../../data/economy.yaml', import.meta.url));
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

export function loadEngineConfig(path: string = DEFAULT_PATH): EngineConfig {
  const y: unknown = parse(readFileSync(path, 'utf8'));
  const pieceValues = {} as Record<PieceType, number>;
  for (const t of PIECE_TYPES) pieceValues[t] = num(y, `pieces.${t}.value`);

  const config: EngineConfig = {
    rules: {
      freeMovesPerTurn: num(y, 'rules.freeMovesPerTurn'),
      focusPool: num(y, 'rules.focusPool'),
      minMovesPerQueue: num(y, 'rules.minMovesPerQueue'),
    },
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
