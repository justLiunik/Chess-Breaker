import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { loadFormations, loadGenConfig, loadTemplates } from '@checkbreaker/content';
import type { Formation, Template } from '@checkbreaker/content';
import type { RunState, StageState } from '@checkbreaker/engine';
import { enemyBoard } from '../src/board';
import { drawPar, placeSpawnedPawns } from '../src/spawn';
import { buildStage } from '../src/stage';
import { deepFreeze } from '../../engine/test/helpers';

export { deepFreeze };

export const config = loadGenConfig();

export function tpl(over: Partial<Template> & { id: string }): Template {
  return {
    title: over.id,
    act: 1,
    tier: 'normal',
    mateIn: [3, 4],
    spawnedPawns: { count: [1, 1], ranks: [3] },
    focusPool: 3,
    enemyPolicy: { type: 'best_move', depth: 2 },
    preconditions: [],
    ...over,
  } as Template;
}

export const stubFormations: Formation[] = [
  { id: 'f1', rating: 1000, black: '1n5k/pp3ppp/8/8/8/8/8/8' },
  { id: 'f2', rating: 1100, black: '6k1/5ppp/8/8/8/8/8/3r4' },
  { id: 'f3', rating: 1200, black: 'r5k1/1p3ppp/8/8/8/8/8/8' },
];

/** The RunState of `content/examples/run-<name>.yaml`, deep-frozen. */
export function exampleRun(name: 'starter' | 'mid'): RunState {
  const url = new URL(`../../../content/examples/run-${name}.yaml`, import.meta.url);
  return deepFreeze(parse(readFileSync(url, 'utf8')) as RunState);
}

/** The example deck `name` at (actIndex, stageIndex), deep-frozen. The 'strong' deck arrives in Task 17; Act III uses 'mid' until then. */
export function deckRun(name: 'starter' | 'mid' | 'strong', actIndex: number, stageIndex: number): RunState {
  const file = name === 'strong' ? 'mid' : name; // TODO Task 17: load run-strong.yaml
  const url = new URL(`../../../content/examples/run-${file}.yaml`, import.meta.url);
  return deepFreeze({ ...(parse(readFileSync(url, 'utf8')) as RunState), actIndex, stageIndex });
}

/**
 * The first `n` boards that G2 and G4 build for a content template, one per seed `GEN-<i>` at
 * attempt 0, as deep-frozen Deployment-phase stages.
 */
export function generatedStages(templateId: string, n: number): { tpl: Template; stage: StageState }[] {
  const t = loadTemplates().find((x) => x.id === templateId);
  if (!t) throw new Error(`no template ${templateId}`);
  const formations = loadFormations()[t.id] ?? [];
  const out: { tpl: Template; stage: StageState }[] = [];
  for (let i = 0; out.length < n; i++) {
    if (i >= 100 * n) throw new Error(`generatedStages: only ${out.length} of ${n} boards for ${templateId} in ${i} seeds`);
    const seed = `GEN-${i}`;
    const enemy = enemyBoard(t, formations, seed, 0, config);
    const board = enemy && placeSpawnedPawns(enemy.board, t, seed, 0, config);
    if (!board) continue;
    out.push({ tpl: t, stage: deepFreeze(buildStage(t, board, `act${t.act}`, t.tier, seed, drawPar(t, seed), config)) });
  }
  return out;
}
