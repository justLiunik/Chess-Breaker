import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTemplates } from '../src/templates';

const DIR = fileURLToPath(new URL('../../../content/templates', import.meta.url));

describe('loadTemplates', () => {
  it('returns the five templates sorted by id', () => {
    expect(loadTemplates().map((t) => t.id)).toEqual([
      'tpl-act1-boss-gatehouse',
      'tpl-act1-first-steps',
      'tpl-act1-open-field',
      'tpl-act2-fortress',
      'tpl-act3-boss-redoubt',
    ]);
  });

  it('names every file after its template id', () => {
    const files = readdirSync(DIR).filter((n) => n.endsWith('.yaml')).sort();
    expect(files).toEqual(loadTemplates().map((t) => `${t.id}.yaml`));
  });
});
