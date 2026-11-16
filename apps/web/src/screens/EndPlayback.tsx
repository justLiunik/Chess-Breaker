import { useEffect, useState } from 'react';
import { Board } from '../board/Board';
import { useShortcuts } from '../input/shortcuts';
import { useReducedMotion } from '../settings';
import { useRun } from '../state/store';

/** How long each position stays up. */
const STEP_MS = 900;

/**
 * A losing commit: the player's resolved position first, then the board after the enemy's reply (docs/08 section 9:
 * the reply is never shown before the position it answers). A click or Space skips to the run Results.
 */
export function EndPlayback() {
  const { lastCommit, dispatch } = useRun();
  const motionReduced = useReducedMotion();
  const [step, setStep] = useState<0 | 1>(0);
  const hasReply = lastCommit?.after != null;
  const done = (): void => dispatch({ type: 'ack_commit' });
  useShortcuts({ commit: done });
  useEffect(() => {
    const t = setTimeout(() => { if (step === 0 && hasReply) setStep(1); else done(); }, STEP_MS);
    return () => clearTimeout(t);
    // `done` only dispatches; the step is what restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hasReply]);
  if (!lastCommit) return null;
  const board = step === 1 && lastCommit.after ? lastCommit.after : lastCommit.resolved;
  return (
    <main className="screen playback" data-testid="playback" onClick={done}>
      <p role="status">{step === 1 ? 'The enemy replies.' : 'Your move is played. Click or press Space to skip.'}</p>
      <div data-testid={step === 1 ? 'playback-after' : 'playback-resolved'}>
        <Board stage={{ board }} reducedMotion={motionReduced} entering />
      </div>
    </main>
  );
}
