import * as internal from '@checkbreaker/engine/internal';
import {
  applyEnemyTurn, enemyClock, enemyMove, hash, legalPlayerMoves, simulate, startStage, toIndex,
} from '@checkbreaker/engine';
import type { Action, EnemyPick, RunState, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import type { Placement } from '../../src/types';

const { applyPlayerMove, fromBoard, hasBonusMove, tiersOf } = internal;

/** Which queues the oracle may play besides single MOVEs of non-pawns and non-promoting pawns. */
export type BruteOpts = {
  /** Also the two-move queues of a piece with a bonus move (the Legendary knight). */
  bonus: boolean;
  /** Also every queue that moves a White pawn to rank 8 (where it vanishes and promotes into the deck). */
  pawnToRank8: boolean;
};

export type BruteStats = {
  /** `simulate` calls. */
  simulated: number;
  /** Enemy replies computed by `enemyMove`. */
  enemyCalls: number;
  /** Enemy replies read from the memo. */
  memoHits: number;
  /** Queues skipped because an earlier queue of the same node reached the same state. */
  duplicates: number;
  /** Subtrees skipped because the same state already failed at the same target turn. */
  failHits: number;
};

export type BruteResult = { mate: { turn: number; line: Action[][] } | null; stats: BruteStats };

/**
 * A scan-only pruning of the queue set: `bruteSearch` plays a queue on turn `turn` of the iteration
 * for mating turn `target` only if this returns true. It must depend on nothing else, so the
 * transposition skips stay sound. `bruteMate` never passes one.
 */
export type BruteFilter = (stage: StageState, queue: Action[], turn: number, target: number) => boolean;

/** One MOVE action. */
const move = (from: string, to: string): Action => ({ type: 'MOVE', from, to });

/** The engine's own test for a MOVE whose pawn vanishes on rank 8 (`playMove` in queue.ts). */
const promotes = (stage: StageState, from: string, to: string): boolean => {
  const mover = stage.board[from];
  return mover !== undefined && mover.pieceType === 'pawn' && mover.color === 'white' && to.endsWith('8');
};

/**
 * Every queue the oracle tries on `stage` (Action phase, no skills), in a fixed order: for each White
 * piece in square-index order (a1 first), `[MOVE from→to]` for each `legalPlayerMoves` target, and, when
 * `opts.bonus` and the piece has a bonus move, `[MOVE from→to, MOVE to→c]` for each `legalPlayerMoves`
 * target c on the board after the first move. Targets are pseudo-legal; `simulate` refuses the queues
 * that end with the White King attacked. With `opts.pawnToRank8` false, no queue moves a pawn to rank 8.
 * Without skills the engine accepts no other queue: there is one move credit per turn, and only a
 * bonus-move piece's own paid MOVE earns a free MOVE, by that piece, once.
 */
export function bruteQueues(stage: StageState, opts: BruteOpts, config: GenConfig): Action[][] {
  const out: Action[][] = [];
  const squares = Object.keys(stage.board)
    .filter((sq) => stage.board[sq]!.color === 'white')
    .sort((a, b) => toIndex(a) - toIndex(b));
  for (const from of squares) {
    const piece = stage.board[from]!;
    const bonus = opts.bonus && hasBonusMove(piece, config);
    for (const to of legalPlayerMoves(stage, from, config)) {
      if (!opts.pawnToRank8 && promotes(stage, from, to)) continue;
      out.push([move(from, to)]);
      if (!bonus) continue;
      const mid: StageState = { ...stage, board: applyPlayerMove(stage.board, from, to, config).board };
      for (const c of legalPlayerMoves(mid, to, config)) {
        if (!opts.pawnToRank8 && promotes(mid, to, c)) continue; // never true: a bonus-move piece is no pawn
        out.push([move(from, to), move(to, c)]);
      }
    }
  }
  return out;
}

/** One character per square: the piece code (-6..6) and White's tier (0..3), as `enemyMove` reads them. */
function boardKey(stage: StageState): string {
  const b = fromBoard(stage.board);
  const t = tiersOf(stage.board);
  let s = '';
  for (let i = 0; i < 64; i++) s += String.fromCharCode(65 + (b[i]! + 6) * 4 + t[i]!);
  return s;
}

/**
 * The key of everything `enemyMove` reads: the board's codes and tiers, the policy (scripted cursor,
 * fallback), the live modifiers (Lockdown's frozen pieces; always empty here, as the oracle plays no
 * skills), the seed's `turnsUsed` (the stage seed is fixed within one search) and the clock
 * `enemyClock` gives.
 */
function replyKey(run: RunState, stage: StageState, config: GenConfig): string {
  return [
    boardKey(stage), stage.turnsUsed, enemyClock(run, stage, config),
    JSON.stringify(stage.enemyPolicy), JSON.stringify(stage.modifiers),
  ].join('|');
}

/**
 * The key of a whole Action-phase state for the rest of the search: the reply key plus the run's
 * coins and the overtime paid (past the par, the clock and the out-of-coins loss read them). Instance
 * ids, the deck and the events do not change what can happen next: moves, bonus moves and the
 * enemy's search read only codes and tiers.
 */
function stateKey(run: RunState, stage: StageState, config: GenConfig): string {
  return `${replyKey(run, stage, config)}|${run.coins}|${stage.overtimePaid}|${stage.status}`;
}

/**
 * The exhaustive search behind `bruteMate`, with its line and counters. Iterative deepening on the
 * mating turn, from `minSolveTurns` to `maxTurns`: at target T, every line of `bruteQueues` queues is
 * played to turn T, each queue through `simulate` and, on the turns before T, followed by the enemy's
 * reply exactly as `commitQueue` computes it (`enemyMove` with `hash(stageSeed, turnsUsed)` and
 * `enemyClock`, then `applyEnemyTurn`), the pick memoized by `replyKey`. Turn T gets no reply: only a
 * mate there counts.
 * A mate before `minSolveTurns` ends its line unproven (the stage is over). Two queues of one node that
 * reach the same `stateKey` share a subtree, and a state that failed at T is not searched again at T.
 * With `filter`, only the queues it keeps are played (a pruned search: the freeze script's pre-check).
 */
export function bruteSearch(
  run: RunState,
  stage: StageState,
  placements: Placement[],
  maxTurns: number,
  opts: BruteOpts,
  config: GenConfig,
  filter?: BruteFilter,
): BruteResult {
  const started = startStage(run, stage, placements, config);
  if (!started.ok) throw new Error(`bruteMate: startStage refused: ${JSON.stringify(started.error)}`);
  const stats: BruteStats = { simulated: 0, enemyCalls: 0, memoHits: 0, duplicates: 0, failHits: 0 };
  const replies = new Map<string, EnemyPick>();
  const failed = new Set<string>();

  const reply = (r: RunState, s: StageState): EnemyPick => {
    const key = replyKey(r, s, config);
    const hit = replies.get(key);
    if (hit !== undefined) {
      stats.memoHits++;
      return hit;
    }
    stats.enemyCalls++;
    const pick = enemyMove(s, hash(s.stageSeed, s.turnsUsed), enemyClock(r, s, config), config);
    replies.set(key, pick);
    return pick;
  };

  /** A line from this turn that mates exactly on turn `target`, or null. */
  const search = (r: RunState, s: StageState, target: number): Action[][] | null => {
    const memoKey = `${target}|${stateKey(r, s, config)}`;
    if (failed.has(memoKey)) {
      stats.failHits++;
      return null;
    }
    const turn = s.turnsUsed + 1;
    const seen = new Set<string>();
    for (const q of bruteQueues(s, opts, config)) {
      if (filter !== undefined && !filter(s, q, turn, target)) continue;
      stats.simulated++;
      const sim = simulate(r, s, q, config);
      if (!sim.ok) continue;
      const next = sim.value.stage;
      // Earlier iterations found no mate before `target`, and a mate before minSolveTurns proves nothing.
      if (next.status === 'won') {
        if (turn === target) return [q];
        continue;
      }
      if (next.status !== 'active' || turn === target) continue;
      const key = stateKey(sim.value.run, next, config);
      if (seen.has(key)) {
        stats.duplicates++;
        continue;
      }
      seen.add(key);
      const after = applyEnemyTurn(sim.value.run, next, reply(sim.value.run, next), config);
      if (!after.ok) throw new Error(`bruteMate: applyEnemyTurn refused: ${JSON.stringify(after.error)}`);
      if (after.value.stage.status !== 'active') continue;
      const rest = search(after.value.run, after.value.stage, target);
      if (rest !== null) return [q, ...rest];
    }
    failed.add(memoKey);
    return null;
  };

  for (let target = config.gen.solver.minSolveTurns; target <= maxTurns; target++) {
    const line = search(started.value.run, started.value.stage, target);
    if (line !== null) return { mate: { turn: target, line }, stats };
  }
  return { mate: null, stats };
}

/**
 * The brute-force mate oracle: the shortest turn ≥ `minSolveTurns` (and ≤ `maxTurns`) on which some
 * line of queues mates after deploying `placements`, against the enemy `commitQueue` plays; null when
 * none does. The queues are every single MOVE, plus the bonus-move piece's two-move queues when
 * `opts.bonus`; with `opts.pawnToRank8` false, no queue moves a pawn to rank 8. No skills.
 */
export function bruteMate(
  run: RunState,
  stage: StageState,
  placements: Placement[],
  maxTurns: number,
  opts: BruteOpts,
  config: GenConfig,
): number | null {
  return bruteSearch(run, stage, placements, maxTurns, opts, config).mate?.turn ?? null;
}
