import { describe, expect, it } from 'vitest';
import { commitQueue } from '../src/rules';
import { config, deckFor, deepFreeze, runOf, stageOf } from './helpers';
import type { Action, GameEvent } from '../src/types';

const mv = (from: string, to: string): Action[] => [{ type: 'MOVE', from, to }];
const scripted = (line: string[]) => ({ type: 'scripted' as const, line, fallbackDepth: 1 });
const depth1 = { type: 'best_move' as const, depth: 1 };

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
const types = (e: GameEvent[]) => e.map((x) => x.type);

describe('commitQueue', () => {
  it('applies the enemy reply, reports it and starts the next turn', () => {
    const stage = stageOf({ e1: 'K', a1: 'R', e8: 'k', h7: 'p' }, {
      enemyPolicy: scripted(['h7h6']), moveCredits: 1, focus: 0, turnsUsed: 2,
    });
    const v = ok(commitQueue(runOf(), stage, mv('a1', 'a2'), config));
    expect(v.stage.board.h6).toEqual({ pieceType: 'pawn', color: 'black', stageId: stage.board.h7!.stageId });
    expect(v.stage.board.h7).toBeUndefined();
    expect(v.stage.turnsUsed).toBe(3);
    expect(v.stage.enemyPolicy.cursor).toBe(1);
    expect(types(v.events)).toEqual(['move', 'enemy_move', 'turn_started']);
    expect(v.events).toContainEqual({ type: 'enemy_move', from: 'h7', to: 'h6' });
    expect(v.events.at(-1)).toEqual({ type: 'turn_started', turn: 4 });
  });

  it('refills credits and Focus', () => {
    const stage = stageOf({ e1: 'K', a1: 'R', e8: 'k' }, {
      enemyPolicy: depth1, moveCredits: 2, focus: 0, focusPool: 3,
    });
    const v = ok(commitQueue(runOf(), stage, mv('a1', 'a2'), config));
    expect(v.stage.moveCredits).toBe(config.rules.freeMovesPerTurn);
    expect(v.stage.focus).toBe(3);
  });

  it('captures a White piece with no salvage and promotes a Black pawn', () => {
    const stage = stageOf({ g3: 'K', a1: 'R', e8: 'k', b2: 'p', a3: 'N' }, {
      enemyPolicy: scripted(['b2b1']),
    });
    const v = ok(commitQueue(runOf({ coins: 7 }), stage, mv('a1', 'a2'), config));
    expect(v.stage.board.b1).toEqual({ pieceType: 'queen', color: 'black', stageId: stage.board.b2!.stageId });
    expect(v.events).toContainEqual({ type: 'enemy_promoted', square: 'b1' });
    const capStage = stageOf(
      { g3: 'K', a1: 'R', e8: 'k', c8: 'r', c1: 'B' }, { enemyPolicy: scripted(['c8c1']) });
    const cap = ok(commitQueue(deckFor(runOf({ coins: 7 }), capStage), capStage, mv('a1', 'a2'), config));
    expect(cap.run.coins).toBe(7);
    expect(cap.stage.board.c1).toEqual({ pieceType: 'rook', color: 'black', stageId: capStage.board.c8!.stageId });
    expect(cap.events).toContainEqual({
      type: 'capture', square: 'c1', pieceType: 'bishop', color: 'white', salvage: 0, instanceId: 'p_bishop_c1',
    });
  });

  it('reports a White capture by the enemy with salvage 0', () => {
    const stage = stageOf({ g1: 'K', a1: 'R', e8: 'k', a8: 'r' }, { enemyPolicy: scripted(['a8a2']) });
    const v = ok(commitQueue(deckFor(runOf(), stage), stage, mv('a1', 'a2'), config));
    expect(v.events).toContainEqual({
      type: 'capture', square: 'a2', pieceType: 'rook', color: 'white', salvage: 0, instanceId: 'p_rook_a1',
    });
    expect(v.stage.board.a2).toEqual({ pieceType: 'rook', color: 'black', stageId: stage.board.a8!.stageId });
  });

  it('emits enemy_fell_back once, when the script cannot be played', () => {
    const stage = stageOf({ e1: 'K', a1: 'R', e8: 'k', h7: 'p' }, {
      enemyPolicy: scripted(['h7h2']), // illegal
    });
    const v = ok(commitQueue(runOf(), stage, mv('a1', 'a2'), config));
    expect(v.events).toContainEqual({ type: 'enemy_fell_back', cursor: 0 });
    expect(v.stage.enemyPolicy.fellBack).toBe(true);
    expect(types(v.events).indexOf('enemy_fell_back')).toBeLessThan(types(v.events).indexOf('enemy_move'));
    const again = ok(commitQueue(runOf(), v.stage, mv('a2', 'a3'), config));
    expect(types(again.events)).not.toContain('enemy_fell_back');
  });

  it('player_mated when the reply mates the White king', () => {
    const stage = stageOf({ h1: 'K', b2: 'r', a8: 'r', e8: 'k' }, { enemyPolicy: scripted(['a8a1']) });
    const v = ok(commitQueue(runOf(), stage, mv('h1', 'g1'), config));
    expect(v.stage.status).toBe('lost');
    expect(v.stage.endReason).toBe('player_mated');
    expect(types(v.events).slice(-3)).toEqual(['turn_started', 'check', 'stage_lost']);
    expect(v.events.at(-1)).toEqual({ type: 'stage_lost', endReason: 'player_mated' });
    expect(v.award).toBeNull();
  });

  it('player_stalemated when the reply leaves White no move and no check', () => {
    const stage = stageOf({ h2: 'K', g8: 'q', e8: 'k' }, { enemyPolicy: scripted(['g8g3']) });
    const v = ok(commitQueue(runOf(), stage, mv('h2', 'h1'), config));
    expect(v.stage.status).toBe('lost');
    expect(v.stage.endReason).toBe('player_stalemated');
    expect(types(v.events)).not.toContain('check');
    expect(v.events.at(-1)).toEqual({ type: 'stage_lost', endReason: 'player_stalemated' });
  });

  it('gives a won stage no enemy move', () => {
    const stage = stageOf({ e1: 'K', a1: 'R', h8: 'k', g7: 'p', h7: 'p' }, { turnsUsed: 1 });
    const v = ok(commitQueue(runOf(), stage, mv('a1', 'a8'), config));
    expect(v.stage.status).toBe('won');
    expect(types(v.events)).not.toContain('enemy_move');
    expect(types(v.events)).not.toContain('turn_started');
    expect(v.stage.moveCredits).toBe(0);
  });

  it('gives a lost stage no enemy move', () => {
    const stage = stageOf({ e1: 'K', h1: 'R', a8: 'k' }, { turnsUsed: 7, turnLimit: 8 });
    const v = ok(commitQueue(runOf(), stage, mv('h1', 'h2'), config));
    expect(v.stage.endReason).toBe('out_of_turns');
    expect(types(v.events)).not.toContain('enemy_move');
  });

  it('does not mutate frozen inputs and passes errors through', () => {
    const stage = deepFreeze(stageOf({ e1: 'K', a1: 'R', e8: 'k' }, { enemyPolicy: depth1 }));
    const run = deepFreeze(runOf());
    const queue = deepFreeze(mv('a1', 'a2'));
    ok(commitQueue(run, stage, queue, config));
    const bad = commitQueue(run, stage, deepFreeze([]), config);
    expect(bad).toEqual({ ok: false, error: { kind: 'empty_queue' } });
  });
});
