import { generateStage } from '@checkbreaker/gen';
import type { GenContent } from '@checkbreaker/gen';
import { parseFormations, parseGenConfig, parseTemplates } from '@checkbreaker/content/parse';
import type { GenConfig } from '@checkbreaker/content/parse';
import type { GenRequest } from '@checkbreaker/run';
import { genTexts } from '../config';
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

self.onmessage = (e: MessageEvent<{ id: number; request: GenRequest }>): void => {
  const { id, request } = e.data;
  let answer: StageAnswer;
  try {
    const { config, content } = load();
    const t0 = performance.now();
    const out = generateStage(request, content, config);
    answer = { id, ok: true, stage: out.stage, ms: performance.now() - t0 };
  } catch (err) {
    answer = { id, ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(answer);
};
