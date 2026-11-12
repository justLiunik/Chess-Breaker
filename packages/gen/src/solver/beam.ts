import * as internal from '@checkbreaker/engine/internal';
import {
  applyEnemyTurn, enemyClock, enemyMove, hash, legalPlayerMoves, simulate, toIndex,
} from '@checkbreaker/engine';
import type { Action, BoardPiece, EnemyPick, RunState, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import type { SolveResult } from '../types';

const { applyPlayerMove, evaluate, fromBoard, hasBonusMove, tiersOf } = internal;

export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One MOVE action. */
const move = (from: string, to: string): Action => ({ type: 'MOVE', from, to });

/** A queue's text: each MOVE as `from+to`, joined by `,` (`b1c3,c3d5`). */
export function queueText(queue: Action[]): string {
  return queue.map((a) => (a.type === 'MOVE' ? `${a.from}${a.to}` : a.skillId)).join(',');
}

/**
 * The queues the solver tries on an Action-phase stage (§9.1: no skills), in a fixed order: for each
 * White piece in square-index order (a1 first), `[MOVE from→to]` for each `legalPlayerMoves` target and,
 * for a piece with a bonus move (the Legendary knight), `[MOVE from→to, MOVE to→c]` for each
 * `legalPlayerMoves` target c on the board after the first move. Targets are pseudo-legal: `simulate`
 * refuses the queues that leave the White King attacked.
 */
export function queuesOf(stage: StageState, config: GenConfig): Action[][] {
  const out: Action[][] = [];
  const squares = Object.keys(stage.board)
    .filter((sq) => stage.board[sq]!.color === 'white')
    .sort((a, b) => toIndex(a) - toIndex(b));
  for (const from of squares) {
    const bonus = hasBonusMove(stage.board[from]!, config);
    for (const to of legalPlayerMoves(stage, from, config)) {
      out.push([move(from, to)]);
      if (!bonus) continue;
      const mid: StageState = { ...stage, board: applyPlayerMove(stage.board, from, to, config).board };
      for (const c of legalPlayerMoves(mid, to, config)) out.push([move(from, to), move(to, c)]);
    }
  }
  return out;
}

const LETTER: Record<BoardPiece['pieceType'], string> = {
  pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k',
};

/**
 * The position key: the board sorted by square name, each piece with its colour, type (and
 * transformed type) and rarity, plus `turnsUsed`, the policy's `cursor` and `fellBack`, the enemy
 * clock and the live modifiers. It covers everything `enemyMove` reads (codes and tiers come from
 * colour, type and rarity; the stage seed and the policy's other fields are fixed within a solve), so
 * it keys the reply memo. That holds under two assumptions: solver boards carry no skills or
 * modifiers on pieces (so piece ids, which `enemyMove` reads through `frozenMask`, are not needed),
 * and every White non-pawn piece is a Hero piece (so tiers follow from colour, type and rarity). A
 * future skill-aware solver must extend the key; and two states with one key have the same future within the par, so it
 * deduplicates the beam.
 */
export function positionKey(run: RunState, stage: StageState, config: GenConfig): string {
  const parts: string[] = [];
  for (const sq of Object.keys(stage.board).sort(byText)) {
    const p = stage.board[sq]!;
    const letter = LETTER[p.pieceType];
    parts.push(
      `${sq}${p.color === 'white' ? letter.toUpperCase() : letter}${p.rarity?.[0] ?? ''}`
      + `${p.transformed ? `>${LETTER[p.transformed.pieceType]}` : ''}`,
    );
  }
  const policy = stage.enemyPolicy;
  return [
    parts.join(','), stage.turnsUsed, policy.cursor ?? '', policy.fellBack ? 1 : 0,
    enemyClock(run, stage, config), JSON.stringify(stage.modifiers),
  ].join('|');
}

type Stats = SolveResult['stats'];

/** The bookkeeping of one `solveStage` call: the reply memo, the counters, and which phase the nodes go to. */
export type Search = {
  config: GenConfig;
  /** Enemy picks by position key; null when `memoizeEnemyReplies` is off. */
  memo: Map<string, EnemyPick> | null;
  stats: Stats;
  phase: 'screenNodes' | 'deepNodes';
};

export function newSearch(config: GenConfig): Search {
  return {
    config,
    memo: config.gen.solver.memoizeEnemyReplies ? new Map() : null,
    stats: { screenNodes: 0, deepNodes: 0, deployments: 0, enemyCalls: 0, memoHits: 0, replayFailures: 0 },
    phase: 'screenNodes',
  };
}

/**
 * The enemy's pick on `stage` (after the player's queue), exactly as `commitQueue` computes it:
 * `enemyMove(stage, hash(stageSeed, turnsUsed), enemyClock(run, stage), config)`. Each call is one
 * node, whether computed or read from the memo; null when the node budget is already spent.
 */
function reply(search: Search, run: RunState, stage: StageState, key: string): EnemyPick | null {
  const { config, stats } = search;
  if (stats.screenNodes + stats.deepNodes >= config.gen.solver.nodeBudget) return null;
  stats[search.phase]++;
  const hit = search.memo?.get(key);
  if (hit !== undefined) {
    stats.memoHits++;
    return hit;
  }
  stats.enemyCalls++;
  const pick = enemyMove(stage, hash(stage.stageSeed, stage.turnsUsed), enemyClock(run, stage, config), config);
  search.memo?.set(key, pick);
  return pick;
}

/**
 * A beam state: an active Action-phase stage at the start of a player turn, the line that reached
 * it, the line's text (queue texts joined by a space) and the score that kept it (−Infinity at the start).
 */
export type BeamState = { run: RunState; stage: StageState; line: Action[][]; text: string; score: number };

export type BeamResult =
  | { kind: 'win'; line: Action[][]; mateTurn: number }
  | { kind: 'out_of_budget' }
  /** No win within the turns; `best` is the best score of any state the beam kept (−Infinity if none). */
  | { kind: 'done'; best: number };

type Step = Exclude<BeamResult, { kind: 'done' }> | { kind: 'next'; beam: BeamState[] };
type Child = BeamState & { key: string };

/** −evaluate (the enemy's static score, so higher is better for the player), with White's tiers. */
const scoreOf = (stage: StageState, config: GenConfig): number =>
  -evaluate(fromBoard(stage.board), config, tiersOf(stage.board));

/** Sorts best score first, ties by the line's text. */
const byScore = (a: BeamState, b: BeamState): number => b.score - a.score || byText(a.text, b.text);

/** One player turn of the beam, §9.3 steps 1-7, from every state of `beam` (all on the same turn). */
function step(search: Search, beam: BeamState[], width: number): Step {
  const { config } = search;
  const { minSolveTurns, expansion } = config.gen.solver;
  const children = new Map<string, Child>();
  for (const s of beam) {
    for (const q of queuesOf(s.stage, config)) {
      // 1. Simulate the queue; a queue the engine refuses is dropped.
      const sim = simulate(s.run, s.stage, q, config);
      if (!sim.ok) continue;
      const next = sim.value.stage;
      // 2. A win on turn minSolveTurns or later ends the search. An earlier win is no proof: it is
      //    ignored and the search goes on from the same beam. A loss (stalemating the enemy) is dropped.
      if (next.status === 'won') {
        if (next.turnsUsed >= minSolveTurns) return { kind: 'win', line: [...s.line, q], mateTurn: next.turnsUsed };
        continue;
      }
      if (next.status !== 'active') continue;
      // 3. On the last turn of the par only wins count: no reply is needed.
      if (next.turnsUsed >= next.mateIn) continue;
      // 4. Deduplicate by position, keeping the line with the smaller text.
      const text = s.text === '' ? queueText(q) : `${s.text} ${queueText(q)}`;
      const key = positionKey(sim.value.run, next, config);
      const prev = children.get(key);
      if (prev !== undefined && byText(prev.text, text) <= 0) continue;
      children.set(key, { run: sim.value.run, stage: next, line: [...s.line, q], text, score: 0, key });
    }
  }
  // 4. Score the distinct positions by −evaluate.
  const ranked = [...children.values()];
  for (const c of ranked) c.score = scoreOf(c.stage, config);
  ranked.sort(byScore);
  // 5. The top width × expansion get the enemy's reply (memoized by position), as commitQueue applies it,
  //    lazily in rank order: step 7 keeps the top `width` survivors by this same pre-reply rank, so once
  //    `width` have survived, no further reply can change the kept beam and none is needed (§9.4 counts
  //    only replies needed). A child dropped at step 6 lets the next one in order be tried.
  const kept: BeamState[] = [];
  for (const c of ranked.slice(0, width * expansion)) {
    if (kept.length >= width) break;
    const pick = reply(search, c.run, c.stage, c.key);
    if (pick === null) return { kind: 'out_of_budget' };
    const after = applyEnemyTurn(c.run, c.stage, pick, config);
    if (!after.ok) throw new Error(`solveStage: applyEnemyTurn refused: ${JSON.stringify(after.error)}`);
    // 6. A reply that leaves the player no legal queue ends the stage: dropped.
    if (after.value.stage.status !== 'active') continue;
    kept.push({ run: after.value.run, stage: after.value.stage, line: c.line, text: c.text, score: c.score });
  }
  // 7. The top width are kept (`kept` is already in score order and holds at most `width`).
  return { kind: 'next', beam: kept };
}

/**
 * Runs a beam of `width` from `start` for up to `turns` player turns: a win (on turn
 * `minSolveTurns` or later), the budget running out, or `done` with the best score the beam kept.
 */
export function runBeam(search: Search, start: BeamState, turns: number, width: number): BeamResult {
  let beam = [start];
  let best = -Infinity;
  for (let i = 0; i < turns && beam.length > 0; i++) {
    const r = step(search, beam, width);
    if (r.kind !== 'next') return r;
    beam = r.beam;
    for (const s of beam) if (s.score > best) best = s.score;
  }
  return { kind: 'done', best };
}
