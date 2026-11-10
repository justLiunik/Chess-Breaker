import { describe, expect, it } from 'vitest';
import { hasLegalQueue } from '../src/legal-queue';
import { applyPlayerMove, resolveQueue } from '../src/queue';
import type { Action, CommitError, GameEvent, Rarity, Square, StageState } from '../src/types';
import { config, deepFreeze, runOf, stageOf } from './helpers';

const mv = (from: string, to: string): Action => ({ type: 'MOVE', from, to });
const skill = (skillId: string, target?: string): Action => ({
  type: 'ACTIVATE_SKILL', skillId, ...(target !== undefined && { target }),
});

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

const run = runOf();
const resolve = (s: StageState, queue: Action[], r = run) => resolveQueue(r, s, queue, config);
const refusal = (s: StageState, queue: Action[]): CommitError => {
  const r = resolve(s, queue);
  if (r.ok) throw new Error('expected a refusal');
  return r.error;
};
const captures = (events: GameEvent[]) => events.filter((e) => e.type === 'capture');

describe('multi-capture in the queue (Legendary rook: X then Y on its line)', () => {
  // Rook a1 reaches a4 (bishop, salvage 1) and, through it, a5 (queen, salvage 3).
  const spec = { g1: 'K', h8: 'k', a1: 'R:legendary', a4: 'b', a5: 'q' };

  it('MOVE to Y captures X and Y, two capture events in order, salvage summed, one credit', () => {
    const r = resolve(stageWith(spec), [mv('a1', 'a5')]);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(captures(r.value.events)).toMatchObject([
      { square: 'a4', pieceType: 'bishop', salvage: 1 },
      { square: 'a5', pieceType: 'queen', salvage: 3 },
    ]);
    expect(r.value.events.map((e) => e.type)).toEqual(['move', 'capture', 'capture']);
    expect(r.value.run.coins).toBe(4);
    expect(r.value.stage.moveCredits).toBe(0);
    expect(Object.keys(r.value.stage.board).sort()).toEqual(['a5', 'g1', 'h8']);
    expect(r.value.stage.board.a5!.pieceType).toBe('rook');
  });

  it('MOVE to X captures X only', () => {
    const r = resolve(stageWith(spec), [mv('a1', 'a4')]);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(captures(r.value.events)).toHaveLength(1);
    expect(r.value.run.coins).toBe(1);
    expect(r.value.stage.board.a5?.pieceType).toBe('queen');
  });

  it('a bad Y: empty, off the line -> unreachable; an ally -> own_piece; the enemy king -> king_square', () => {
    const base = { e1: 'K', h8: 'k', a1: 'R:legendary', a4: 'b' };
    const reason = (extra: Record<Square, string>, to: string) => {
      const e = refusal(stageWith({ ...base, ...extra }), [mv('a1', to)]);
      return e.kind === 'illegal_move' ? e.reason : e.kind;
    };
    expect(reason({}, 'a5')).toBe('unreachable'); // Y empty
    expect(reason({ a5: 'P' }, 'a5')).toBe('own_piece'); // Y an ally (R12: always own_piece)
    expect(reason({ a5: 'q' }, 'b5')).toBe('unreachable'); // off the line
    expect(reason({ a5: 'q', a6: 'q' }, 'a6')).toBe('unreachable'); // two enemies in a row: a6 is not a legal Y
    expect(reason({ a5: 'k', h8: 'q' }, 'a5')).toBe('king_square'); // the king directly behind X
  });

  it('an ally destination is own_piece for any piece', () => {
    const plain = stageWith({ e1: 'K', h8: 'k', a1: 'R:normal', a4: 'b', a5: 'P' });
    expect(refusal(plain, [mv('a1', 'a5')])).toMatchObject({ reason: 'own_piece' });
    const adjacent = stageWith({ e1: 'K', h8: 'k', a1: 'R:legendary', a2: 'P' });
    expect(refusal(adjacent, [mv('a1', 'a2')])).toMatchObject({ reason: 'own_piece' });
  });

  it('applyPlayerMove derives the multi-capture itself', () => {
    const s = stageWith(spec);
    const applied = applyPlayerMove(s.board, 'a1', 'a5', config);
    expect(captures(applied.events)).toHaveLength(2);
    expect(applied.salvage).toBe(4);
    expect(captures(applyPlayerMove(s.board, 'a1', 'a4', config).events)).toHaveLength(1);
  });
});

