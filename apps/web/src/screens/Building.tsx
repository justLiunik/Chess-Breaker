import { useRun } from '../state/store';

/** Shown while the next stage is being generated; a failed generation offers Retry. */
export function Building() {
  const { error, dispatch, generating } = useRun();
  return (
    <main className="screen building" data-testid="building">
      <h1>Building the next stage…</h1>
      {error ? (
        <>
          <p role="alert" className="error">{error}</p>
          <button type="button" className="start" onClick={() => dispatch({ type: 'retry' })}>Retry</button>
        </>
      ) : (
        <p role="status">{generating ? 'Generating a position. This can take a few seconds.' : 'Waiting for the stage.'}</p>
      )}
    </main>
  );
}
