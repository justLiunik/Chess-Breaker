import { describe, expect, it } from 'vitest';
import { fromBoard } from '../src/position';
import { scoreRootMoves } from '../src/enemy/search';
import { GAME_FENS, MIDGAME_FENS, config, fenToStage } from './helpers';

const WARMUP = 3;
const RUNS = 20;

/** Median wall time in ms of a depth-4 root search, playerTurnsLeft 6, after a warm-up. */
function medianMs(fen: string): number {
  const b = fromBoard(fenToStage(fen).board);
  for (let i = 0; i < WARMUP; i++) scoreRootMoves(b, 6, 4, config);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    scoreRootMoves(b, 6, 4, config);
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  return (times[RUNS / 2 - 1]! + times[RUNS / 2]!) / 2;
}

describe('depth-4 enemy search speed', () => {
  for (const fen of GAME_FENS) {
    it(`under 50 ms (median): ${fen}`, { timeout: 120_000 }, () => {
      const ms = medianMs(fen);
      console.log(`depth 4 median ${ms.toFixed(1)} ms  ${fen}`);
      expect(ms).toBeLessThan(50);
    });
  }

  it('reports middle-game medians (not asserted)', { timeout: 600_000 }, () => {
    for (const fen of MIDGAME_FENS) {
      console.log(`depth 4 median ${medianMs(fen).toFixed(1)} ms  ${fen} (middle game)`);
    }
  });
});
