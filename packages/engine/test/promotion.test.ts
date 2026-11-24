import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import { durabilityMaxOf } from '../src/abilities';
import { previewSteps, promotionChoices } from '../src/view';
import type { Action, BoardPiece, PromotionType, Rarity, RunState, StageState } from '../src/types';
import { config, deepFreeze, runOf, stageOf } from './helpers';

// M5.1 P1-P4 (docs/02 §2.2): a White pawn reaching rank 8 becomes the chosen Hero Piece, with the
// pawn's rarity, on the same square, and joins the deck at once.

const mv = (from: string, to: string, promotion?: PromotionType): Action =>
  ({ type: 'MOVE', from, to, ...(promotion !== undefined && { promotion }) });

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const pawn = (rarity: Rarity, stageId: string): BoardPiece =>
  ({ pieceType: 'pawn', color: 'white', spawned: true, rarity, stageId });

/** `stageOf(pieces)` with spawned pawns of the given rarity added (no instanceId, as generation spawns them). */
function withPawns(
  pieces: Record<string, string>, pawns: Record<string, Rarity>, over: Partial<StageState> = {},
): StageState {
  const base = stageOf(pieces, over);
  const board = { ...base.board };
  let n = 90;
  for (const [sq, rarity] of Object.entries(pawns)) board[sq] = pawn(rarity, `s${n++}`);
  return deepFreeze({ ...base, board });
}

/** A Rare spawned pawn on g7, g8 empty, and a quiet enemy (a lone king on h5). */
const quiet = (over: Partial<StageState> = {}) => withPawns({ e1: 'K', h5: 'k' }, { g7: 'rare' }, over);

const run: RunState = runOf();

