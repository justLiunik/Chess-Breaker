import { describe, expect, it } from 'vitest';
import type { PieceInstance, Rarity, RunState } from '@checkbreaker/engine';
import { cutPiece, mergePieces, repairPiece, sellPiece } from '../src/deck';
import { runConfig, starterRun } from './fixtures';

type P = PieceInstance;
const mk = (id: string, type: PieceInstance['pieceType'], rarity: Rarity, durability: number, extra: Partial<P> = {}): P => ({
  instanceId: id, pieceType: type, rarity, durability, durabilityMax: type === 'queen' && rarity === 'legendary' ? 1 : 2,
  origin: 'shop', acquiredAtStage: 1, status: 'in_deck', ...extra,
});
const withDeck = (pieces: P[], coins = 20): RunState => ({ ...starterRun(), coins, deck: [starterRun().deck[0]!, ...pieces] });
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : r.error);

describe('mergePieces', () => {
  it('three normal knights become one rare knight', () => {
    const run = withDeck([mk('a', 'knight', 'normal', 2), mk('b', 'knight', 'normal', 1), mk('c', 'knight', 'normal', 2)]);
    const r = mergePieces(run, ['c', 'a', 'b'], 1, 4, runConfig);
    if (!r.ok) throw new Error('expected ok');
    const made = r.value.run.deck.find(p => p.instanceId === r.value.resultId)! as P;
    expect(made).toMatchObject({ pieceType: 'knight', rarity: 'rare', durability: 2, durabilityMax: 2, origin: 'merge', acquiredAtStage: 4, status: 'in_deck' });
    expect(made.usedOnce).toBeUndefined();
    expect(made.pricePaid).toBeUndefined();
    expect(r.value.run.deck.map(p => p.instanceId)).not.toContain('a');
    expect(r.value.run.deck).toHaveLength(2);
    expect(r.value.resultId).toMatch(/^p_[0-9a-f]+$/);
    const again = mergePieces(run, ['a', 'b', 'c'], 1, 4, runConfig);
    expect(again.ok && again.value.resultId).toBe(r.value.resultId);
  });
  it('rejects invalid merges', () => {
    const three = (rarity: Rarity) => withDeck(['a', 'b', 'c'].map(i => mk(i, 'knight', rarity, 2)));
    expect(err(mergePieces(three('rare'), ['a', 'b', 'c'], 1, 1, runConfig))).toEqual({ kind: 'merge_invalid', reason: 'ceiling' });
    expect(err(mergePieces(three('legendary'), ['a', 'b', 'c'], 3, 1, runConfig))).toEqual({ kind: 'merge_invalid', reason: 'legendary' });
    const mixed = withDeck([mk('a', 'knight', 'normal', 2), mk('b', 'knight', 'rare', 2), mk('c', 'knight', 'normal', 2)]);
    expect(err(mergePieces(mixed, ['a', 'b', 'c'], 3, 1, runConfig))).toEqual({ kind: 'merge_invalid', reason: 'mismatch' });
    const spent = withDeck([mk('a', 'knight', 'normal', 0, { status: 'spent' }), mk('b', 'knight', 'normal', 2), mk('c', 'knight', 'normal', 2)]);
    expect(err(mergePieces(spent, ['a', 'b', 'c'], 1, 1, runConfig))).toEqual({ kind: 'merge_invalid', reason: 'durability' });
    expect(err(mergePieces(three('normal'), ['a', 'b'], 1, 1, runConfig))).toEqual({ kind: 'merge_invalid', reason: 'count' });
  });
  it('three unique queens in act 3 make a legendary queen with durability 1', () => {
    const run = withDeck(['a', 'b', 'c'].map(i => mk(i, 'queen', 'unique', 2, { usedOnce: ['lifeline'] })));
    const r = mergePieces(run, ['a', 'b', 'c'], 3, 9, runConfig);
    if (!r.ok) throw new Error('expected ok');
    const made = r.value.run.deck.find(p => p.instanceId === r.value.resultId)!;
    expect(made).toMatchObject({ rarity: 'legendary', durability: 1, durabilityMax: 1 });
    expect(made.usedOnce).toBeUndefined();
  });
});

