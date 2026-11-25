import { Board } from '../board/Board';
import { useShortcuts } from '../input/shortcuts';
import { useReducedMotion } from '../settings';
import { useRun } from '../state/store';

/** After a mate: the position the player left, then what the stage paid. Continue goes on to the shop or the run results. */
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
        <>
          {lastCommit.award && (
            <table className="award" data-testid="award">
              <tbody>
                <tr data-testid="award-base"><th scope="row">Base reward</th><td>+{lastCommit.award.base} ◈</td></tr>
                <tr data-testid="award-par"><th scope="row">Par bonus</th><td>+{lastCommit.award.parBonus} ◈</td></tr>
                <tr data-testid="award-interest"><th scope="row">Interest</th><td>+{lastCommit.award.interest} ◈</td></tr>
                <tr data-testid="award-salvage"><th scope="row">Salvage</th><td>+{lastCommit.salvage} ◈</td></tr>
                <tr data-testid="award-total"><th scope="row">Total</th><td><strong>+{last.coinsEarned} ◈</strong></td></tr>
              </tbody>
            </table>
          )}
          <p>
            {!lastCommit.award && <><strong>+{last.coinsEarned} ◈</strong>{' · '}</>}
            Cleared in {last.turnsUsed} {last.turnsUsed === 1 ? 'turn' : 'turns'}
            {' · '}Pieces lost: {last.piecesLost}
            {' · '}Wallet {session.run.coins} ◈
          </p>
        </>
      )}
      <button type="button" className="start" autoFocus onClick={done}>{final ? 'Continue to the results' : 'Continue'}</button>
    </main>
  );
}
