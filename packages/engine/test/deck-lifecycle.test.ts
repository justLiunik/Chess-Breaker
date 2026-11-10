import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import { hash } from '../src/rng';
import { config, deepFreeze, runOf, stageOf } from './helpers';
import type { Action, BoardPiece, PieceInstance, Rarity, RunState, StageState } from '../src/types';

const mv = (from: string, to: string): Action => ({ type: 'MOVE', from, to });

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const inst = (over: Partial<PieceInstance> & Pick<PieceInstance, 'instanceId' | 'pieceType'>): PieceInstance => ({
  rarity: 'normal', durability: 2, durabilityMax: 2, origin: 'starter', acquiredAtStage: 0, status: 'deployed', ...over,
});

/** `base` with `extra` squares added (or replaced) as given pieces. */
function withPieces(base: StageState, extra: Record<string, BoardPiece>, over: Partial<StageState> = {}): StageState {
  return deepFreeze({ ...base, board: { ...base.board, ...extra }, ...over } as StageState);
}
const withDeck = (run: RunState, extra: PieceInstance[]): RunState => deepFreeze({ ...run, deck: [...run.deck, ...extra] });

// White king e1 steps to f1; the scripted Black pawn on e4 then takes the White piece on d3
// (a depth-1 search prefers king moves to a pawn-for-knight trade: the weights make 3 points of material worth one king move).
const capturedStage = (pieceLetter: 'N' | 'Q' | 'P'): StageState =>
  stageOf({ e1: 'K', d3: pieceLetter, e4: 'p', h8: 'k' }, { enemyPolicy: { type: 'scripted', line: ['e4d3'] } });
const kingStep = [mv('e1', 'f1')];
const tierIndex = (r: Rarity): number => ['normal', 'rare', 'unique', 'legendary'].indexOf(r);

describe('enemy captures (R5)', () => {
  it('removes the instance from run.deck', () => {
    const run = withDeck(runOf(), [inst({ instanceId: 'p_knight_d3', pieceType: 'knight' })]);
    const v = ok(commitQueue(run, capturedStage('N'), kingStep, config));
    expect(v.events).toContainEqual({
      type: 'capture', square: 'd3', pieceType: 'knight', color: 'white', salvage: 0, instanceId: 'p_knight_d3',
    });
    expect(v.run.deck.some((i) => i.instanceId === 'p_knight_d3')).toBe(false);
    expect(v.run.deck).toHaveLength(run.deck.length - 1);
  });

  it('keeps a Unique queen with lifeline: captured, usedOnce, lifeline_saved after the capture', () => {
    expect(config.abilities.queen[tierIndex('unique')]!.lifeline).toBe(true);
    const run = withDeck(runOf(), [inst({ instanceId: 'p_queen_d3', pieceType: 'queen', rarity: 'unique', durability: 2 })]);
    const v = ok(commitQueue(run, capturedStage('Q'), kingStep, config));
    const q = v.run.deck.find((i) => i.instanceId === 'p_queen_d3')!;
    expect(q.status).toBe('captured');
    expect(q.usedOnce).toEqual(['lifeline']);
    expect(q.durability).toBe(2);
    const types = v.events.map((e) => e.type);
    expect(types.indexOf('lifeline_saved')).toBe(types.indexOf('capture') + 1);
    expect(v.events).toContainEqual({ type: 'lifeline_saved', instanceId: 'p_queen_d3' });
  });

  it('removes a Unique queen whose lifeline is already used', () => {
    const run = withDeck(runOf(), [inst({ instanceId: 'p_queen_d3', pieceType: 'queen', rarity: 'unique', usedOnce: ['lifeline'] })]);
    const v = ok(commitQueue(run, capturedStage('Q'), kingStep, config));
    expect(v.run.deck.some((i) => i.instanceId === 'p_queen_d3')).toBe(false);
    expect(v.events.some((e) => e.type === 'lifeline_saved')).toBe(false);
  });

  it('gives a Rare queen no lifeline', () => {
    const run = withDeck(runOf(), [inst({ instanceId: 'p_queen_d3', pieceType: 'queen', rarity: 'rare' })]);
    const v = ok(commitQueue(run, capturedStage('Q'), kingStep, config));
    expect(v.run.deck.some((i) => i.instanceId === 'p_queen_d3')).toBe(false);
    expect(v.events.some((e) => e.type === 'lifeline_saved')).toBe(false);
  });

  it('reads the tier from the deck instance, not the board piece', () => {
    const stage = withPieces(capturedStage('Q'), { d3: { pieceType: 'queen', color: 'white', instanceId: 'p_queen_d3', rarity: 'normal' } });
    const run = withDeck(runOf(), [inst({ instanceId: 'p_queen_d3', pieceType: 'queen', rarity: 'legendary' })]);
    const v = ok(commitQueue(run, stage, kingStep, config));
    expect(v.run.deck.find((i) => i.instanceId === 'p_queen_d3')?.status).toBe('captured');
  });

  it('counts an instance of an unknown rarity as Normal: removed, no lifeline, no throw', () => {
    const run = withDeck(runOf(), [inst({ instanceId: 'p_queen_d3', pieceType: 'queen', rarity: 'mythic' as Rarity })]);
    const v = ok(commitQueue(run, capturedStage('Q'), kingStep, config));
    expect(v.run.deck.some((i) => i.instanceId === 'p_queen_d3')).toBe(false);
    expect(v.events.some((e) => e.type === 'lifeline_saved')).toBe(false);
  });

  it('refuses with invariant_violation I15 when the captured Hero Piece has no deck instance', () => {
    expect(commitQueue(runOf(), capturedStage('N'), kingStep, config)).toEqual({
      ok: false,
      error: { kind: 'invariant_violation', invariant: 'I15', detail: 'captured Hero Piece p_knight_d3 has no deck instance' },
    });
  });

  it('leaves the deck alone when the enemy captures nothing, and simulate agrees', () => {
    const stage = stageOf({ e1: 'K', h8: 'k', a7: 'P' });
    const run = runOf();
    const c = ok(commitQueue(run, stage, [mv('a7', 'a8')], config));
    const s = ok(simulate(run, stage, [mv('a7', 'a8')], config));
    expect(c.events.some((e) => e.type === 'capture' && e.color === 'white')).toBe(false);
    expect(c.run.deck).toEqual(s.run.deck);
  });
});

