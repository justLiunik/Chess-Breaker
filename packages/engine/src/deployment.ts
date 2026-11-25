import { abilityAttacked, markAbilityAttacks, spawnCostOf } from './abilities';
import { KING, PAWN, fromBoard, tiersOf } from './position';
import { inCheck } from './legality';
import { attackedBy } from './movegen';
import { isSquare, toSquare } from './square';
import type {
  BoardPiece, CommitError, EngineConfig, GameEvent, PieceInstance, Result, RunState, Square, StageState,
} from './types';

const refuse = (error: CommitError): Result<never, CommitError> => ({ ok: false, error });

/** A deck instance with the square it is to be placed on. */
export type Placed = { instance: PieceInstance; to: Square };

/**
 * One placement's own checks, in `startStage`'s order: not_in_deck, duplicate, durability,
 * outside_zone, occupied. `taken` (squares in use) and `seen` (instances placed) are the state so
 * far; a placement that passes is added to both. Shared with `deploymentStatus` (view.ts) so the
 * preview and START cannot disagree.
 */
export function checkPlacement(
  run: RunState, taken: Set<Square>, seen: Set<string>, instanceId: string, to: Square, config: EngineConfig,
): Result<PieceInstance, CommitError> {
  const instance = run.deck.find((p) => p.instanceId === instanceId);
  if (!instance || instance.status !== 'in_deck') {
    return refuse({ kind: 'invalid_deployment', to, reason: 'not_in_deck' });
  }
  if (seen.has(instanceId)) return refuse({ kind: 'invalid_deployment', to, reason: 'duplicate' });
  seen.add(instanceId);
  if (instance.pieceType !== 'king' && (instance.durability ?? 0) < 1) {
    return refuse({ kind: 'durability_unavailable', instanceId });
  }
  if (!isSquare(to) || !config.rules.deploymentRanks.includes(Number(to[1]))) {
    return refuse({ kind: 'invalid_deployment', to, reason: 'outside_zone' });
  }
  if (taken.has(to)) return refuse({ kind: 'invalid_deployment', to, reason: 'occupied' });
  taken.add(to);
  return { ok: true, value: instance };
}

/** The spawn points `placed` costs: the King is free. */
export function spawnCostOfPlaced(placed: Placed[], config: EngineConfig): number {
  let cost = 0;
  for (const { instance } of placed) {
    if (instance.pieceType !== 'king') {
      cost += spawnCostOf(instance.pieceType, instance.rarity ?? 'normal', config);
    }
  }
  return cost;
}

/** The stage board with `placed` summoned onto it. */
export function boardWith(stage: StageState, placed: Placed[]): Record<Square, BoardPiece> {
  const board: Record<Square, BoardPiece> = { ...stage.board };
  for (const { instance, to } of placed) {
    board[to] = instance.pieceType === 'king'
      ? { pieceType: 'king', color: 'white', instanceId: instance.instanceId }
      : { pieceType: instance.pieceType, color: 'white', instanceId: instance.instanceId, rarity: instance.rarity ?? 'normal' };
  }
  return board;
}

/**
 * The square of a White piece giving check to the Black King on `board`, or null when none does (I16).
 * Judged as the engine judges Black's check, with rarity abilities (`abilityAttacked`). With several
 * checkers the answer is the first in square order (lowest index: a1, b1 ... h8). Each White piece is
 * tested on the real board for what `abilityAttacked` counts for it: its plain attack, the other White
 * pieces left as blockers only, and for a tiered piece its ability attacks (`markAbilityAttacks`, which
 * passes allies it may leap: a Unique bishop checks through its own pawn). So the named square always
 * holds a real checker; the fallback to the first White piece cannot be reached.
 */
