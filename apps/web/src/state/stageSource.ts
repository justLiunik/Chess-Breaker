import type { StageState } from '@checkbreaker/engine';
import type { GenRequest } from '@checkbreaker/run';

export type StageAnswer =
  | { id: number; ok: true; stage: StageState; provenance: unknown; ms: number }
  | { id: number; ok: false; message: string };

/** Where stages come from: the generation worker in the app, a hand-made double in tests. */
export interface StageSource {
  /** `templateId` (dev bench only) offers just that template to the generator, so the draw lands on it. */
  request(id: number, req: GenRequest, templateId?: string): Promise<StageAnswer>;
}