describe('capture event ids', () => {
  it('a player capture carries the Stage Piece stageId', () => {
    const stage = stageOf({ e1: 'K', a1: 'R', a8: 'r', h8: 'k' });
    const v = ok(simulate(runOf(), stage, [mv('a1', 'a8')], config));
    const cap = v.events.find((e) => e.type === 'capture');
    expect(cap).toMatchObject({ square: 'a8', stageId: stage.board.a8!.stageId });
    expect(cap).not.toHaveProperty('instanceId');
  });

  it('an enemy capture of a Hero Piece carries instanceId and no stageId', () => {
    const run = withDeck(runOf(), [inst({ instanceId: 'p_knight_d3', pieceType: 'knight' })]);
    const v = ok(commitQueue(run, capturedStage('N'), kingStep, config));
    const cap = v.events.find((e) => e.type === 'capture');
    expect(cap).toHaveProperty('instanceId', 'p_knight_d3');
    expect(cap).not.toHaveProperty('stageId');
  });

  it('an enemy capture of a spawned pawn carries its stageId', () => {
    const stage = capturedStage('P');
    const v = ok(commitQueue(runOf(), stage, kingStep, config));
    expect(v.events.find((e) => e.type === 'capture')).toMatchObject({ square: 'd3', stageId: stage.board.d3!.stageId });
  });
});

describe('promotion adds an instance', () => {
  const pawn = (pieceType: 'knight' | 'bishop' | 'rook' | 'queen', rarity: Rarity): BoardPiece => ({
    pieceType: 'pawn', color: 'white', spawned: true, rarity: 'normal', promotesTo: { pieceType, rarity }, stageId: 's09',
  });
  const promote = (rarity: Rarity, run: RunState = runOf()) => {
    const stage = withPieces(stageOf({ e1: 'K', h8: 'k' }), { a7: pawn('queen', rarity) });
    return ok(simulate(run, stage, [mv('a7', 'a8')], config));
  };

  it('adds exactly promotesTo at full durability: Rare queen 2, Legendary queen 1', () => {
    for (const [rarity, dur] of [['rare', 2], ['legendary', 1]] as const) {
      const run = runOf({ actIndex: 1, stageIndex: 2 });
      const v = promote(rarity, run);
      expect(v.run.deck).toHaveLength(run.deck.length + 1);
      const added = v.run.deck.at(-1)!;
      expect(added).toEqual({
        instanceId: 'p_' + hash('9C41-0B77', 0, 0, 'a8').toString(16),
        pieceType: 'queen', rarity, durability: dur, durabilityMax: dur,
        origin: 'promotion', acquiredAtStage: 5, status: 'in_deck',
      });
      expect(v.events).toContainEqual({
        type: 'pawn_promoted', square: 'a8', promotesTo: { pieceType: 'queen', rarity }, instanceId: added.instanceId,
      });
    }
  });

  it('is deterministic across two runs of the same queue', () => {
    expect(promote('rare').run.deck).toEqual(promote('rare').run.deck);
  });

  it('a pawn without promotesTo adds nothing', () => {
    const stage = withPieces(stageOf({ e1: 'K', h8: 'k' }), { a7: { pieceType: 'pawn', color: 'white', stageId: 's09' } });
    const run = runOf();
    expect(ok(simulate(run, stage, [mv('a7', 'a8')], config)).run.deck).toEqual(run.deck);
  });

  it('gives two pawns promoting on e8 in one turn two distinct ids', () => {
    const stage = withPieces(
      stageOf({ e1: 'K', h8: 'k', e8: 'r' }),
      { d7: pawn('knight', 'normal'), e7: pawn('knight', 'normal') },
      { moveCredits: 2 },
    );
    const run = runOf();
    const v = ok(simulate(run, stage, [mv('d7', 'e8'), mv('e7', 'e8')], config));
    const added = v.run.deck.slice(run.deck.length);
    expect(added).toHaveLength(2);
    expect(new Set(added.map((i) => i.instanceId)).size).toBe(2);
    expect(added.map((i) => i.instanceId)).toEqual([0, 1].map((n) => 'p_' + hash('9C41-0B77', 0, n, 'e8').toString(16)));
  });

  it('commitQueue keeps the promoted instance and agrees with simulate', () => {
    const stage = withPieces(stageOf({ e1: 'K', h8: 'k' }), { a7: pawn('queen', 'rare') });
    const c = ok(commitQueue(runOf(), stage, [mv('a7', 'a8')], config));
    const s = ok(simulate(runOf(), stage, [mv('a7', 'a8')], config));
    expect(c.run.deck).toEqual(s.run.deck);
  });
});
