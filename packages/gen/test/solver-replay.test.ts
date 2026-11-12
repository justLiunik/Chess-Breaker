import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitQueue, startStage } from '@checkbreaker/engine';
import type { RunState, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import { solveStage } from '../src/solver';
import { queuesOf } from '../src/solver/beam';
import { replayLine } from '../src/solver/replay';
import type { Placement, SolveResult } from '../src/types';
import { config, deepFreeze } from './helpers';

type Name = 'mate2' | 'mate3' | 'bonus' | 'promotion';
type Fixture = { name: Name; run: RunState; stage: StageState; placements: Placement[]; mateTurn: number; deploymentRanks: number[] };
type Win = NonNullable<SolveResult['win']>;

const fixtures = deepFreeze(
  JSON.parse(readFileSync(new URL('./fixtures/solver-known.json', import.meta.url), 'utf8')) as Fixture[],
);
const NAMES = ['mate2', 'mate3', 'bonus', 'promotion'] as const;
const fixture = (name: Name): Fixture => fixtures.find((x) => x.name === name)!;
const configOf = (f: Fixture): GenConfig => ({ ...config, rules: { ...config.rules, deploymentRanks: f.deploymentRanks } });
const TIMEOUT = 120_000;

const found = new Map<Name, Win>();
function winOf(name: Name): Win {
  const hit = found.get(name);
  if (hit) return hit;
  const f = fixture(name);
  const r = solveStage(f.run, f.stage, configOf(f));
  if (!r.win) throw new Error(`${name}: no win`);
  found.set(name, r.win);
  return r.win;
}

describe('replayLine', () => {
  for (const name of NAMES) {
    it(`${name}: accepts the found line`, () => {
      const f = fixture(name);
      expect(replayLine(f.run, f.stage, winOf(name), configOf(f))).toBe(true);
    }, TIMEOUT);
  }

  it('rejects the same line with the last move changed to another legal square', () => {
    const f = fixture('mate3');
    const cfg = configOf(f);
    const win = winOf('mate3');
    // Play the line up to the last turn, then pick a different legal queue for it.
    const started = startStage(f.run, f.stage, win.placements, cfg);
    if (!started.ok) throw new Error('startStage');
    let { run, stage } = started.value;
    for (const q of win.line.slice(0, -1)) {
      const out = commitQueue(run, stage, q, cfg);
      if (!out.ok) throw new Error('commit');
      ({ run, stage } = out.value);
    }
    const last = win.line[win.line.length - 1]!;
    const lastMove = last[last.length - 1]!;
    const alt = queuesOf(stage, cfg).find((q) => {
      const m = q[q.length - 1];
      return q.length === last.length && m?.type === 'MOVE' && lastMove.type === 'MOVE'
        && m.from === lastMove.from && m.to !== lastMove.to;
    });
    expect(alt).toBeDefined();
    const altQueue = [...last.slice(0, -1), alt![alt!.length - 1]!];
    const bad: Win = { ...win, line: [...win.line.slice(0, -1), altQueue] };
    expect(replayLine(f.run, f.stage, bad, cfg)).toBe(false);
  }, TIMEOUT);

  it('rejects a line one turn longer than mateIn', () => {
    const f = fixture('mate2');
    const win = winOf('mate2');
    const longer: Win = { ...win, line: [...win.line, win.line[0]!], mateTurn: win.mateTurn + 1 };
    const stage = { ...f.stage, mateIn: win.mateTurn };
    expect(replayLine(f.run, stage, longer, configOf(f))).toBe(false);
  }, TIMEOUT);

  it('a line found with coins = 0 replays with coins = 0 and with coins = 999 (the shop cannot spoil the proof)', () => {
    const f = fixture('mate2');
    const cfg = configOf(f);
    const poor = { ...f.run, coins: 0 };
    const r = solveStage(poor, f.stage, cfg);
    expect(r.win).not.toBeNull();
    expect(replayLine({ ...f.run, coins: 0 }, f.stage, r.win!, cfg)).toBe(true);
    expect(replayLine({ ...f.run, coins: 999 }, f.stage, r.win!, cfg)).toBe(true);
  }, TIMEOUT);
});
