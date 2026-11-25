import { describe, expect, it } from 'vitest';
import { hasLegalQueue } from '../src/legal-queue';
import { applyPlayerMove, resolveQueue } from '../src/queue';
import { legalPlayerMoves } from '../src/legality';
import { applySkill, checkSkill } from '../src/skills/check';
import type { QueueCtx } from '../src/queue';
import type { Action, RunState, StageState } from '../src/types';
import { config, deepFreeze, runOf, stageOf } from './helpers';

const withSkills = (...ids: string[]): RunState => runOf({ loadout: ids.map((skillId) => ({ skillId })) });

describe('hasLegalQueue with skills', () => {
  it('true with a single legal move (M1 behaviour)', () => {
    expect(hasLegalQueue(runOf(), stageOf({ e1: 'K', a1: 'R', e8: 'k' }), config)).toBe(true);
  });

  // The king on a1 has no safe single step (b8 covers the b-file, h2 covers rank 2), but a2 then a3 is safe.
  const walk = { a1: 'K', b8: 'r', h2: 'r', g8: 'k' };
  it('true when only Twin Step + two king moves escape', () => {
    expect(hasLegalQueue(runOf(), stageOf(walk), config)).toBe(false);
    expect(hasLegalQueue(withSkills('twin_step'), stageOf(walk), config)).toBe(true);
  });

  // Rook e8 checks Ke1, whose neighbours are all taken or attacked; only the bishop on a6 as a queen
  // (b5 pawn and the rank-6 path make e6 reachable only for a queen) can block.
  const block = { e1: 'K', d1: 'P', f1: 'P', d2: 'P', f2: 'P', a6: 'B', b5: 'P', e8: 'r', h8: 'k' };
  it('true when only Ascension lets the bishop block', () => {
    expect(hasLegalQueue(runOf(), stageOf(block), config)).toBe(false);
    expect(hasLegalQueue(withSkills('ascension'), stageOf(block), config)).toBe(true);
  });

  // Ka1 in check; rooks on ranks 1-3 cover every square within two king steps, a4 is three away.
  const far = { a1: 'K', h1: 'r', h2: 'r', h3: 'r', h8: 'k' };
  it('false when a second copy of Twin Step would be needed: once_per_turn holds across copies', () => {
    expect(hasLegalQueue(withSkills('twin_step', 'twin_step', 'twin_step'), stageOf(far), config)).toBe(false);
  });

  it('every implemented skill is once_per_turn, which lets hasLegalQueue try each skill id once', () => {
    const mvp = Object.values(config.skills).filter((s) => s.status === 'mvp');
    expect(mvp.length).toBeGreaterThan(0);
    for (const s of mvp) expect(s.restrictions, s.id).toContain('once_per_turn');
  });

  // Ka1 cannot step (b8 covers b1 and b2, h2 covers a2): the only legal queue is the g7 pawn's promotion.
  it('true when the only legal queue is a promotion, with each choice', () => {
    const boxed = { a1: 'K', b8: 'r', h2: 'r', e5: 'k', g7: 'P' };
    expect(hasLegalQueue(runOf(), stageOf(boxed), config)).toBe(true);
    for (const promotion of PROMOTIONS) {
      expect(resolveQueue(runOf(), stageOf(boxed), [{ type: 'MOVE', from: 'g7', to: 'g8', promotion }], config).ok).toBe(true);
    }
    expect(hasLegalQueue(runOf(), stageOf({ ...boxed, g8: 'n' }), config)).toBe(false);
  });

  it('false when Focus is short', () => {
    expect(hasLegalQueue(withSkills('ascension'), stageOf(block, { focus: 1 }), config)).toBe(false);
  });
});

const PROMOTIONS = ['queen', 'rook', 'bishop', 'knight'] as const;

