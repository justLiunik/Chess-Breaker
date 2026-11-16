import { useState } from 'react';
import { runConfig, engineConfig } from '../config';
import { useShortcuts } from '../input/shortcuts';
import { useRun } from '../state/store';

/** Where the run stands, shown before each stage's Deployment. */
export function RunMap({ onContinue }: { onContinue(): void }) {
  const { session, dispatch } = useRun();
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  useShortcuts({ escape: () => setAsking(false) });
  if (!session) return null;
  const { run } = session;
  const { acts, stagesPerAct } = runConfig.run;
  const cleared = run.history.filter((h) => h.outcome === 'win').length;
  const deck = run.deck.filter((p) => p.pieceType !== 'king').length;

  const copy = (): void => {
    try {
      void Promise.resolve(navigator.clipboard.writeText(run.seed)).then(() => setCopied(true), () => setCopied(false));
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="screen run-map" data-testid="run-map">
      <h1>Run map</h1>
      {session.debug && <p><strong className="debug-flag">DEBUG RUN</strong></p>}
      <p><strong>Act {run.actIndex + 1} of {acts}</strong></p>
      <ol className="progress" aria-label="Stages">
        {Array.from({ length: acts * stagesPerAct }, (_, i) => {
          const here = i === run.actIndex * stagesPerAct + run.stageIndex;
          return <li key={i} className={i < cleared ? 'done' : here ? 'here' : ''}>{i < cleared ? '✔' : here ? '▶' : '·'}</li>;
        })}
      </ol>
      <p><strong>Stage {run.stageIndex + 1} of {stagesPerAct}</strong></p>
      <p>Coins {run.coins} ◈ · Deck {deck} / {engineConfig.deck.capacity} · Stages cleared {cleared}</p>
      <p>
        Seed{' '}
        <button type="button" className="seed" onClick={copy} aria-label={`Seed ${run.seed}, click to copy`}>{run.seed}</button>
        {copied && <span role="status"> copied</span>}
      </p>
      <p>
        <button type="button" className="start" autoFocus onClick={onContinue}>Continue</button>
        {' '}
        <button type="button" onClick={() => setAsking(true)}>Abandon run</button>
      </p>
      {asking && (
        <div className="confirm" role="dialog" aria-modal="true" aria-label="Abandon run">
          <p>Abandon this run? It counts as lost.</p>
          <button type="button" autoFocus onClick={() => setAsking(false)}>Cancel</button>
          {' '}
          <button type="button" onClick={() => dispatch({ type: 'abandon' })}>Abandon</button>
        </div>
      )}
    </main>
  );
}