describe('chess promotion (M5.1 P1-P4)', () => {
  it.each(['knight', 'bishop', 'rook', 'queen'] as const)(
    'promotes to %s on the board with the pawn rarity and joins the deck',
    (pieceType) => {
      const v = ok(simulate(run, quiet(), [mv('g7', 'g8', pieceType)], config));
      const placed = v.stage.board['g8']!;
      expect(v.stage.board['g7']).toBeUndefined();
      expect(placed).toEqual({ pieceType, color: 'white', rarity: 'rare', instanceId: expect.stringMatching(/^p_[0-9a-f]+$/) });
      const max = durabilityMaxOf(pieceType, 'rare', config);
      expect(v.run.deck).toHaveLength(run.deck.length + 1);
      expect(v.run.deck.at(-1)).toEqual({
        instanceId: placed.instanceId, pieceType, rarity: 'rare', durability: max, durabilityMax: max,
        origin: 'promotion', acquiredAtStage: 0, pricePaid: 0, status: 'in_deck',
      });
      expect(v.events).toContainEqual({
        type: 'pawn_promoted', square: 'g8', pieceType, rarity: 'rare', instanceId: placed.instanceId,
      });
    },
  );

  it('refuses a promotion without a choice', () => {
    expect(simulate(run, quiet(), [mv('g7', 'g8')], config)).toEqual({
      ok: false, error: { kind: 'illegal_move', atStep: 0, from: 'g7', to: 'g8', reason: 'promotion_required' },
    });
  });

  it('refuses promotion on a non-promoting move', () => {
    const stage = withPawns({ e1: 'K', a1: 'R', h5: 'k' }, { c5: 'normal' }, { moveCredits: 1 });
    expect(simulate(run, stage, [mv('a1', 'a2', 'queen')], config)).toEqual({
      ok: false, error: { kind: 'illegal_move', atStep: 0, from: 'a1', to: 'a2', reason: 'promotion_not_allowed' },
    });
    expect(simulate(run, stage, [mv('c5', 'c6', 'rook')], config)).toEqual({
      ok: false, error: { kind: 'illegal_move', atStep: 0, from: 'c5', to: 'c6', reason: 'promotion_not_allowed' },
    });
  });

  it('a capture-promotion that mates wins at once', () => {
    // b7xc8=Q gives check along rank 8 at once; the g8 king is boxed in by its own pawns (Review Focus 1).
    const stage = withPawns({ e1: 'K', c8: 'r', g8: 'k', f7: 'p', g7: 'p', h7: 'p' }, { b7: 'normal' });
    const queue = [mv('b7', 'c8', 'queen')];
    const v = ok(commitQueue(run, stage, queue, config));
    expect(v.stage.status).toBe('won');
    expect(v.stage.endReason).toBe('checkmate');
    expect(v.stage.board['c8']).toMatchObject({ pieceType: 'queen', color: 'white', rarity: 'normal' });
    expect(v.events.map((e) => e.type)).toEqual(['move', 'capture', 'pawn_promoted', 'stage_won']);
    // I10: the preview's verdict is the commit's.
    const preview = previewSteps(run, stage, queue, config);
    expect(preview.error).toBeNull();
    expect(preview.result!.award).toEqual(v.award);
    expect(preview.steps[0]!.stage.board['c8']).toEqual(v.stage.board['c8']);
    // A knight on c8 gives no check: the same capture does not win.
    expect(ok(commitQueue(run, stage, [mv('b7', 'c8', 'knight')], config)).stage.status).toBe('active');
  });

  it('the enemy reply that captures the promoted piece removes it from the deck', () => {
    const stage = withPawns({ e1: 'K', a8: 'r', h5: 'k' }, { g7: 'rare' }, {
      enemyPolicy: { type: 'scripted', line: ['a8g8'], fallbackDepth: 1 },
    });
    const v = ok(commitQueue(run, stage, [mv('g7', 'g8', 'queen')], config));
    const promoted = v.events.find((e) => e.type === 'pawn_promoted');
    expect(promoted).toBeDefined();
    const id = promoted!.type === 'pawn_promoted' ? promoted!.instanceId : '';
    expect(v.events).toContainEqual({
      type: 'capture', square: 'g8', pieceType: 'queen', color: 'white', salvage: 0, instanceId: id,
    });
    expect(v.stage.board['g8']).toMatchObject({ pieceType: 'rook', color: 'black' });
    expect(v.run.deck.some((p) => p.instanceId === id)).toBe(false);
    expect(v.run.deck).toEqual(run.deck);
  });

  it('two promotions in one queue get distinct instanceIds', () => {
    const stage = withPawns({ e1: 'K', h5: 'k' }, { d7: 'normal', f7: 'unique' }, { moveCredits: 2 });
    const v = ok(simulate(run, stage, [mv('d7', 'd8', 'queen'), mv('f7', 'f8', 'knight')], config));
    const ids = v.events.flatMap((e) => (e.type === 'pawn_promoted' ? [e.instanceId] : []));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(v.run.deck.slice(-2).map((p) => [p.instanceId, p.pieceType, p.rarity])).toEqual([
      [ids[0], 'queen', 'normal'], [ids[1], 'knight', 'unique'],
    ]);
    expect(v.stage.board['d8']).toMatchObject({ pieceType: 'queen', instanceId: ids[0] });
    expect(v.stage.board['f8']).toMatchObject({ pieceType: 'knight', instanceId: ids[1] });
  });

  it('the promoted piece can move again later in the same queue', () => {
    const queue = [mv('g7', 'g8', 'rook'), mv('g8', 'a8')];
    const v = ok(simulate(run, quiet({ moveCredits: 2 }), queue, config));
    expect(v.stage.board['g8']).toBeUndefined();
    expect(v.stage.board['a8']).toMatchObject({ pieceType: 'rook', color: 'white', rarity: 'rare' });
    expect(v.events.filter((e) => e.type === 'move')).toEqual([
      { type: 'move', from: 'g7', to: 'g8', pieceType: 'pawn', color: 'white' },
      { type: 'move', from: 'g8', to: 'a8', pieceType: 'rook', color: 'white' },
    ]);
    const preview = previewSteps(run, quiet({ moveCredits: 2 }), queue, config);
    expect(preview.steps.map((s) => s.ok)).toEqual([true, true]);
  });

  it('promotionChoices lists the four types for a promoting move and null otherwise', () => {
    const stage = withPawns({ e1: 'K', a1: 'R', c8: 'n', h5: 'k' }, { g7: 'rare', b7: 'normal', d5: 'normal' });
    expect(promotionChoices(stage, 'g7', 'g8', config)).toEqual(['queen', 'rook', 'bishop', 'knight']);
    expect(promotionChoices(stage, 'b7', 'c8', config)).toEqual(['queen', 'rook', 'bishop', 'knight']);
    expect(promotionChoices(stage, 'b7', 'b8', config)).toEqual(['queen', 'rook', 'bishop', 'knight']);
    expect(promotionChoices(stage, 'g7', 'h8', config)).toBeNull(); // unreachable
    expect(promotionChoices(stage, 'd5', 'd6', config)).toBeNull();
    expect(promotionChoices(stage, 'a1', 'a8', config)).toBeNull();
    expect(promotionChoices(stage, 'e4', 'e5', config)).toBeNull(); // no piece
    expect(promotionChoices(stage, 'h5', 'h6', config)).toBeNull(); // not White's
  });

  it('enemy pawns still promote to a Normal queen', () => {
    const stage = stageOf({ g3: 'K', b2: 'p', e8: 'k' }, { enemyPolicy: { type: 'scripted', line: ['b2b1'], fallbackDepth: 1 } });
    const v = ok(commitQueue(run, stage, [mv('g3', 'g4')], config));
    expect(v.stage.board['b1']).toEqual({ pieceType: 'queen', color: 'black', stageId: stage.board['b2']!.stageId });
    expect(v.events).toContainEqual({ type: 'enemy_promoted', square: 'b1' });
    expect(v.run.deck).toEqual(run.deck);
  });
});
