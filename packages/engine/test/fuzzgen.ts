import { fromBoard } from '../src/position';
import { inCheck, legalMoves } from '../src/legality';
import { pseudoMoves } from '../src/movegen';
import { rng, hash } from '../src/rng';
import { toSquare } from '../src/square';
import type { Action, RunState, Square, StageState } from '../src/types';
import { runOf, stageOf } from './helpers';

export interface Case { run: RunState; stage: StageState; queue: Action[]; credits: number }

/** All randomness comes from `rng`; one stream per case index. */
function stream(label: string, i: number) {
  let cursor = 0;
  return (n: number): number => {
    const r = rng(`${label}:${i}`, cursor);
    cursor = r.next;
    return Math.floor(r.value * n);
  };
}

const KINDS = ['q', 'r', 'b', 'n', 'p'];

/** A legal position (kings only, neither side in check, Black can move) plus a short queue. */
export function makeCase(label: string, i: number): Case {
  const pick = stream(label, i);
  for (let attempt = 0; ; attempt++) {
    const sub = stream(`${label}/${attempt}`, i);
    const pieces: Record<Square, string> = {};
    const taken = new Set<number>();
    const place = (letter: string, pawn = false): void => {
      for (;;) {
        const sq = sub(64);
        if (taken.has(sq)) continue;
        if (pawn && (sq < 8 || sq >= 56)) continue;
        taken.add(sq);
        pieces[toSquare(sq)] = letter;
        return;
      }
    };
    place('K');
    place('k');
    const others = 2 + sub(7);
    for (let n = 0; n < others; n++) {
      const kind = KINDS[sub(KINDS.length)]!;
      const letter = sub(2) === 0 ? kind.toUpperCase() : kind;
      place(letter, kind === 'p');
    }
    const credits = 1 + pick(2);
    const stage = stageOf(pieces, {
      moveCredits: credits, enemyPolicy: { type: 'best_move', depth: 1 },
      turnsUsed: sub(6), turnLimit: 8,
    });
    const b = fromBoard(stage.board);
    if (inCheck(b, 'white') || inCheck(b, 'black') || legalMoves(b, 'black').length === 0) continue;
    const white = pseudoMoves(b, 'white');
    const queue: Action[] = [];
    const length = 1 + sub(2);
    for (let q = 0; q < length; q++) {
      if (sub(10) === 0 || white.length === 0) {
        queue.push({ type: 'MOVE', from: toSquare(sub(64)), to: toSquare(sub(64)) });
      } else {
        const m = white[sub(white.length)]!;
        queue.push({ type: 'MOVE', from: toSquare(m.from), to: toSquare(m.to) });
      }
    }
    return { run: runOf({ seed: `F${hash(label, i)}` }), stage, queue, credits };
  }
}
