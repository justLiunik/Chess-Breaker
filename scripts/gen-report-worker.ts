// The per-stage work of gen:report, shared by the main thread (--workers 1) and the worker threads.
// A worker gets a list of (template, i) jobs and returns one plain record per job; aggregation
// happens on the main thread in job order, so the numbers never depend on the worker count.
// Only `ms` (wall time, performance.now) varies between runs. performance.now lives in scripts only.
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { parse } from 'yaml';
import { loadFormations, loadGenConfig, loadTemplates } from '@checkbreaker/content';
import type { GenConfig } from '@checkbreaker/content';
import type { RunState } from '@checkbreaker/engine';
import { checkPreconditions, generateWith, solveStage } from '@checkbreaker/gen';
import type { GenContent, SolveResult } from '@checkbreaker/gen';

export type Job = { index: number; templateId: string; i: number };

/** What one generated stage tells the report. */
export type StageRecord = {
  index: number;
  templateId: string;
  par: number; // stage.mateIn
  proven: boolean;
  bonusPawn: boolean;
  validationFailed: boolean;
  /** For a validationFailed stage: the first precondition failing on the board that was emitted. */
  lastFailedPrecondition: string | null;
  attempts: number;
  mateTurn: number | null; // the winning line's mating turn, when proven
  solverCalls: number; // solver calls this stage made (up to maxBoards)
  screenNodes: number; // sums over this stage's solver calls
  deepNodes: number;
  enemyCalls: number;
  memoHits: number;
  replayFailures: number;
  ms: number;
};

const DECK_FILES = ['run-starter.yaml', 'run-mid.yaml', 'run-act3-strong.yaml'];

/** The fixed deck of an act (0-2): starter, mid, strong. */
export function deckFor(actIndex: number): RunState {
  const file = DECK_FILES[actIndex];
  if (file === undefined) throw new Error(`no deck for act index ${actIndex}`);
  return parse(readFileSync(new URL(`../content/examples/${file}`, import.meta.url), 'utf8')) as RunState;
}

/** The (actIndex, stageIndex) pair that draws a template: bosses at stage 2, others at stage 0. */
export const slotOf = (t: { act: number; tier: string }): { actIndex: number; stageIndex: number } => ({
  actIndex: t.act - 1,
  stageIndex: t.tier === 'boss' ? 2 : 0,
});

export function makeRunner(): (job: Job) => StageRecord {
  const config: GenConfig = loadGenConfig();
  const templates = loadTemplates();
  const formations = loadFormations();
  return (job) => {
    const tpl = templates.find((t) => t.id === job.templateId);
    if (!tpl) throw new Error(`no template ${job.templateId}`);
    const { actIndex, stageIndex } = slotOf(tpl);
    const run: RunState = { ...deckFor(actIndex), actIndex, stageIndex, seed: `report-${tpl.id}-${job.i}` };
    // Only this template is offered, so the (act, stage) pair draws it.
    const content: GenContent = { templates: [tpl], formations };
    const sum = { calls: 0, screen: 0, deep: 0, enemy: 0, memo: 0, replay: 0 };
    let mateTurn: number | null = null;
    const wrapped = (r: RunState, s: Parameters<typeof solveStage>[1], c: GenConfig): SolveResult => {
      const res = solveStage(r, s, c);
      sum.calls++;
      sum.screen += res.stats.screenNodes;
      sum.deep += res.stats.deepNodes;
      sum.enemy += res.stats.enemyCalls;
      sum.memo += res.stats.memoHits;
      sum.replay += res.stats.replayFailures;
      if (res.win) mateTurn = res.win.mateTurn;
      return res;
    };
    const t0 = performance.now();
    const { stage, provenance } = generateWith({ run, actIndex, stageIndex }, content, config, wrapped);
    const ms = performance.now() - t0;
    const validationFailed = provenance.validationFailed === true;
    return {
      index: job.index,
      templateId: tpl.id,
      par: stage.mateIn,
      proven: provenance.proven,
      bonusPawn: provenance.bonusPawn,
      validationFailed,
      lastFailedPrecondition: validationFailed ? checkPreconditions(run, stage, tpl, { extraPawns: 0 }, config) : null,
      attempts: provenance.attempts,
      mateTurn: provenance.proven ? mateTurn : null,
      solverCalls: sum.calls,
      screenNodes: sum.screen,
      deepNodes: sum.deep,
      enemyCalls: sum.enemy,
      memoHits: sum.memo,
      replayFailures: sum.replay,
      ms,
    };
  };
}

// Worker entry: runs only when started as a worker thread.
if (parentPort && workerData && (workerData as { gen_report?: boolean }).gen_report) {
  const run = makeRunner();
  parentPort.postMessage((workerData as { jobs: Job[] }).jobs.map(run));
}
