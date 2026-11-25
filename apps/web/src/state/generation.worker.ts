import { generateStage } from '@checkbreaker/gen';
import type { GenContent } from '@checkbreaker/gen';
import { parseFormations, parseGenConfig, parseTemplates } from '@checkbreaker/content/parse';
import type { GenConfig } from '@checkbreaker/content/parse';
import type { GenRequest } from '@checkbreaker/run';
import { genTexts } from './genContent';
import { clueOf } from './stageSource';
import type { StageAnswer } from './stageSource';

type Loaded = { config: GenConfig; content: GenContent };
let loaded: Loaded | null = null;

/** Parses the config, templates and formations once, on the first request. */
function load(): Loaded {
  if (loaded) return loaded;
  const templates = parseTemplates(genTexts.templates);
  loaded = {
    config: parseGenConfig(genTexts.texts),
    content: { templates, formations: parseFormations(genTexts.formations, templates) },
  };
  return loaded;
}

self.onmessage = (e: MessageEvent<{ id: number; request: GenRequest; templateId?: string }>): void => {
  const { id, request, templateId } = e.data;
  let answer: StageAnswer;
  try {
    const { config, content } = load();
    const t0 = performance.now();
    // The dev bench forces a template by offering only it (as scripts/gen-report does); the game never sets one.
    const offered = templateId === undefined
      ? content
      : { ...content, templates: content.templates.filter((t) => t.id === templateId) };
    const out = generateStage(request, offered, config);
    answer = { id, ok: true, stage: out.stage, provenance: out.provenance, ms: performance.now() - t0, clue: clueOf(out.solution) };
  } catch (err) {
    answer = { id, ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(answer);
};
