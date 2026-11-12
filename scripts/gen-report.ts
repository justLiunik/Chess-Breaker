// gen:report — solvability, mating turn vs par, nodes and wall time per template (M3 spec §11).
//   npm run gen:report -- [--stages N] [--template id] [--workers W] [--json out.json]
// Each stage is one `generateWith` call whose solver is wrapped to record `SolveResult.stats`.
// The precondition histogram covers only the emitted board of validationFailed stages; per-attempt failures of
// stages that later passed are not exposed by gen and are not counted.
// Numbers are deterministic whatever --workers is; only the wall times differ.
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { loadFormations, loadGenConfig, loadTemplates } from '@checkbreaker/content';
import { deckFor, makeRunner, slotOf } from './gen-report-worker';
import type { Job, StageRecord } from './gen-report-worker';

// Report parameters (not tuning numbers).
const DEFAULT_STAGES = 200;
const P95 = 0.95;
const TIERS = ['normal', 'rare', 'unique', 'legendary'] as const;

function parseArgs(argv: string[]): { stages: number; template?: string; workers: number; json?: string } {
  const out = {
    stages: DEFAULT_STAGES,
    template: undefined as string | undefined,
    workers: Math.max(1, availableParallelism() - 1),
    json: undefined as string | undefined,
  };
  for (let k = 0; k < argv.length; k++) {
    const flag = argv[k];
    const val = argv[++k];
    if (val === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--stages') out.stages = Number(val);
    else if (flag === '--template') out.template = val;
    else if (flag === '--workers') out.workers = Number(val);
    else if (flag === '--json') out.json = val;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isInteger(out.stages) || out.stages < 1) throw new Error('--stages must be a positive integer');
  if (!Number.isInteger(out.workers) || out.workers < 1) throw new Error('--workers must be a positive integer');
  return out;
}

const sortNum = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = sortNum(xs);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function pct(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = sortNum(xs);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)]!;
}
const stat = (xs: number[]): { median: number | null; p95: number | null } => ({ median: median(xs), p95: pct(xs, P95) });
const rate = (n: number, d: number): number => (d === 0 ? 0 : n / d);
const fmt = (x: number | null, digits = 0): string => (x === null ? '-' : x.toFixed(digits));

