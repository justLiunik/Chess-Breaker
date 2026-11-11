import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitQueue, startStage } from '@checkbreaker/engine';
import type { Action, GameEvent, RunState, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import type { Placement } from '../src/types';
import { bruteMate, bruteQueues, bruteSearch } from './solver/brute';
import type { BruteOpts } from './solver/brute';
import { config, deepFreeze } from './helpers';

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
const configOf = (f: Fixture): GenConfig => ({ ...config, rules: { ...config.rules, deploymentRanks: f.deploymentRanks } });

const FULL: BruteOpts = { bonus: true, pawnToRank8: true };
const NO_BONUS: BruteOpts = { bonus: false, pawnToRank8: true };
const NO_PROMOTION: BruteOpts = { bonus: true, pawnToRank8: false };
/** Brute force re-runs the enemy's search hundreds of times: a generous cap per test. */
const TIMEOUT = 60_000;

/** The fixture's oracle line (full queue set), checked to replay through startStage and commitQueue to mate on `mateTurn`. */
function provenLine(f: Fixture): { line: Action[][]; events: GameEvent[] } {
  const cfg = configOf(f);
  const found = bruteSearch(f.run, f.stage, f.placements, f.mateTurn, FULL, cfg).mate;
  expect(found?.turn).toBe(f.mateTurn);
  const started = startStage(f.run, f.stage, f.placements, cfg);
  if (!started.ok) throw new Error(JSON.stringify(started.error));
  let { run, stage } = started.value;
  const events: GameEvent[] = [];
  for (const queue of found!.line) {
    expect(stage.status).toBe('active');
    const out = commitQueue(run, stage, queue, cfg);
    if (!out.ok) throw new Error(JSON.stringify(out.error));
    ({ run, stage } = out.value);
    events.push(...out.value.events);
  }
  expect(stage.status).toBe('won');
  expect(stage.endReason).toBe('checkmate');
  expect(stage.turnsUsed).toBe(f.mateTurn);
  return { line: found!.line, events };
}

describe('solver-known.json', () => {
  it('holds mate2, mate3, bonus and promotion, each in Deployment with mateIn = mateTurn and an accepted deployment', () => {
    expect(fixtures.map((f) => f.name)).toEqual(['mate2', 'mate3', 'bonus', 'promotion']);
    for (const f of fixtures) {
      expect(f.stage.phase).toBe('deployment');
      expect(f.stage.mateIn).toBe(f.mateTurn);
      expect(f.mateTurn).toBeGreaterThanOrEqual(config.gen.solver.minSolveTurns);
      expect(startStage(f.run, f.stage, f.placements, configOf(f)).ok).toBe(true);
    }
  });
});

describe('bruteMate on the frozen fixtures', () => {
  it('mate2: the shortest mate is on turn 2', () => {
    const f = fixture('mate2');
    expect(f.mateTurn).toBe(2);
    provenLine(f);
  }, TIMEOUT);

  it('mate3: the shortest mate is on turn 3', () => {
    const f = fixture('mate3');
    expect(f.mateTurn).toBe(3);
    provenLine(f);
  }, TIMEOUT);

  it('bonus: mates within the par with the Legendary knight bonus move, and never without it', () => {
    const f = fixture('bonus');
    const { line } = provenLine(f);
    expect(line.some((q) => q.length === 2)).toBe(true);
    expect(bruteMate(f.run, f.stage, f.placements, f.mateTurn, NO_BONUS, configOf(f))).toBeNull();
  }, TIMEOUT);

  it('promotion: mates within the par with a pawn reaching rank 8, and never without it', () => {
    const f = fixture('promotion');
    const { events } = provenLine(f);
    expect(events.some((e) => e.type === 'pawn_promoted')).toBe(true);
    expect(bruteMate(f.run, f.stage, f.placements, f.mateTurn, NO_PROMOTION, configOf(f))).toBeNull();
  }, TIMEOUT);
});

describe('bruteQueues', () => {
  /** The fixture's first Action-phase stage. */
  const started = (f: Fixture): StageState => {
    const s = startStage(f.run, f.stage, f.placements, configOf(f));
    if (!s.ok) throw new Error(JSON.stringify(s.error));
    return s.value.stage;
  };
  const text = (q: Action[]) => q.map((a) => (a.type === 'MOVE' ? `${a.from}${a.to}` : a.skillId)).join(',');

  it('adds the bonus-move piece\'s two-move queues only with bonus: true, each a MOVE then a MOVE by the same piece', () => {
    const f = fixture('bonus');
    const stage = started(f);
    const without = bruteQueues(stage, NO_BONUS, configOf(f));
    const withBonus = bruteQueues(stage, FULL, configOf(f));
    expect(without.every((q) => q.length === 1)).toBe(true);
    expect(withBonus.filter((q) => q.length === 1).map(text)).toEqual(without.map(text));
    const pairs = withBonus.filter((q) => q.length === 2);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [a, b] of pairs as [Action, Action][]) {
      if (a.type !== 'MOVE' || b.type !== 'MOVE') throw new Error('not a MOVE');
      expect(b.from).toBe(a.to);
      expect(stage.board[a.from]?.rarity).toBe('legendary');
    }
  });

  it('drops exactly the queues that move a pawn to rank 8 with pawnToRank8: false', () => {
    const f = fixture('promotion');
    const stage = started(f);
    const all = bruteQueues(stage, FULL, configOf(f)).map(text);
    const kept = bruteQueues(stage, NO_PROMOTION, configOf(f)).map(text);
    const promoting = all.filter((q) => {
      const [from, to] = [q.slice(0, 2), q.slice(2, 4)];
      return stage.board[from]?.pieceType === 'pawn' && to.endsWith('8');
    });
    expect(promoting.length).toBeGreaterThan(0);
    expect(kept).toEqual(all.filter((q) => !promoting.includes(q)));
  });
});
