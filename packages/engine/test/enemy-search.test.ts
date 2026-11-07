import { describe, expect, it } from 'vitest';
import { fromBoard } from '../src/position';
import { toIndex, toSquare } from '../src/square';
import { inCheck, legalMoves } from '../src/legality';
import { makeMove } from '../src/movegen';
import { scoreRootMoves } from '../src/enemy/search';
import type { EngineConfig } from '../src/types';
import { MIDGAME_FENS, config, fenToStage, stageOf } from './helpers';

const b = (p: Record<string, string>) => fromBoard(stageOf(p).board);
const fenBoard = (fen: string) => fromBoard(fenToStage(fen).board);

type Scored = ReturnType<typeof scoreRootMoves>;
const scoreOf = (res: Scored, from: string, to: string): number => {
  const r = res.find((x) => x.move.from === toIndex(from) && x.move.to === toIndex(to));
  if (!r) throw new Error(`no root move ${from}${to}`);
  return r.score;
};
const maxScore = (res: Scored) => Math.max(...res.map((r) => r.score));
const tiedBest = (res: Scored) => {
  const best = maxScore(res);
  return res
    .filter((r) => r.score === best)
    .map((r) => `${toSquare(r.move.from)}${toSquare(r.move.to)}=${r.score}`);
};

const ttOff: EngineConfig = {
  ...config,
  enemyAI: { ...config.enemyAI, search: { ...config.enemyAI.search, transpositionTable: false } },
};

describe('scoreRootMoves', () => {
  it('finds a mate in 1 and scores it by distance', () => {
    const res = scoreRootMoves(b({ a1: 'K', a2: 'P', b2: 'P', h8: 'k', e8: 'r' }), 5, 2, config);
    expect(scoreOf(res, 'e8', 'e1')).toBe(99999);
    expect(maxScore(res)).toBe(99999);
  });

  it('scores a forced loss by its distance', () => {
    const res = scoreRootMoves(b({ b6: 'K', c6: 'Q', a8: 'k' }), 5, 2, config);
    expect(res).toHaveLength(1);
    expect(scoreOf(res, 'a8', 'b8')).toBe(-100000 + 2);
  });

  it('counts player stalemate as the player\'s loss', () => {
    const res = scoreRootMoves(b({ a1: 'K', c2: 'k', d3: 'q' }), 5, 2, config);
    expect(scoreOf(res, 'd3', 'b3')).toBe(99999);
    expect(scoreOf(res, 'd3', 'a3')).toBe(99999);
    expect(maxScore(res)).toBe(99999);
  });

  it('resolves captures past the horizon with quiescence', () => {
    const res = scoreRootMoves(b({ a1: 'K', d1: 'R', d4: 'P', h8: 'k', d5: 'q' }), 5, 1, config);
    const bestQuiet = Math.max(...res.filter((r) => r.move.captured === 0).map((r) => r.score));
    expect(scoreOf(res, 'd5', 'd4')).toBeLessThan(bestQuiet);
  });

  it('scores every non-mating move as out of turns when the player has none left', () => {
    for (const fen of MIDGAME_FENS) {
      const board = fenBoard(fen);
      const res = scoreRootMoves(board, 0, 2, config);
      expect(res.length).toBeGreaterThan(0);
      for (const r of res) {
        const after = board.slice();
        makeMove(after, r.move);
        const mates = inCheck(after, 'white') && legalMoves(after, 'white').length === 0;
        if (!mates) expect(r.score).toBe(50000);
      }
    }
  });

  it('gives identical tied-best scores with the transposition table on and off', () => {
    for (const fen of MIDGAME_FENS) {
      const on = scoreRootMoves(fenBoard(fen), 8, 3, config);
      const off = scoreRootMoves(fenBoard(fen), 8, 3, ttOff);
      expect(on.map((r) => r.move)).toEqual(off.map((r) => r.move));
      expect(tiedBest(on)).toEqual(tiedBest(off));
    }
  });

  it('returns every legal root move in the stable order and leaves the input untouched', () => {
    const board = fenBoard(MIDGAME_FENS[1]!);
    const copy = board.slice();
    const res = scoreRootMoves(board, 8, 2, config);
    expect(board).toEqual(copy);
    expect(res).toHaveLength(legalMoves(board, 'black').length);
    const caps = res.filter((r) => r.move.captured !== 0).length;
    expect(res.slice(0, caps).every((r) => r.move.captured !== 0)).toBe(true);
    for (const r of res) expect(Number.isInteger(r.score)).toBe(true);
  });

  it('does not throw for turns left beyond the hash range', () => {
    expect(() => scoreRootMoves(fenBoard(MIDGAME_FENS[0]!), 30, 2, config)).not.toThrow();
  });
});
