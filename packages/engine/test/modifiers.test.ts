import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import { enemyMove } from '../src/enemy/policy';
import { enemyClock } from '../src/economy';
import { scoreRootMoves } from '../src/enemy/search';
import { legalMoves } from '../src/legality';
import { fromBoard } from '../src/position';
import { toIndex } from '../src/square';
import { frozenMask } from '../src/skills/registry';
import type { Action, EngineConfig, PieceType, RunState, SkillDef, StageState } from '../src/types';
import { config, deckFor, deepFreeze, runOf, stageOf } from './helpers';

const clockOf = (s: StageState): number => enemyClock(runOf(), s, config);

const mv = (from: string, to: string): Action => ({ type: 'MOVE', from, to });
const skill = (skillId: string, target?: string): Action => ({
  type: 'ACTIVATE_SKILL', skillId, ...(target !== undefined && { target }),
});
const runWith = (...ids: string[]): RunState =>
  deepFreeze(runOf({ loadout: ids.map((skillId) => ({ skillId, charges: 2, chargesMax: 2 })) }));
const types = (events: { type: string }[]): string[] => events.map((e) => e.type);

/**
 * A test-only skill that transforms an enemy piece for this turn. The launch skills cannot reach two
 * R1 edge cases: Ascension targets only own bishops (which the player never captures), and a White
 * piece's type never changes what Black attacks. The primitive is data-driven, so a future skill can.
 */
function withEnemyTransform(id: string, pieceType: PieceType, toType: PieceType): EngineConfig {
  const def: SkillDef = {
    id, status: 'mvp', cost: 1, charges: 2, price: 0,
    target: { kind: 'enemy_piece', pieceType, must_be_on_board: true },
    effects: [{ primitive: 'set_piece_type', params: { pieceType: toType }, duration: 'this_turn' }],
    restrictions: [],
  };
  return deepFreeze({ ...config, skills: { ...config.skills, [id]: def } });
}

function ok<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe('R1: this_turn modifiers expire before R2', () => {
  it("Ascension's queen captures, then reverts at R1: the board shows a bishop", () => {
    const s = stageOf({ e1: 'K', c1: 'B', c7: 'n', h8: 'k' });
    const id = s.board.c1!.instanceId!;
    const q = [skill('ascension', 'c1'), mv('c1', 'c7')];
    const r = ok(simulate(runWith('ascension'), s, q, config));
    expect(r.stage.board.c7).toEqual({ pieceType: 'bishop', color: 'white', instanceId: id });
    expect(r.stage.modifiers).toEqual([]);
    expect(types(r.events)).toEqual([
      'skill_activated', 'piece_transformed', 'move', 'capture', 'transform_reverted', 'modifier_expired',
    ]);
    expect(r.events.slice(4)).toEqual([
      { type: 'transform_reverted', target: id },
      { type: 'modifier_expired', modifierId: 'm1_0' },
    ]);
    const c = ok(commitQueue(runWith('ascension'), s, q, config));
    expect(c.events.slice(0, r.events.length)).toEqual(r.events);
    expect(c.stage.board.c7?.transformed).toBeUndefined();
  });

  it('a temporary queen never mates', () => {
    const pieces = { a1: 'K', b5: 'B', h8: 'k', g7: 'p', h7: 'p' };
    // Control: a real queen on b5 mates with b8.
    const real = ok(simulate(runOf(), stageOf({ ...pieces, b5: 'Q' }), [mv('b5', 'b8')], config));
    expect(real.stage).toMatchObject({ status: 'won', endReason: 'checkmate' });

    const r = ok(simulate(runWith('ascension'), stageOf(pieces), [skill('ascension', 'b5'), mv('b5', 'b8')], config));
    expect(r.stage.status).toBe('active');
    expect(r.stage.board.b8?.transformed).toBeUndefined();
    expect(types(r.events)).not.toContain('stage_won');
    expect(types(r.events)).not.toContain('check');
  });

  it('a revert that exposes the king is king_in_check_at_end { afterRevert: true }', () => {
    const cfg = withEnemyTransform('test_disguise', 'rook', 'bishop');
    const s = stageOf({ e1: 'K', d8: 'r', h8: 'k' });
    // As a bishop d8 does not see d1; reverted to a rook it does.
    const r = simulate(runWith('test_disguise'), s, [skill('test_disguise', 'd8'), mv('e1', 'd1')], cfg);
    expect(r).toEqual({
      ok: false, error: { kind: 'king_in_check_at_end', square: 'd1', checkers: ['d8'], afterRevert: true },
    });
    expect(commitQueue(runWith('test_disguise'), s, [skill('test_disguise', 'd8'), mv('e1', 'd1')], cfg)).toEqual(r);
  });

  it('a plain check is king_in_check_at_end { afterRevert: false }', () => {
    const s = stageOf({ e1: 'K', d8: 'r', h8: 'k' });
    expect(simulate(runOf(), s, [mv('e1', 'd1')], config)).toEqual({
      ok: false, error: { kind: 'king_in_check_at_end', square: 'd1', checkers: ['d8'], afterRevert: false },
    });
  });

  it('an Ascension-style transform on a bishop later captured in the queue: the modifier drops, no revert event', () => {
    const cfg = withEnemyTransform('test_hex', 'bishop', 'knight');
    const s = stageOf({ e1: 'K', b1: 'R', b7: 'b', h8: 'k' });
    const r = ok(simulate(runWith('test_hex'), s, [skill('test_hex', 'b7'), mv('b1', 'b7')], cfg));
    expect(r.stage.modifiers).toEqual([]);
    expect(r.stage.board.b7).toEqual(s.board.b1);
    expect(types(r.events)).not.toContain('transform_reverted');
    expect(r.events.at(-1)).toEqual({ type: 'modifier_expired', modifierId: 'm1_0' });
  });
});

