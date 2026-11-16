import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplates } from './templates';
import { parseFormations } from './parse';
import type { Formation } from './parse';

export type { Formation, FormationFile } from './parse';

const DEFAULT_FORMATIONS_DIR = fileURLToPath(new URL('../../../content/formations', import.meta.url));

/** Formations keyed by template id; a template with no file (fixed placement) maps to []. */
export function loadFormations(dir: string = DEFAULT_FORMATIONS_DIR): Record<string, Formation[]> {
  const files: Record<string, string> = {};
  const templates = loadTemplates();
  for (const t of templates) {
    const file = join(dir, `${t.id}.json`);
    if (existsSync(file)) files[t.id] = readFileSync(file, 'utf8');
  }
  return parseFormations(files, templates);
}
