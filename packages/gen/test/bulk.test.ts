import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { TIERS } from '@checkbreaker/engine';
import { loadFormations, loadTemplates } from '@checkbreaker/content';
import type { ActKey } from '@checkbreaker/content';
import { checkPreconditions } from '../src/preconditions';
import { generateWith } from '../src/generate';
import type { SolveResult } from '../src/types';
import { config, deckRun } from './helpers';

const templates = loadTemplates();
const content = { templates, formations: loadFormations() };
const first: SolveResult = {
  win: { placements: [], line: [], mateTurn: 1 },
  stats: { screenNodes: 0, deepNodes: 0, deployments: 0, enemyCalls: 0, memoHits: 0, replayFailures: 0 },
};
const schema = JSON.parse(readFileSync(new URL('../../../schemas/stage.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

// The (act, stageIndex) pairs the templates cover: boss -> 2, normal -> 0 or 1.
const pairs: { actIndex: number; stageIndex: number }[] = [];
for (const t of templates) {
  for (const stageIndex of t.tier === 'boss' ? [2] : [0, 1]) {
    if (!pairs.some((p) => p.actIndex === t.act - 1 && p.stageIndex === stageIndex)) {
      pairs.push({ actIndex: t.act - 1, stageIndex });
    }
  }
}
pairs.sort((a, b) => a.actIndex - b.actIndex || a.stageIndex - b.stageIndex);

describe('1,000-stage CI run', () => {
  it('every stage is a valid, deterministic Deployment-phase stage', { timeout: 120_000 }, () => {
    for (let i = 0; i < 1000; i++) {
      const { actIndex, stageIndex } = pairs[i % pairs.length]!;
      const deck = actIndex === 0 ? 'starter' : actIndex === 1 ? 'mid' : 'strong';
      const run = { ...deckRun(deck, actIndex, stageIndex), seed: `BULK-${i}` };
      const input = { run, actIndex, stageIndex };
      const { stage, provenance } = generateWith(input, content, config, () => first);
      const where = `#${i} act${actIndex + 1}/${stageIndex}`;
      const tpl = templates.find((t) => t.id === provenance.templateId)!;
      const ceiling = TIERS.indexOf(config.gen.rarityPool[`act${actIndex + 1}` as ActKey].ceiling);

      expect(stage.phase, where).toBe('deployment');
      expect(provenance.validationFailed, where).toBeUndefined();
      const pieces = Object.values(stage.board);
      expect(pieces.some((p) => p.color === 'white' && !p.spawned), where).toBe(false);
      expect(checkPreconditions(run, stage, tpl, { extraPawns: 0 }, config), where).toBeNull();
      for (const p of pieces) {
        if (p.color === 'black') expect(p.rarity, where).toBeUndefined();
        if (p.spawned) {
          expect(TIERS.indexOf(p.rarity!), where).toBeLessThanOrEqual(ceiling);
          expect(TIERS.indexOf(p.promotesTo!.rarity), where).toBeLessThanOrEqual(ceiling);
        }
      }
      expect(validate(stage), `${where} ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(JSON.stringify(generateWith(input, content, config, () => first)), where).toBe(
        JSON.stringify({ stage, provenance }),
      );
    }
  });
});
