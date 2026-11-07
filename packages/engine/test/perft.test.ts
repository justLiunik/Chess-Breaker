import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { legalMoves } from '../src/legality';
import { makeMove, unmakeMove } from '../src/movegen';
import { fromBoard } from '../src/position';
import type { Color } from '../src/types';
import { fenToStage } from './helpers';

function perft(b: Int8Array, color: Color, depth: number): number {
  if (depth === 0) return 1;
  const next: Color = color === 'white' ? 'black' : 'white';
  let n = 0;
  for (const m of legalMoves(b, color)) {
    if (depth === 1) { n++; continue; }
    makeMove(b, m);
    n += perft(b, next, depth - 1);
    unmakeMove(b, m);
  }
  return n;
}

function refPerft(c: Chess, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of c.moves({ verbose: true })) {
    if (m.flags.includes('e')) continue;
    if (m.promotion && m.promotion !== 'q') continue;
    if (depth === 1) { n++; continue; }
    c.move(m);
    n += refPerft(c, depth - 1);
    c.undo();
  }
  return n;
}

const CASES: [string, number][] = [
  ['4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1', 4],
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1', 3],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w - - 0 1', 3],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4],
  ['8/8/8/8/8/4k3/ppp5/4K3 b - - 0 1', 4],
  ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 3],
];

describe('perft vs chess.js', () => {
  for (const [fen, depth] of CASES) {
    it(`${fen} d${depth}`, { timeout: 120_000 }, () => {
      const color: Color = fen.split(' ')[1] === 'w' ? 'white' : 'black';
      const b = fromBoard(fenToStage(fen).board);
      for (let d = 1; d <= depth; d++) {
        expect(perft(b, color, d), `depth ${d}`).toBe(refPerft(new Chess(fen), d));
      }
    });
  }
});
