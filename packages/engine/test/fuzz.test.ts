import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import { applyPlayerMove } from '../src/queue';
import { checkPlayerMove, hasLegalQueue, inCheck } from '../src/legality';
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

function replay(stage: StageState, queue: Action[]): number {
  let board = stage.board;
  let made = 0;
  for (const a of queue) {
    if (a.type !== 'MOVE') break;
    expect(checkPlayerMove(board, a.from, a.to)).toBeNull(); // I4
    board = applyPlayerMove(board, a.from, a.to, config).board;
    made++;
  }
  return made;
}

describe('fuzz: queue invariants', () => {
  it(`holds on ${CASES} random positions and queues`, () => {
    let accepted = 0;
    let refused = 0;
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
        const made = replay(stage, queue); // I4
        expect(made).toBeLessThanOrEqual(credits); // I5
        expect(r.value.events.filter((e) => e.type === 'move')).toHaveLength(made);
      } else {
        refused++;
      }
      if (i % COMMIT_EVERY === 0) {
        const c = commitQueue(run, stage, queue, config);
        expect(JSON.stringify([run, stage, queue])).toBe(before);
        expect(c.ok).toBe(r.ok);
        if (c.ok) {
          expect(kings(c.value.stage.board)).toEqual({ white: 1, black: 1 });
          // After the reply White may be in check, but an active stage always has a legal queue.
          if (c.value.stage.status === 'active') expect(hasLegalQueue(c.value.stage, config)).toBe(true);
        }
      }
    }
    // The generator must exercise both outcomes.
    expect(accepted).toBeGreaterThan(CASES / 10);
    expect(refused).toBeGreaterThan(CASES / 10);
  }, 60_000);
});
