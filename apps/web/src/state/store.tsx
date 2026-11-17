import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { commitQueue as playQueue, previewSteps } from '@checkbreaker/engine';
import type { Action, Award, Square, StageState } from '@checkbreaker/engine';
import {
  abandon, buy, commit, cut, devSkipStage, leave, loadSave, merge, newRun, provideStage, reroll, repair, restartStage,
  sell, serializeSave, start,
} from '@checkbreaker/run';
import type { GenRequest, RunResult, RunSession, RunStorage } from '@checkbreaker/run';
import { engineConfig, runConfig } from '../config';
import { runErrorText, saveErrorText } from '../messages';
import { devToggle } from '../storage';
import type { StageSource } from './stageSource';

export type UiAction =
  | { type: 'new_run'; seed?: string }
  | { type: 'continue' }
  | { type: 'retry' }
  | { type: 'start'; placements: { instanceId: string; to: Square }[] }
  | { type: 'commit'; queue: Action[] }
  | { type: 'restart' }
  | { type: 'skip' }
  | { type: 'buy'; slot: number; replace?: number }
  | { type: 'repair'; id: string }
  | { type: 'reroll' }
  | { type: 'sell'; id: string }
  | { type: 'cut'; id: string }
  | { type: 'merge'; ids: string[] }
  | { type: 'leave' }
  | { type: 'abandon' }
  | { type: 'set_dev'; on: boolean }
  | { type: 'ack_commit' }
  | { type: 'to_title' };

type Board = StageState['board'];

/**
 * The positions of a commit that ended its stage, for the playback that precedes the results screens:
 * `resolved` is the player's own position (before the enemy replies), `after` the board once the reply is made
 * (null for a win, which has no reply). A win also keeps the engine's `stage_won` award and the stage's salvage
 * (the history record's `coinsEarned` less the award), for the Stage Results breakdown.
 */
export interface LastCommit { resolved: Board; after: Board | null; won: boolean; award: Award | null; salvage: number }

export interface RunApi {
  session: RunSession | null;
  dispatch(action: UiAction): void;
  /** The last refused player action; the next successful action clears it. */
  error: string | null;
  /**
   * A failed stage generation (or a stage the run refused). It outlives later actions, so Building and the Shop keep
   * offering Retry; only `retry`, a good answer, `new_run`, `continue` and `to_title` clear it.
   */
  genError: string | null;
  generating: boolean;
  dev: boolean;
  lastCommit: LastCommit | null;
  storage: RunStorage;
}

