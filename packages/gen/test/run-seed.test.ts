import { describe, expect, it } from 'vitest';
import { loadFormations, loadRunConfig, loadTemplates } from '@checkbreaker/content';
import { expectedSeed, newRun, requestFor } from '@checkbreaker/run';
import { generateWith } from '../src/generate';
import type { SolveResult } from '../src/types';
import { config } from './helpers';

const content = { templates: loadTemplates(), formations: loadFormations() };
const runConfig = loadRunConfig();
const ZERO = { screenNodes: 0, deepNodes: 0, deployments: 0, enemyCalls: 0, memoHits: 0, replayFailures: 0 };
/** No proofs: the seed is fixed at G0, before any solve, and the real solver costs 4-16 s per stage. */
const noProof = (): SolveResult => ({ win: null, stats: ZERO });

describe('gen and the run layer agree on stage seeds', () => {
  // generateStage(input) is generateWith(input, ..., solveStage): the G0 seed code is the same path.
  it('expectedSeed equals the generated stage\'s stageSeed for three run-layer requests', () => {
    for (const [seed, stageNumber] of [['7F3A-2210', 0], ['B0B0-1234', 4], ['0000-0001', 8]] as const) {
      const request = requestFor(newRun(seed, runConfig).run, stageNumber, runConfig);
      const { stage, provenance } = generateWith(request, content, config, noProof);
      const want = expectedSeed(seed, request.actIndex, request.stageIndex);
      expect(stage.stageSeed).toBe(want);
      expect(provenance.seed).toBe(want);
    }
  });
});
