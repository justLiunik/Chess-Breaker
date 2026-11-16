import { useState } from 'react';
import type { PieceInstance } from '@checkbreaker/engine';
import { cutPiece, mergePieces, repairPiece, sellPiece, sellPrice } from '@checkbreaker/run';
import { PIECE_NAME, PieceGlyph, RARITY_NAME } from '../board/pieces';
import { Pips } from '../hud/Pips';
import { runConfig } from '../config';
import { runErrorText } from '../messages';
import { useRun } from '../state/store';

export type DeckMode = 'view' | 'chooser' | 'shop';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const pieceLabel = (p: Pick<PieceInstance, 'pieceType' | 'rarity'>): string =>
  `${p.rarity ? RARITY_NAME[p.rarity] : 'King'} ${cap(PIECE_NAME[p.pieceType])}`;

const STATUS: Partial<Record<PieceInstance['status'], string>> = { spent: 'spent', deployed: 'deployed' };

/**
 * The deck in the run's own order (never re-sorted, so a row does not jump when its durability changes).
 * In the shop and the chooser each row offers Sell / Cut (and Repair in the shop) and can be ticked for a merge.
 * Whether an action is possible is asked of the run layer's own functions on the current run; the UI decides nothing.
 */
export function DeckList({ mode }: { mode: DeckMode }) {
  const { session, dispatch } = useRun();
  const [picked, setPicked] = useState<string[]>([]);
  if (!session) return null;
  const { run } = session;
  const c = runConfig;
  const act = session.shop?.act ?? ((run.actIndex + 1) as 1 | 2 | 3);
  const stageNumber = session.shop?.stageNumber ?? run.actIndex * c.run.stagesPerAct + run.stageIndex;
  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const merge = picked.length > 0 ? mergePieces(run, picked, act, stageNumber, c) : null;
  const needed = c.run.merge.inputs;

  return (
    <div className="decklist" data-testid="decklist">
      <ul className="deck">
        {run.deck.map((p) => {
          const label = pieceLabel(p);
          const king = p.pieceType === 'king';
          const sell = sellPiece(run, p.instanceId, act, c);
          const cut = cutPiece(run, p.instanceId);
          const repair = repairPiece(run, p.instanceId, c);
          const damaged = !king && p.status === 'in_deck' && (p.durability ?? 0) < (p.durabilityMax ?? 0);
          return (
            <li key={p.instanceId} className="deck-piece" data-testid={`deck-piece-${p.instanceId}`}>
              <span className="deck-glyph"><PieceGlyph piece={{ pieceType: p.pieceType, color: 'white' }} rarity={p.rarity} /></span>
              <span className="deck-name">{label}</span>
              <Pips instance={p} />
              {STATUS[p.status] && <em className="deck-status"> {STATUS[p.status]}</em>}
              {mode !== 'view' && !king && (
                <span className="deck-actions">
                  <label>
                    <input type="checkbox" checked={picked.includes(p.instanceId)} onChange={() => toggle(p.instanceId)} />
                    {' '}Merge {label}
                  </label>
                  <button type="button" disabled={!sell.ok} title={sell.ok ? undefined : runErrorText(sell.error)} aria-label={`Sell ${label} for ${sell.ok ? sell.value.coins : sellPrice(p, act, c)} coins`}
                    onClick={() => dispatch({ type: 'sell', id: p.instanceId })}>
                    Sell (+{sellPrice(p, act, c)})
                  </button>
                  <button type="button" disabled={!cut.ok} title={cut.ok ? undefined : runErrorText(cut.error)} aria-label={`Cut ${label}`}
                    onClick={() => dispatch({ type: 'cut', id: p.instanceId })}>
                    Cut
                  </button>
                  {mode === 'shop' && damaged && (
                    <button type="button" disabled={!repair.ok} title={repair.ok ? undefined : runErrorText(repair.error)} aria-label={`Repair ${label}`}
                      onClick={() => dispatch({ type: 'repair', id: p.instanceId })}>
                      Repair ({c.run.services.repair} ◈)
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {mode !== 'view' && (
        <p className="deck-merge">
          <button type="button" disabled={!merge || !merge.ok} onClick={() => { dispatch({ type: 'merge', ids: picked }); setPicked([]); }}>
            Merge selected ({picked.length}/{needed})
          </button>
          {merge && !merge.ok && picked.length >= needed && <span role="note" className="error"> {runErrorText(merge.error)}</span>}
        </p>
      )}
    </div>
  );
}
