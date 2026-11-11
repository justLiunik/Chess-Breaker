import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { PieceType, Square } from '@checkbreaker/engine';

const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL('../../../content/templates', import.meta.url));

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
  turnLimit: number;
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

/** Loads every `<id>.yaml` in `dir` (one template per file), sorted by id. */
export function loadTemplates(dir: string = DEFAULT_TEMPLATES_DIR): Template[] {
  const templates = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => {
      const t = parse(readFileSync(join(dir, name), 'utf8')) as Template;
      if (name !== `${t.id}.yaml`) throw new Error(`${name}: file name must equal the template id`);
      return t;
    });
  return templates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
