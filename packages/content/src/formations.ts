import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplates } from './templates';

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

const DEFAULT_FORMATIONS_DIR = fileURLToPath(new URL('../../../content/formations', import.meta.url));

/** Formations keyed by template id; a template with no file (fixed placement) maps to []. */
export function loadFormations(dir: string = DEFAULT_FORMATIONS_DIR): Record<string, Formation[]> {
  const out: Record<string, Formation[]> = {};
  for (const t of loadTemplates()) {
    const file = join(dir, `${t.id}.json`);
    out[t.id] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as FormationFile).formations : [];
  }
  return out;
}