/** A fresh run seed, `XXXX-XXXX` uppercase hex: the only randomness in the app, and it is outside the rules. */
export function newSeed(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  const h = n!.toString(16).toUpperCase().padStart(8, '0');
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

type View = {
  session: RunSession | null; error: string | null; genError: string | null; generating: boolean; lastCommit: LastCommit | null;
};

const Ctx = createContext<RunApi | null>(null);

export function RunProvider({ source, storage, children }: { source: StageSource; storage: RunStorage; children: ReactNode }) {
  const [view, setView] = useState<View>({ session: null, error: null, genError: null, generating: false, lastCommit: null });
  const [dev, setDev] = useState<boolean>(() => devToggle.read());

  // The truth lives in refs so async answers always see the current session; `view` mirrors it for rendering.
  const sessionRef = useRef<RunSession | null>(null);
  const errorRef = useRef<string | null>(null);
  const genErrorRef = useRef<string | null>(null);
  const lastCommitRef = useRef<LastCommit | null>(null);
  const pendingRef = useRef<{ id: number; request: GenRequest } | null>(null);
  const failedRef = useRef<GenRequest | null>(null);
  const nextId = useRef(1);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const publish = useCallback((): void => {
    if (!mounted.current) return;
    setView({
      session: sessionRef.current,
      error: errorRef.current,
      genError: genErrorRef.current,
      generating: pendingRef.current !== null,
      lastCommit: lastCommitRef.current,
    });
  }, []);

  /** Posts the session's request when it has one without a stage and none is in flight or failed for it. */
  const sync = useCallback((): void => {
    const next = sessionRef.current?.next ?? null;
    const wanted = next && next.stage === null ? next.request : null;
    if (!wanted) {
      pendingRef.current = null; // an answer for a request nobody wants any more is dropped
      return;
    }
    if (pendingRef.current?.request === wanted || failedRef.current === wanted) return;
    const id = nextId.current++;
    pendingRef.current = { id, request: wanted };
    const fail = (message: string): void => {
      if (pendingRef.current?.id !== id) return; // stale
      pendingRef.current = null;
      failedRef.current = wanted;
      genErrorRef.current = `Stage generation failed: ${message}`;
      publish();
    };
    sourceRef.current.request(id, wanted).then((answer) => {
      if (pendingRef.current?.id !== id || answer.id !== id) return; // stale: the run moved on
      if (!answer.ok) return fail(answer.message);
      const r = provideStage(sessionRef.current!, answer.stage, runConfig);
      pendingRef.current = null;
      if (!r.ok) {
        failedRef.current = wanted;
        genErrorRef.current = runErrorText(r.error);
      } else {
        genErrorRef.current = null;
        accept(r.value.session);
      }
      publish();
    }, (e: unknown) => fail(e instanceof Error ? e.message : String(e)));
  }, [publish]);

  const accept = (session: RunSession): void => {
    sessionRef.current = session;
    storageRef.current.write(serializeSave(session, new Date().toISOString()));
    sync();
  };

  const run = (r: RunResult, lastCommit: LastCommit | null = null): void => {
    if (r.ok) {
      errorRef.current = null;
      lastCommitRef.current = lastCommit;
      accept(r.value.session);
    } else {
      errorRef.current = runErrorText(r.error);
    }
    publish();
  };

  /** A commit; one that ends the stage also records the positions the endings screens replay. */
  const commitQueue = (s: RunSession, queue: Action[]): void => {
    const r = commit(s, queue, runConfig);
    let last: LastCommit | null = null;
    if (r.ok && r.value.session.phase !== 'action' && s.stage) {
      const preview = previewSteps(s.run, s.stage, queue, engineConfig);
      const resolved = preview.steps.at(-1)?.stage.board;
      if (resolved) {
        const won = preview.result?.stage.status === 'won';
        // The preview stops before the enemy's reply; the engine's own commit gives the board after it (none if the
        // queue itself ended the stage).
        const played = won ? null : playQueue(s.run, s.stage, queue, engineConfig);
        const board = played?.ok ? played.value.stage.board : null;
        const wonEvent = r.ok ? r.value.events.find((e) => e.type === 'stage_won') : undefined;
        const award = wonEvent?.type === 'stage_won' ? wonEvent.award : null;
        const earned = r.ok ? r.value.session.run.history.at(-1)?.coinsEarned ?? 0 : 0;
        last = {
          resolved, after: board && JSON.stringify(board) !== JSON.stringify(resolved) ? board : null, won,
          award, salvage: award ? earned - award.coins : earned,
        };
      }
    }
    run(r, last);
  };

  const dispatch = useCallback((a: UiAction): void => {
    const s = sessionRef.current;
    const c = runConfig;
    if (a.type === 'set_dev') {
      devToggle.write(a.on);
      setDev(a.on);
      return;
    }
    if (a.type === 'ack_commit') {
      lastCommitRef.current = null;
      publish();
      return;
    }
    if (a.type === 'to_title') {
      pendingRef.current = null;
      failedRef.current = null;
      errorRef.current = null;
      genErrorRef.current = null;
      lastCommitRef.current = null;
      sessionRef.current = null;
      publish();
      return;
    }
    if (a.type === 'new_run') {
      lastCommitRef.current = null;
      pendingRef.current = null;
      failedRef.current = null;
      errorRef.current = null;
      genErrorRef.current = null;
      accept(newRun(a.seed ?? newSeed(), c));
      publish();
      return;
    }
    if (a.type === 'continue') {
      const text = storageRef.current.read();
      if (text === null) return;
      const back = loadSave(text, c);
      if (!back.ok) {
        errorRef.current = saveErrorText(back.error);
        publish();
        return;
      }
      pendingRef.current = null;
      failedRef.current = null;
      errorRef.current = null;
      genErrorRef.current = null;
      lastCommitRef.current = null;
      sessionRef.current = back.value;
      sync();
      publish();
      return;
    }
    if (a.type === 'retry') {
      failedRef.current = null;
      genErrorRef.current = null;
      sync();
      publish();
      return;
    }
    if (!s) return;
    switch (a.type) {
      case 'start': return run(start(s, a.placements, c));
      case 'commit': return commitQueue(s, a.queue);
      case 'restart': return run(restartStage(s, c));
      case 'skip': return run(devSkipStage(s, c));
      case 'buy': return run(buy(s, a.slot, a.replace === undefined ? {} : { replace: a.replace }, c));
      case 'repair': return run(repair(s, a.id, c));
      case 'reroll': return run(reroll(s, c));
      case 'sell': return run(sell(s, a.id, c));
      case 'cut': return run(cut(s, a.id, c));
      case 'merge': return run(merge(s, a.ids, c));
      case 'leave': return run(leave(s, c));
      case 'abandon': return run(abandon(s));
    }
  }, []);

  const api = useMemo<RunApi>(() => ({ ...view, dispatch, dev, storage }), [view, dispatch, dev, storage]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useRun(): RunApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useRun must be used inside <RunProvider>');
  return api;
}