describe('mergePieces maxInputTier', () => {
  const capped = { ...runConfig, run: { ...runConfig.run, merge: { ...runConfig.run.merge, maxInputTier: 'rare' as const } } };
  it('is read from config', () => {
    const uniq = withDeck(['a', 'b', 'c'].map(i => mk(i, 'knight', 'unique', 2)));
    expect(err(mergePieces(uniq, ['a', 'b', 'c'], 3, 1, capped))).toEqual({ kind: 'merge_invalid', reason: 'legendary' });
    const rare = withDeck(['a', 'b', 'c'].map(i => mk(i, 'knight', 'rare', 2)));
    expect(mergePieces(rare, ['a', 'b', 'c'], 3, 1, capped).ok).toBe(true);
  });
});

describe('sellPiece', () => {
  it('removes the piece and pays', () => {
    const run = withDeck([mk('a', 'rook', 'rare', 1)], 5);
    const r = sellPiece(run, 'a', 2, runConfig);
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.coins).toBe(9);
    expect(r.value.run.coins).toBe(14);
    expect(r.value.run.deck.some(p => p.instanceId === 'a')).toBe(false);
  });
  it('caps at pricePaid', () => {
    const run = withDeck([mk('a', 'knight', 'normal', 2, { pricePaid: 4 })]);
    const r = sellPiece(run, 'a', 3, runConfig);
    expect(r.ok && r.value.coins).toBe(4);
  });
  it('refuses king and spent', () => {
    const run = withDeck([mk('a', 'knight', 'normal', 0, { status: 'spent' })]);
    expect(err(sellPiece(run, 'p_king_01', 1, runConfig))).toEqual({ kind: 'cannot_sell', instanceId: 'p_king_01', reason: 'king' });
    expect(err(sellPiece(run, 'a', 1, runConfig))).toEqual({ kind: 'cannot_sell', instanceId: 'a', reason: 'spent' });
    expect(err(sellPiece(run, 'zz', 1, runConfig))).toEqual({ kind: 'cannot_sell', instanceId: 'zz', reason: 'not_in_deck' });
  });
});

describe('repairPiece', () => {
  it('restores one durability for the repair cost, repeatably', () => {
    const run = withDeck([mk('a', 'knight', 'rare', 1), mk('b', 'bishop', 'normal', 1)], 20);
    const r1 = repairPiece(run, 'a', runConfig);
    if (!r1.ok) throw new Error('expected ok');
    expect(r1.value.durability).toBe(2);
    const r2 = repairPiece(r1.value.run, 'b', runConfig);
    if (!r2.ok) throw new Error('expected ok');
    expect(r2.value.run.coins).toBe(12);
    expect(r2.value.run.deck.find(p => p.instanceId === 'a')).toMatchObject({ durability: 2, rarity: 'rare' });
  });
  it('refuses undamaged, spent and short of coins', () => {
    const run = withDeck([mk('q', 'queen', 'legendary', 1), mk('s', 'knight', 'normal', 0, { status: 'spent' }), mk('d', 'knight', 'normal', 1)], 3);
    expect(err(repairPiece(run, 'q', runConfig))).toEqual({ kind: 'not_damaged', instanceId: 'q' });
    expect(err(repairPiece(run, 's', runConfig))).toEqual({ kind: 'cannot_repair', instanceId: 's', reason: 'spent' });
    expect(err(repairPiece(run, 'p_king_01', runConfig))).toEqual({ kind: 'cannot_repair', instanceId: 'p_king_01', reason: 'king' });
    expect(err(repairPiece(run, 'd', runConfig))).toEqual({ kind: 'insufficient_coins', price: 4, coins: 3 });
  });
});

describe('cutPiece', () => {
  it('removes any non-king piece including spent', () => {
    const run = withDeck([mk('s', 'knight', 'normal', 0, { status: 'spent' })]);
    const r = cutPiece(run, 's');
    expect(r.ok && r.value.run.deck.some(p => p.instanceId === 's')).toBe(false);
    expect(err(cutPiece(run, 'p_king_01'))).toEqual({ kind: 'cannot_cut', instanceId: 'p_king_01', reason: 'king' });
  });
});
