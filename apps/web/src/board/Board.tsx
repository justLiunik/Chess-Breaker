import { useEffect, useRef } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import type { BoardPiece, Square, StageState } from '@checkbreaker/engine';
import { PlanLayer } from './PlanLayer';
import { FILES, centre, colorFor } from './arrows';
import type { Plan, PlanColor } from './arrows';
import { PIECE_NAME, PieceGlyph } from './pieces';

export type Arrow = { from: Square; to: Square; kind?: string };
/** An icon on a square. `label` is the cause, appended to the square's aria-label. */
export type Mark = { square: Square; kind: string; label?: string };

/** A ghost of a piece the solver's proven setup puts here (the placement clue). `note` is appended to the square's aria-label. */
export type ClueMark = { square: Square; piece: BoardPiece; note?: string };

export interface Overlays {
  /** The complete planned board (e.g. the queue's result). Squares where it differs from `stage.board` get ghost styling. */
  ghost?: StageState['board'];
  /** Black attackers per square, from `threatMap`; every listed square carries a threat icon. */
  threats?: Record<Square, { attackers: Square[] }>;
  highlights?: Square[];
  arrows?: Arrow[];
  marks?: Mark[];
  /** Translucent ghosts of the proven setup, drawn under any real or planned piece. */
  clue?: ClueMark[];
  /** Squares drawn with a hatch pattern and tint (the deployment ranks). */
  hatch?: Square[];
  /** The player's own planning arrows and marks (right mouse button); drawn under the other overlays. */
  plan?: Plan;
}

