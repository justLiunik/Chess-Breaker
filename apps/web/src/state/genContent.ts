import type { ConfigTexts } from '@checkbreaker/content/parse';
import { texts } from '../config';

// Worker-only: the template and formation YAML/JSON stay out of the main bundle.
const templateFiles = import.meta.glob('../../../../content/templates/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const formationFiles = import.meta.glob('../../../../content/formations/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

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
