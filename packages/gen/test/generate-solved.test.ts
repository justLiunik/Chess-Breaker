import { describe, expect, it } from 'vitest';
import { loadFormations, loadTemplates } from '@checkbreaker/content';
import type { RunState } from '@checkbreaker/engine';
import { generateStage } from '../src/generate';
import { replayLine } from '../src/solver/replay';
import { solveStage } from '../src/solver';
import { config, deckRun, deepFreeze } from './helpers';

const TIMEOUT = 120_000;
const ID = 'tpl-act2-fortress';
const templates = loadTemplates().filter((t) => t.id === ID);
const content = { templates, formations: { [ID]: loadFormations()[ID] ?? [] } };
const withSeed = (run: RunState, seed: string): RunState => deepFreeze({ ...run, seed });
const midInput = (seed: string) => ({ run: withSeed(deckRun('mid', 1, 0), seed), actIndex: 1, stageIndex: 0 });

describe('generateStage with the real solver', () => {
  it('three seeds on tpl-act2-fortress: each is proven and replays, or has the bonus pawn; one is proven', () => {
    let proven = 0;
    for (const seed of ['AAAA-0001', 'AAAA-0002', 'AAAA-0003']) {
      const input = midInput(seed);
      const { stage, provenance } = generateStage(input, content, config);
      expect(provenance.templateId).toBe(ID);
      if (provenance.proven) {
        proven++;
        const r = solveStage(input.run, stage, config);
        expect(r.win).not.toBeNull();
        expect(r.stats.replayFailures).toBe(0);
        expect(replayLine(input.run, stage, r.win!, config)).toBe(true);
      } else {
        expect(provenance.bonusPawn).toBe(true);
      }
    }
    expect(proven).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);

  it('the same input twice gives a byte-identical StageState and Provenance', () => {
    const a = generateStage(midInput('AAAA-0001'), content, config);
    const b = generateStage(midInput('AAAA-0001'), content, config);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, TIMEOUT);

  it('the mid deck in reversed array order gives a byte-identical result', () => {
    const run = withSeed(deckRun('mid', 1, 0), 'AAAA-0001');
    const reversed = deepFreeze({ ...run, deck: [...run.deck].reverse() });
    const a = generateStage({ run, actIndex: 1, stageIndex: 0 }, content, config);
    const b = generateStage({ run: reversed, actIndex: 1, stageIndex: 0 }, content, config);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, TIMEOUT);

  it('a King-only run on Act I is unproven with the bonus pawn (or no free square), and does not throw', () => {
    const base = deckRun('starter', 0, 0);
    const run = deepFreeze({ ...base, deck: base.deck.filter((p) => p.pieceType === 'king') });
    expect(run.deck.length).toBe(1);
    const t1 = loadTemplates().filter((t) => t.act === 1);
    const content1 = { templates: t1, formations: loadFormations() };
    const { provenance } = generateStage({ run, actIndex: 0, stageIndex: 0 }, content1, config);
    expect(provenance.proven).toBe(false);
    // The bonus pawn is added only when a free square passes the preconditions; either way nothing throws.
    expect(typeof provenance.bonusPawn).toBe('boolean');
  }, TIMEOUT);
});
