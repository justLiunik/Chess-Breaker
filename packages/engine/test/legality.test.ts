import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { fromBoard } from '../src/position';
import { toSquare } from '../src/square';
import {
  checkPlayerMove, hasLegalQueue, inCheck, legalMoves, legalPlayerMoves,
} from '../src/legality';
import { config, deepFreeze, runOf, stageOf } from './helpers';
import type { StageState } from '../src/types';

const st = (p: Record<string, string>) => stageOf(p);

describe('checkPlayerMove', () => {
  const s = st({ e1: 'K', a1: 'R', b1: 'N', a3: 'P', a8: 'k', h1: 'r' });
  it('reports each reason in order', () => {
    expect(checkPlayerMove(s.board, 'c3', 'c4')).toBe('no_piece');
    expect(checkPlayerMove(s.board, 'a8', 'a7')).toBe('not_your_piece');
    expect(checkPlayerMove(s.board, 'a1', 'b1')).toBe('own_piece');
    expect(checkPlayerMove(s.board, 'a1', 'c5')).toBe('unreachable');
    expect(checkPlayerMove(s.board, 'a1', 'a2')).toBe(null);
  });
  it('king_square for rook onto the black king along an open file', () => {
    const t = st({ e1: 'K', h1: 'R', h8: 'k' });
    expect(checkPlayerMove(t.board, 'h1', 'h8')).toBe('king_square');
  });
  it('ignores check: king may step into check per action', () => {
    const t = st({ e1: 'K', a2: 'r', h8: 'k' });
    expect(checkPlayerMove(t.board, 'e1', 'e2')).toBe(null);
    expect(legalPlayerMoves(t, 'e1')).toContain('e2');
    const moves = legalMoves(fromBoard(t.board), 'white').map((m) => toSquare(m.to));
    expect(moves).not.toContain('e2');
    expect(inCheck(fromBoard(st({ e1: 'K', e8: 'r', h8: 'k' }).board), 'white')).toBe(true);
  });
});

describe('legalPlayerMoves', () => {
  it('lists exactly the reachable squares', () => {
    const t = st({ e1: 'K', a1: 'R', a4: 'P', d1: 'n', h8: 'k' });
    expect([...legalPlayerMoves(t, 'a1')].sort()).toEqual(['a2', 'a3', 'b1', 'c1', 'd1']);
  });
  it('is empty for a malformed or empty square', () => {
    const t = st({ e1: 'K', a1: 'R', h8: 'k' });
    expect(legalPlayerMoves(t, 'a1x')).toEqual([]);
    expect(legalPlayerMoves(t, 'c3')).toEqual([]);
  });
});

describe('hasLegalQueue', () => {
  it('stalemate is false', () => {
    expect(hasLegalQueue(runOf(), st({ a1: 'K', b3: 'q', c3: 'k' }), config)).toBe(false);
  });
  it('mate is false', () => {
    expect(hasLegalQueue(runOf(), st({ a1: 'K', b2: 'q', c3: 'k' }), config)).toBe(false);
  });
  it('example stage-state is true', () => {
    const doc = parse(readFileSync(new URL('../../../content/examples/stage-state.yaml', import.meta.url), 'utf8'));
    const s = deepFreeze(doc) as StageState;
    expect(hasLegalQueue(runOf(), { ...s, moveCredits: config.rules.freeMovesPerTurn }, config)).toBe(true);
  });
});
