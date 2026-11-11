import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGenConfig } from '../src/loadGenConfig';
import { loadFormations } from '../src/formations';
import { loadTemplates } from '../src/templates';

describe('loadFormations', () => {
  const formations = loadFormations();
  const templates = loadTemplates();

  it('has an entry for every template; fixed ones map to []', () => {
    expect(Object.keys(formations).sort()).toEqual(templates.map((t) => t.id));
    for (const t of templates) {
      if (t.placement === 'fixed') expect(formations[t.id]).toEqual([]);
      else expect(formations[t.id]!.length).toBeGreaterThan(0);
    }
  });

  it('every black field is 8 ranks of Black pieces only', () => {
    for (const list of Object.values(formations)) {
      for (const f of list) {
        const ranks = f.black.split('/');
        expect(ranks).toHaveLength(8);
        for (const r of ranks) {
          expect(r).toMatch(/^[1-8kqrbnp]+$/);
          const width = [...r].reduce((n, c) => n + (/\d/.test(c) ? Number(c) : 1), 0);
          expect(width).toBe(8);
        }
        expect(Number.isInteger(f.rating)).toBe(true);
      }
    }
  });

  it('keeps at most maxPerTemplate formations per template', () => {
    const max = loadGenConfig().gen.formations.maxPerTemplate;
    for (const list of Object.values(formations)) expect(list.length).toBeLessThanOrEqual(max);
  });

  it('a missing directory yields [] for every template', () => {
    const none = loadFormations(fileURLToPath(new URL('./no-such-dir/', import.meta.url)));
    expect(Object.values(none).every((l) => l.length === 0)).toBe(true);
  });
});
