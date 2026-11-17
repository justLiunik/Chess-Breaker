import type { GenRequest } from '@checkbreaker/run';
import type { StageAnswer, StageSource } from './stageSource';

/** A `StageSource` backed by the generation Web Worker (created on first use). One answer per posted id. */
export function workerSource(): StageSource {
  let worker: Worker | null = null;
  const waiting = new Map<number, (a: StageAnswer) => void>();
  const failAll = (message: string): void => {
    for (const [id, resolve] of waiting) resolve({ id, ok: false, message });
    waiting.clear();
  };
  const ensure = (): Worker => {
    if (worker) return worker;
    const w = new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<StageAnswer>): void => {
      const resolve = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      resolve?.(e.data);
    };
    w.onerror = (e: ErrorEvent): void => {
      // A dead worker is dropped so the next request starts a fresh one.
      w.terminate();
      worker = null;
      failAll(e.message || 'the generation worker failed');
    };
    worker = w;
    return w;
  };
  return {
    request(id: number, request: GenRequest, templateId?: string): Promise<StageAnswer> {
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        try {
          ensure().postMessage({ id, request, templateId });
        } catch (e) {
          waiting.delete(id);
          resolve({ id, ok: false, message: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
