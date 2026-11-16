import { Board } from '../board/Board';
import { useShortcuts } from '../input/shortcuts';
import { useReducedMotion } from '../settings';
import { useRun } from '../state/store';

/** After a mate: the position the player left, then what the stage paid. Continue goes on to the chooser or shop. */
export function StageResults() {
  const { session, lastCommit, dispatch } = useRun();
  const motionReduced = useReducedMotion();
  const done = (): void => dispatch({ type: 'ack_commit' });
  useShortcuts({ commit: done });
  if (!session || !lastCommit) return null;
  const last = session.run.history.at(-1);
  const final = session.run.status === 'won';
  return (
    <main className="screen stage-results" data-testid="stage-results">
      <h1>Stage cleared</h1>
      <div data-testid="results-board">
        <Board stage={{ board: lastCommit.after ?? lastCommit.resolved }} reducedMotion={motionReduced} />
      </div>
      {last && (
        <p>
          <strong>+{last.coinsEarned} ◈</strong> earned in {last.turnsUsed} {last.turnsUsed === 1 ? 'turn' : 'turns'}
          {last.piecesLost > 0 && <>; pieces lost: {last.piecesLost}</>}
          {' · '}Wallet {session.run.coins} ◈
        </p>
      )}
      <button type="button" className="start" autoFocus onClick={done}>{final ? 'Continue to the results' : 'Continue'}</button>
    </main>
  );
}
