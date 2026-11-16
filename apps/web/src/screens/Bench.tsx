import { useMemo, useRef, useState } from 'react';
import { enemyMove } from '@checkbreaker/engine';
import type { StageState } from '@checkbreaker/engine';
import { parseRunState, parseTemplates } from '@checkbreaker/content/parse';
import type { GenRequest } from '@checkbreaker/run';
import { GAME_FENS, RARITY_FENS, fenToStage, rarityStage } from '../../../../packages/engine/test/bench-positions';
import { engineConfig } from '../config';
import { benchDeckTexts, genTexts } from '../state/genContent';
import type { StageSource } from '../state/stageSource';

// Dev page at /#bench: stage-generation wall time per template (measured inside the generation worker)
// and the enemy search time on the main thread. Numbers depend on the machine it runs on.
const DEFAULT_STAGES = 10;
const DEFAULT_WARMUPS = 3;
const DEFAULT_RUNS = 20;
const ENEMY_CLOCK = 6; // player turns left, as the engine bench passes it
const ENEMY_DEPTH = 4;
const P95 = 0.95;

export interface BenchProps {
  source: StageSource;
  /** Timed enemy searches per position (default 20). */
  enemyRuns?: number;
  /** Untimed enemy searches before them (default 3). */
  enemyWarmups?: number;
}

type GenRow = { id: string; act: number; stages: number; failed: number; median: number | null; p95: number | null };
type EnemyRow = { fen: string; rarity: string; median: number; max: number };

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = sorted(xs);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function percentile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  return sorted(xs)[Math.max(0, Math.ceil(q * xs.length) - 1)]!;
}
const fmt = (x: number | null): string => (x === null ? '-' : x.toFixed(1));
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function genTable(rows: GenRow[]): string {
  return [
    '| Template | Act | Stages | Failed | Median ms | p95 ms |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.id} | ${r.act} | ${r.stages} | ${r.failed} | ${fmt(r.median)} | ${fmt(r.p95)} |`),
  ].join('\n');
}

function enemyTable(rows: EnemyRow[]): string {
  return [
    '| Position | Rarity | Median ms | Max ms |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.fen} | ${r.rarity} | ${fmt(r.median)} | ${fmt(r.max)} |`),
  ].join('\n');
}

export function Bench({ source, enemyRuns = DEFAULT_RUNS, enemyWarmups = DEFAULT_WARMUPS }: BenchProps) {
  const templates = useMemo(() => parseTemplates(genTexts.templates), []);
  const decks = useMemo(() => benchDeckTexts.map(parseRunState), []);
  const [count, setCount] = useState(String(DEFAULT_STAGES));
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [genRows, setGenRows] = useState<GenRow[]>([]);
  const [enemyRows, setEnemyRows] = useState<EnemyRow[]>([]);
  const nextId = useRef(1);

  const run = async (): Promise<void> => {
    const n = Math.max(1, Math.floor(Number(count)) || DEFAULT_STAGES);
    setRunning(true);
    setGenRows([]);
    setEnemyRows([]);

    // Generation, one template after another through the one worker, as the game uses it.
    for (const t of templates) {
      setStatus(`Generating ${t.id} (${n} stages)...`);
      const actIndex = t.act - 1;
      const stageIndex = t.tier === 'boss' ? 2 : 0;
      const times: number[] = [];
      let failed = 0;
      for (let i = 0; i < n; i++) {
        const request: GenRequest = {
          run: { ...decks[actIndex]!, actIndex, stageIndex, seed: `bench-${t.id}-${i}` },
          actIndex,
          stageIndex,
        };
        const answer = await source.request(nextId.current++, request, t.id);
        if (answer.ok) times.push(answer.ms);
        else failed++;
      }
      const row: GenRow = { id: t.id, act: t.act, stages: n, failed, median: median(times), p95: percentile(times, P95) };
      setGenRows((rows) => [...rows, row]);
    }

    // Enemy search on the main thread: the public enemyMove at depth 4 (capped on rarity boards by the engine).
    const positions: { fen: string; rarity: string; stage: StageState }[] = [
      ...GAME_FENS.map((fen) => ({
        fen, rarity: 'normal', stage: fenToStage(fen, { enemyPolicy: { type: 'best_move', depth: ENEMY_DEPTH } }),
      })),
      ...RARITY_FENS.map(({ fen, rarity }) => {
        const stage = rarityStage(fen, rarity);
        return { fen, rarity, stage: { ...stage, enemyPolicy: { type: 'best_move' as const, depth: ENEMY_DEPTH } } };
      }),
    ];
    for (const [k, p] of positions.entries()) {
      setStatus(`Enemy search ${k + 1}/${positions.length}...`);
      await tick();
      for (let i = 0; i < enemyWarmups; i++) enemyMove(p.stage, 1, ENEMY_CLOCK, engineConfig);
      const times: number[] = [];
      for (let i = 0; i < enemyRuns; i++) {
        const t0 = performance.now();
        enemyMove(p.stage, 1, ENEMY_CLOCK, engineConfig);
        times.push(performance.now() - t0);
      }
      const row: EnemyRow = { fen: p.fen, rarity: p.rarity, median: median(times) ?? 0, max: Math.max(...times, 0) };
      setEnemyRows((rows) => [...rows, row]);
    }
    setStatus('Done.');
    setRunning(false);
  };

  const copy = (): void => {
    const text = [
      '## Stage generation (Web Worker, ms per stage)', '', genTable(genRows), '',
      `## Enemy search (main thread, depth ${ENEMY_DEPTH}, ms; ${enemyWarmups} warm-ups, ${enemyRuns} runs)`, '', enemyTable(enemyRows), '',
    ].join('\n');
    void navigator.clipboard.writeText(text);
  };

  return (
    <main className="bench">
      <h1>Dev bench</h1>
      <p>Numbers depend on the machine and browser this runs on; compare only runs from the same one.</p>
      <p>
        <label>
          Stages per template
          {' '}
          <input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} disabled={running} />
        </label>
        {' '}
        <button type="button" onClick={() => void run()} disabled={running}>Run bench</button>
        {' '}
        <button type="button" onClick={copy} disabled={running || (genRows.length === 0 && enemyRows.length === 0)}>
          Copy as Markdown
        </button>
      </p>
      <p role="status">{status}</p>

      <h2>Stage generation (Web Worker)</h2>
      <table>
        <thead>
          <tr><th>Template</th><th>Act</th><th>Stages</th><th>Failed</th><th>Median ms</th><th>p95 ms</th></tr>
        </thead>
        <tbody>
          {genRows.map((r) => (
            <tr key={r.id} data-testid={`gen-${r.id}`}>
              <td>{r.id}</td><td>{r.act}</td><td>{r.stages}</td><td>{r.failed}</td><td>{fmt(r.median)}</td><td>{fmt(r.p95)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Enemy search (main thread)</h2>
      <table>
        <thead>
          <tr><th>Position</th><th>Rarity</th><th>Median ms</th><th>Max ms</th></tr>
        </thead>
        <tbody>
          {enemyRows.map((r, k) => (
            <tr key={k} data-testid={`enemy-${k}`}>
              <td>{r.fen}</td><td>{r.rarity}</td><td>{fmt(r.median)}</td><td>{fmt(r.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
