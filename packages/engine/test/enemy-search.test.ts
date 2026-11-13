import { describe, expect, it } from 'vitest';
import { fromBoard } from '../src/position';
import { toIndex, toSquare } from '../src/square';
import { inCheck, legalMoves } from '../src/legality';
import { makeMove } from '../src/movegen';
import { mateBound, scoreRootMoves } from '../src/enemy/search';
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

  it('scores a mate on the horizon as a terminal', () => {
    const res = scoreRootMoves(b({ a1: 'K', a2: 'P', b2: 'P', h8: 'k', e8: 'r' }), 5, 1, config);
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

  it('scores every root move as out of clock when the player has no clock left, mates included', () => {
    // White's out-of-clock check comes before its no-legal-move check, so even a mate scores 50000.
    for (const fen of MIDGAME_FENS) {
      const res = scoreRootMoves(fenBoard(fen), 0, 2, config);
      expect(res.length).toBeGreaterThan(0);
      for (const r of res) expect(r.score).toBe(50000);
    }
    const mate = scoreRootMoves(b({ a1: 'K', a2: 'P', b2: 'P', h8: 'k', e8: 'r' }), 0, 2, config);
    expect(scoreOf(mate, 'e8', 'e1')).toBe(50000);
    expect(mate.every((r) => r.score === 50000)).toBe(true);
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
    for (const r of res) expect(Number.isInteger(r.score)).toBe(true);
  });

  it('orders root moves by MVV/LVA, then checks, then from-index, then to-index', () => {
    // Bxd4+ and Nxd4 take the queen with equal-value attackers, so the check breaks the tie; the quiet
    // check Rh1+ comes before every other quiet move although its from-index (h6) is high.
    const board = b({
      a1: 'K', d4: 'Q', b5: 'N', h7: 'k', d8: 'r', c6: 'n', e5: 'b', a6: 'p', h6: 'r',
    });
    const res = scoreRootMoves(board, 5, 2, config);
    const names = res.map((r) => `${toSquare(r.move.from)}${toSquare(r.move.to)}`);
    expect(names.slice(0, 6)).toEqual(['e5d4', 'c6d4', 'd8d4', 'a6b5', 'h6h1', 'e5h2']);

    // The full order against an independent statement of the comparator.
    const value = (code: number, attacker: boolean): number => {
      const t = (['pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const)[Math.abs(code)]!;
      return attacker && t === 'king' ? Infinity : config.pieceValues[t];
    };
    const keyed = legalMoves(board, 'black').map((m) => {
      const after = board.slice();
      makeMove(after, m);
      return {
        name: `${toSquare(m.from)}${toSquare(m.to)}`,
        cap: m.captured !== 0 ? 1 : 0,
        v: m.captured !== 0 ? value(m.captured, false) : 0,
        a: m.captured !== 0 ? value(board[m.from]!, true) : 0,
        chk: inCheck(after, 'white') ? 1 : 0,
        from: m.from,
        to: m.to,
      };
    });
    keyed.sort((x, y) => (y.cap - x.cap) || (y.v - x.v) || (x.a - y.a) || (y.chk - x.chk)
      || (x.from - y.from) || (x.to - y.to));
    expect(names).toEqual(keyed.map((k) => k.name));
  });

  it('does not throw for turns left beyond the hash range', () => {
    expect(() => scoreRootMoves(fenBoard(MIDGAME_FENS[0]!), 30, 2, config)).not.toThrow();
  });
});

describe('mateBound', () => {
  it('is the midpoint of the player-mated and out-of-clock scores', () => {
    expect(mateBound(config)).toBe(75000);
  });

  // The bound only affects the TT's node-relative storage, and a TT key includes the turns left, which
// fixes the ply of a node within one search, so the adjustment cannot change a root score; this test
// therefore pins the derived value and that mates still score by distance, not the TT behaviour.
  it('follows the configured terminal scores, and mates still score by distance', () => {
    const big: EngineConfig = {
      ...config,
      enemyAI: {
        ...config.enemyAI,
        terminal: { playerMated: 200000, playerOutOfClock: 50000, enemyMated: -200000 },
      },
    };
    expect(mateBound(big)).toBe(125000);
    const in1 = scoreRootMoves(b({ a1: 'K', a2: 'P', b2: 'P', h8: 'k', e8: 'r' }), 5, 3, big);
    const in2 = scoreRootMoves(b({ a1: 'K', h8: 'k', c7: 'r', h6: 'r' }), 5, 3, big);
    expect(maxScore(in1)).toBe(199999);
    expect(maxScore(in2)).toBe(199997);
    expect(maxScore(in1)).toBeGreaterThan(maxScore(in2));
  });
});
