import { describe, expect, it } from 'vitest';
import type { Color } from '../src/types';
import { abilityAttacked, abilityTargets } from '../src/abilities';
import { evaluate } from '../src/enemy/evaluate';
import { legalMoves } from '../src/legality';
import { isAttacked } from '../src/movegen';
import { config, randomBoard, runOf, stageOf } from './helpers';
import { legalPlayerMoves, planPlayerMove } from '../src/legality';
import { resolveQueue } from '../src/queue';
import { TIERS } from '../src/position';
import { toIndex, toSquare } from '../src/square';
import type { Action } from '../src/types';
import { refAttacked, refLegalMoves, refPseudoMoves } from './reference/movegen';
import { refEvaluate } from './reference/evaluate';

const sortMoves = (ms: { from: number; to: number }[]) =>
  ms.map(({ from, to }) => ({ from, to })).sort((a, b) => a.from - b.from || a.to - b.to);

const COLORS = ['white', 'black'] as const;
const CHECK_BOARDS = 1000;

/** Every (board, side to move) the move differential covers: no check, then each side in check. */
function moveCases(): { b: Int8Array; color: Color }[] {
  const cases: { b: Int8Array; color: Color }[] = [];
  for (let i = 0; i < 5000; i++) {
    const b = randomBoard('ref', i);
    for (const color of COLORS) cases.push({ b, color });
  }
  for (const color of COLORS) {
    for (let i = 0; i < CHECK_BOARDS; i++) cases.push({ b: randomBoard(`ref-${color}-check`, i, { sideInCheck: color }), color });
  }
  return cases;
}

/** 15,000 so that a king on Y behind X (the rarest feature, about 1 board in 270) appears 50 times. */
const TIER_BOARDS = 15000;

/** Random boards with a random tier on each White knight, bishop, rook and queen. */
function tierCases(): { b: Int8Array; t: Int8Array }[] {
  const cases: { b: Int8Array; t: Int8Array }[] = [];
  for (let i = 0; i < TIER_BOARDS; i++) {
    const t = new Int8Array(64);
    const b = randomBoard('ref-tier', i, { tiers: t });
    cases.push({ b, t });
  }
  return cases;
}

const TYPE_NAMES = [null, null, 'knight', 'bishop', 'rook', 'queen'] as const;
const DIAGONAL_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const ORTHOGONAL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Coverage only: walks each tiered White slider's lines with its ability flags and reports whether
 * a Rare leap meets an enemy it may not capture, a Unique-style leap captures, or a multi-capture
 * line ends with the Black king directly beyond the first capture.
 */
function sliderFeatures(b: Int8Array, t: Int8Array) {
  const out = { rareLeapBlocked: false, uniqueCaptureAfterLeap: false, kingOnYBehindX: false };
  for (let from = 0; from < 64; from++) {
    const code = b[from]!;
    const name = TYPE_NAMES[code];
    if (code < 3 || t[from] === 0 || !name || name === 'knight') continue;
    const f = config.abilities[name][t[from] as 1 | 2 | 3];
    const diag = code !== 4 || f.extraRays.includes('diagonal');
    const ortho = code !== 3 || f.extraRays.includes('orthogonal');
    const dirs = [...(diag ? DIAGONAL_DIRS : []), ...(ortho ? ORTHOGONAL_DIRS : [])];
    for (const [df, dr] of dirs) {
      let passed = false;
      for (let x = (from & 7) + df, y = (from >> 3) + dr; x >= 0 && x < 8 && y >= 0 && y < 8; x += df, y += dr) {
        const v = b[x + 8 * y]!;
        if (v === 0) continue;
        if (v > 0) {
          if (f.leapAllies === 0) break;
          passed = true;
          continue;
        }
        if (v === -6) break;
        if (passed && f.leapAllies === 1) out.rareLeapBlocked = true;
        if (passed && f.leapAllies === 2) out.uniqueCaptureAfterLeap = true;
        const capture = !passed || f.leapAllies === 2;
        const multi = f.multiCapture === 2 || (f.multiCapture === 1 && !passed);
        const nx = x + df;
        const ny = y + dr;
        if (capture && multi && nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[nx + 8 * ny] === -6) out.kingOnYBehindX = true;
        break;
      }
    }
  }
  return out;
}

