import { spawnCostOf } from './abilities';
import {
  boardWith, checkPlacement, spawnCostOfPlaced, type Placed,
} from './deployment';
import { inCheck } from './legality';
import { interestOf, pendingBase, stageEconomy } from './economy';
import { beginQueue, resolveStep } from './queue';
import { simulate } from './rules';
import { DIAG_R, KING_T, KNIGHT_T, ORTHO_R } from './movegen';
import { BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, fromBoard } from './position';
import { toSquare } from './square';
import type { Action, Award, CommitError, EngineConfig, GameEvent, RunState, Square, StageState } from './types';

/**
 * Read-only answers for the UI (M5 §7.3), so that it computes no rules itself. Pure; they never
 * throw on player-shaped input.
 */

/**
 * For every square, the Black pieces attacking it, by the attack rule `inCheck` uses (a pawn's
 * diagonals, whatever stands there; a slider up to and including the first piece, defended ones
 * too). Only squares with an attacker have an entry; attackers are listed by square index.
 * Rarity abilities are White's: they widen what White attacks and never what Black does, so the
 * same rule holds on a rarity board.
 */
export function threatMap(
  _run: RunState, stage: StageState, _config: EngineConfig,
): Record<Square, { attackers: Square[] }> {
  const b = fromBoard(stage.board);
  const out: Record<Square, { attackers: Square[] }> = {};
  const mark = (to: number, from: number): void => {
    const sq = toSquare(to);
    (out[sq] ??= { attackers: [] }).attackers.push(toSquare(from));
  };
  for (let from = 0; from < 64; from++) {
    const code = -b[from]!;
    if (code <= 0) continue;
    if (code === PAWN) {
      const f = from & 7;
      if (from >= 8) {
        if (f > 0) mark(from - 9, from);
        if (f < 7) mark(from - 7, from);
      }
    } else if (code === KNIGHT || code === KING) {
      for (const to of (code === KNIGHT ? KNIGHT_T : KING_T)[from]!) mark(to, from);
    } else {
      const sets = code === BISHOP ? [DIAG_R[from]!] : code === ROOK ? [ORTHO_R[from]!] : code === QUEEN ? [DIAG_R[from]!, ORTHO_R[from]!] : [];
      for (const set of sets) {
        for (const ray of set) {
          for (const to of ray) {
            mark(to, from);
            if (b[to] !== 0) break;
          }
        }
      }
    }
  }
  return out;
}

export type DropRefusal =
  | 'occupied' | 'outside_zone' | 'king_in_check' | 'not_in_deck' | 'duplicate' | 'spawn_points_exceeded';

export type DeploymentStatus = {
  spawnUsed: number;
  spawnBudget: number;
  startCost: { instanceId: string; from: number; to: number }[];
  tray: Record<string, { placeable: boolean; reason?: 'spent' | 'too_expensive' | 'placed' }>;
  drop(instanceId: string, to: Square): { ok: true } | { ok: false; reason: DropRefusal };
};

/**
 * The Deployment screen's answers for the placements made so far: spawn points used, what START
 * will charge, which tray pieces can still be placed, and whether a piece may be dropped on a
 * square. It runs `startStage`'s own per-placement and cost checks (`checkPlacement`,
 * `spawnCostOfPlaced`), so it cannot disagree with START. Placements that fail those checks are
 * ignored. `drop` judges the new placement after the existing ones; a King's check is judged on the
 * board so far, so drop the King after its blockers (a non-King never changes it for the worse).
 */
export function deploymentStatus(
  run: RunState, stage: StageState, placements: { instanceId: string; to: Square }[], config: EngineConfig,
): DeploymentStatus {
  const taken = new Set<Square>(Object.keys(stage.board));
  const seen = new Set<string>();
  const placed: Placed[] = [];
  for (const { instanceId, to } of placements) {
    const r = checkPlacement(run, taken, seen, instanceId, to, config);
    if (r.ok) placed.push({ instance: r.value, to });
  }
  const spawnUsed = spawnCostOfPlaced(placed, config);
  const startCost = placed.filter((p) => p.instance.pieceType !== 'king').map((p) => {
    const from = p.instance.durability ?? 0;
    return { instanceId: p.instance.instanceId, from, to: from - config.rules.summonCostsDurability };
  });

  const remaining = stage.spawnPoints - spawnUsed;
  const tray: DeploymentStatus['tray'] = {};
  for (const inst of run.deck) {
    if (placed.some((p) => p.instance.instanceId === inst.instanceId)) {
      tray[inst.instanceId] = { placeable: false, reason: 'placed' };
    } else if (inst.status !== 'in_deck' || (inst.pieceType !== 'king' && (inst.durability ?? 0) < 1)) {
      tray[inst.instanceId] = { placeable: false, reason: 'spent' };
    } else if (inst.pieceType !== 'king' && spawnCostOf(inst.pieceType, inst.rarity ?? 'normal', config) > remaining) {
      tray[inst.instanceId] = { placeable: false, reason: 'too_expensive' };
    } else {
      tray[inst.instanceId] = { placeable: true };
    }
  }

  const drop: DeploymentStatus['drop'] = (instanceId, to) => {
    const t = new Set(taken);
    const s = new Set(seen);
    const r = checkPlacement(run, t, s, instanceId, to, config);
    if (!r.ok) {
      const e = r.error;
      return { ok: false, reason: e.kind === 'invalid_deployment' && e.reason !== 'king_missing' && e.reason !== 'king_in_check'
        ? e.reason : 'not_in_deck' };
    }
    const next = [...placed, { instance: r.value, to }];
    if (spawnCostOfPlaced(next, config) > stage.spawnPoints) return { ok: false, reason: 'spawn_points_exceeded' };
    if (r.value.pieceType === 'king' && inCheck(fromBoard(boardWith(stage, next)), 'white')) {
      return { ok: false, reason: 'king_in_check' };
    }
    return { ok: true };
  };

  return { spawnUsed, spawnBudget: stage.spawnPoints, startCost, tray, drop };
}