export interface BoardProps {
  stage: Pick<StageState, 'board'>;
  overlays?: Overlays;
  onSquare?: (square: Square) => void;
  onSquareContext?: (square: Square) => void;
  onHover?: (square: Square | null) => void;
  /** Right-drag from one square to another. */
  onPlanArrow?: (from: Square, to: Square, color: PlanColor) => void;
  /** Right-click on one square. */
  onPlanMark?: (square: Square, color: PlanColor) => void;
  /** A left click anywhere on the board. */
  onPlanClear?: () => void;
  /** Pieces fade instead of travelling. */
  reducedMotion?: boolean;
  /** Every piece is newly shown (the played-out position): animate them all in. */
  entering?: boolean;
  /** Whether the piece on `square` may be dragged. */
  draggable?: (square: Square) => boolean;
  onDragStart?: (square: Square, event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (square: Square, event: DragEvent<HTMLButtonElement>) => void;
  /** Something was dropped on `square`. */
  onDrop?: (square: Square, event: DragEvent<HTMLButtonElement>) => void;
}

const squareAt = (col: number, row: number): Square => `${FILES[col]}${8 - row}`;

export function describeOccupant(piece: BoardPiece | undefined): string {
  if (!piece) return 'empty';
  const tier = piece.rarity && piece.rarity !== 'normal' ? ` (${piece.rarity})` : '';
  return `${piece.color} ${PIECE_NAME[piece.pieceType]}${tier}`;
}

const samePiece = (a: BoardPiece | undefined, b: BoardPiece | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.pieceType === b.pieceType && a.color === b.color
    && a.instanceId === b.instanceId && a.stageId === b.stageId && a.rarity === b.rarity);

function MarkIcon({ kind }: { kind: string }) {
  return (
    <svg className={`mark-icon mark-${kind}`} data-mark={kind} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {kind === 'king-unsafe' || kind === 'deploy-refused'
        ? <><path d="M3 3H17V12L10 18L3 12Z" /><path d="M7 6L13 12M13 6L7 12" /></>
        : <circle cx="10" cy="10" r="4" />}
    </svg>
  );
}

export function Board({ stage, overlays = {}, onSquare, onSquareContext, onHover, onPlanArrow, onPlanMark, onPlanClear, reducedMotion, entering, draggable, onDragStart, onDragEnd, onDrop }: BoardProps) {
  const rightFrom = useRef<Square | null>(null);
  useEffect(() => {
    const reset = (): void => { rightFrom.current = null; };
    window.addEventListener('mouseup', reset);
    return () => window.removeEventListener('mouseup', reset);
  }, []);
  const hatch = new Set(overlays.hatch);
  const highlights = new Set(overlays.highlights);
  const marks = new Map<Square, Mark[]>();
  for (const m of overlays.marks ?? []) marks.set(m.square, [...(marks.get(m.square) ?? []), m]);
  const clues = new Map<Square, ClueMark>();
  for (const c of overlays.clue ?? []) clues.set(c.square, c);
  const cells = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = squareAt(col, row);
      const real = stage.board[sq];
      const planned = overlays.ghost ? overlays.ghost[sq] : real;
      const changed = overlays.ghost !== undefined && !samePiece(real, planned);
      const vacated = changed && real !== undefined && planned === undefined;
      const isGhost = changed && planned !== undefined;
      const piece = vacated ? real : planned;
      const attackers = overlays.threats?.[sq]?.attackers;
      const here = marks.get(sq) ?? [];
      const causes = here.map((m) => m.label).filter((l): l is string => l !== undefined);
      const clue = clues.get(sq);
      const clueLabel = clue ? [`clue: ${describeOccupant(clue.piece)}`, ...(clue.note ? [clue.note] : [])] : [];
      const classes = [
        'square', (col + row) % 2 === 0 ? 'light' : 'dark', highlights.has(sq) ? 'highlight' : '',
        vacated ? 'vacated' : '', isGhost ? 'ghost' : '',
      ].filter(Boolean).join(' ');
      cells.push(
        <button
          key={sq}
          type="button"
          className={classes}
          aria-label={[`${sq}, ${describeOccupant(vacated ? undefined : planned)}`, ...causes, ...clueLabel].join(', ')}
          data-square={sq}
          data-hatch={hatch.has(sq) ? '' : undefined}
          data-vacated={vacated ? '' : undefined}
          data-ghost={isGhost ? '' : undefined}
          draggable={piece !== undefined && !vacated && (draggable?.(sq) ?? false)}
          onClick={() => { onPlanClear?.(); onSquare?.(sq); }}
          onMouseDown={(e) => { if (e.button === 2 && onPlanArrow) rightFrom.current = sq; }}
          onMouseUp={(e) => {
            if (e.button !== 2) return;
            const from = rightFrom.current;
            rightFrom.current = null;
            if (from === null) return;
            if (from === sq) onPlanMark?.(sq, colorFor(e));
            else onPlanArrow?.(from, sq, colorFor(e));
          }}
          onContextMenu={(e: MouseEvent) => { e.preventDefault(); onSquareContext?.(sq); }}
          onMouseEnter={() => onHover?.(sq)}
          onMouseLeave={() => onHover?.(null)}
          onFocus={() => onHover?.(sq)}
          onBlur={() => onHover?.(null)}
          onDragStart={(e) => onDragStart?.(sq, e)}
          onDragEnd={(e) => onDragEnd?.(sq, e)}
          onDragOver={(e) => { if (onDrop) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); onDrop?.(sq, e); }}
        >
          {clue && <span className="clue-ghost" data-clue={clue.piece.pieceType} {...(clue.note ? { 'data-clue-note': clue.note } : {})}><PieceGlyph piece={clue.piece} rarity={clue.piece.rarity} /></span>}
          {piece && <PieceGlyph piece={piece} rarity={piece.color === 'white' ? piece.rarity : undefined} />}
          {attackers && (
            <svg className="threat" data-threat={attackers.join(' ')} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M10 2L18 17H2Z" />
              <path d="M10 7V12M10 14V15" />
            </svg>
          )}
          {here.map((m, i) => <MarkIcon key={`${m.kind}-${i}`} kind={m.kind} />)}
        </button>,
      );
    }
  }
  return (
    <div className={`board ${reducedMotion ? 'motion-fade' : 'motion-travel'}${entering ? ' entering' : ''}`} role="group" aria-label="Board">
      {overlays.plan && <PlanLayer plan={overlays.plan} />}
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
      </svg>
    </div>
  );
}
