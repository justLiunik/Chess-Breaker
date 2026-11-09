import { describe, expect, it } from 'vitest';
import { abilityAttacked, abilityTargets, hasTiers } from '../src/abilities';
import { makeMove, pieceTargets, pseudoMoves, unmakeMove, type Move } from '../src/movegen';
import { BISHOP, KNIGHT, ROOK, fromBoard, tiersOf } from '../src/position';
import { toIndex, toSquare } from '../src/square';
import type { BoardPiece, Rarity, Square } from '../src/types';
import { config, stageOf } from './helpers';

const table = config.abilities;

/** A position from `{ square: 'B' | 'B:rare' | 'p' ... }`; a White Hero Piece takes the rarity after the colon. */
function pos(spec: Record<Square, string>): { b: Int8Array; t: Int8Array; board: Record<Square, BoardPiece> } {
  const letters: Record<Square, string> = {};
  for (const [sq, v] of Object.entries(spec)) letters[sq] = v.split(':')[0]!;
  const board: Record<Square, BoardPiece> = {};
  for (const [sq, piece] of Object.entries(stageOf(letters).board)) {
    const rarity = spec[sq]!.split(':')[1] as Rarity | undefined;
    board[sq] = rarity === undefined ? piece : { ...piece, rarity };
  }
  return { b: fromBoard(board), t: tiersOf(board), board };
}

/** Destinations as squares; a multi-capture is written `X+Y` (captures X, ends on Y). */
const targetsOf = (b: Int8Array, t: Int8Array, from: Square): string[] =>
  abilityTargets(b, t, toIndex(from), table)
    .map(({ to, via }) => (via < 0 ? toSquare(to) : `${toSquare(via)}+${toSquare(to)}`))
    .sort();

type Row = {
  name: string;
  spec: Record<Square, string>;
  from: Square;
  has?: string[];
  lacks?: string[];
  attacked?: Square[];
  notAttacked?: Square[];
};

