import { describe, expect, it } from 'vitest';
import { rng } from '../src/rng';
import { toIndex, toSquare } from '../src/square';
import {
  isAttacked, makeMove, pieceTargets, pseudoMoves, unmakeMove,
} from '../src/movegen';
import { fromBoard } from '../src/position';
import { stageOf } from './helpers';

const board = (p: Record<string, string>) => fromBoard(stageOf(p).board);
const targets = (b: Int8Array, sq: string) => pieceTargets(b, toIndex(sq)).map(toSquare).sort();

describe('movegen', () => {
  it('knight on b1', () => {
    const b = board({ b1: 'N', e1: 'K', e8: 'k' });
    expect(targets(b, 'b1')).toEqual(['a3', 'c3', 'd2']);
  });

  it('rook blocked by own pawn, captures enemy pawn', () => {
    const own = board({ a1: 'R', a3: 'P', e1: 'K', e8: 'k' });
    expect(targets(own, 'a1')).toContain('a2');
    expect(targets(own, 'a1')).not.toContain('a3');
    expect(targets(own, 'a1')).not.toContain('a4');
    const enemy = board({ a1: 'R', a3: 'p', e1: 'K', e8: 'k' });
    expect(targets(enemy, 'a1')).toContain('a3');
    expect(targets(enemy, 'a1')).not.toContain('a4');
  });

  it('king squares are attacked but never targets', () => {
    const b = board({ c1: 'B', f4: 'k', e1: 'K' });
    expect(targets(b, 'c1')).not.toContain('f4');
    expect(isAttacked(b, toIndex('f4'), 'white')).toBe(true);
    expect(isAttacked(b, toIndex('d2'), 'white')).toBe(true);
    expect(isAttacked(b, toIndex('a1'), 'white')).toBe(false);
  });

  it('pawn pushes', () => {
    expect(targets(board({ e2: 'P', e1: 'K', e8: 'k' }), 'e2')).toEqual(['e3', 'e4']);
    expect(targets(board({ e2: 'P', e3: 'n', e1: 'K', e8: 'k' }), 'e2')).toEqual([]);
    expect(targets(board({ e2: 'P', e4: 'n', e1: 'K', e8: 'k' }), 'e2')).toEqual(['e3']);
    expect(targets(board({ c4: 'P', e1: 'K', e8: 'k' }), 'c4')).toEqual(['c5']);
    expect(targets(board({ d7: 'p', e1: 'K', e8: 'k' }), 'd7')).toEqual(['d5', 'd6']);
  });

  it('pawn captures only diagonally', () => {
    const b = board({ e4: 'P', d5: 'n', f5: 'N', e5: 'n', e1: 'K', e8: 'k' });
    expect(targets(b, 'e4')).toEqual(['d5']);
  });

  it('promotion', () => {
    const b = board({ a2: 'p', e1: 'K', e8: 'k' });
    const m = pseudoMoves(b, 'black').find((x) => x.from === toIndex('a2') && x.to === toIndex('a1'));
    expect(m?.promotion).toBe('queen');
    const w = board({ h7: 'P', e1: 'K', e8: 'k' });
    const wm = pseudoMoves(w, 'white').find((x) => x.from === toIndex('h7') && x.to === toIndex('h8'));
    expect(wm?.promotion).toBe('removed');
  });

  it('make/unmake restores 200 seeded positions', () => {
    const codes = [1, 2, 3, 4, 5, -1, -2, -3, -4, -5];
    let cursor = 0;
    const next = () => {
      const r = rng('movegen-test', cursor);
      cursor = r.next;
      return r.value;
    };
    for (let n = 0; n < 200; n++) {
      const b = new Int8Array(64);
      const sqs = new Set<number>();
      while (sqs.size < 12) sqs.add(Math.floor(next() * 64));
      const list = [...sqs];
      b[list[0]!] = 6;
      b[list[1]!] = -6;
      for (const s of list.slice(2)) b[s] = codes[Math.floor(next() * codes.length)]!;
      const before = b.slice();
      for (const color of ['white', 'black'] as const) {
        for (const m of pseudoMoves(b, color)) {
          makeMove(b, m);
          unmakeMove(b, m);
          expect(Array.from(b)).toEqual(Array.from(before));
        }
      }
    }
  });
});
