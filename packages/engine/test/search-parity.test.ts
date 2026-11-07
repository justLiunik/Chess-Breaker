import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fromBoard } from '../src/position';
import { toSquare } from '../src/square';
import { legalMoves } from '../src/legality';
import { evaluate } from '../src/enemy/evaluate';
import { scoreRootMoves } from '../src/enemy/search';
import { GAME_FENS, MIDGAME_FENS, config, fenToStage } from './helpers';

type Pinned = {
  fen: string;
  best: { from: string; to: string }[];
  score: number;
  evaluate: number;
  legalBlack: number;
};

/** What the search and evaluation return for `fen`, in the shape of the pinned baseline. */
function pinnedResult(fen: string): Pinned {
  const b = fromBoard(fenToStage(fen).board);
  const res = scoreRootMoves(b, 6, 3, config);
  const score = Math.max(...res.map((r) => r.score));
  return {
    fen,
    best: res.filter((r) => r.score === score)
      .map((r) => ({ from: toSquare(r.move.from), to: toSquare(r.move.to) })),
    score,
    evaluate: evaluate(b, config),
    legalBlack: legalMoves(b, 'black').length,
  };
}

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'search-baseline.json');
const baseline: Pinned[] = JSON.parse(readFileSync(fixture, 'utf8'));

describe('search results match the pinned baseline', () => {
  it('pins every benchmark position', () => {
    expect(baseline.map((p) => p.fen)).toEqual([...GAME_FENS, ...MIDGAME_FENS]);
  });

  for (const pinned of baseline) {
    it(pinned.fen, { timeout: 60_000 }, () => {
      expect(pinnedResult(pinned.fen)).toEqual(pinned);
    });
  }
});
