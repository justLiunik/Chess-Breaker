import type { StageState } from '@checkbreaker/engine';
import type { GenRequest } from '@checkbreaker/run';

export type StageAnswer =
  | { id: number; ok: true; stage: StageState; ms: number }
  | { id: number; ok: false; message: string };

/** Where stages come from: the generation worker in the app, a hand-made double in tests. */
export interface StageSource {
  request(id: number, req: GenRequest): Promise<StageAnswer>;
}
