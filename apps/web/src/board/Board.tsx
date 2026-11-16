import type { DragEvent, MouseEvent } from 'react';
import type { BoardPiece, Square, StageState } from '@checkbreaker/engine';
import { PIECE_NAME, PieceGlyph } from './pieces';

export type Arrow = { from: Square; to: Square; kind?: string };
export type Mark = { square: Square; kind: string };

export interface Overlays {
  /** Pieces drawn on top of the stage's board (planned placements, the plan's moves). */
  ghost?: StageState['board'];
  /** Black attackers per square, from `threatMap`; every listed square carries a threat icon. */
  threats?: Record<Square, { attackers: Square[] }>;
  highlights?: Square[];
  arrows?: Arrow[];
  marks?: Mark[];
  /** Squares drawn with a hatch pattern (the deployment ranks). */
  hatch?: Square[];
}

export interface BoardProps {
  stage: Pick<StageState, 'board'>;
  overlays?: Overlays;
  onSquare?: (square: Square) => void;
  onSquareContext?: (square: Square) => void;
  onHover?: (square: Square | null) => void;
  /** A piece standing on `square` started a drag. */
  onDragStart?: (square: Square, event: DragEvent<HTMLButtonElement>) => void;
  /** Something was dropped on `square`. */
  onDrop?: (square: Square, event: DragEvent<HTMLButtonElement>) => void;
}

const FILES = 'abcdefgh';
const squareAt = (col: number, row: number): Square => `${FILES[col]}${8 - row}`;
const centre = (sq: Square): { x: number; y: number } => ({ x: FILES.indexOf(sq[0]!) + 0.5, y: 8 - Number(sq[1]) + 0.5 });

export function describeOccupant(piece: BoardPiece | undefined): string {
  if (!piece) return 'empty';
  const tier = piece.rarity && piece.rarity !== 'normal' ? ` (${piece.rarity})` : '';
  return `${piece.color} ${PIECE_NAME[piece.pieceType]}${tier}`;
}

export function Board({ stage, overlays = {}, onSquare, onSquareContext, onHover, onDragStart, onDrop }: BoardProps) {
  const board = { ...stage.board, ...overlays.ghost };
  const hatch = new Set(overlays.hatch);
  const highlights = new Set(overlays.highlights);
  const cells = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = squareAt(col, row);
      const piece = board[sq];
      const attackers = overlays.threats?.[sq]?.attackers;
      const classes = ['square', (col + row) % 2 === 0 ? 'light' : 'dark', highlights.has(sq) ? 'highlight' : ''].filter(Boolean).join(' ');
      cells.push(
        <button
          key={sq}
          type="button"
          className={classes}
          aria-label={`${sq}, ${describeOccupant(piece)}`}
          data-square={sq}
          data-hatch={hatch.has(sq) ? '' : undefined}
          draggable={onDragStart !== undefined && piece?.color === 'white' && overlays.ghost?.[sq] !== undefined}
          onClick={() => onSquare?.(sq)}
          onContextMenu={(e: MouseEvent) => { e.preventDefault(); onSquareContext?.(sq); }}
          onMouseEnter={() => onHover?.(sq)}
          onMouseLeave={() => onHover?.(null)}
          onFocus={() => onHover?.(sq)}
          onBlur={() => onHover?.(null)}
          onDragStart={(e) => onDragStart?.(sq, e)}
          onDragOver={(e) => { if (onDrop) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); onDrop?.(sq, e); }}
        >
          {piece && <PieceGlyph piece={piece} rarity={piece.color === 'white' ? piece.rarity : undefined} />}
          {attackers && (
            <svg className="threat" data-threat={attackers.join(' ')} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M10 2L18 17H2Z" />
              <path d="M10 7V12M10 14V15" />
            </svg>
          )}
        </button>,
      );
    }
  }
  return (
    <div className="board" role="group" aria-label="Board">
      {cells}
      <svg className="overlay" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
        {(overlays.arrows ?? []).map((a, i) => {
          const f = centre(a.from);
          const t = centre(a.to);
          return (
            <line key={`${a.kind ?? 'arrow'}-${a.from}-${i}`} className={`arrow arrow-${a.kind ?? 'plain'}`}
              data-testid={`${a.kind ?? 'arrow'}-line-${a.from}`} x1={f.x} y1={f.y} x2={t.x} y2={t.y} />
          );
        })}
        {(overlays.marks ?? []).map((m, i) => {
          const c = centre(m.square);
          return <circle key={`${m.kind}-${m.square}-${i}`} className={`mark mark-${m.kind}`} data-mark={m.kind} cx={c.x} cy={c.y} r={0.18} />;
        })}
      </svg>
    </div>
  );
}
