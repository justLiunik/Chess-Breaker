import { useState } from 'react';
import type { Action, StageState } from '@checkbreaker/engine';

export interface QueueApi {
  queue: Action[];
  append(a: Action): void;
  removeAt(i: number): void;
  move(from: number, to: number): void;
  undo(): void;
  clear(): void;
  /** The entry whose resulting position is previewed; -1 when the queue is empty. Follows the end until `setStep` picks one. */
  stepIndex: number;
  setStep(i: number): void;
}

type State = { key: string; queue: Action[]; step: number | null };

/** The queue being built for the current turn. It starts empty again whenever the stage moves on to another turn. */
export function useQueue(stage: StageState | null): QueueApi {
  const key = stage ? `${stage.stageSeed}:${stage.turnsUsed}` : '';
  const [state, setState] = useState<State>({ key, queue: [], step: null });
  let cur = state;
  if (state.key !== key) {
    cur = { key, queue: [], step: null };
    setState(cur);
  }
  const update = (f: (s: State) => State): void => setState((s) => f(s.key === key ? s : { key, queue: [], step: null }));
  const { queue } = cur;
  const stepIndex = cur.step === null ? queue.length - 1 : Math.min(cur.step, queue.length - 1);
  return {
    queue,
    stepIndex,
    append: (a) => update((s) => ({ ...s, queue: [...s.queue, a], step: null })),
    removeAt: (i) => update((s) => ({ ...s, queue: s.queue.filter((_, j) => j !== i), step: null })),
    move: (from, to) => update((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return s;
      const next = [...s.queue];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return { ...s, queue: next, step: null };
    }),
    undo: () => update((s) => ({ ...s, queue: s.queue.slice(0, -1), step: null })),
    clear: () => update((s) => ({ ...s, queue: [], step: null })),
    setStep: (i) => update((s) => ({ ...s, step: i >= s.queue.length - 1 ? null : Math.max(0, i) })),
  };
}