export function startCheckSquare(board: Record<Square, BoardPiece>, config: EngineConfig): Square | null {
  const b = fromBoard(board);
  const t = tiersOf(board);
  const k = b.indexOf(-KING);
  if (k < 0 || !abilityAttacked(b, t, k, config.abilities)) return null;
  const whites: number[] = [];
  for (let i = 0; i < 64; i++) if (b[i]! > 0) whites.push(i);
  const marks = new Uint8Array(64);
  for (const i of whites) {
    if (t[i]! > 0) {
      marks.fill(0);
      if (markAbilityAttacks(b, t, i, config.abilities, marks) && marks[k] === 1) return toSquare(i);
    }
    const alone = b.slice();
    for (const j of whites) if (j !== i) alone[j] = -PAWN; // a blocker, never an attacker of the King
    if (attackedBy(alone, k, 1)) return toSquare(i);
  }
  return toSquare(whites[0]!);
}

/** Whether `placed` summons more queens than `config.deployment.maxQueenSummons` allows. */
export function queenLimitExceeded(placed: Placed[], config: EngineConfig): boolean {
  return placed.filter((p) => p.instance.pieceType === 'queen').length > config.deployment.maxQueenSummons;
}

/**
 * The Deployment phase: place Hero Pieces from the deck, pay their durability, start the Action phase.
 * Every check runs before any change, so a refusal spends nothing (spec §7.2). The loadout is left
 * as it is: skills are single use, and nothing refills them (M4).
 */
export function startStage(
  run: RunState,
  stage: StageState,
  placements: { instanceId: string; to: Square }[],
  config: EngineConfig,
): Result<{ run: RunState; stage: StageState; events: GameEvent[] }, CommitError> {
  if (stage.status !== 'active') return refuse({ kind: 'stage_not_active' });
  if (stage.phase !== 'deployment') return refuse({ kind: 'wrong_phase', expected: 'deployment' });

  const taken = new Set<Square>(Object.keys(stage.board));
  const seen = new Set<string>();
  const placed: Placed[] = [];
  for (const { instanceId, to } of placements) {
    const checked = checkPlacement(run, taken, seen, instanceId, to, config);
    if (!checked.ok) return refuse(checked.error);
    placed.push({ instance: checked.value, to });
  }

  const kings = placed.filter((p) => p.instance.pieceType === 'king');
  if (kings.length !== 1) {
    // `to` is the first placement's square, or '' when there are no placements.
    return refuse({ kind: 'invalid_deployment', to: placements[0]?.to ?? '', reason: 'king_missing' });
  }

  const cost = spawnCostOfPlaced(placed, config);
  if (cost > stage.spawnPoints) {
    return refuse({ kind: 'spawn_points_exceeded', budget: stage.spawnPoints, cost });
  }

  if (queenLimitExceeded(placed, config)) {
    // `to` is the first queen over the limit, in placement order.
    const queens = placed.filter((p) => p.instance.pieceType === 'queen');
    return refuse({ kind: 'invalid_deployment', to: queens[config.deployment.maxQueenSummons]!.to, reason: 'queen_limit' });
  }

  const board = boardWith(stage, placed);
  if (inCheck(fromBoard(board), 'white')) {
    return refuse({ kind: 'invalid_deployment', to: kings[0]!.to, reason: 'king_in_check' });
  }
  const checker = startCheckSquare(board, config);
  if (checker !== null) return refuse({ kind: 'invalid_deployment', to: checker, reason: 'gives_check' });

  const deck = run.deck.map((p): PieceInstance => {
    if (!seen.has(p.instanceId)) return p;
    if (p.pieceType === 'king') return { ...p, status: 'deployed' };
    const durability = (p.durability ?? 0) - config.rules.summonCostsDurability;
    return { ...p, durability, status: durability <= 0 ? 'spent' : 'deployed' };
  });
  const events: GameEvent[] = placed.map(({ instance, to }) => ({
    type: 'piece_summoned', instanceId: instance.instanceId, square: to,
  }));
  events.push({ type: 'stage_started' });
  return {
    ok: true,
    value: {
      run: { ...run, deck },
      stage: {
        ...stage, board, phase: 'action', moveCredits: config.rules.freeMovesPerTurn,
        focus: stage.focusPool, skillLog: [],
      },
      events,
    },
  };
}
