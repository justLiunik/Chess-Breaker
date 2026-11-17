import { useRun } from '../state/store';

/** Shown while the next stage is being generated; a failed generation offers Retry. */
export function Building() {
  const { genError, dispatch, generating } = useRun();
  return (
    <main className="screen building" data-testid="building">
      <h1>Building the next stage…</h1>
      {genError ? <GenFailure message={genError} onRetry={() => dispatch({ type: 'retry' })} /> : (
        <p role="status">{generating ? 'Generating a position. This can take a few seconds.' : 'Waiting for the stage.'}</p>
      )}
    </main>
  );
}

/** A failed generation's message with its Retry button (Building and the Shop's next-stage panel). */
export function GenFailure({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <>
      <p role="alert" className="error">{message}</p>
      <button type="button" className="start" onClick={onRetry}>Retry</button>
    </>
  );
}
