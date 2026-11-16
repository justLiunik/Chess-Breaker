import { useEffect, useMemo, useRef, useState } from 'react';
import { legalPlayerMoves, previewSteps, threatMap } from '@checkbreaker/engine';
import type { Square, StageState } from '@checkbreaker/engine';
import type { RunSession } from '@checkbreaker/run';
import { clear as clearPlan, empty as emptyPlan, toggleArrow, toggleMark } from '../board/arrows';
import type { Plan } from '../board/arrows';
import { Board } from '../board/Board';
import type { Arrow, Mark } from '../board/Board';
import { engineConfig } from '../config';
import { Header } from '../hud/Header';
import { Hud, lossBanner } from '../hud/Hud';
import { useShortcuts } from '../input/shortcuts';
import type { Shortcuts } from '../input/shortcuts';
import { commitErrorText } from '../messages';
import { QueueStrip, skillName } from '../queue/QueueStrip';
import { useQueue } from '../queue/useQueue';
import { reducedMotion } from '../settings';
import { useRun } from '../state/store';

type Phase = 'idle' | 'thinking' | 'playback';

/** How long the player's resolved position stays up before the enemy's reply replaces it. */
const PLAYBACK_MS = 900;

export function Action() {
  const { session, dispatch, error, dev } = useRun();
  const stage = session?.stage ?? null;
  const run = session?.run ?? null;
  const q = useQueue(stage);
  const [selected, setSelected] = useState<Square | null>(null);
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);
  const [hover, setHover] = useState<Square | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [resolved, setResolved] = useState<StageState['board'] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [plan, setPlan] = useState<Plan>(emptyPlan);
  const motionReduced = useMemo(() => reducedMotion.read(), []);

  const latest = useRef<RunSession | null>(session);
  latest.current = session;
  const started = useRef<RunSession | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const preview = useMemo(
    () => (run && stage ? previewSteps(run, stage, q.queue, engineConfig) : null),
    [run, stage, q.queue],
  );
  const planStage = preview?.steps.at(-1)?.stage ?? stage;
  const shown = preview && q.stepIndex >= 0 ? preview.steps[q.stepIndex]?.stage.board : undefined;
  const legal = useMemo(
    () => (selected && planStage ? legalPlayerMoves(planStage, selected, engineConfig) : []),
    [selected, planStage],
  );
  const threats = useMemo(() => {
    if (!run || !stage) return {};
    const all = threatMap(run, { ...stage, board: shown ?? stage.board }, engineConfig);
    const board = shown ?? stage.board;
    return Object.fromEntries(Object.entries(all).filter(([sq]) => board[sq]?.color === 'white'));
  }, [run, stage, shown]);

  // After a refused commit the session is the one we started from: unlock. Otherwise let the reply play, then show it.
  useEffect(() => {
    if (phase !== 'playback') return undefined;
    if (latest.current === started.current) {
      setPhase('idle');
      setResolved(null);
      return undefined;
    }
    timer.current = setTimeout(() => { setPhase('idle'); setResolved(null); }, PLAYBACK_MS);
    return clearTimer;
  }, [phase]);
  // Handlers are assigned below, once the values they need exist; the hook itself must run before the early return.
  const keys = useRef<Shortcuts>({});
  useShortcuts({
    commit: () => keys.current.commit?.(),
    undo: () => keys.current.undo?.(),
    stepPrev: () => keys.current.stepPrev?.(),
    stepNext: () => keys.current.stepNext?.(),
    escape: () => keys.current.escape?.(),
  });

  if (!session || !run || !stage || !preview || !planStage) return null;

  const locked = phase !== 'idle';
  const loss = lossBanner(preview);
  const queueError = q.queue.length > 0 && preview.error ? commitErrorText(preview.error) : null;
  const canCommit = !locked && q.queue.length > 0 && preview.error === null;

  const reset = (): void => { setSelected(null); setPendingSkill(null); };

  const startCommit = (): void => {
    if (!canCommit) return;
    setConfirming(false);
    setPlan(clearPlan());
    reset();
    setResolved(planStage.board);
    setPhase('thinking');
    started.current = session;
    const queue = q.queue;
    // Let the "thinking" frame paint before the (possibly slow) enemy search runs.
    timer.current = setTimeout(() => {
      timer.current = null;
      dispatch({ type: 'commit', queue });
      setPhase('playback');
    }, 0);
  };

  keys.current = {
    commit: () => {
      if (phase === 'playback') { clearTimer(); setPhase('idle'); setResolved(null); }
      else if (confirming) return;
      else if (canCommit) { if (loss) setConfirming(true); else startCommit(); }
    },
    undo: () => { if (!locked && q.queue.length > 0) { q.undo(); reset(); } },
    stepPrev: () => { if (!locked && q.stepIndex > 0) q.setStep(q.stepIndex - 1); },
    stepNext: () => { if (!locked && q.queue.length > 0) q.setStep(q.stepIndex + 1); },
    escape: () => { if (confirming) setConfirming(false); else reset(); },
  };

  const onSquare = (sq: Square): void => {
    if (locked) return;
    if (pendingSkill) {
      q.append({ type: 'ACTIVATE_SKILL', skillId: pendingSkill, target: sq });
      setPendingSkill(null);
      return;
    }
    if (selected && legal.includes(sq)) {
      q.append({ type: 'MOVE', from: selected, to: sq });
      setSelected(null);
      return;
    }
    if (sq === selected) { setSelected(null); return; }
    setSelected(planStage.board[sq]?.color === 'white' ? sq : null);
  };

  const arrows: Arrow[] = q.queue.flatMap((a) => (a.type === 'MOVE' ? [{ from: a.from, to: a.to, kind: 'plan' }] : []));
  if (hover && !locked) for (const from of threats[hover]?.attackers ?? []) arrows.push({ from, to: hover, kind: 'capture' });
  const marks: Mark[] = [];
  if (preview.error?.kind === 'king_in_check_at_end') marks.push({ square: preview.error.square, kind: 'king-unsafe', label: 'King in check' });

  const copies = (id: string): number => run.loadout.filter((l) => l.skillId === id).length;
  const used = (id: string): number => q.queue.filter((a) => a.type === 'ACTIVATE_SKILL' && a.skillId === id).length;
  const skillIds = [...new Set(run.loadout.map((l) => l.skillId))];

  const playing = locked && resolved !== null;
  return (
    <main
      className="screen action"
      data-testid="action-screen"
      onClick={() => { if (phase === 'playback') { clearTimer(); setPhase('idle'); setResolved(null); } }}
    >
      <Header session={session} />
      <div className="action-body">
        {playing ? (
          <Board stage={{ board: resolved }} reducedMotion={motionReduced} />
        ) : (
          <Board
            stage={stage}
            overlays={{ ghost: shown, threats, highlights: selected ? [selected, ...legal] : [], arrows, marks, plan }}
            onSquare={onSquare}
            onHover={setHover}
            onPlanArrow={(from, to, color) => setPlan((p) => toggleArrow(p, { from, to, color }))}
            onPlanMark={(square, color) => setPlan((p) => toggleMark(p, { square, color }))}
            onPlanClear={() => setPlan((p) => (p.arrows.length || p.marks.length ? clearPlan() : p))}
            reducedMotion={motionReduced}
            draggable={(sq) => !locked && planStage.board[sq]?.color === 'white'}
            onDragStart={(sq, e) => { setSelected(sq); e.dataTransfer?.setData('text/plain', sq); }}
            onDrop={(sq) => onSquare(sq)}
          />
        )}
        <aside className="side">
          <Hud session={session} preview={preview} focus={planStage.focus} credits={planStage.moveCredits} />
          {skillIds.length > 0 && (
            <div className="skills" data-testid="skills">
              <h2>Skills</h2>
              {skillIds.map((id) => {
                const def = engineConfig.skills[id];
                const spent = used(id) >= copies(id);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={locked || spent}
                    aria-pressed={pendingSkill === id}
                    onClick={() => {
                      if (!def || def.target.kind === 'none') q.append({ type: 'ACTIVATE_SKILL', skillId: id });
                      else { setSelected(null); setPendingSkill(pendingSkill === id ? null : id); }
                    }}
                  >
                    {skillName(id)} ({def?.cost ?? '?'} Focus){spent ? ' — used' : ''}
                  </button>
                );
              })}
              {pendingSkill && <p data-testid="skill-prompt">Choose a target square for {skillName(pendingSkill)}.</p>}
            </div>
          )}
          <h2>Queue</h2>
          <QueueStrip
            queue={q.queue}
            stage={stage}
            preview={preview}
            stepIndex={q.stepIndex}
            locked={locked}
            onRemove={(i) => { q.removeAt(i); reset(); }}
            onMove={q.move}
            onShow={q.setStep}
          />
          <p>
            <button type="button" disabled={locked || q.queue.length === 0} onClick={() => { q.undo(); reset(); }}>Undo</button>
            {' '}
            <button type="button" disabled={locked || q.queue.length === 0} onClick={() => { q.clear(); reset(); }}>Clear</button>
          </p>
          {queueError && <p role="alert" className="error" data-testid="queue-error">{queueError}</p>}
          {error && <p role="alert" className="error" data-testid="run-error">{error}</p>}
          {phase === 'thinking' && <p role="status" data-testid="thinking">The enemy is thinking…</p>}
          <button
            type="button"
            className="start commit"
            disabled={!canCommit}
            onClick={() => (loss ? setConfirming(true) : startCommit())}
          >
            COMMIT
          </button>
          {stage.turnsUsed === 0 && (
            <button
              type="button"
              disabled={locked}
              onClick={() => { q.clear(); reset(); dispatch({ type: 'restart' }); }}
            >
              Restart stage
            </button>
          )}
          {dev && <button type="button" disabled={locked} onClick={() => dispatch({ type: 'skip' })}>Skip stage (dev)</button>}
        </aside>
      </div>
      {confirming && (
        <div className="confirm" role="dialog" aria-modal="true" aria-label="Confirm commit">
          <p><strong>{loss}</strong></p>
          <p>Committing this queue loses the stage. Commit anyway?</p>
          <button type="button" autoFocus onClick={() => setConfirming(false)}>Cancel</button>
          {' '}
          <button type="button" onClick={startCommit}>Confirm: commit and lose</button>
        </div>
      )}
    </main>
  );
}
