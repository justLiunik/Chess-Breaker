import type { StageState } from '@checkbreaker/engine';
import type { CluePlacement, GenRequest } from '@checkbreaker/run';

export type StageAnswer =
  | { id: number; ok: true; stage: StageState; provenance: unknown; ms: number; clue: CluePlacement[] | null }
  | { id: number; ok: false; message: string };

/** The placements only: a fresh `{ instanceId, to }` per entry, so nothing else of the solution (its move line) is posted. */
export function clueOf(solution: { placements: CluePlacement[] } | null): CluePlacement[] | null {
  return solution ? solution.placements.map((p) => ({ instanceId: p.instanceId, to: p.to })) : null;
}

/** Where stages come from: the generation worker in the app, a hand-made double in tests. */
export interface StageSource {
  /** `templateId` (dev bench only) offers just that template to the generator, so the draw lands on it. */
  request(id: number, req: GenRequest, templateId?: string): Promise<StageAnswer>;
}