// One row per ability of docs/02 §2.3, then the multi-capture rules 1-7.
const ROWS: Row[] = [
  {
    name: 'Rare bishop leaps an ally but cannot capture after',
    spec: { c1: 'B:rare', d2: 'N', f4: 'n', e1: 'K', h8: 'k' },
    from: 'c1', has: ['e3', 'b2', 'a3'], lacks: ['d2', 'f4', 'g5'],
    attacked: ['d2'], notAttacked: ['e3', 'f4', 'g5'],
  },
  {
    name: 'Normal bishop does not leap (tier 0 is M1)',
    spec: { c1: 'B:normal', d2: 'N', f4: 'n', e1: 'K', h8: 'k' },
    from: 'c1', has: ['b2', 'a3'], lacks: ['d2', 'e3', 'f4'], attacked: ['d2'], notAttacked: ['e3'],
  },
  {
    name: 'Rare bishop gives no check through an ally',
    spec: { c1: 'B:rare', d2: 'N', f4: 'k', e1: 'K' },
    from: 'c1', has: ['e3'], lacks: ['f4'], notAttacked: ['e3', 'f4'],
  },
  {
    name: 'Unique bishop captures after a leap and checks through an ally',
    spec: { c1: 'B:unique', d2: 'N', f4: 'n', e1: 'K', h8: 'k' },
    from: 'c1', has: ['e3', 'f4'], lacks: ['d2', 'g5'], attacked: ['e3', 'f4'], notAttacked: ['g5'],
  },
  {
    name: 'Unique bishop checks a king through an ally',
    spec: { c1: 'B:unique', d2: 'N', f4: 'k', e1: 'K' },
    from: 'c1', has: ['e3'], lacks: ['f4', 'g5'], attacked: ['f4'], notAttacked: ['g5'],
  },
  {
    name: 'Legendary bishop moves orthogonally, leaps, captures after',
    spec: { d1: 'B:legendary', d3: 'N', d5: 'r', h3: 'K', h8: 'k' },
    from: 'd1', has: ['d2', 'd4', 'd5', 'e2', 'a4', 'a1', 'h1'], lacks: ['d3', 'd6'],
    attacked: ['d4', 'd5', 'c1'], notAttacked: ['d6'],
  },
  {
    name: 'Rare knight (2,0) leaps over pieces; Unique adds (2,2)',
    spec: { f3: 'N:rare', f4: 'p', h3: 'b', d3: 'P', a1: 'K', a8: 'k' },
    from: 'f3', has: ['f5', 'f1', 'h3', 'g5', 'e1'], lacks: ['d3', 'd5', 'h5', 'd1', 'h1'],
    attacked: ['f5', 'd3'], notAttacked: ['d5', 'h5'],
  },
  {
    name: 'Unique knight leaps two diagonally, never onto a king',
    spec: { f3: 'N:unique', d5: 'k', a1: 'K' },
    from: 'f3', has: ['h5', 'd1', 'h1', 'f5', 'd3', 'g5'], lacks: ['d5'], attacked: ['d5', 'h5', 'h1'],
  },
  {
    name: 'Rare rook leaps without capture',
    spec: { a1: 'R:rare', a2: 'P', a4: 'q', h1: 'K', h8: 'k' },
    from: 'a1', has: ['a3', 'b1'], lacks: ['a2', 'a4', 'b2'], attacked: ['a2'], notAttacked: ['a3', 'a4'],
  },
  {
    name: 'Unique rook steps diagonally and captures',
    spec: { a1: 'R:unique', b2: 'n', h1: 'K', h8: 'k' },
    from: 'a1', has: ['b2', 'a8', 'g1'], lacks: ['c3'], attacked: ['b2'], notAttacked: ['c3'],
  },
  {
    name: 'Legendary rook captures once after a leap',
    spec: { a1: 'R:legendary', a2: 'P', a4: 'n', a5: 'b', h1: 'K', h8: 'k' },
    from: 'a1', has: ['a3', 'a4'], lacks: ['a5', 'a4+a5'], attacked: ['a3', 'a4'], notAttacked: ['a5'],
  },
  {
    name: 'Legendary rook multi-captures only without a leap',
    spec: { a1: 'R:legendary', a3: 'n', a4: 'b', b1: 'N', d1: 'n', e1: 'b', h1: 'K', h8: 'k' },
    from: 'a1', has: ['a2', 'a3', 'a3+a4', 'c1', 'd1'], lacks: ['a4', 'e1', 'd1+e1'],
    attacked: ['a3', 'd1'], notAttacked: ['a4', 'e1'],
  },
  {
    name: 'Legendary queen multi-captures with or without a leap',
    spec: { d1: 'Q:legendary', d2: 'P', d4: 'n', d5: 'b', e2: 'n', f3: 'r', h1: 'K', h8: 'k' },
    from: 'd1', has: ['d3', 'd4', 'd4+d5', 'e2', 'e2+f3'], lacks: ['d5', 'f3'],
    attacked: ['d4', 'e2'], notAttacked: ['d5', 'f3'],
  },
  {
    name: 'Rare queen leaps allies in all eight directions, without capture',
    spec: { d1: 'Q:rare', d2: 'P', d4: 'n', e2: 'R', g4: 'n', h1: 'K', h8: 'k' },
    from: 'd1', has: ['d3', 'f3'], lacks: ['d4', 'g4'], notAttacked: ['d3', 'd4', 'f3', 'g4'],
  },
  {
    name: 'Y must be directly beyond X (same direction; an ally on Y stops)',
    spec: { a1: 'R:legendary', a3: 'n', b4: 'b', c1: 'n', d1: 'N', h1: 'K', h8: 'k' },
    from: 'a1', has: ['a3', 'c1'], lacks: ['a3+b4', 'c1+d1', 'b4'],
  },
  {
    name: 'no capture across a gap',
    spec: { a1: 'R:legendary', a3: 'n', a5: 'b', h1: 'K', h8: 'k' },
    from: 'a1', has: ['a3'], lacks: ['a3+a5', 'a5', 'a4'],
  },
  {
    name: 'Y holding the enemy king stops on X (and a king on Y is not in check through X)',
    spec: { a1: 'R:legendary', a3: 'n', a4: 'k', h1: 'K' },
    from: 'a1', has: ['a3'], lacks: ['a3+a4', 'a4'], attacked: ['a3'], notAttacked: ['a4'],
  },
  {
    name: 'never a third',
    spec: { a1: 'Q:legendary', a3: 'n', a4: 'b', a5: 'r', h1: 'K', h8: 'k' },
    from: 'a1', has: ['a3', 'a3+a4'], lacks: ['a4+a5', 'a5', 'a3+a5'], notAttacked: ['a4', 'a5'],
  },
];

