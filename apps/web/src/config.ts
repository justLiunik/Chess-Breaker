import { parseEngineConfig, parseRunConfig } from '@checkbreaker/content/parse';
import type { ConfigTexts } from '@checkbreaker/content/parse';
import type { EngineConfig } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content/parse';
import economy from '../../../data/economy.yaml?raw';
import pieces from '../../../content/examples/pieces.yaml?raw';
import skills from '../../../content/examples/skills.yaml?raw';

const texts: ConfigTexts = { economy, pieces, skills };

const templateFiles = import.meta.glob('../../../content/templates/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const formationFiles = import.meta.glob('../../../content/formations/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export const engineConfig: EngineConfig = parseEngineConfig(texts);
export const runConfig: RunConfig = parseRunConfig(texts);

/** Raw texts handed to the generation worker, which parses them itself (gen config, templates, formations). */
export const genTexts: {
  texts: ConfigTexts;
  templates: { name: string; text: string }[];
  formations: Record<string, string>;
} = {
  texts,
  templates: Object.entries(templateFiles).map(([path, text]) => ({ name: baseName(path), text })),
  formations: Object.fromEntries(
    Object.entries(formationFiles).map(([path, text]) => [baseName(path).replace(/\.json$/, ''), text]),
  ),
};
