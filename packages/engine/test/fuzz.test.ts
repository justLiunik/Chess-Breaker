import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import { applyPlayerMove } from '../src/queue';
import { checkPlayerMove, inCheck } from '../src/legality';
import { hasLegalQueue } from '../src/legal-queue';
import { KING, fromBoard } from '../src/position';
import type { Action, StageState } from '../src/types';
import { config, deepFreeze } from './helpers';
import { makeCase } from './fuzzgen';

// Runtime budget: well under 30 s (about 6 s measured).
const CASES = 10_000;
const COMMIT_EVERY = 20; // commitQueue (with the depth-1 search) on 1 case in 20

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

function replay(stage: StageState, queue: Action[]): { made: number; board: StageState['board'] } {
  let board = stage.board;
  let made = 0;
  for (const a of queue) {
    if (a.type !== 'MOVE') break;
    expect(checkPlayerMove(board, a.from, a.to, config)).toBeNull(); // I4
    board = applyPlayerMove(board, a.from, a.to, config).board;
    made++;
  }
  return { made, board };
}

describe('fuzz: queue invariants', () => {
  it(`holds on ${CASES} random positions and queues`, () => {
    let accepted = 0;
    let refused = 0;
    let withSkills = 0;
    let transforms = 0;
    for (let i = 0; i < CASES; i++) {
      const { run, stage, queue, credits } = makeCase('fuzz', i);
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
        const used = r.value.events.flatMap((e) => (e.type === 'skill_activated' ? [e.skillId] : []));
        const moves = r.value.events.filter((e) => e.type === 'move').length;
        if (used.length === 0) {
          const { made, board } = replay(stage, queue); // I4
          expect(end.board).toEqual(board);
          expect(moves).toBe(made);
        } else {
          withSkills++;
          if (r.value.events.some((e) => e.type === 'piece_transformed')) transforms++;
          // Skills change what a move may do, so I4 is covered by the engine's own checks here.
        }
        // I5: paid moves <= credits (+1 per Twin Step); Focus spent <= the pool the stage had.
        const granted = used.filter((id) => id === 'twin_step').length;
        expect(moves).toBeLessThanOrEqual(credits + granted);
        const spent = used.reduce((n, id) => n + (config.skills[id]?.cost ?? 0), 0);
        expect(spent).toBeLessThanOrEqual(stage.focus);
        for (const id of used) expect(run.loadout.some((l) => l.skillId === id && l.charges >= 1)).toBe(true);
        expect(end.modifiers.every((m) => m.duration !== 'this_turn')).toBe(true); // R1 expired them
        for (const p of Object.values(end.board)) expect(p.transformed).toBeUndefined();
      } else {
        refused++;
        expect(r.error.kind).not.toBe('invariant_violation'); // I1/I3 would surface only here
      }
      if (i % COMMIT_EVERY === 0) {
        const c = commitQueue(run, stage, queue, config);
        expect(JSON.stringify([run, stage, queue])).toBe(before);
        expect(c.ok).toBe(r.ok);
        if (c.ok) {
          expect(kings(c.value.stage.board)).toEqual({ white: 1, black: 1 });
          // After the reply White may be in check, but an active stage always has a legal queue.
          if (c.value.stage.status === 'active') expect(hasLegalQueue(c.value.run, c.value.stage, config)).toBe(true);
        }
      }
    }
    // The generator must exercise both outcomes.
    expect(accepted).toBeGreaterThan(CASES / 10);
    expect(refused).toBeGreaterThan(CASES / 10);
    expect(withSkills).toBeGreaterThan(CASES / 50);
    expect(transforms).toBeGreaterThan(20);
  }, 60_000);
});
