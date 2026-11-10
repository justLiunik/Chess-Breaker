import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import { applyPlayerMove } from '../src/queue';
import { checkPlayerMove, inCheck } from '../src/legality';
import { hasLegalQueue } from '../src/legal-queue';
import { hasBonusMove, lifelineSaves } from '../src/abilities';
import { KING, fromBoard, tiersOf } from '../src/position';
import type { Action, BoardPiece, GameEvent, RunState, StageState } from '../src/types';
import { config, deepFreeze } from './helpers';
import { makeCase } from './fuzzgen';

// Runtime budget: well under 30 s (about 2.5 s measured).
const CASES = 10_000;
// commitQueue (with the depth-1 search) on 1 case in 10, and on every case whose deck has a queen
// with an unused lifeline (so R5 lifeline saves occur).
const COMMIT_EVERY = 10;
const lifelineQueen = (run: RunState): boolean => run.deck.some((p) => lifelineSaves(p, config));

function kings(board: StageState['board']): { white: number; black: number } {
  const b = fromBoard(board);
  let white = 0;
  let black = 0;
  for (let i = 0; i < 64; i++) {
    if (b[i] === KING) white++;
    if (b[i] === -KING) black++;
  }
  return { white, black };
}

/** I4: every MOVE of the queue, its skills skipped, is legal when made; returns the end board. */
function replay(stage: StageState, queue: Action[]): { made: number; board: StageState['board'] } {
  let board = stage.board;
  let made = 0;
  for (const a of queue) {
    if (a.type !== 'MOVE') continue;
    expect(checkPlayerMove(board, a.from, a.to, config)).toBeNull(); // I4
    board = applyPlayerMove(board, a.from, a.to, config).board;
    made++;
  }
  return { made, board };
}

/**
 * The free bonus moves in an accepted queue's events (I5): a Legendary knight's second MOVE of the
 * turn is free, once. Pieces are followed through the `move` events from the stage board.
 */
function bonusMoves(stage: StageState, events: GameEvent[]): number {
  const at = new Map<string, BoardPiece>(Object.entries(stage.board));
  const count = new Map<BoardPiece, number>();
  for (const e of events) {
    if (e.type !== 'move') continue;
    const piece = at.get(e.from)!;
    at.delete(e.from);
    at.set(e.to, piece);
    count.set(piece, (count.get(piece) ?? 0) + 1);
  }
  let free = 0;
  for (const [piece, n] of count) if (n >= 2 && hasBonusMove(piece, config)) free++;
  return free;
}

/** Two `capture` events right after one `move`: a multi-capture. */
const multiCaptured = (events: GameEvent[]): boolean =>
  events.some((e, i) => e.type === 'move' && events[i + 1]?.type === 'capture' && events[i + 2]?.type === 'capture');

describe('fuzz: queue invariants', () => {
  it(`holds on ${CASES} random positions and queues`, () => {
    let accepted = 0;
    let refused = 0;
    let withSkills = 0;
    let transforms = 0;
    let tiered = 0;
    let multiCaptures = 0;
    let bonus = 0;
    let heroCaptures = 0;
    let lifelines = 0;
    for (let i = 0; i < CASES; i++) {
      const { run, stage, queue, credits } = makeCase('fuzz', i);
      deepFreeze(run);
      deepFreeze(stage);
      deepFreeze(queue);
      const before = JSON.stringify([run, stage, queue]);
      const r = simulate(run, stage, queue, config);
      expect(JSON.stringify([run, stage, queue])).toBe(before);
      if (r.ok) {
        accepted++;
        const end = r.value.stage;
        const k = kings(end.board);
        expect(k).toEqual({ white: 1, black: 1 }); // I1, I3
        expect(inCheck(fromBoard(end.board), 'white')).toBe(false); // I2
        if (tiersOf(stage.board).some((t) => t > 0)) tiered++;
        const used = r.value.events.flatMap((e) => (e.type === 'skill_activated' ? [e.skillId] : []));
        const moves = r.value.events.filter((e) => e.type === 'move').length;
        const transformed = r.value.events.some((e) => e.type === 'piece_transformed');
        if (used.length > 0) withSkills++;
        if (transformed) {
          transforms++;
          // A transform changes what its piece may do, so I4 is covered by the engine's own checks here.
        } else {
          const { made, board } = replay(stage, queue); // I4
          expect(end.board).toEqual(board);
          expect(moves).toBe(made);
        }
        if (multiCaptured(r.value.events)) multiCaptures++;
        // I5: paid moves <= credits (+1 per Twin Step); a Legendary knight's bonus move is free, once.
        const free = bonusMoves(stage, r.value.events);
        if (free > 0) bonus++;
        const granted = used.filter((id) => id === 'twin_step').length;
        expect(moves - free).toBeLessThanOrEqual(credits + granted);
        const spent = used.reduce((n, id) => n + (config.skills[id]?.cost ?? 0), 0);
        expect(spent).toBeLessThanOrEqual(stage.focus); // I6
        for (const id of used) expect(run.loadout.some((l) => l.skillId === id && l.charges >= 1)).toBe(true);
        expect(end.modifiers.every((m) => m.duration !== 'this_turn')).toBe(true); // R1 expired them
        for (const p of Object.values(end.board)) expect(p.transformed).toBeUndefined();
      } else {
        refused++;
        expect(r.error.kind).not.toBe('invariant_violation'); // I1/I3 would surface only here
      }
      if (i % COMMIT_EVERY === 0 || lifelineQueen(run)) {
        const c = commitQueue(run, stage, queue, config);
        expect(JSON.stringify([run, stage, queue])).toBe(before);
        // A board/deck desync would refuse here with invariant_violation I15.
        expect(c.ok ? null : c.error).toEqual(r.ok ? null : r.error);
        if (c.ok) {
          expect(kings(c.value.stage.board)).toEqual({ white: 1, black: 1 });
          const reply = c.value.events.slice(r.ok ? r.value.events.length : 0);
          if (reply.some((e) => e.type === 'capture' && e.color === 'white' && e.instanceId !== undefined)) heroCaptures++;
          if (reply.some((e) => e.type === 'lifeline_saved')) lifelines++;
          // After the reply White may be in check, but an active stage always has a legal queue.
          if (c.value.stage.status === 'active') expect(hasLegalQueue(c.value.run, c.value.stage, config)).toBe(true);
        }
      }
    }
    // The generator must exercise both outcomes, skills, rarity and the deck.
    expect(accepted).toBeGreaterThan(CASES / 10);
    expect(refused).toBeGreaterThan(CASES / 10);
    expect(withSkills).toBeGreaterThan(CASES / 50);
    expect(transforms).toBeGreaterThan(20);
    expect(tiered).toBeGreaterThan(CASES / 10);
    expect(multiCaptures, 'accepted queues with a multi-capture').toBeGreaterThan(20);
    expect(bonus, 'accepted queues with a Legendary knight bonus move').toBeGreaterThan(20);
    expect(heroCaptures, 'R5 captures of a Hero Piece').toBeGreaterThan(50);
    expect(lifelines, 'R5 captures saved by a lifeline').toBeGreaterThan(0);
  }, 60_000);
});
