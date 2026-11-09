import { spawnCostOf } from './abilities';
import { fromBoard } from './position';
import { inCheck } from './legality';
import { isSquare } from './square';
import type {
  BoardPiece, CommitError, EngineConfig, GameEvent, PieceInstance, Result, RunState, Square, StageState,
} from './types';

const refuse = (error: CommitError): Result<never, CommitError> => ({ ok: false, error });

/**
 * The Deployment phase: place Hero Pieces from the deck, pay their durability, start the Action phase.
 * Every check runs before any change, so a refusal spends nothing (spec §7.2).
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
  const placed: { instance: PieceInstance; to: Square }[] = [];
  for (const { instanceId, to } of placements) {
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
    placed.push({ instance, to });
  }

  const kings = placed.filter((p) => p.instance.pieceType === 'king');
  if (kings.length !== 1) {
    // `to` is the first placement's square, or '' when there are no placements.
    return refuse({ kind: 'invalid_deployment', to: placements[0]?.to ?? '', reason: 'king_missing' });
  }

  let cost = 0;
  for (const { instance } of placed) {
    if (instance.pieceType !== 'king') {
      cost += spawnCostOf(config, instance.pieceType, instance.rarity ?? 'normal');
    }
  }
  if (cost > stage.spawnPoints) {
    return refuse({ kind: 'spawn_points_exceeded', budget: stage.spawnPoints, cost });
  }

  const board: Record<Square, BoardPiece> = { ...stage.board };
  for (const { instance, to } of placed) {
    board[to] = instance.pieceType === 'king'
      ? { pieceType: 'king', color: 'white', instanceId: instance.instanceId }
      : { pieceType: instance.pieceType, color: 'white', instanceId: instance.instanceId, rarity: instance.rarity ?? 'normal' };
  }
  if (inCheck(fromBoard(board), 'white')) {
    return refuse({ kind: 'invalid_deployment', to: kings[0]!.to, reason: 'king_in_check' });
  }

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
      run: { ...run, deck, loadout: run.loadout.map((l) => ({ ...l, charges: l.chargesMax })) },
      stage: {
        ...stage, board, phase: 'action', moveCredits: config.rules.freeMovesPerTurn,
        focus: stage.focusPool, skillLog: [],
      },
      events,
    },
  };
}