/**
 * The queue entry by entry, for the planner. `steps[i].stage` is the stage after entry `i` (board,
 * focus, credits, modifiers, skill log), so `legalPlayerMoves` can be asked of it; an entry after
 * the first refused one is `ok: false` and carries the last good stage. The verdict (`error` for a
 * refused queue, `result` for an accepted one) is `simulate`'s own, so preview and commit cannot
 * disagree (I10): a queue can resolve in every step and still be refused at its end (check) or for
 * lacking a move.
 */
export function previewSteps(
  run: RunState, stage: StageState, queue: Action[], config: EngineConfig,
): {
  steps: { stage: StageState; ok: boolean }[];
  error: CommitError | null;
  result: { run: RunState; stage: StageState; events: GameEvent[]; award: Award | null } | null;
} {
  const steps: { stage: StageState; ok: boolean }[] = [];
  const begun = beginQueue(run, stage);
  let r = begun.ok ? begun.value : null;
  let shown = stage;
  for (const action of queue) {
    const next = r === null ? null : resolveStep(r, action, config);
    if (next !== null && next.ok) {
      r = next.value;
      const { ctx } = r;
      shown = { ...stage, board: ctx.board, focus: ctx.focus, moveCredits: ctx.moveCredits, modifiers: ctx.modifiers, skillLog: ctx.skillLog };
      steps.push({ stage: shown, ok: true });
    } else {
      r = null;
      steps.push({ stage: shown, ok: false });
    }
  }
  const sim = simulate(run, stage, queue, config);
  return sim.ok ? { steps, error: null, result: sim.value } : { steps, error: sim.error, result: null };
}

/**
 * The HUD's coin figures, from the economy functions `simulate` uses. `freeTurnsLeft` counts the
 * turns still inside the par, this one included. `*IfMateNow` are for a mate on this turn, with
 * interest on the current wallet (no salvage from the plan); when the queue mates, show
 * `previewSteps(...).result.award.coins` instead. `nextTurnPotential` is what a mate on the next
 * turn would pay: the next turn's overtime bill (reward first, then wallet) is taken off, and 0
 * when the wallet cannot cover it (the stage would be lost).
 */
export function hudEconomy(
  run: RunState, stage: StageState, config: EngineConfig,
): {
  mateIn: number; turn: number; freeTurnsLeft: number; lastParTurn: boolean; overtimeCost: number;
  pendingBase: number; parBonusIfMateNow: number; interestIfMateNow: number; nextTurnPotential: number;
} {
  const { parBonusFull, overtimeCost } = stageEconomy(run, config);
  const turn = stage.turnsUsed + 1;
  const pending = pendingBase(run, stage, config);
  const interest = interestOf(run.coins, config);
  let nextTurnPotential: number;
  if (turn + 1 <= stage.mateIn) {
    nextTurnPotential = pending + parBonusFull + interest;
  } else {
    const fromReward = Math.min(overtimeCost, pending);
    const fromWallet = overtimeCost - fromReward;
    nextTurnPotential = run.coins < fromWallet ? 0 : pending - fromReward + interestOf(run.coins - fromWallet, config);
  }
  return {
    mateIn: stage.mateIn,
    turn,
    freeTurnsLeft: Math.max(0, stage.mateIn - stage.turnsUsed),
    lastParTurn: turn === stage.mateIn,
    overtimeCost,
    pendingBase: pending,
    parBonusIfMateNow: turn <= stage.mateIn ? parBonusFull : 0,
    interestIfMateNow: interest,
    nextTurnPotential,
  };
}