describe('fast engine against the slow reference', () => {
  it('random boards are well formed and reproducible', () => {
    for (let i = 0; i < 200; i++) {
      const b = randomBoard('ref', i);
      expect(b.filter((c) => c === 6)).toHaveLength(1);
      expect(b.filter((c) => c === -6)).toHaveLength(1);
      expect(randomBoard('ref', i)).toEqual(b);
      for (const color of COLORS) {
        const c = randomBoard('chk', i, { sideInCheck: color });
        expect(refAttacked(c, c.indexOf(color === 'white' ? 6 : -6), color === 'white' ? 'black' : 'white')).toBe(true);
        expect(refAttacked(c, c.indexOf(color === 'white' ? -6 : 6), color)).toBe(false);
      }
    }
  });

  it('legal moves match the reference, with and without check', () => {
    for (const { b, color } of moveCases()) {
      expect(sortMoves(legalMoves(b, color))).toEqual(sortMoves(refLegalMoves(b, color)));
    }
  });

  it('the move boards exercise the risky features (counted with the reference)', () => {
    const n = { pinned: 0, pawn7: 0, pawn2: 0, doubleStep: 0, inCheck: 0 };
    for (const { b, color } of moveCases()) {
      const s = color === 'white' ? 1 : -1;
      const enemy: Color = color === 'white' ? 'black' : 'white';
      const k = b.indexOf(6 * s);
      const checked = refAttacked(b, k, enemy);
      if (checked) n.inCheck++;
      if (!checked) {
        const pinned = b.some((v, sq) => {
          if (v * s <= 0 || sq === k) return false;
          const c = b.slice();
          c[sq] = 0;
          return refAttacked(c, k, enemy);
        });
        if (pinned) n.pinned++;
      }
      if (color === 'white' && b.some((v, sq) => v === 1 && (sq >> 3) === 6)) n.pawn7++;
      if (color === 'black' && b.some((v, sq) => v === -1 && (sq >> 3) === 1)) n.pawn2++;
      if (refLegalMoves(b, color).some((m) => Math.abs(b[m.from]!) === 1 && Math.abs(m.to - m.from) === 16)) n.doubleStep++;
    }
    for (const [name, count] of Object.entries(n)) expect(count, name).toBeGreaterThanOrEqual(50);
  });

  it('attack maps match the reference', () => {
    for (let i = 0; i < 1000; i++) {
      const b = randomBoard('ref-attack', i);
      for (let sq = 0; sq < 64; sq++) {
        for (const by of COLORS) {
          expect(isAttacked(b, sq, by)).toBe(refAttacked(b, sq, by));
        }
      }
    }
  });

  it('White ability moves and White attack maps match the reference on boards with random tiers', () => {
    const table = config.abilities;
    const key = (m: { from: number; to: number; via: number }) => `${m.from}-${m.to}-${m.via}`;
    for (const { b, t } of tierCases()) {
      const fast: string[] = [];
      for (let from = 0; from < 64; from++) {
        if (b[from]! <= 0) continue;
        for (const { to, via } of abilityTargets(b, t, from, table)) fast.push(key({ from, to, via }));
      }
      expect(fast.sort()).toEqual(refPseudoMoves(b, 'white', t).map(key).sort());
      const fastMap: boolean[] = [];
      const refMap: boolean[] = [];
      for (let sq = 0; sq < 64; sq++) {
        fastMap.push(abilityAttacked(b, t, sq, table));
        refMap.push(refAttacked(b, sq, 'white', t));
      }
      expect(fastMap).toEqual(refMap);
    }
  });

  it('the tier boards exercise every ability (counted with the reference)', () => {
    const n = { rareLeapBlocked: 0, uniqueCaptureAfterLeap: 0, multiCapture: 0, kingOnYBehindX: 0 };
    for (const { b, t } of tierCases()) {
      const f = sliderFeatures(b, t);
      if (f.rareLeapBlocked) n.rareLeapBlocked++;
      if (f.uniqueCaptureAfterLeap) n.uniqueCaptureAfterLeap++;
      if (f.kingOnYBehindX) n.kingOnYBehindX++;
      if (refPseudoMoves(b, 'white', t).some((m) => m.via >= 0)) n.multiCapture++;
    }
    for (const [name, count] of Object.entries(n)) expect(count, name).toBeGreaterThanOrEqual(50);
  });

  it('evaluate matches the reference, with Black not in check and in check', () => {
    for (let i = 0; i < 3000; i++) {
      const b = randomBoard('ref-eval', i);
      expect(evaluate(b, config)).toBe(refEvaluate(b, config));
    }
    for (let i = 0; i < CHECK_BOARDS; i++) {
      const b = randomBoard('ref-eval-check', i, { sideInCheck: 'black' });
      expect(evaluate(b, config)).toBe(refEvaluate(b, config));
    }
  });
});

