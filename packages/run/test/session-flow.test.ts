import { describe, expect, it } from 'vitest';
import { interestOf } from '@checkbreaker/engine';
import type { Action, Award, PieceInstance, PromotionType, StageState } from '@checkbreaker/engine';
import { commit, expectedSeed, leave, newRun, provideStage, repair, sell, start } from '../src/session';
import type { RunEvent, RunResult, RunSession } from '../src/types';
import { ROOK_ID, deepFreeze, mateInOneStage, promotionOverflowStage, runConfig as c, runWithRook } from './fixtures';

const SEED = 'B0B0-1234';
const KING_ROOK = [{ instanceId: 'p_king_01', to: 'd1' }, { instanceId: ROOK_ID, to: 'e1' }];
const mv = (from: string, to: string, promotion?: PromotionType): Action[] =>
  [{ type: 'MOVE', from, to, ...(promotion !== undefined && { promotion }) }];

const value = (r: RunResult): { session: RunSession; events: RunEvent[] } => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return { session: deepFreeze(r.value.session), events: r.value.events };
};

/** The stub generator: the stage the session asks for, built with the seed it expects. */
const stubStage = (s: RunSession, make: (seed: string) => StageState = mateInOneStage): StageState => {
  const { actIndex, stageIndex } = s.next!.request;
  return make(expectedSeed(s.run.seed, actIndex, stageIndex));
};

type Log = { events: RunEvent[]; shopActs: number[]; awards: { startCoins: number; award: Award }[] };

/**
 * Plays one stage from awaiting_stage or shop: in the shop it repairs the rook, and provides the next stage
 * before leaving on even stage numbers, after leaving on odd ones (both paths into Deployment).
 */
function playStage(s: RunSession, n: number, log: Log, make?: (seed: string) => StageState, turns = [mv('e1', 'e8')]): RunSession {
  const step = (r: RunResult): RunSession => {
    const v = value(r);
    log.events.push(...v.events);
    for (const e of v.events) if (e.type === 'shop_opened') log.shopActs.push(e.act);
    return v.session;
  };
  let cur = s;
  if (cur.phase === 'shop') {
    const rook = cur.run.deck.find(p => p.instanceId === ROOK_ID)!;
    if (rook.durability! < rook.durabilityMax!) cur = step(repair(cur, ROOK_ID, c));
    if (n % 2 === 0) cur = step(provideStage(cur, stubStage(cur, make), c));
    cur = step(leave(cur, c));
  }
  if (cur.phase === 'awaiting_stage') cur = step(provideStage(cur, stubStage(cur, make), c));
  expect(cur.phase).toBe('deployment');
  expect(cur.run.actIndex * 3 + cur.run.stageIndex).toBe(n);
  const startCoins = cur.tally!.startCoins;
  cur = step(start(cur, KING_ROOK, c));
  for (const queue of turns) {
    const before = log.events.length;
    cur = step(commit(cur, queue, c));
    for (const e of log.events.slice(before)) if (e.type === 'stage_won') log.awards.push({ startCoins, award: e.award });
  }
  return cur;
}

describe('a whole run from a stub generator', () => {
  it('nine mate-in-ones: won, 9 records, 8 shops in acts 1,1,1,2,2,2,3,3, interest once the wallet reaches 5', () => {
    const fresh = newRun(SEED, c);
    let s = deepFreeze({ ...fresh, run: runWithRook(fresh.run) });
    const log: Log = { events: [], shopActs: [], awards: [] };
    const requests: string[] = [];
    for (let n = 0; n < 9; n++) {
      requests.push(`${s.next!.request.actIndex}-${s.next!.request.stageIndex}`);
      s = playStage(s, n, log);
      expect(s.phase).toBe(n < 8 ? 'shop' : 'ended');
    }
    expect(requests).toEqual(['0-0', '0-1', '0-2', '1-0', '1-1', '1-2', '2-0', '2-1', '2-2']);

    expect(s).toMatchObject({ phase: 'ended', outcome: { result: 'won' }, stage: null, shop: null, next: null, chooser: null, tally: null });
    expect(s.run.status).toBe('won');
    expect(log.events.at(-1)).toEqual({ type: 'run_ended', result: 'won' });
    expect(s.run.history).toHaveLength(9);
    expect(s.run.history.map(h => h.outcome)).toEqual(Array(9).fill('win'));
    expect(s.run.history.map(h => h.stageSeed)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => expectedSeed(SEED, Math.floor(n / 3), n % 3)),
    );
    expect(log.shopActs).toEqual([1, 1, 1, 2, 2, 2, 3, 3]);
    expect(log.events.filter(e => e.type === 'stage_entered').map(e => (e as { stageNumber: number }).stageNumber))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    // interest: on the wallet at the mate (no salvage here), visible as soon as it reaches 5
    expect(log.awards).toHaveLength(9);
    for (const [i, { startCoins, award }] of log.awards.entries()) {
      expect(award.interest, `stage ${i}`).toBe(interestOf(startCoins, c));
      if (startCoins >= 5) expect(award.interest, `stage ${i}`).toBeGreaterThan(0);
      expect(s.run.history[i]!.coinsEarned).toBe(award.coins);
    }
    expect(log.awards[0]!.award.interest).toBe(0);
    expect(log.awards.filter(a => a.startCoins >= 5).length).toBeGreaterThanOrEqual(7);
    // the free Twin Step arrived at stage I-3 and was never used
    expect(s.run.loadout).toEqual([{ skillId: 'twin_step' }]);
  });

  it('a chooser after stage 9 ends the run won once the deck fits', () => {
    const fresh = newRun(SEED, c);
    let s = deepFreeze({ ...fresh, run: runWithRook(fresh.run) });
    const log: Log = { events: [], shopActs: [], awards: [] };
    for (let n = 0; n < 8; n++) s = playStage(s, n, log);
    expect(s.phase).toBe('shop');
    // fill the deck to 8 before the last stage, whose promotion overflows it
    const fill = (k: number): PieceInstance => ({
      instanceId: `p_fill_${k}`, pieceType: 'bishop', rarity: 'normal', durability: 2, durabilityMax: 2,
      origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
    });
    const room = c.deck.capacity - s.run.deck.filter(p => p.pieceType !== 'king').length;
    s = deepFreeze({ ...s, run: { ...s.run, deck: [...s.run.deck, ...Array.from({ length: room }, (_, k) => fill(k))] } });
    s = playStage(s, 8, log, promotionOverflowStage, [mv('b7', 'b8', 'knight'), mv('e1', 'e8')]);
    expect(s).toMatchObject({ phase: 'chooser', chooser: { overCapacity: 1 } });
    expect(s.run.status).toBe('in_progress');
    expect(s.run.history).toHaveLength(9);
    const { session, events } = value(sell(s, 'p_fill_0', c));
    expect(session).toMatchObject({ phase: 'ended', outcome: { result: 'won' }, chooser: null, shop: null, next: null });
    expect(session.run.status).toBe('won');
    expect(events.map(e => e.type)).toEqual(['piece_sold', 'run_ended']);
    expect(log.shopActs).toEqual([1, 1, 1, 2, 2, 2, 3, 3]);
  });
});
