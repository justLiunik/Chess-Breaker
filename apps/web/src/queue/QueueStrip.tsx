import { useState } from 'react';
import type { Action, StageState } from '@checkbreaker/engine';
import { PieceGlyph } from '../board/pieces';
import { engineConfig } from '../config';
import type { Preview } from '../hud/Hud';

export const skillName = (id: string): string =>
  id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export interface QueueStripProps {
  queue: Action[];
  /** The stage the queue starts from. */
  stage: StageState;
  preview: Preview;
  stepIndex: number;
  locked: boolean;
  onRemove(i: number): void;
  onMove(from: number, to: number): void;
  onShow(i: number): void;
}

/** Why entry `i` is marked, or null when it resolves. */
function problemOf(preview: Preview, i: number): 'unaffordable' | 'refused' | 'blocked' | null {
  if (preview.steps[i]?.ok !== false) return null;
  const e = preview.error;
  if (e && 'atStep' in e && e.atStep === i) {
    return e.kind === 'focus_exceeded' || e.kind === 'credits_exceeded' ? 'unaffordable' : 'refused';
  }
  // The verdict names no step (e.g. a queue without moves): the first entry that stopped resolving is the culprit.
  return preview.steps.findIndex((s) => !s.ok) === i ? 'refused' : 'blocked';
}

const PROBLEM_TEXT = {
  unaffordable: '⚠ unaffordable',
  refused: '✗ refused',
  blocked: '✗ blocked by an earlier step',
} as const;

export function QueueStrip({ queue, stage, preview, stepIndex, locked, onRemove, onMove, onShow }: QueueStripProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  if (queue.length === 0) return <p className="queue-empty" data-testid="queue-empty">No moves yet. Pick a piece, then a square.</p>;
  return (
    <ol className="queue" data-testid="queue" aria-label="Queue">
      {queue.map((a, i) => {
        const prev = i === 0 ? stage : preview.steps[i - 1]!.stage;
        const problem = problemOf(preview, i);
        const name = a.type === 'MOVE' ? `${a.from}→${a.to}` : `${skillName(a.skillId)}${a.target ? ` on ${a.target}` : ''}`;
        const mover = a.type === 'MOVE' ? prev.board[a.from] : undefined;
        const skillCost = a.type === 'ACTIVATE_SKILL' ? engineConfig.skills[a.skillId]?.cost : undefined;
        return (
          <li
            key={`${i}-${name}`}
            data-testid={`queue-entry-${i}`}
            data-unaffordable={problem === 'unaffordable' ? '' : undefined}
            data-problem={problem ?? undefined}
            data-current={i === stepIndex ? '' : undefined}
            className={`queue-entry${i === stepIndex ? ' current' : ''}${problem ? ' problem' : ''}`}
            draggable={!locked}
            onDragStart={(e) => {
              setDragFrom(i);
              if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }
            }}
            onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) onMove(dragFrom, i);
              setDragFrom(null);
            }}
            onDragEnd={() => setDragFrom(null)}
          >
            <button type="button" className="queue-main" disabled={locked} aria-label={`Remove step ${i + 1}: ${name}`} onClick={() => onRemove(i)}>
              <span className="queue-num">{i + 1}.</span>
              <span className="queue-icon" aria-hidden="true">
                {mover ? <PieceGlyph piece={mover} rarity={mover.color === 'white' ? mover.rarity : undefined} /> : '✦'}
              </span>
              <span className="queue-name">{name}</span>
              {skillCost !== undefined && <span className="queue-cost"> ({skillCost} Focus)</span>}
              {problem && <strong className="queue-problem"> {PROBLEM_TEXT[problem]}</strong>}
            </button>
            <button type="button" disabled={locked} aria-label={`Show position after step ${i + 1}`} aria-pressed={i === stepIndex} onClick={() => onShow(i)}>Show</button>
            <button type="button" disabled={locked || i === 0} aria-label={`Move step ${i + 1} earlier`} onClick={() => onMove(i, i - 1)}>↑</button>
            <button type="button" disabled={locked || i === queue.length - 1} aria-label={`Move step ${i + 1} later`} onClick={() => onMove(i, i + 1)}>↓</button>
          </li>
        );
      })}
    </ol>
  );
}