describe('White legal moves with tiers against the reference', () => {
  const LETTER = [' ', 'P', 'N', 'B', 'R', 'Q', 'K'];

  /** The stage a tier board stands for: White Hero Pieces carry their tier's rarity. */
  function stageFrom(b: Int8Array, t: Int8Array) {
    const pieces: Record<string, string> = {};
    for (let i = 0; i < 64; i++) {
      if (b[i] === 0) continue;
      const letter = LETTER[Math.abs(b[i]!)]!;
      pieces[toSquare(i)] = b[i]! > 0 ? letter : letter.toLowerCase();
    }
    const base = stageOf(pieces);
    const board = { ...base.board };
    for (let i = 0; i < 64; i++) {
      const piece = board[toSquare(i)];
      if (piece && piece.color === 'white' && piece.instanceId !== undefined && t[i]! > 0) {
        board[toSquare(i)] = { ...piece, rarity: TIERS[t[i]!]! };
      }
    }
    return { ...base, board };
  }

  /** The fast side: `legalPlayerMoves` candidates, each judged by the queue as a one-move turn. */
  function fastLegal(b: Int8Array, t: Int8Array): string[] {
    const stage = stageFrom(b, t);
    const out: string[] = [];
    for (let from = 0; from < 64; from++) {
      if (b[from]! <= 0) continue;
      for (const to of legalPlayerMoves(stage, toSquare(from), config)) {
        const move: Action = { type: 'MOVE', from: toSquare(from), to };
        if (resolveQueue(runOf(), stage, [move], config).ok) out.push(`${from}-${toIndex(to)}`);
      }
    }
    return out.sort();
  }

  /** Whether the straight move from `from` to `to` passes over a White piece. */
  function leapsAlly(b: Int8Array, from: number, to: number): boolean {
    const df = (to & 7) - (from & 7);
    const dr = (to >> 3) - (from >> 3);
    if (!(df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr))) return false;
    const step = Math.sign(df) + 8 * Math.sign(dr);
    for (let i = from + step; i !== to; i += step) if (b[i]! > 0) return true;
    return false;
  }

  const WHITE_BOARDS = 1500;
  const CHECK_TIER_BOARDS = 1000;

  function boards(): { b: Int8Array; t: Int8Array; checked: boolean }[] {
    const out: { b: Int8Array; t: Int8Array; checked: boolean }[] = [];
    for (let i = 0; i < WHITE_BOARDS; i++) {
      const t = new Int8Array(64);
      out.push({ b: randomBoard('ref-tier-legal', i, { tiers: t }), t, checked: false });
    }
    for (let i = 0; i < CHECK_TIER_BOARDS; i++) {
      const t = new Int8Array(64);
      out.push({ b: randomBoard('ref-tier-legal-check', i, { sideInCheck: 'white', tiers: t }), t, checked: true });
    }
    return out;
  }

  it('the fast legal moves equal refLegalMoves on 2,500 tier boards, 1,000 with White in check', () => {
    const n = { multiCapture: 0, allyLeap: 0, checkedWithMoves: 0 };
    for (const { b, t, checked } of boards()) {
      const ref = [...new Set(refLegalMoves(b, 'white', t).map((m) => `${m.from}-${m.to}`))].sort();
      const fast = fastLegal(b, t);
      expect(fast).toEqual(ref);
      const stage = stageFrom(b, t);
      const plans = fast.map((k) => {
        const [from, to] = k.split('-').map(Number) as [number, number];
        return { from, to, via: planPlayerMove(stage.board, toSquare(from), toSquare(to), config).via };
      });
      if (plans.some((p) => p.via !== null)) n.multiCapture++;
      if (plans.some((p) => leapsAlly(b, p.from, p.to))) n.allyLeap++;
      if (checked && fast.length > 0) n.checkedWithMoves++;
    }
    expect(n.multiCapture).toBeGreaterThanOrEqual(20);
    expect(n.allyLeap).toBeGreaterThanOrEqual(50);
    expect(n.checkedWithMoves).toBeGreaterThanOrEqual(50);
  }, 120_000);
});
