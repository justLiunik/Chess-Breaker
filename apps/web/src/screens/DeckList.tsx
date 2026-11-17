import { useState } from 'react';
import type { PieceInstance } from '@checkbreaker/engine';
import { cut, merge, repair, sell } from '@checkbreaker/run';
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
  // Every verdict below is a dry run of the run layer's own function on the current session; nothing is dispatched.
  const ids = picked.filter((id) => run.deck.some((p) => p.instanceId === id));
  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const mergeTry = ids.length > 0 ? merge(session, ids, c) : null;
  const needed = c.run.merge.inputs;

  return (
    <div className="decklist" data-testid="decklist">
      <ul className="deck">
        {run.deck.map((p) => {
          const label = pieceLabel(p);
          const king = p.pieceType === 'king';
          const sold = mode === 'view' ? null : sell(session, p.instanceId, c);
          const cutTry = mode === 'view' ? null : cut(session, p.instanceId, c);
          const fix = mode === 'shop' ? repair(session, p.instanceId, c) : null;
          const sellGain = sold?.ok ? sold.value.session.run.coins - run.coins : null;
          // A repair offer exists unless the piece has nothing to repair; an unaffordable one stays, disabled.
          const showRepair = fix !== null && (fix.ok || (!fix.ok && fix.error.kind !== 'not_damaged' && fix.error.kind !== 'cannot_repair'));
          return (
            <li key={p.instanceId} className="deck-piece" data-testid={`deck-piece-${p.instanceId}`}>
              <span className="deck-glyph"><PieceGlyph piece={{ pieceType: p.pieceType, color: 'white' }} rarity={p.rarity} /></span>
              <span className="deck-name">{label}</span>
              <Pips instance={p} />
              {STATUS[p.status] && <em className="deck-status"> {STATUS[p.status]}</em>}
              {mode !== 'view' && !king && (
                <span className="deck-actions">
                  <label>
                    <input type="checkbox" checked={ids.includes(p.instanceId)} onChange={() => toggle(p.instanceId)} />
                    {' '}Merge {label}
                  </label>
                  <button type="button" disabled={!sold?.ok} title={sold && !sold.ok ? runErrorText(sold.error) : undefined}
                    aria-label={`Sell ${label}`} onClick={() => { dispatch({ type: 'sell', id: p.instanceId }); setPicked(ids.filter((x) => x !== p.instanceId)); }}>
                    Sell{sellGain !== null ? ` (+${sellGain})` : ''}
                  </button>
                  <button type="button" disabled={!cutTry?.ok} title={cutTry && !cutTry.ok ? runErrorText(cutTry.error) : undefined}
                    aria-label={`Cut ${label}`} onClick={() => { dispatch({ type: 'cut', id: p.instanceId }); setPicked(ids.filter((x) => x !== p.instanceId)); }}>
                    Cut
                  </button>
                  {showRepair && fix && (
                    <button type="button" disabled={!fix.ok} title={fix.ok ? undefined : runErrorText(fix.error)} aria-label={`Repair ${label}`}
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
          <button type="button" disabled={!mergeTry || !mergeTry.ok} onClick={() => { dispatch({ type: 'merge', ids }); setPicked([]); }}>
            Merge selected ({ids.length}/{needed})
          </button>
          {mergeTry && !mergeTry.ok && ids.length >= needed && <span role="note" className="error"> {runErrorText(mergeTry.error)}</span>}
        </p>
      )}
    </div>
  );
}
