import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitQueue, simulate, startStage } from '@checkbreaker/engine';
import type { Action, BoardPiece, GameEvent, PieceInstance, RunState, Square, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import { solveStage } from '../src/solver';
import { queueText, queuesOf } from '../src/solver/beam';
import { deploymentCandidates } from '../src/solver/deployment';
import { buildStage } from '../src/stage';
import type { Placement, SolveResult } from '../src/types';
import { config, deepFreeze, tpl } from './helpers';
import { bruteQueues } from './solver/brute';

type Name = 'mate2' | 'mate3' | 'bonus' | 'promotion';
type Fixture = {
  name: Name;
  run: RunState;
  stage: StageState;
  placements: Placement[];
  mateTurn: number;
  deploymentRanks: number[];
};

const fixtures = deepFreeze(
  JSON.parse(readFileSync(new URL('./fixtures/solver-known.json', import.meta.url), 'utf8')) as Fixture[],
);

function fixture(name: Name): Fixture {
  const f = fixtures.find((x) => x.name === name);
  if (f === undefined) throw new Error(`solver-known.json has no ${name} fixture`);
  return f;
}

/** The test config each fixture was frozen with. */
const configOf = (f: Fixture): GenConfig => ({
  ...config, rules: { ...config.rules, deploymentRanks: f.deploymentRanks },
});

/** `config` with some `gen.solver` keys replaced. */
const withSolver = (base: GenConfig, over: Partial<GenConfig['gen']['solver']>): GenConfig => ({
  ...base,
  gen: { ...base.gen, solver: { ...base.gen.solver, ...over } },
});

/** The enemy's search runs hundreds of times per solve: a generous cap per test. */
const TIMEOUT = 120_000;

/** One solve per fixture, shared by the tests that read it. */
const solved = new Map<Name, SolveResult>();
function solve(name: Name): SolveResult {
  const hit = solved.get(name);
  if (hit !== undefined) return hit;
  const f = fixture(name);
  const r = solveStage(f.run, f.stage, configOf(f));
  solved.set(name, r);
  return r;
}

const nodes = (r: SolveResult): number => r.stats.screenNodes + r.stats.deepNodes;

/** Replays a win through startStage and commitQueue: the final stage and every event. */
function replay(run0: RunState, stage0: StageState, win: NonNullable<SolveResult['win']>, cfg: GenConfig) {
  const started = startStage(run0, stage0, win.placements, cfg);
  if (!started.ok) throw new Error(JSON.stringify(started.error));
  let { run, stage } = started.value;
  const events: GameEvent[] = [];
  for (const queue of win.line) {
    expect(stage.status).toBe('active');
    const out = commitQueue(run, stage, queue, cfg);
    if (!out.ok) throw new Error(JSON.stringify(out.error));
    ({ run, stage } = out.value);
    events.push(...out.value.events);
  }
  return { stage, events };
}

describe('solveStage on the frozen fixtures', () => {
  for (const name of ['mate2', 'mate3', 'bonus', 'promotion'] as const) {
    it(`${name}: finds a win on a turn from minSolveTurns to mateIn, and the line replays to checkmate`, () => {
      const f = fixture(name);
      const r = solve(name);
      expect(r.win).not.toBeNull();
      const win = r.win!;
      expect(win.mateTurn).toBeLessThanOrEqual(f.stage.mateIn);
      expect(win.mateTurn).toBeGreaterThanOrEqual(2);
      expect(win.mateTurn).toBeGreaterThanOrEqual(config.gen.solver.minSolveTurns);
      expect(win.line).toHaveLength(win.mateTurn);
      const { stage } = replay(f.run, f.stage, win, configOf(f));
      expect(stage.status).toBe('won');
      expect(stage.endReason).toBe('checkmate');
      expect(stage.turnsUsed).toBe(win.mateTurn);
      // Every node is one enemy reply needed: computed or read from the memo.
      expect(nodes(r)).toBe(r.stats.enemyCalls + r.stats.memoHits);
      expect(r.stats.deployments).toBeGreaterThan(0);
    }, TIMEOUT);
  }

  it('bonus: the line contains a two-action queue', () => {
    expect(solve('bonus').win!.line.some((q) => q.length === 2)).toBe(true);
  }, TIMEOUT);

  it('promotion: replaying the line through commitQueue emits pawn_promoted', () => {
    const f = fixture('promotion');
    const { events } = replay(f.run, f.stage, solve('promotion').win!, configOf(f));
    expect(events.some((e) => e.type === 'pawn_promoted')).toBe(true);
  }, TIMEOUT);

  it('mate3: reads the enemy-reply memo (memoHits > 0)', () => {
    expect(solve('mate3').stats.memoHits).toBeGreaterThan(0);
  }, TIMEOUT);

  it('the same input twice gives deep equality', () => {
    const f = fixture('mate3');
    expect(solveStage(f.run, f.stage, configOf(f))).toEqual(solve('mate3'));
  }, TIMEOUT);

  it('memoizeEnemyReplies: false finds the same win with the same nodes, every one an enemy call', () => {
    const f = fixture('bonus');
    const memo = solve('bonus');
    expect(memo.stats.memoHits).toBeGreaterThan(0); // otherwise the comparison below cannot fail
    const plain = solveStage(f.run, f.stage, withSolver(configOf(f), { memoizeEnemyReplies: false }));
    expect(plain.win).toEqual(memo.win);
    expect(plain.stats).toEqual({
      ...memo.stats, enemyCalls: memo.stats.enemyCalls + memo.stats.memoHits, memoHits: 0,
    });
  }, TIMEOUT);
});

describe('queuesOf', () => {
  it("is the oracle's full queue set, in the same order (bonus pairs and pawns to rank 8 included)", () => {
    for (const name of ['bonus', 'promotion', 'mate3'] as const) {
      const f = fixture(name);
      const started = startStage(f.run, f.stage, f.placements, configOf(f));
      if (!started.ok) throw new Error(JSON.stringify(started.error));
      const s = started.value.stage;
      const ours = queuesOf(s, configOf(f)).map(queueText);
      expect(ours).toEqual(bruteQueues(s, { bonus: true, pawnToRank8: true }, configOf(f)).map(queueText));
      expect(new Set(ours).size).toBe(ours.length);
    }
  });
});

describe('nodeBudget', () => {
  it('nodeBudget: 50 stops with win: null after exactly 50 nodes, with identical stats on a second run', () => {
    const f = fixture('mate3');
    // The unlimited solve needs more than 50 nodes before its win, so a budget of 50 must stop it.
    expect(nodes(solve('mate3'))).toBeGreaterThan(50);
    const cfg = withSolver(configOf(f), { nodeBudget: 50 });
    const a = solveStage(f.run, f.stage, cfg);
    expect(a.win).toBeNull();
    expect(a.stats.screenNodes + a.stats.deepNodes).toBe(50);
    const b = solveStage(f.run, f.stage, cfg);
    expect(b.stats).toEqual(a.stats);
    expect(b).toEqual(a);
  }, TIMEOUT);
});

describe('minSolveTurns', () => {
  // Task 11's back-rank board: Kg8 and pawns b7-h7 with no luft; a rook on the a-file mates on a8.
  const TYPES: Record<string, BoardPiece['pieceType']> = { K: 'king', P: 'pawn' };
  const BACK_RANK = 'Kg8 Pb7 Pc7 Pd7 Pe7 Pf7 Pg7 Ph7';

  function board(black: string, spawned: string): Record<Square, BoardPiece> {
    const out: Record<Square, BoardPiece> = {};
    let n = 0;
    const id = () => `s${String(++n).padStart(2, '0')}`;
    for (const w of black.split(' ')) out[w.slice(1)] = { pieceType: TYPES[w[0]!]!, color: 'black', stageId: id() };
    out[spawned] = {
      pieceType: 'pawn', color: 'white', spawned: true, stageId: id(),
      rarity: 'normal', promotesTo: { pieceType: 'knight', rarity: 'normal' },
    };
    return out;
  }

  const king: PieceInstance = {
    instanceId: 'king', pieceType: 'king', rarity: null, durability: null, durabilityMax: null,
    origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
  };
  const rook: PieceInstance = {
    instanceId: 'rook-normal-1', pieceType: 'rook', rarity: 'normal', durability: 2, durabilityMax: 2,
    origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
  };
  const ROOK = deepFreeze({
    version: 1, seed: 'TEST-0001', actIndex: 0, stageIndex: 0, coins: 0, deckCapacity: 8,
    deck: [king, rook], loadout: [], history: [], rngCursor: 0, status: 'in_progress',
  } as RunState);
  const stage = deepFreeze(
    buildStage(tpl({ id: 'tpl-test' }), board(BACK_RANK, 'd3'), 'act1', 'normal', 'TEST-0001', 2, config),
  );

  /** Square scores that put the rook on the open a-file first, so a candidate can mate on turn 1. */
  const aFile = withSolver(config, {
    deployment: { ...config.gen.solver.deployment, score: { ...config.gen.solver.deployment.score, kingZone: 0 } },
  });

  it('the back-rank board with mateIn: 2 never returns mateTurn: 1', () => {
    const r = solveStage(ROOK, stage, config);
    expect(r.win === null || r.win.mateTurn >= 2).toBe(true);
  }, TIMEOUT);

  it('ignores the turn-1 mate of a candidate that has one (Ra1-a8)', () => {
    const cands = deploymentCandidates(ROOK, stage, aFile);
    const onA1 = cands.find((c) => c.some((p) => p.instanceId === 'rook-normal-1' && p.to === 'a1'));
    expect(onA1).toBeDefined();
    const started = startStage(ROOK, stage, onA1!, aFile);
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const mate: Action[] = [{ type: 'MOVE', from: 'a1', to: 'a8' }];
    const sim = simulate(started.value.run, started.value.stage, mate, aFile);
    expect(sim.ok && sim.value.stage.status).toBe('won');

    const r = solveStage(ROOK, stage, aFile);
    expect(r.win === null || r.win.mateTurn >= 2).toBe(true);
    // The rook-on-a1 candidate was screened (its turn-1 mate met and ignored).
    expect(r.stats.deployments).toBeGreaterThan(cands.indexOf(onA1!));
  }, TIMEOUT);
});