/** Every interleaving of at most two skills and three moves, judged by resolveQueue. */
function bruteForce(run: RunState, stage: StageState): boolean {
  const squares = Object.keys(stage.board);
  const queue: Action[] = [];
  const go = (ctx: QueueCtx, skills: number, moves: number): boolean => {
    if (moves >= 1 && resolveQueue(run, stage, queue, config).ok) return true;
    if (skills < 2) {
      for (const skillId of Object.keys(config.skills)) {
        for (const target of [undefined, ...squares]) {
          const action: Action = { type: 'ACTIVATE_SKILL', skillId, ...(target !== undefined && { target }) };
          const next = { ...ctx };
          if (checkSkill(next, action, queue.length, config)) continue;
          applySkill(next, action, queue.length, config);
          queue.push(action);
          const done = go(next, skills + 1, moves);
          queue.pop();
          if (done) return true;
        }
      }
    }
    if (moves < 3 && ctx.moveCredits >= 1) {
      const here = { ...stage, board: ctx.board };
      for (const from of Object.keys(ctx.board)) {
        if (ctx.board[from]!.color !== 'white') continue;
        const pawn = ctx.board[from]!.pieceType === 'pawn';
        for (const to of legalPlayerMoves(here, from, config)) {
          // A pawn reaching rank 8 is tried with every promotion choice.
          for (const promotion of pawn && to.endsWith('8') ? PROMOTIONS : [undefined]) {
            queue.push({ type: 'MOVE', from, to, ...(promotion !== undefined && { promotion }) });
            const made = promotion === undefined ? undefined : { pieceType: promotion, instanceId: `p_brute_${queue.length}` };
            const next = { ...ctx, board: applyPlayerMove(ctx.board, from, to, config, made).board, moveCredits: ctx.moveCredits - 1 };
            const done = go(next, skills, moves + 1);
            queue.pop();
            if (done) return true;
          }
        }
      }
    }
    return false;
  };
  return go({
    run, board: stage.board, focus: stage.focus, moveCredits: stage.moveCredits,
    modifiers: stage.modifiers, skillLog: stage.skillLog, turn: stage.turnsUsed + 1,
  }, 0, 0);
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

describe('hasLegalQueue brute force', () => {
  it('agrees with an exhaustive search over every interleaving, on 300 small boards', () => {
    const rand = mulberry32(20261109);
    const pick = (n: number): number => Math.floor(rand() * n);
    const files = 'abcdefgh';
    let trues = 0;
    let falses = 0;
    let skillsMatter = 0;
    for (let i = 0; i < 300; i++) {
      const pieces: Record<string, string> = {};
      const place = (letter: string): void => {
        const pawn = letter.toLowerCase() === 'p';
        for (;;) {
          const sq = `${files[pick(8)]}${(pawn ? 2 + pick(6) : 1 + pick(8))}`;
          if (!(sq in pieces)) { pieces[sq] = letter; return; }
        }
      };
      place('K');
      place('k');
      for (const side of ['upper', 'lower'] as const) {
        const n = pick(4);
        for (let j = 0; j < n; j++) {
          const letter = 'pnbrq'[pick(5)]!;
          place(side === 'upper' ? letter.toUpperCase() : letter);
        }
      }
      // 0, 1 or 2 copies of each launch skill (single use: a copy is one loadout entry).
      const loadout = ['twin_step', 'ascension', 'lockdown']
        .flatMap((skillId) => Array.from({ length: pick(3) }, () => ({ skillId })));
      const run = runOf({ loadout });
      const stage = deepFreeze(stageOf(pieces, { focus: pick(4) }));
      const expected = bruteForce(run, stage);
      expect(hasLegalQueue(run, stage, config), JSON.stringify({ pieces, loadout, focus: stage.focus })).toBe(expected);
      if (expected) trues++; else falses++;
      if (expected && !hasLegalQueue(runOf(), stage, config)) skillsMatter++;
    }
    // The sample must exercise both outcomes.
    expect(trues).toBeGreaterThan(0);
    expect(falses).toBeGreaterThan(0);
    expect(skillsMatter, 'boards where only skills give a legal queue').toBeGreaterThan(0);
  }, 30_000);
});