/** Runs the jobs on `workers` threads (round-robin split) and returns the records in job order. */
async function runJobs(jobs: Job[], workers: number): Promise<StageRecord[]> {
  if (workers === 1) {
    const run = makeRunner();
    return jobs.map(run);
  }
  const chunks: Job[][] = Array.from({ length: workers }, () => []);
  jobs.forEach((j, k) => chunks[k % workers]!.push(j));
  const parts = await Promise.all(
    chunks
      .filter((c) => c.length > 0)
      .map(
        (chunk) =>
          new Promise<StageRecord[]>((resolve, reject) => {
            const w = new Worker(new URL('./gen-report-worker.ts', import.meta.url), {
              workerData: { gen_report: true, jobs: chunk },
              execArgv: ['--import', 'tsx'],
            });
            w.once('message', resolve);
            w.once('error', reject);
            w.once('exit', (code) => code !== 0 && reject(new Error(`worker exited with code ${code}`)));
          }),
      ),
  );
  return parts.flat().sort((a, b) => a.index - b.index);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadGenConfig();
  const { minSolvableRate, medianMateTurnTolerance } = config.gen.acceptance;
  const templates = loadTemplates()
    .filter((t) => args.template === undefined || t.id === args.template)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (templates.length === 0) throw new Error(`no template ${args.template}`);
  const formations = loadFormations();

  const jobs: Job[] = [];
  for (const t of templates) for (let i = 0; i < args.stages; i++) jobs.push({ index: jobs.length, templateId: t.id, i });
  const t0 = performance.now();
  const records = await runJobs(jobs, args.workers);
  const elapsedMs = performance.now() - t0;

  const perTemplate = templates.map((t) => {
    const rs = records.filter((r) => r.templateId === t.id);
    const proven = rs.filter((r) => r.proven);
    const deck = deckFor(slotOf(t).actIndex).deck.filter((p) => p.pieceType !== 'king');
    const tierMix = Object.fromEntries(TIERS.map((r) => [r, deck.filter((p) => (p.rarity ?? 'normal') === r).length]));
    const hist: Record<string, number> = {};
    for (const r of rs) {
      if (!r.validationFailed) continue;
      const k = r.lastFailedPrecondition ?? 'none';
      hist[k] = (hist[k] ?? 0) + 1;
    }
    const medMate = median(proven.map((r) => r.mateTurn!));
    const medPar = median(rs.map((r) => r.par));
    return {
      templateId: t.id,
      act: t.act,
      stages: rs.length,
      proven: proven.length,
      provenRate: rate(proven.length, rs.length),
      medianMateTurn: medMate,
      medianPar: medPar,
      mateTurnFlag: medMate !== null && medPar !== null && Math.abs(medMate - medPar) > medianMateTurnTolerance,
      bonusPawnRate: rate(rs.filter((r) => r.bonusPawn).length, rs.length),
      screenNodes: stat(rs.map((r) => r.screenNodes)),
      deepNodes: stat(rs.map((r) => r.deepNodes)),
      screenPlusDeepNodes: stat(rs.map((r) => r.screenNodes + r.deepNodes)),
      attempts: stat(rs.map((r) => r.attempts)),
      solverCalls: stat(rs.map((r) => r.solverCalls)),
      deckTierMix: tierMix,
      validationFailed: rs.filter((r) => r.validationFailed).length,
      lastFailedPreconditionOfValidationFailed: hist,
      replayFailures: rs.reduce((a, r) => a + r.replayFailures, 0),
      formationPool: (formations[t.id] ?? []).length,
      wallMs: stat(rs.map((r) => r.ms)),
    };
  });
  const total = records.length;
  const provenTotal = records.filter((r) => r.proven).length;
  const overall = {
    stages: total,
    proven: provenTotal,
    provenRate: rate(provenTotal, total),
    minSolvableRate,
    pass: rate(provenTotal, total) >= minSolvableRate,
  };

  const lines: string[] = [];
  lines.push(`gen:report  ${args.stages} stages per template, ${templates.length} template(s), ${args.workers} worker(s)`);
  lines.push('Node counts, solver calls and attempts are per stage (summed over the up-to-maxBoards solver calls one stage makes).');
  lines.push(
    `Run seed report-<templateId>-<i>; decks: Act I starter, Act II mid, Act III strong. "!" = median mating turn vs median par differs by more than ${medianMateTurnTolerance}.`,
  );
  for (const p of perTemplate) {
    const mix = TIERS.map((r) => `${p.deckTierMix[r]} ${r}`).join(', ');
    lines.push('');
    lines.push(`${p.templateId} (act ${p.act})`);
    lines.push(`  proven within par   ${p.proven}/${p.stages} = ${(p.provenRate * 100).toFixed(1)}%`);
    lines.push(`  mating turn         median ${fmt(p.medianMateTurn, 1)} vs par ${fmt(p.medianPar, 1)}${p.mateTurnFlag ? '  !' : ''}`);
    lines.push(`  bonus-pawn rate     ${(p.bonusPawnRate * 100).toFixed(1)}%`);
    lines.push(`  screen nodes        median ${fmt(p.screenNodes.median)}  p95 ${fmt(p.screenNodes.p95)}`);
    lines.push(`  deep nodes          median ${fmt(p.deepNodes.median)}  p95 ${fmt(p.deepNodes.p95)}`);
    lines.push(`  wall time (ms)      median ${fmt(p.wallMs.median, 1)}  p95 ${fmt(p.wallMs.p95, 1)}`);
    lines.push(`  nodes by deck tiers [${mix}]: median screen+deep ${fmt(p.screenPlusDeepNodes.median)}`);
    lines.push(
      `  attempts            median ${fmt(p.attempts.median, 1)}  p95 ${fmt(p.attempts.p95)}; solver calls median ${fmt(p.solverCalls.median, 1)}  p95 ${fmt(p.solverCalls.p95)}`,
    );
    const h = Object.entries(p.lastFailedPreconditionOfValidationFailed)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(`  precondition fails  validationFailed ${p.validationFailed}${h ? ` (first failing precondition on the emitted board: ${h})` : ''}`);
    lines.push(`  replay failures     ${p.replayFailures}`);
    lines.push(`  formation pool      ${p.formationPool}`);
  }
  lines.push('');
  lines.push(
    `overall: proven ${overall.proven}/${overall.stages} = ${(overall.provenRate * 100).toFixed(1)}% vs minSolvableRate ${(minSolvableRate * 100).toFixed(1)}%  ${overall.pass ? 'PASS' : 'FAIL'}`,
  );
  lines.push(`wall time: ${(elapsedMs / 1000).toFixed(1)} s`);
  console.log(lines.join('\n'));

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify({ params: { stages: args.stages, template: args.template ?? null }, workers: args.workers, templates: perTemplate, overall, elapsedMs }, null, 2),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