describe('R3: suppression in force', () => {
  it('Lockdown leaving the enemy no move, enemy in check: won (checkmate)', () => {
    const s = stageOf({ a1: 'K', e1: 'R', h8: 'k', g7: 'p', h7: 'p', f6: 'n' });
    // Control: without Lockdown the knight answers the check.
    expect(ok(simulate(runOf(), s, [mv('e1', 'e8')], config)).stage.status).toBe('active');
    const r = ok(simulate(runWith('lockdown'), s, [skill('lockdown', 'f6'), mv('e1', 'e8')], config));
    expect(r.stage).toMatchObject({ status: 'won', endReason: 'checkmate' });
    expect(types(r.events)).toContain('stage_won');
  });

  it('Lockdown leaving the enemy no move, not in check: lost (enemy_stalemated)', () => {
    const s = stageOf({ h6: 'K', g1: 'R', h8: 'k', h7: 'p', a5: 'n' });
    expect(ok(simulate(runOf(), s, [mv('g1', 'g2')], config)).stage.status).toBe('active');
    const r = ok(simulate(runWith('lockdown'), s, [skill('lockdown', 'a5'), mv('g1', 'g2')], config));
    expect(r.stage).toMatchObject({ status: 'lost', endReason: 'enemy_stalemated' });
    expect(r.events.at(-1)).toEqual({ type: 'stage_lost', endReason: 'enemy_stalemated' });
  });

  it('Lockdown on b7, then the player captures b7 in the same queue: no modifier survives R1, R3 freezes nothing', () => {
    const s = stageOf({ e1: 'K', b1: 'R', b7: 'n', h8: 'k', g7: 'p' });
    const r = ok(simulate(runWith('lockdown'), s, [skill('lockdown', 'b7'), mv('b1', 'b7')], config));
    expect(r.stage.modifiers).toEqual([]);
    expect(r.events.at(-1)).toEqual({ type: 'modifier_expired', modifierId: 'm1_0' });
    expect([...frozenMask(r.stage)].every((v) => v === 0)).toBe(true);
    const c = ok(commitQueue(runWith('lockdown'), s, [skill('lockdown', 'b7'), mv('b1', 'b7')], config));
    expect(c.events.filter((e) => e.type === 'modifier_expired')).toHaveLength(1);
    expect(c.stage.modifiers).toEqual([]);
  });
});

