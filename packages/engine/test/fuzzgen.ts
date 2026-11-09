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
const LAUNCH_SKILLS = ['twin_step', 'ascension', 'lockdown'];

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
      const kind = sub(5) === 0 ? 'b' : KINDS[sub(KINDS.length)]!;
      const letter = sub(2) === 0 ? kind.toUpperCase() : kind;
      place(letter, kind === 'p');
    }
    const credits = 1 + pick(2);
    const stage = stageOf(pieces, {
      moveCredits: credits, focus: sub(6) === 0 ? 0 : 1 + sub(3), focusPool: 3, enemyPolicy: { type: 'best_move', depth: 1 },
      turnsUsed: sub(6), turnLimit: 8,
    });
    const b = fromBoard(stage.board);
    if (inCheck(b, 'white') || inCheck(b, 'black') || legalMoves(b, 'black').length === 0) continue;
    const white = pseudoMoves(b, 'white');
    const queue: Action[] = [];
    const length = 1 + sub(3);
    // Random loadout of the launch skills, with random charges (0 sometimes).
    const loadout = LAUNCH_SKILLS.filter(() => sub(4) > 0)
      .map((skillId) => ({ skillId, charges: sub(6) === 0 ? 0 : 1 + sub(2), chargesMax: 3 }));
    const occupied = Object.keys(stage.board);
    for (let q = 0; q < length; q++) {
      if (sub(q === 0 ? 2 : 4) === 0) {
        // A skill: mostly from the loadout (or a stranger), a target that is usually a real piece.
        const skillId = sub(8) === 0 ? ['gallop', 'nonsense'][sub(2)]! : LAUNCH_SKILLS[sub(3)]!;
        // Usually the kind of piece the skill wants; sometimes any piece or a random square.
        const wanted = Object.entries(stage.board).filter(([, p]) =>
          skillId === 'ascension' ? p.color === 'white' && p.pieceType === 'bishop' : p.color === 'black')
          .map(([sq]) => sq);
        const roll = sub(8);
        const target = skillId === 'twin_step' && roll > 0 ? undefined
          : roll === 0 ? toSquare(sub(64))
          : roll === 1 ? occupied[sub(occupied.length)]!
          : wanted.length > 0 ? wanted[sub(wanted.length)]! : undefined;
        queue.push({ type: 'ACTIVATE_SKILL', skillId, ...(target !== undefined && { target }) });
      } else if (sub(10) === 0 || white.length === 0) {
        queue.push({ type: 'MOVE', from: toSquare(sub(64)), to: toSquare(sub(64)) });
      } else {
        const m = white[sub(white.length)]!;
        queue.push({ type: 'MOVE', from: toSquare(m.from), to: toSquare(m.to) });
      }
    }
    return { run: runOf({ seed: `F${hash(label, i)}`, loadout }), stage, queue, credits };
  }
}
