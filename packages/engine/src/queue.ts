import type { BoardPiece, EngineConfig, GameEvent, Square, StageState } from './types';

type Board = StageState['board'];

export function applyPlayerMove(
  board: Board,
  from: Square,
  to: Square,
  config: EngineConfig,
): { board: Board; events: GameEvent[]; salvage: number } {
  const mover = board[from] as BoardPiece;
  const next: Board = { ...board };
  delete next[from];
  const events: GameEvent[] = [
    { type: 'move', from, to, pieceType: mover.pieceType, color: mover.color },
  ];
  let salvage = 0;

  const captured = board[to];
  if (captured && captured.color === 'black') {
    const { enabled, divisor } = config.economy.salvage;
    salvage = enabled ? Math.floor(config.pieceValues[captured.pieceType] / divisor) : 0;
    events.push({
      type: 'capture', square: to, pieceType: captured.pieceType, color: captured.color, salvage,
    });
  }

  if (mover.pieceType === 'pawn' && mover.color === 'white' && to.endsWith('8') && mover.promotesTo) {
    delete next[to];
    events.push({ type: 'pawn_promoted', square: to, promotesTo: mover.promotesTo });
  } else {
    next[to] = mover;
  }
  return { board: next, events, salvage };
}
