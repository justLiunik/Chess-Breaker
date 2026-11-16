import { useState } from 'react';
import { rerollShop } from '@checkbreaker/run';
import { Board } from '../board/Board';
import { PieceGlyph } from '../board/pieces';
import { engineConfig, runConfig, skillNames, skillTexts } from '../config';
import { Header } from '../hud/Header';
import { useShortcuts } from '../input/shortcuts';
import { useReducedMotion } from '../settings';
import { useRun } from '../state/store';
import { DeckList, pieceLabel } from './DeckList';

export function Shop() {
  const { session, dispatch, error } = useRun();
  const [choosing, setChoosing] = useState<number | null>(null);
  const motionReduced = useReducedMotion();
  useShortcuts({ escape: () => setChoosing(null) });
  const shop = session?.shop;
  if (!session || !shop) return null;
  const { run } = session;
  const c = runConfig;
  const next = session.next?.stage ?? null;
  const recoveryLive = shop.recovery && !shop.slots[0]?.sold;
  const loadoutFull = run.loadout.length >= c.run.loadoutSlots;

  // The reroll's price and availability are the run function's own answer, not recomputed here.
  const roll = rerollShop(run, shop, c);
  const exhausted = !roll.ok && roll.error.kind === 'rerolls_exhausted';
  const rollCost = roll.ok ? roll.value.cost : roll.error.kind === 'insufficient_coins' ? roll.error.price : null;
  const left = c.run.services.maxRerollsPerVisit - shop.rerollsUsed;

  const buy = (slot: number): void => {
    const offer = shop.slots[slot - 1]!;
    if (offer.kind === 'skill' && loadoutFull) setChoosing(slot);
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
              const afford = run.coins >= o.price;
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
                    <button type="button" disabled={!afford} title={afford ? undefined : `You have ${run.coins} coins`} onClick={() => buy(slot)}>
                      Buy {o.price} ◈
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <p>
            <button type="button" disabled={!roll.ok} onClick={() => dispatch({ type: 'reroll' })}>
              Reroll ({rollCost === 0 ? 'free' : rollCost === null ? 'no rerolls left' : `${rollCost} ◈`}){' · '}{exhausted ? 0 : left} left
            </button>
          </p>
          {error && <p role="alert" className="error" data-testid="run-error">{error}</p>}
          <h2>Your deck</h2>
          <DeckList mode="shop" />
        </section>
        <aside data-testid="next-preview">
          <h2>Next stage</h2>
          {next ? <Board stage={next} reducedMotion={motionReduced} /> : <p role="status">The next stage is being prepared…</p>}
        </aside>
      </div>
      <p><button type="button" className="start" onClick={() => dispatch({ type: 'leave' })}>Leave shop</button></p>
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