describe('Legendary knight bonus move', () => {
  const knights = { e1: 'K', h8: 'k', b1: 'N:legendary', a1: 'R' };

  it('the second MOVE by the same knight costs 0', () => {
    const r = resolve(stageWith(knights), [mv('b1', 'c3'), mv('c3', 'e4')]);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.stage.moveCredits).toBe(0);
    expect(r.value.stage.board.e4?.pieceType).toBe('knight');
  });

  it('the bonus is once per turn: a third knight MOVE is credits_exceeded', () => {
    expect(refusal(stageWith(knights), [mv('b1', 'c3'), mv('c3', 'e4'), mv('e4', 'd6')]))
      .toEqual({ kind: 'credits_exceeded', atStep: 2 });
  });

  it('a Normal, Rare or Unique knight has no bonus', () => {
    for (const rarity of ['normal', 'rare', 'unique'] as const) {
      const s = stageWith({ ...knights, b1: `N:${rarity}` });
      expect(refusal(s, [mv('b1', 'c3'), mv('c3', 'e4')])).toEqual({ kind: 'credits_exceeded', atStep: 1 });
    }
  });

  it('the bonus never pays another piece MOVE', () => {
    expect(refusal(stageWith(knights), [mv('b1', 'c3'), mv('a1', 'a2')]))
      .toEqual({ kind: 'credits_exceeded', atStep: 1 });
    // With a second credit the rook pays for itself, and the knight's bonus is still waiting.
    const r = resolve(stageWith(knights, { moveCredits: 2 }), [mv('b1', 'c3'), mv('a1', 'a2'), mv('c3', 'e4')]);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.stage.moveCredits).toBe(0);
  });

  it('the bonus is not retroactive: it cannot pay an earlier move by another piece', () => {
    expect(refusal(stageWith(knights), [mv('a1', 'a2'), mv('b1', 'c3'), mv('c3', 'e4')]))
      .toEqual({ kind: 'credits_exceeded', atStep: 1 });
  });

  it('the bonus does not carry to the next turn', () => {
    const first = resolve(stageWith(knights), [mv('b1', 'c3')]);
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    expect(first.value.stage.moveCredits).toBe(0);
    expect(refusal(first.value.stage, [mv('c3', 'e4')])).toEqual({ kind: 'credits_exceeded', atStep: 0 });
  });

  it('a Legendary knight that gives check cannot land on the king with its bonus move', () => {
    const s = stageWith({ e1: 'K', f6: 'k', c3: 'N:legendary' });
    expect(refusal(s, [mv('c3', 'd5'), mv('d5', 'f6')])).toEqual({
      kind: 'illegal_move', atStep: 1, from: 'd5', to: 'f6', reason: 'king_square',
    });
    expect(resolve(s, [mv('c3', 'd5'), mv('d5', 'e7')]).ok).toBe(true); // the bonus may go elsewhere
  });

  it('two Legendary knights each have their own bonus', () => {
    const s = stageWith({ e1: 'K', h8: 'k', b1: 'N:legendary', g1: 'N:legendary' }, { moveCredits: 2 });
    const four = [mv('b1', 'c3'), mv('g1', 'f3'), mv('c3', 'e4'), mv('f3', 'e5')];
    const r = resolve(s, four);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.stage.moveCredits).toBe(0);
    expect(refusal(s, [...four, mv('e4', 'd6')])).toEqual({ kind: 'credits_exceeded', atStep: 4 });
  });
});

describe('Ascension suspends a bishop ability while the piece is a queen', () => {
  const spec = { e1: 'K', h8: 'k', c1: 'B:unique', d2: 'N', a1: 'R' };
  const ascend = runOf({ loadout: [{ skillId: 'ascension', charges: 2, chargesMax: 2 }] });

  it('the Unique bishop leaps its ally d2 to e3 normally', () => {
    expect(resolve(stageWith(spec, { focus: 3 }), [mv('c1', 'e3')]).ok).toBe(true);
  });

  it('as a queen this turn it cannot; after the revert it can next turn', () => {
    const s = stageWith(spec, { focus: 3 });
    const blocked = resolve(s, [skill('ascension', 'c1'), mv('c1', 'e3')], ascend);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatchObject({ kind: 'illegal_move', atStep: 1, reason: 'unreachable' });
    const turn1 = resolve(s, [skill('ascension', 'c1'), mv('a1', 'a2')], ascend);
    if (!turn1.ok) throw new Error(JSON.stringify(turn1.error));
    expect(turn1.value.stage.board.c1!.transformed).toBeUndefined();
    const next = { ...turn1.value.stage, moveCredits: 1, turnsUsed: 1 };
    expect(resolve(next, [mv('c1', 'e3')], turn1.value.run).ok).toBe(true);
  });
});

describe('hasLegalQueue counts the bonus move', () => {
  // The king on a1 is checked along the a-file by the rook on a8; the rook b1 and pawn b2 box it in.
  // Only a knight can block, and from d1 it needs two moves: c3, then a4.
  const boxed = (rarity: Rarity) =>
    stageWith({ a1: 'K', a8: 'r', h8: 'k', b1: 'R', b2: 'P', d1: `N:${rarity}` }, { moveCredits: 1 });

  it('true with a Legendary knight, false with a Unique or Normal one', () => {
    expect(hasLegalQueue(run, boxed('legendary'), config)).toBe(true);
    expect(hasLegalQueue(run, boxed('unique'), config)).toBe(false);
    expect(hasLegalQueue(run, boxed('normal'), config)).toBe(false);
  });

  it('agrees with resolveQueue on the bonus line', () => {
    expect(resolve(boxed('legendary'), [mv('d1', 'c3'), mv('c3', 'a4')]).ok).toBe(true);
    expect(resolve(boxed('unique'), [mv('d1', 'c3'), mv('c3', 'a4')]).ok).toBe(false);
  });
});

describe('public surface', () => {
  it('tiersOf gives an unknown rarity string tier 0, not -1', async () => {
    const { tiersOf } = await import('../src/position');
    const s = stageWith({ e1: 'K', h8: 'k', c1: 'B' });
    const odd = { ...s.board, c1: { ...s.board.c1!, rarity: 'mythic' as unknown as Rarity } };
    expect(tiersOf(odd)[2]).toBe(0);
  });

  it('index does not export the hot-path ability internals', async () => {
    const api = await import('../src/index');
    for (const name of ['abilityTargets', 'abilityTargetsInto', 'abilityAttacked', 'hasTiers']) {
      expect(name in api).toBe(false);
    }
    expect('TIERS' in api).toBe(true);
  });
});
