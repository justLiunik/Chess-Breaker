import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { abilityTargets } from '../src/abilities';
import { enemyMove } from '../src/enemy/policy';
import { scoreRootMoves } from '../src/enemy/search';
import { zobristKey } from '../src/enemy/zobrist';
import { legalMovesInPlace, newSafety } from '../src/legality';
import { makeMoveTiered, unmakeMoveTiered, type Move } from '../src/movegen';
import { fromBoard, tiersOf } from '../src/position';
import { simulate } from '../src/rules';
import { toIndex, toSquare } from '../src/square';
import type { Rarity, Square, StageState } from '../src/types';
import {
  GAME_FENS, MIDGAME_FENS, RARITY_FENS, config, deepFreeze, fenToStage, randomBoard, rarityStage, runOf, stageOf,
} from './helpers';

/** A stage from `{ square: 'R' | 'R:legendary' | 'p' ... }`; a White Hero Piece takes the rarity after the colon. */
function stageWith(spec: Record<Square, string>, over: Partial<StageState> = {}): StageState {
  const letters: Record<Square, string> = {};
  for (const [sq, v] of Object.entries(spec)) letters[sq] = v.split(':')[0]!;
  const base = stageOf(letters, over);
  const board = { ...base.board };
  for (const [sq, v] of Object.entries(spec)) {
    const rarity = v.split(':')[1] as Rarity | undefined;
    if (rarity !== undefined) board[sq] = { ...board[sq]!, rarity };
  }
  return deepFreeze({ ...base, board } as StageState);
}

type Scored = ReturnType<typeof scoreRootMoves>;

/** Root scores of the stage at `depth`, with its tiers (or with every tier dropped when `normal`). */
function rootScores(stage: StageState, depth: number, normal = false): Scored {
  const t = normal ? new Int8Array(64) : tiersOf(stage.board);
  return scoreRootMoves(fromBoard(stage.board), stage.turnLimit - stage.turnsUsed, depth, config, undefined, t);
}
const tiedBest = (res: Scored): string[] => {
  const best = Math.max(...res.map((r) => r.score));
  return res.filter((r) => r.score === best).map((r) => `${toSquare(r.move.from)}${toSquare(r.move.to)}`);
};