describe('R5: the enemy reply with suppression at the root only', () => {
  // Black's rook on e8 sees a free knight on e4.
  const pieces = { g1: 'K', e4: 'N', a8: 'k', e8: 'r' };

  it('the suppressed piece does not move in R5, but may move the enemy turn after', () => {
    const s = stageOf(pieces);
    const free = ok(commitQueue(deckFor(runOf(), s), s, [mv('g1', 'h1')], config));
    expect(free.events).toContainEqual({ type: 'enemy_move', from: 'e8', to: 'e4' });

    const t1 = ok(commitQueue(deckFor(runWith('lockdown'), s), s, [skill('lockdown', 'e8'), mv('g1', 'h1')], config));
    const reply1 = t1.events.find((e) => e.type === 'enemy_move');
    expect(reply1).toMatchObject({ type: 'enemy_move' });
    expect(reply1 && 'from' in reply1 && reply1.from).not.toBe('e8');
    expect(t1.stage.board.e8?.pieceType).toBe('rook');
    expect(t1.stage.modifiers).toEqual([]);

    const t2 = ok(commitQueue(t1.run, t1.stage, [mv('h1', 'g1')], config));
    expect(t2.events).toContainEqual({ type: 'enemy_move', from: 'e8', to: 'e4' });
  });

  it('next_enemy_turn modifiers expire after R5 with modifier_expired', () => {
    const s = stageOf(pieces);
    const q = [skill('lockdown', 'e8'), mv('g1', 'h1')];
    // The preview keeps the modifier: it is in force for R5.
    const sim = ok(simulate(runWith('lockdown'), s, q, config));
    expect(sim.stage.modifiers).toHaveLength(1);
    expect(types(sim.events)).not.toContain('modifier_expired');

    const c = ok(commitQueue(runWith('lockdown'), s, q, config));
    expect(types(c.events)).toEqual([
      'skill_activated', 'piece_suppressed', 'move', 'enemy_move', 'modifier_expired', 'turn_started',
    ]);
    expect(c.events[4]).toEqual({ type: 'modifier_expired', modifierId: 'm1_0' });
    expect(c.stage.modifiers).toEqual([]);
  });

  it("R5's search never freezes below the root", () => {
    // The knight on b7 is pinned at the root, so freezing it there removes nothing: the root moves
    // and their child positions are the same. Once the king steps off the pin, the knight is free
    // at Black's next move (ply 2) and can take the queen on d6. A search that froze it below the
    // root would score those children differently.
    const b = fromBoard(stageOf({ g1: 'K', d5: 'B', d6: 'Q', a8: 'k', b7: 'n' }).board);
    const frozen = new Uint8Array(64);
    frozen[toIndex('b7')] = 1;
    const free = scoreRootMoves(b, 5, 2, config);
    expect(free.every((r) => r.move.from !== toIndex('b7'))).toBe(true);
    expect(scoreRootMoves(b, 5, 2, config, frozen)).toEqual(free);
  });

  it('the root mask removes exactly the frozen piece moves', () => {
    const b = fromBoard(stageOf(pieces).board);
    const frozen = new Uint8Array(64);
    frozen[toIndex('e8')] = 1;
    const masked = scoreRootMoves(b, 5, 2, config, frozen).map((r) => r.move);
    const all = legalMoves(b, 'black');
    expect(masked.length).toBeGreaterThan(0);
    expect(new Set(masked.map((m) => `${m.from}-${m.to}`))).toEqual(
      new Set(all.filter((m) => m.from !== toIndex('e8')).map((m) => `${m.from}-${m.to}`)),
    );
  });

  it('a scripted line whose next move is by a frozen piece falls back for good (Ruling R7)', () => {
    const s0 = stageOf(pieces, { enemyPolicy: { type: 'scripted', line: ['e8e4'], fallbackDepth: 2 } });
    const c = ok(commitQueue(runWith('lockdown'), s0, [skill('lockdown', 'e8'), mv('g1', 'h1')], config));
    const fell = c.events.findIndex((e) => e.type === 'enemy_fell_back');
    const moved = c.events.findIndex((e) => e.type === 'enemy_move');
    expect(fell).toBeGreaterThanOrEqual(0);
    expect(fell).toBeLessThan(moved);
    expect(c.events[moved]).not.toMatchObject({ from: 'e8' });
    expect(c.stage.enemyPolicy).toMatchObject({ fellBack: true, cursor: 0 });
  });

  it('enemyMove returns no move when only frozen pieces could move', () => {
    const s = stageOf({ h6: 'K', g2: 'R', h8: 'k', h7: 'p', a5: 'n' });
    const locked: StageState = deepFreeze({
      ...s,
      modifiers: [{
        modifierId: 'm1_0', primitive: 'suppress_piece', source: 'lockdown', target: s.board.a5!.stageId!,
        duration: 'next_enemy_turn', appliedOnTurn: 1,
      }],
    });
    expect(enemyMove(s, 0, clockOf(s), config).move).not.toBeNull();
    expect(enemyMove(locked, 0, clockOf(locked), config).move).toBeNull();
  });
});

describe('frozen masks', () => {
  it('legalMoves with a mask drops every move from a frozen square, and only those', () => {
    const b = fromBoard(stageOf({ e1: 'K', a8: 'k', e8: 'r', c6: 'n' }).board);
    const frozen = new Uint8Array(64);
    frozen[toIndex('e8')] = 1;
    const all = legalMoves(b, 'black');
    expect(legalMoves(b, 'black', frozen)).toEqual(all.filter((m) => m.from !== toIndex('e8')));
    expect(legalMoves(b, 'black', new Uint8Array(64))).toEqual(all);
  });

  it('frozenMask finds each suppressed piece by id, wherever it stands', () => {
    const s = stageOf({ e1: 'K', a8: 'k', e8: 'r', c6: 'n' });
    const rookId = s.board.e8!.stageId!;
    const moved: StageState = deepFreeze({
      ...s,
      board: { e1: s.board.e1!, a8: s.board.a8!, c6: s.board.c6!, e5: s.board.e8! },
      modifiers: [
        { modifierId: 'm1_0', primitive: 'suppress_piece', source: 'lockdown', target: rookId, duration: 'next_enemy_turn', appliedOnTurn: 1 },
        { modifierId: 'm1_1', primitive: 'set_piece_type', source: 'ascension', target: s.board.c6!.stageId!, duration: 'this_turn', appliedOnTurn: 1 },
      ],
    });
    const mask = frozenMask(moved);
    expect([...mask].reduce((a, v) => a + v, 0)).toBe(1);
    expect(mask[toIndex('e5')]).toBe(1);
  });
});
