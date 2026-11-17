import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplates } from './parse';
import type { Template } from './parse';

export type { EnemyPolicySpec, PreconditionId, Template } from './parse';

const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL('../../../content/templates', import.meta.url));

/** Loads every `<id>.yaml` in `dir` (one template per file), sorted by id. */
export function loadTemplates(dir: string = DEFAULT_TEMPLATES_DIR): Template[] {
  return parseTemplates(
    readdirSync(dir)
      .filter((name) => name.endsWith('.yaml'))
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') })),
  );
}
