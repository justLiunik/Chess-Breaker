import { useRun } from '../state/store';
import { DeckList } from './DeckList';

/** A promotion overflowed the deck: sell, cut or merge until it fits (the run closes the chooser by itself). */
export function Chooser() {
  const { session, error } = useRun();
  const over = session?.chooser?.overCapacity ?? 0;
  return (
    <main className="screen chooser" data-testid="chooser">
      <h1>Your deck is full</h1>
      <p>
        <strong>{over} {over === 1 ? 'piece' : 'pieces'} over</strong> the limit. Sell, cut or merge pieces until the deck fits.
      </p>
      <DeckList mode="chooser" />
      {error && <p role="alert" className="error" data-testid="run-error">{error}</p>}
    </main>
  );
}