describe('the enemy search with rarity abilities (docs/02 §8.1, spec §9.4)', () => {
  it("the enemy does not leave a piece en prise to a Rare knight's (2,0) leap", () => {
    // Qxd6 wins a rook against a Normal knight on d4; a Rare knight takes back with its d4-d6 leap.
    const spec = { h1: 'K', d4: 'N:rare', d6: 'R', h8: 'k', d8: 'q', g7: 'p', h7: 'p' };
    const rare = stageWith(spec);
    const normal = stageWith({ ...spec, d4: 'N' });
    expect(tiedBest(rootScores(normal, 2))).toEqual(['d8d6']);
    expect(tiedBest(rootScores(rare, 2))).not.toContain('d8d6');
    expect(enemyMove(normal, 0, config).move).toEqual({ from: 'd8', to: 'd6' });
    expect(enemyMove(rare, 0, config).move).not.toEqual({ from: 'd8', to: 'd6' });
  });

  it("the enemy sees a Legendary queen's double capture", () => {
    // Qxd5 alone loses the queen to exd5, so against a Normal queen e6-e5 is best; a Legendary
    // queen would then take d5 and the rook on d6 in one move.
    const spec = { g1: 'K', d1: 'Q:legendary', h8: 'k', d5: 'p', e6: 'p', d6: 'r', g7: 'p', h7: 'p' };
    const stage = stageWith(spec);
    const doubleCaptures = (move: string): number => {
      const board = { ...stage.board };
      board[move.slice(2, 4)] = board[move.slice(0, 2)]!;
      delete board[move.slice(0, 2)];
      return abilityTargets(fromBoard(board), tiersOf(board), toIndex('d1'), config.abilities)
        .filter((m) => m.via >= 0).length;
    };
    expect(tiedBest(rootScores(stage, 2, true))).toEqual(['e6e5']);
    expect(doubleCaptures('e6e5')).toBe(1);
    const best = tiedBest(rootScores(stage, 2));
    expect(best).not.toContain('e6e5');
    for (const m of best) expect(doubleCaptures(m), m).toBe(0);
  });

  it("the enemy does not imagine the Legendary knight's bonus move or skills", () => {
    // Nb1-c3 and then the free c3xe4 would win the queen; one standard move cannot reach e4.
    const spec = { a1: 'K', b1: 'N:legendary', h8: 'k', e4: 'q', h7: 'p' };
    const legendary = rootScores(stageWith(spec), 3);
    // A Unique knight moves exactly like a Legendary one, without the bonus move.
    expect(legendary).toEqual(rootScores(stageWith({ ...spec, b1: 'N:unique' }), 3));
    // Skills live in the run's loadout, which enemyMove never sees; Focus left changes nothing.
    const s = stageWith(spec);
    expect(enemyMove(stageWith(spec, { focus: 0 }), 5, config)).toEqual(enemyMove(s, 5, config));
  });

  it('R3 sees a mate given through an ability', () => {
    // Nf5-h6 checks h8 with the Rare (0,2) leap; g8 is covered by the knight, g7 and h7 are blocked.
    const stage = stageWith({ a1: 'K', f5: 'N:rare', h8: 'k', g7: 'n', h7: 'p' });
    const r = simulate(runOf(), stage, [{ type: 'MOVE', from: 'f5', to: 'h6' }], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.stage.status).toBe('won');
    expect(r.value.stage.endReason).toBe('checkmate');
    // The same move by a Normal knight gives no check.
    const n = simulate(runOf(), stageWith({ a1: 'K', f5: 'N', h8: 'k', g7: 'n', h7: 'p' }), [
      { type: 'MOVE', from: 'f5', to: 'h6' },
    ], config);
    if (!n.ok) throw new Error(JSON.stringify(n.error));
    expect(n.value.stage.status).toBe('active');
  });

  it('tier-free boards: scores identical to the search-parity baseline', () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'search-baseline.json');
    const baseline: { fen: string; best: { from: string; to: string }[]; score: number }[] =
      JSON.parse(readFileSync(fixture, 'utf8'));
    expect(baseline.map((p) => p.fen)).toEqual([...GAME_FENS, ...MIDGAME_FENS]);
    for (const pinned of baseline.slice(0, GAME_FENS.length)) {
      const stage = fenToStage(pinned.fen);
      const b = fromBoard(stage.board);
      const plain = scoreRootMoves(b, 6, 3, config);
      // A tier array of zeros (every Hero Piece Normal) is the M1 search exactly.
      expect(scoreRootMoves(b, 6, 3, config, undefined, tiersOf(stage.board))).toEqual(plain);
      const score = Math.max(...plain.map((r) => r.score));
      expect(score).toBe(pinned.score);
      expect(plain.filter((r) => r.score === score).map((r) => ({ from: toSquare(r.move.from), to: toSquare(r.move.to) })))
        .toEqual(pinned.best);
    }
  }, 60_000);

  it('make/unmake restores b and t exactly over a full search', () => {
    // Walks every line of the search's own generators three plies deep, Black first, on tier
    // boards, counting (not asserting per node, for speed) every departure from exact restoration.
    const n = { nodes: 0, multi: 0, tieredCaptures: 0, whiteVanishes: 0, blackPromotesOnTier: 0, bad: 0 };
    const same = (x: Int8Array, y: Int8Array): boolean => x.every((v, i) => v === y[i]);
    const walk = (b: Int8Array, t: Int8Array, black: boolean, depth: number): void => {
      n.nodes++;
      // A tier sits only under a White piece.
      for (let sq = 0; sq < 64; sq++) if (b[sq]! <= 0 && t[sq] !== 0) n.bad++;
      if (depth === 0) return;
      const moves: Move[] = legalMovesInPlace(b, black ? 'black' : 'white', [], newSafety({ t, table: config.abilities }));
      for (const m of moves) {
        const bb = b.slice();
        const tt = t.slice();
        const key = zobristKey(b, black, 5, t);
        if (m.via >= 0) n.multi++;
        if (black && m.captured > 0 && t[m.to]! > 0) n.tieredCaptures++;
        if (!black && m.promotion === 'removed') n.whiteVanishes++;
        if (black && m.promotion === 'queen' && m.captured > 0 && t[m.to]! > 0) n.blackPromotesOnTier++;
        const saved = makeMoveTiered(b, t, m);
        if (b[m.to]! > 0 && t[m.to] !== tt[m.from]) n.bad++;
        walk(b, t, !black, depth - 1);
        unmakeMoveTiered(b, t, m, saved);
        if (!same(b, bb) || !same(t, tt) || zobristKey(b, black, 5, t) !== key) n.bad++;
      }
    };
    const boards: { b: Int8Array; t: Int8Array }[] = [];
    for (let i = 0; i < 12; i++) {
      const t = new Int8Array(64);
      boards.push({ b: randomBoard('enemy-tier-walk', i, { tiers: t }), t });
    }
    // Multi-captures: the double-capture position, and the benchmark boards at Legendary.
    // Promotions: a White pawn vanishing on c8, and axb1=Q taking a Rare rook.
    const stages = [
      stageWith({ g1: 'K', d1: 'Q:legendary', h8: 'k', d5: 'p', e6: 'p', d6: 'r', g7: 'p', h7: 'p' }),
      stageWith({ h1: 'K', b1: 'R:rare', c7: 'P', h8: 'k', a2: 'p' }),
      ...RARITY_FENS.filter((r) => r.rarity === 'legendary').map((r) => rarityStage(r.fen, r.rarity)),
    ];
    for (const st of stages) boards.push({ b: fromBoard(st.board), t: tiersOf(st.board) });
    for (const { b, t } of boards) {
      const b0 = b.slice();
      const t0 = t.slice();
      walk(b, t, true, 3);
      scoreRootMoves(b, 5, 3, config, undefined, t);
      expect(b).toEqual(b0);
      expect(t).toEqual(t0);
    }
    expect(n.bad).toBe(0);
    expect(n.nodes).toBeGreaterThan(10_000);
    expect(n.multi).toBeGreaterThan(0);
    expect(n.tieredCaptures).toBeGreaterThan(0);
    expect(n.whiteVanishes).toBeGreaterThan(0);
    expect(n.blackPromotesOnTier).toBeGreaterThan(0);
  }, 120_000);

  it('Zobrist keys: tier-free keys are the M1 keys; a tier changes the key', () => {
    const b = fromBoard(fenToStage(GAME_FENS[0]!).board);
    const zero = new Int8Array(64);
    expect(zobristKey(b, true, 4, zero)).toBe(zobristKey(b, true, 4));
    const t = new Int8Array(64);
    t[toIndex('b1')] = 2;
    const keys = [1, 2, 3].map((tier) => { t[toIndex('b1')] = tier; return zobristKey(b, true, 4, t); });
    expect(new Set([zobristKey(b, true, 4), ...keys]).size).toBe(4);
  });

  it('tier boards: the best root score and moves are the same with the transposition table on and off', () => {
    const ttOff = { ...config, enemyAI: { ...config.enemyAI, search: { ...config.enemyAI.search, transpositionTable: false } } };
    // As on the M1 boards, the best score and the moves that tie it agree (other moves' scores are
    // bounds, which the table may tighten).
    const bestOf = (res: Scored) => ({ score: Math.max(...res.map((r) => r.score)), moves: tiedBest(res) });
    for (const { fen, rarity } of RARITY_FENS) {
      const board = rarityStage(fen, rarity).board;
      const b = fromBoard(board);
      const t = tiersOf(board);
      expect(bestOf(scoreRootMoves(b, 6, 3, config, undefined, t)), `${fen} ${rarity}`)
        .toEqual(bestOf(scoreRootMoves(b, 6, 3, ttOff, undefined, t)));
    }
  }, 120_000);
});
