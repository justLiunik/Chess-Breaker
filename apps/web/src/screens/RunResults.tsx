import type { EndReason } from '@checkbreaker/engine';
import { useRun } from '../state/store';

const REASON: Record<EndReason | 'abandoned', string> = {
  checkmate: 'You checkmated the last stage.',
  enemy_stalemated: 'You stalemated the enemy.',
  out_of_coins: 'You ran out of coins.',
  player_mated: 'Your King was checkmated.',
  player_stalemated: 'You were stalemated.',
  abandoned: 'You abandoned the run.',
};

export function RunResults() {
  const { session, dispatch } = useRun();
  if (!session?.outcome) return null;
  const { run, outcome } = session;
  const won = outcome.result === 'won';
  const cleared = run.history.filter((h) => h.outcome === 'win').length;
  return (
    <main className="screen run-results" data-testid="run-results">
      <h1>{won ? 'RUN WON' : 'RUN LOST'}</h1>
      {session.debug && <p><strong>DEBUG RUN</strong></p>}
      {outcome.endReason && <p>{REASON[outcome.endReason]}</p>}
      <p>Stages cleared: {cleared}</p>
      <p>Seed: <code>{run.seed}</code></p>
      <p>
        <button type="button" className="start" autoFocus onClick={() => dispatch({ type: 'new_run' })}>New run</button>
        {' '}
        <button type="button" onClick={() => dispatch({ type: 'to_title' })}>Title</button>
      </p>
    </main>
  );
}
