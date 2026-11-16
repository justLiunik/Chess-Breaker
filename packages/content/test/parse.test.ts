import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadEngineConfig } from '../src/loadEngineConfig';
import { loadGenConfig } from '../src/loadGenConfig';
import { loadRunConfig } from '../src/loadRunConfig';
import { loadTemplates } from '../src/templates';
import { loadFormations } from '../src/formations';
import { parseEngineConfig, parseFormations, parseGenConfig, parseRunConfig, parseTemplates } from '../src/parse';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('parse entry', () => {
  it('parsers equal the Node loaders on the repo data', () => {
    const t = {
      economy: read('data/economy.yaml'),
      pieces: read('content/examples/pieces.yaml'),
      skills: read('content/examples/skills.yaml'),
    };
    expect(parseEngineConfig(t)).toEqual(loadEngineConfig());
    expect(parseRunConfig(t)).toEqual(loadRunConfig());
    expect(parseGenConfig(t)).toEqual(loadGenConfig());

    const tplDir = join(ROOT, 'content/templates');
    const templates = parseTemplates(readdirSync(tplDir).map((name) => ({ name, text: readFileSync(join(tplDir, name), 'utf8') })));
    expect(templates).toEqual(loadTemplates());

    const fDir = join(ROOT, 'content/formations');
    const files: Record<string, string> = {};
    for (const name of readdirSync(fDir).filter((n) => n.endsWith('.json'))) {
      files[name.replace(/\.json$/, '')] = readFileSync(join(fDir, name), 'utf8');
    }
    expect(parseFormations(files, templates)).toEqual(loadFormations());
  });

  it('parse entry imports nothing from node', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+'([^']+)'/g)) {
        const spec = m[1]!;
        if (spec.startsWith('node:') || ['fs', 'path', 'url'].includes(spec)) bad.push(`${file}: ${spec}`);
        if (spec.startsWith('.')) walk(resolve(dirname(file), spec.endsWith('.ts') ? spec : `${spec}.ts`));
      }
    };
    walk(fileURLToPath(new URL('../src/parse.ts', import.meta.url)));
    expect(bad).toEqual([]);
  });

  it('gen imports content at runtime only from /parse', () => {
    const genSrc = join(ROOT, 'packages/gen/src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/^(import|export)\s(?!type\b)[^;]*?from\s+'@checkbreaker\/content'/gm)) {
            offenders.push(`${p}: ${m[0]}`);
          }
        }
      }
    };
    walk(genSrc);
    expect(offenders).toEqual([]);
  });
});