describe('ability-aware generation (docs/02 §2.3)', () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const { b, t } = pos(row.spec);
      const got = targetsOf(b, t, row.from);
      for (const m of row.has ?? []) expect(got, `${row.from} -> ${m}`).toContain(m);
      for (const m of row.lacks ?? []) expect(got, `${row.from} -> ${m}`).not.toContain(m);
      for (const sq of row.attacked ?? []) expect(abilityAttacked(b, t, toIndex(sq), table), sq).toBe(true);
      for (const sq of row.notAttacked ?? []) expect(abilityAttacked(b, t, toIndex(sq), table), sq).toBe(false);
    });
  }

  it('tier 0 gives exactly the M1 targets and attacks', () => {
    const { b, t } = pos({ c1: 'B', d2: 'P', f4: 'n', a1: 'R', e1: 'K', h8: 'k', g6: 'q' });
    for (let from = 0; from < 64; from++) {
      if (b[from] === 0) continue;
      expect(abilityTargets(b, t, from, table)).toEqual(pieceTargets(b, from).map((to) => ({ to, via: -1 })));
    }
  });
});

describe('tiersOf and hasTiers', () => {
  it('tiers White Hero Pieces by rarity, and nothing else', () => {
    const { board } = pos({
      a1: 'B:rare', b1: 'N:unique', c1: 'Q:legendary', d1: 'R:normal', e1: 'R', f1: 'K', h8: 'k',
      a2: 'P', g8: 'q',
    });
    const withExtras: Record<Square, BoardPiece> = {
      ...board,
      a2: { ...board.a2!, rarity: 'legendary' },
      g8: { ...board.g8!, rarity: 'legendary' },
      h1: { pieceType: 'rook', color: 'white', stageId: 's99', rarity: 'rare' },
      h2: {
        pieceType: 'bishop', color: 'white', instanceId: 'p_b', rarity: 'unique',
        transformed: { pieceType: 'queen', modifierId: 'm1' },
      },
    };
    const t = tiersOf(withExtras);
    const at = (sq: Square) => t[toIndex(sq)];
    expect([at('a1'), at('b1'), at('c1'), at('d1'), at('e1')]).toEqual([1, 2, 3, 0, 0]);
    expect(at('a2')).toBe(0); // spawned pawn: rarity only sets promotesTo
    expect(at('g8')).toBe(0); // enemy pieces are Normal
    expect(at('h1')).toBe(0); // not a Hero Piece
    expect(at('h2')).toBe(0); // transforms suspend rarity
    expect(hasTiers(t)).toBe(true);
    expect(hasTiers(tiersOf(stageOf({ a1: 'B', e1: 'K', e8: 'k' }).board))).toBe(false);
  });
});

describe('Move.via', () => {
  it('existing moves carry via -1 and viaCaptured 0', () => {
    const { b } = pos({ a1: 'R', a3: 'n', e1: 'K', e8: 'k' });
    for (const m of pseudoMoves(b, 'white')) expect([m.via, m.viaCaptured]).toEqual([-1, 0]);
  });

  it('makeMove and unmakeMove play and restore a multi-capture exactly', () => {
    const { b } = pos({ a1: 'R:legendary', a3: 'n', a4: 'b', e1: 'K', e8: 'k' });
    const before = b.slice();
    const m: Move = {
      from: toIndex('a1'), to: toIndex('a4'), captured: -BISHOP, promotion: null,
      via: toIndex('a3'), viaCaptured: -KNIGHT,
    };
    makeMove(b, m);
    expect([b[toIndex('a1')], b[toIndex('a3')], b[toIndex('a4')]]).toEqual([0, 0, ROOK]);
    unmakeMove(b, m);
    expect(b).toEqual(before);
  });
});
