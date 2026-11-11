import type { Action, RunState, Square } from '@checkbreaker/engine';
import type { Formation, Template } from '@checkbreaker/content';

export type GenInput = { run: RunState; actIndex: number; stageIndex: number; previousTemplateId?: string };
export type GenContent = { templates: Template[]; formations: Record<string, Formation[]> };
export type Placement = { instanceId: string; to: Square };

export type Provenance = {
  templateId: string;
  seed: string;
  formationId: string | null;
  mirrored: boolean;
  attempts: number;
  proven: boolean;
  bonusPawn: boolean;
  solverNodes: number;
  validationFailed?: true;
};

export type SolveResult = {
  win: { placements: Placement[]; line: Action[][]; mateTurn: number } | null;
  stats: { screenNodes: number; deepNodes: number; deployments: number; enemyCalls: number; memoHits: number };
};
