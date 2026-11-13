import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RunState, StageState } from '@checkbreaker/engine';
import type { Placement } from '../src/types';
import { config, deepFreeze } from './helpers';

// The beam claims a win that no engine replay can confirm: solveStage's replay gate must turn it into "not found".
vi.mock('../src/solver/beam', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/solver/beam')>();
  return { ...actual, runBeam: () => ({ kind: 'win', line: [[], []], mateTurn: 2 }) };
});
const { solveStage } = await import('../src/solver');

type Fixture = { name: string; run: RunState; stage: StageState; placements: Placement[]; deploymentRanks: number[] };
const fixtures = deepFreeze(
  JSON.parse(readFileSync(new URL('./fixtures/solver-known.json', import.meta.url), 'utf8')) as Fixture[],
);

describe('solveStage replay gate', () => {
  it('a bogus win from the beam is dropped and counted as a replay failure', () => {
    const f = fixtures.find((x) => x.name === 'mate2')!;
    const cfg = { ...config, rules: { ...config.rules, deploymentRanks: f.deploymentRanks } };
    const r = solveStage(f.run, f.stage, cfg);
    expect(r.win).toBeNull();
    expect(r.stats.replayFailures).toBe(1);
  });
});
