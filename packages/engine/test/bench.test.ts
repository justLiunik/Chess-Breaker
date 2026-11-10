import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fromBoard, tiersOf } from '../src/position';
import { scoreRootMoves } from '../src/enemy/search';
import { hasLegalQueue } from '../src/legal-queue';
import type { StageState } from '../src/types';
import { GAME_FENS, MIDGAME_FENS, RARITY_FENS, config, fenToStage, rarityStage, runOf, stageOf } from './helpers';

const WARMUP = 3;
const RUNS = 20;

/** M1 medians in ms per GAME_FEN: the M1 code (647bc0c) measured on this machine (Rulings R3, R14). */
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bench-baseline.json');
const baseline: Record<string, number> = JSON.parse(readFileSync(fixture, 'utf8'));

/**
 * Median wall time in ms of a depth-4 root search, playerTurnsLeft 6, after a warm-up. The tiers
 * are passed as enemyMove passes them.
 */
function medianMs(stage: StageState): number {
  const b = fromBoard(stage.board);
  const t = tiersOf(stage.board);
  for (let i = 0; i < WARMUP; i++) scoreRootMoves(b, 6, 4, config, undefined, t);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    scoreRootMoves(b, 6, 4, config, undefined, t);
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  return (times[RUNS / 2 - 1]! + times[RUNS / 2]!) / 2;
}

describe('depth-4 enemy search speed', () => {
  for (const fen of GAME_FENS) {
    it(`under 50 ms and at most 1.1x M1 (median): ${fen}`, { timeout: 120_000 }, () => {
      const ms = medianMs(fenToStage(fen));
      const m1 = baseline[fen]!;
      console.log(`depth 4 median ${ms.toFixed(1)} ms (M1 ${m1} ms, ${(ms / m1).toFixed(2)}x)  ${fen}`);
      expect(ms).toBeLessThan(50);
      expect(ms).toBeLessThanOrEqual(1.1 * m1);
    });
  }

  // Report-only (Ruling R14): rarity pieces genuinely enlarge the tree, so the 2x ratio is logged,
  // not asserted; docs/10's risk register carries the open decision.
  it('reports rarity medians and their ratio to the GAME_FEN baseline (not asserted)', { timeout: 600_000 }, () => {
    for (const { fen, rarity } of RARITY_FENS) {
      const ms = medianMs(rarityStage(fen, rarity));
      const m1 = baseline[fen]!;
      console.log(`depth 4 median ${ms.toFixed(1)} ms (M1 ${m1} ms, ${(ms / m1).toFixed(2)}x)  ${fen} ${rarity}`);
    }
  });

  it('reports middle-game medians (not asserted)', { timeout: 600_000 }, () => {
    for (const fen of MIDGAME_FENS) {
      console.log(`depth 4 median ${medianMs(fenToStage(fen)).toFixed(1)} ms  ${fen} (middle game)`);
    }
  });
});

// The final M2 review's worst case: White is mated, so hasLegalQueue must exhaust every queue that
// Twin Step, Ascension and Lockdown allow before it answers false (7.8 s before the fix).
const MATED = {
  h1: 'K', g2: 'P', h2: 'P', a1: 'r', h8: 'k',
  b2: 'p', c2: 'p', d2: 'p', e2: 'p', f2: 'p',
  a3: 'p', b3: 'p', c3: 'p', d3: 'p', e3: 'p', f3: 'p', g3: 'p', h3: 'p',
  g4: 'n', a6: 'N', c6: 'N', e6: 'B', b5: 'B', d6: 'R', f6: 'R', d7: 'Q',
};
const HLQ_BOUND_MS = 400; // about 2x the 190 ms median measured on this machine after the fix

describe('hasLegalQueue speed', () => {
  it(`a mated board with all three launch skills: under ${HLQ_BOUND_MS} ms (median of 5)`, { timeout: 120_000 }, () => {
    const stage = stageOf(MATED);
    const run = runOf({
      loadout: ['twin_step', 'ascension', 'lockdown'].map((skillId) => ({ skillId, charges: 3, chargesMax: 3 })),
    });
    expect(hasLegalQueue(run, stage, config)).toBe(false); // warm-up, and the answer
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      hasLegalQueue(run, stage, config);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const ms = times[2]!;
    console.log(`hasLegalQueue mated, three skills: median ${ms.toFixed(1)} ms (bound ${HLQ_BOUND_MS} ms)`);
    expect(ms).toBeLessThan(HLQ_BOUND_MS);
  });
});
