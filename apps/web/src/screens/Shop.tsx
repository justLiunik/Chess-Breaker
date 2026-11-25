import { useState } from 'react';
import { buy as tryBuy, leave as tryLeave, rerollShop, rerollsLeft } from '@checkbreaker/run';
import { Board } from '../board/Board';
import { PieceGlyph } from '../board/pieces';
import { engineConfig, runConfig, skillNames, skillTexts } from '../config';
import { Header } from '../hud/Header';
import { useShortcuts } from '../input/shortcuts';
import { useReducedMotion } from '../settings';
import { deckGateText, runErrorText } from '../messages';
import { useRun } from '../state/store';
import { GenFailure } from './Building';
import { DeckList, pieceLabel } from './DeckList';

export function Shop() {
  const { session, dispatch, error, genError } = useRun();
  const [choosing, setChoosing] = useState<number | null>(null);
  const motionReduced = useReducedMotion();
  useShortcuts({ escape: () => setChoosing(null) });
  const shop = session?.shop;
  if (!session || !shop) return null;
  const { run } = session;
  const c = runConfig;
  const next = session.next?.stage ?? null;
  const recoveryLive = shop.recovery && !shop.slots[0]?.sold;

  // The reroll's price and availability are the run function's own answer, not recomputed here.
  const roll = rerollShop(run, shop, c);
  const rollCost = roll.ok ? roll.value.cost : roll.error.kind === 'insufficient_coins' ? roll.error.price : null;
  const left = rerollsLeft(shop, c);

  // The deck gate is the run layer's own answer to a dry run of leave, not a recount here.
  const gate = tryLeave(session, c);
  const gateText = !gate.ok && gate.error.kind === 'deck_over_capacity' ? deckGateText(gate.error) : null;

  const buy = (slot: number): void => {
    // A buy the run layer refuses only for a full loadout asks which skill to replace.
    const verdict = tryBuy(session, slot, {}, c);
    if (!verdict.ok && verdict.error.kind === 'loadout_full') setChoosing(slot);
    else dispatch({ type: 'buy', slot });
  };

  return (
    <main className="screen shop" data-testid="shop">
      <Header session={session} />
      <h1>Shop</h1>
      <div className="shop-body">
        <section>
          <h2>Offers</h2>
          <ol className="offers">
            {shop.slots.map((o, i) => {
              const slot = i + 1;
              const live = i === 0 && recoveryLive && o.kind === 'piece' && o.recovery === true;
              const verdict = o.sold ? null : tryBuy(session, slot, {}, c);
              const blocked = verdict !== null && !verdict.ok && verdict.error.kind !== 'loadout_full' ? runErrorText(verdict.error) : null;
              const text = o.kind === 'skill' ? skillTexts.find((s) => s.id === o.skillId) : null;
              return (
                <li key={slot} className="offer" data-testid={`shop-slot-${slot}`} data-sold={o.sold ? '' : undefined}>
                  {o.kind === 'piece' ? (
                    <>
                      <span className="offer-glyph"><PieceGlyph piece={{ pieceType: o.pieceType, color: 'white' }} rarity={o.rarity} /></span>
                      <strong>{pieceLabel(o)}</strong>
                      {live && <span className="badge" data-testid="shop-recovery"> RECOVERY OFFER</span>}
                    </>
                  ) : (
                    <>
                      <strong>{skillNames[o.skillId] ?? o.skillId}</strong>
                      {' '}({engineConfig.skills[o.skillId]?.cost ?? '?'} Focus)
                      {text && <span className="offer-text"> {text.ruleBroken} {text.text}</span>}
                    </>
                  )}
                  {' '}<span className="price">{o.price} ◈</span>{' '}
                  {o.sold ? <em>Sold</em> : (
                    <button type="button" disabled={blocked !== null} title={blocked ?? undefined} onClick={() => buy(slot)}>
                      Buy {o.price} ◈
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <p>
            <button type="button" disabled={!roll.ok} onClick={() => dispatch({ type: 'reroll' })}>
              Reroll ({rollCost === 0 ? 'free' : rollCost === null ? 'no rerolls left' : `${rollCost} ◈`}){' · '}{left} left
            </button>
          </p>
          {error && <p role="alert" className="error" data-testid="run-error">{error}</p>}
          <h2>Your deck</h2>
          <DeckList mode="shop" />
        </section>
        <aside data-testid="next-preview">
          <h2>Next stage</h2>
          {next ? <Board stage={next} reducedMotion={motionReduced} />
            : genError ? <GenFailure message={genError} onRetry={() => dispatch({ type: 'retry' })} />
              : <p role="status">The next stage is being prepared…</p>}
        </aside>
      </div>
      {gateText && <p role="status" className="error" data-testid="deck-gate">{gateText}</p>}
      <p>
        <button type="button" className="start" disabled={gateText !== null} title={gateText ?? undefined} onClick={() => dispatch({ type: 'leave' })}>
          Leave shop
        </button>
      </p>
      {choosing !== null && (
        <div className="confirm" role="dialog" aria-modal="true" aria-label="Replace a skill">
          <p>Your skill loadout is full. Which skill does {skillNames[(shop.slots[choosing - 1] as { skillId: string }).skillId]} replace?</p>
          {run.loadout.map((l, i) => (
            <p key={i}>
              <button type="button" onClick={() => { dispatch({ type: 'buy', slot: choosing, replace: i }); setChoosing(null); }}>
                Slot {i + 1}: {skillNames[l.skillId] ?? l.skillId}
              </button>
            </p>
          ))}
          <button type="button" autoFocus onClick={() => setChoosing(null)}>Cancel</button>
        </div>
      )}
    </main>
  );
}
