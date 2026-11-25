import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { commitQueue, hash } from '@checkbreaker/engine';
import type { Action, PieceInstance, PromotionType, RunState, StageState } from '@checkbreaker/engine';
import {
  abandon, buy, commit, cut, expectedSeed, leave, merge, newRun, provideStage, repair, requestFor, reroll, sell, start,
} from '../src/session';
import { sellPrice } from '../src/prices';
import type { RunError, RunEvent, RunPhase, RunResult, RunSession } from '../src/types';
import {
  ROOK_ID, deepFreeze, doublePromotionStage, losingStage, mateInOneStage, promotionCapturedStage, promotionOverflowStage,
  runConfig as c, runWithRook,
} from './fixtures';

const SEED = '7F3A-2210';
const KING_ROOK = [{ instanceId: 'p_king_01', to: 'd1' }, { instanceId: ROOK_ID, to: 'e1' }];
const mv = (from: string, to: string, promotion?: PromotionType): Action[] =>
  [{ type: 'MOVE', from, to, ...(promotion !== undefined && { promotion }) }];

const value = (r: RunResult): { session: RunSession; events: RunEvent[] } => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return { session: deepFreeze(r.value.session), events: r.value.events };
};
const error = (r: RunResult): RunError | null => (r.ok ? null : r.error);
const nonKing = (run: RunState) => run.deck.filter(p => p.pieceType !== 'king').length;
const normal = (id: string, pieceType: PieceInstance['pieceType']): PieceInstance => ({
  instanceId: id, pieceType, rarity: 'normal', durability: 2, durabilityMax: 2,
  origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
});

/** The seed the session's pending request expects. */
const seedOf = (s: RunSession): string => expectedSeed(s.run.seed, s.next!.request.actIndex, s.next!.request.stageIndex);
/** A fresh run with the mate-in-one rook, plus `extra` pieces. */
const rookRun = (extra: PieceInstance[] = [], seed = SEED): RunSession => {
  const s = newRun(seed, c);
  return deepFreeze({ ...s, run: { ...runWithRook(s.run), deck: [...runWithRook(s.run).deck, ...extra] } });
};
/** Provides `make(seed)` for the pending request, deploys King d1 + rook e1. */
const deploy = (s: RunSession, make: (seed: string) => StageState = mateInOneStage): RunSession => {
  const provided = value(provideStage(s, make(seedOf(s)), c)).session;
  return value(start(provided, KING_ROOK, c)).session;
};
/** From awaiting_stage or shop: plays one mate-in-one (repairing the rook in the shop) and lands where the flow goes. */
const winOne = (s: RunSession): { session: RunSession; events: RunEvent[] } => {
  let cur = s;
  if (cur.phase === 'shop') {
    const rook = cur.run.deck.find(p => p.instanceId === ROOK_ID);
    if (rook && rook.durability! < rook.durabilityMax!) cur = value(repair(cur, ROOK_ID, c)).session;
    cur = value(leave(cur, c)).session;
  }
  if (cur.phase === 'awaiting_stage') cur = value(provideStage(cur, mateInOneStage(seedOf(cur)), c)).session;
  const started = value(start(cur, KING_ROOK, c)).session;
  return value(commit(started, mv('e1', 'e8'), c));
};

describe('newRun', () => {
  it('builds the run-starter.yaml run: ids, deck, coins, empty loadout and history', () => {
    const yaml = parse(readFileSync(new URL('../../../content/examples/run-starter.yaml', import.meta.url), 'utf8')) as RunState;
    const s = newRun(SEED, c);
    expect(s.run).toEqual(yaml);
    expect(s.run.deck.map(p => p.instanceId)).toEqual(['p_king_01', 'p_knight_02', 'p_knight_03', 'p_bishop_04', 'p_bishop_05']);
  });

  it('waits for stage 0 with a request shaped like gen input', () => {
    const s = newRun(SEED, c);
    expect(s).toMatchObject({ version: 1, phase: 'awaiting_stage', stage: null, tally: null, shop: null, outcome: null });
    expect('chooser' in s).toBe(false);
    expect(s.next).toEqual({ request: { run: s.run, actIndex: 0, stageIndex: 0 }, stage: null });
    expect('previousTemplateId' in s.next!.request).toBe(false);
  });

  it('is deterministic', () => {
    expect(newRun('ABCD-0001', c)).toEqual(newRun('ABCD-0001', c));
  });
});

describe('requestFor and expectedSeed', () => {
  it('requestFor sets the act and stage of the stage number and the last template', () => {
    const run = deepFreeze({
      ...newRun(SEED, c).run,
      history: [{ stageSeed: 'AAAA-0000', templateId: 'tpl-x', outcome: 'win' as const, turnsUsed: 1, coinsEarned: 10, piecesLost: 0 }],
    });
    for (const [n, act, stage] of [[0, 0, 0], [2, 0, 2], [3, 1, 0], [5, 1, 2], [8, 2, 2]] as const) {
      const r = requestFor(run, n, c);
      expect(r).toEqual({ run: { ...run, actIndex: act, stageIndex: stage }, actIndex: act, stageIndex: stage, previousTemplateId: 'tpl-x' });
    }
  });

  it('expectedSeed is the G0 code: 32-bit hash as XXXX-XXXX', () => {
    for (const [seed, a, st] of [[SEED, 0, 0], ['0000-0001', 1, 2], ['FFFF-FFFF', 2, 1]] as const) {
      const h = hash(seed, a, st).toString(16).toUpperCase().padStart(8, '0');
      expect(expectedSeed(seed, a, st)).toBe(`${h.slice(0, 4)}-${h.slice(4)}`);
      expect(expectedSeed(seed, a, st)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
    expect(expectedSeed(SEED, 0, 0)).not.toBe(expectedSeed(SEED, 0, 1));
  });
});

describe('provideStage (Review Focus 2)', () => {
  it('refuses a stage whose seed is not the request\'s', () => {
    const s = deepFreeze(newRun(SEED, c));
    expect(error(provideStage(s, mateInOneStage('0000-0000'), c)))
      .toEqual({ kind: 'stage_mismatch', expected: expectedSeed(SEED, 0, 0), got: '0000-0000' });
  });

  it('in awaiting_stage enters Deployment of stage 0', () => {
    const s = deepFreeze(newRun(SEED, c));
    const stage = mateInOneStage(seedOf(s));
    const { session, events } = value(provideStage(s, stage, c));
    expect(session.phase).toBe('deployment');
    expect(session.stage).toEqual(stage);
    expect(session.next).toBeNull();
    expect(session.tally).toEqual({ startCoins: 0, salvage: 0, piecesLost: 0 });
    expect(events).toEqual([{ type: 'stage_entered', stageNumber: 0 }]);
  });

  it('in the shop fills next.stage without changing phase; a second stage is refused', () => {
    const shop = winOne(rookRun()).session;
    expect(shop.phase).toBe('shop');
    const stage = mateInOneStage(seedOf(shop));
    const once = value(provideStage(shop, stage, c));
    expect(once.session.phase).toBe('shop');
    expect(once.session.next!.stage).toEqual(stage);
    expect(once.session.shop).toEqual(shop.shop);
    expect(once.events).toEqual([]);
    expect(error(provideStage(once.session, stage, c))).toEqual({ kind: 'stage_already_provided' });
    expect(error(provideStage(shop, mateInOneStage('0000-0000'), c))).toMatchObject({ kind: 'stage_mismatch' });
  });
});

describe('leave', () => {
  it('before the stage is ready goes to awaiting_stage; provideStage then enters Deployment of the next stage', () => {
    const shop = winOne(rookRun()).session;
    const waiting = value(leave(shop, c));
    expect(waiting.session.phase).toBe('awaiting_stage');
    expect(waiting.session.shop).toBeNull();
    expect(waiting.session.next).toEqual(shop.next);
    expect(waiting.events).toEqual([]);
    const { session, events } = value(provideStage(waiting.session, mateInOneStage(seedOf(waiting.session)), c));
    expect(session.phase).toBe('deployment');
    expect([session.run.actIndex, session.run.stageIndex]).toEqual([0, 1]);
    expect(events).toEqual([{ type: 'stage_entered', stageNumber: 1 }]);
  });

  it('with the stage ready goes straight to its Deployment', () => {
    const shop = winOne(rookRun()).session;
    const ready = value(provideStage(shop, mateInOneStage(seedOf(shop)), c)).session;
    const { session, events } = value(leave(ready, c));
    expect(session).toMatchObject({ phase: 'deployment', shop: null, next: null });
    expect(session.stage).toEqual(ready.next!.stage);
    expect(session.tally).toEqual({ startCoins: ready.run.coins, salvage: 0, piecesLost: 0 });
    expect(events).toEqual([{ type: 'stage_entered', stageNumber: 1 }]);
  });
});

describe('start and commit', () => {
  it('wrap engine refusals as { kind: engine } and change nothing', () => {
    const provided = value(provideStage(rookRun(), mateInOneStage(seedOf(rookRun())), c)).session;
    expect(error(start(provided, [], c))).toEqual({ kind: 'engine', error: { kind: 'invalid_deployment', to: '', reason: 'king_missing' } });
    const action = value(start(provided, KING_ROOK, c)).session;
    expect(action.phase).toBe('action');
    expect(error(commit(action, [], c))).toEqual({ kind: 'engine', error: { kind: 'empty_queue' } });
    expect(error(commit(action, mv('a1', 'a2'), c))).toMatchObject({ kind: 'engine', error: { kind: 'illegal_move' } });
  });

  it('a mate in one in Act I with wallet 0 pays 10, records the stage and opens the shop for stage 1', () => {
    const action = deploy(rookRun());
    expect(action.run.coins).toBe(0);
    const { session, events } = value(commit(action, mv('e1', 'e8'), c));
    expect(session.run.coins).toBe(10);
    expect(session.run.history).toEqual([{
      stageSeed: expectedSeed(SEED, 0, 0), templateId: 'tpl-act1-open-field', outcome: 'win', turnsUsed: 1, coinsEarned: 10, piecesLost: 0,
    }]);
    expect(session).toMatchObject({ phase: 'shop', stage: null, tally: null, outcome: null });
    expect(session.shop).toMatchObject({ act: 1, stageNumber: 0, roll: 0, rerollsUsed: 0, recovery: false });
    expect(session.next!.stage).toBeNull();
    expect(session.next!.request).toMatchObject({ actIndex: 0, stageIndex: 1, previousTemplateId: 'tpl-act1-open-field' });
    expect(session.next!.request.run).toEqual({ ...session.run, actIndex: 0, stageIndex: 1 });
    const types = events.map(e => e.type);
    expect(types).toContain('stage_won');
    expect(types).toContain('piece_returned');
    expect(events.at(-1)).toEqual({ type: 'shop_opened', act: 1, recovery: false });
    // the rook was summoned once: it comes back at 1/2
    expect(session.run.deck.find(p => p.instanceId === ROOK_ID)).toMatchObject({ status: 'in_deck', durability: 1 });
  });

  it('a turn that does not end the stage stays in action and folds salvage into the tally', () => {
    // the promotion stage: turn 1 promotes, nothing captured
    const action = deploy(rookRun(), promotionOverflowStage);
    const t1 = value(commit(action, mv('b7', 'b8', 'knight'), c)).session;
    expect(t1.phase).toBe('action');
    expect(t1.stage!.turnsUsed).toBe(1);
    expect(t1.tally).toEqual({ startCoins: 0, salvage: 0, piecesLost: 0 });
  });

  it('a loss ends the run with the stage\'s endReason and a loss record', () => {
    const s = deepFreeze(newRun(SEED, c));
    const provided = value(provideStage(s, losingStage(seedOf(s)), c)).session;
    const action = value(start(provided, [{ instanceId: 'p_king_01', to: 'e1' }], c)).session;
    const engine = commitQueue(action.run, action.stage!, mv('e1', 'f1'), c);
    if (!engine.ok) throw new Error('engine refused');
    expect(engine.value.stage.status).toBe('lost');
    const { session, events } = value(commit(action, mv('e1', 'f1'), c));
    expect(session).toMatchObject({ phase: 'ended', stage: null, tally: null, shop: null, next: null });
    expect(session.run.status).toBe('lost');
    expect(session.outcome).toEqual({ result: 'lost', endReason: engine.value.stage.endReason });
    expect(session.run.history).toEqual([{
      stageSeed: expectedSeed(SEED, 0, 0), templateId: 'tpl-act1-open-field', outcome: 'loss', turnsUsed: 1, coinsEarned: 0, piecesLost: 0,
    }]);
    expect(events.at(-1)).toEqual({ type: 'run_ended', result: 'lost', endReason: engine.value.stage.endReason });
  });
});

/** `mateInOneStage` plus a Black piece on `square`, with the scripted enemy playing `line`. */
const withBlack = (square: string, pieceType: 'knight' | 'bishop', line: string[], over: Partial<StageState> = {}) =>
  (seed: string): StageState => {
    const base = mateInOneStage(seed);
    return deepFreeze({
      ...base, ...over,
      board: { ...base.board, [square]: { pieceType, color: 'black', stageId: 's99' } },
      enemyPolicy: { type: 'scripted', line, fallbackDepth: 1 },
    } as StageState);
  };

describe('the stage tally', () => {
  it('salvage from a Black capture is in coinsEarned and the wallet', () => {
    // Re1xe8 takes a knight (salvage floor(3 / 3) = 1) and mates
    const action = deploy(rookRun(), withBlack('e8', 'knight', ['h7h6']));
    const { session, events } = value(commit(action, mv('e1', 'e8'), c));
    const salvage = events.filter(e => e.type === 'capture' && e.color === 'black').reduce((n, e) => n + (e as { salvage: number }).salvage, 0);
    expect(salvage).toBe(1);
    expect(session.run.coins).toBe(11);
    expect(session.run.history[0]).toMatchObject({ outcome: 'win', coinsEarned: 11, piecesLost: 0 });
  });

  it('a Hero Piece the enemy captures is lost; the shop then opens with recovery', () => {
    // deck: King, 2 knights, rook. Bishop a6 takes the knight on f1 after Kd1-c1; Re1-e8 mates on turn 2.
    const fresh = rookRun();
    const s = deepFreeze({ ...fresh, run: { ...fresh.run, deck: fresh.run.deck.filter(p => p.pieceType !== 'bishop') } });
    const provided = value(provideStage(s, withBlack('a6', 'bishop', ['a6f1'])(seedOf(s)), c)).session;
    const action = value(start(provided, [...KING_ROOK, { instanceId: 'p_knight_02', to: 'f1' }], c)).session;
    const t1 = value(commit(action, mv('d1', 'c1'), c));
    expect(t1.events).toContainEqual(expect.objectContaining({ type: 'capture', color: 'white', instanceId: 'p_knight_02' }));
    expect(t1.session.tally).toEqual({ startCoins: 0, salvage: 0, piecesLost: 1 });
    const { session, events } = value(commit(t1.session, mv('e1', 'e8'), c));
    expect(session.run.history[0]).toMatchObject({ outcome: 'win', turnsUsed: 2, coinsEarned: 10, piecesLost: 1 });
    expect(nonKing(session.run)).toBe(2);
    expect(events.at(-1)).toEqual({ type: 'shop_opened', act: 1, recovery: true });
    expect(session.shop!.slots[0]).toMatchObject({ kind: 'piece', rarity: 'normal', recovery: true });
  });

  it('a lifeline-saved capture is not a lost piece', () => {
    const queen: PieceInstance = {
      instanceId: 'p_queen_77', pieceType: 'queen', rarity: 'unique', durability: 2, durabilityMax: 2,
      origin: 'shop', acquiredAtStage: 0, pricePaid: 0, status: 'in_deck',
    };
    const s = rookRun([queen]);
    const provided = value(provideStage(s, withBlack('a6', 'bishop', ['a6f1'], { spawnPoints: 40 })(seedOf(s)), c)).session;
    const action = value(start(provided, [...KING_ROOK, { instanceId: 'p_queen_77', to: 'f1' }], c)).session;
    const t1 = value(commit(action, mv('d1', 'c1'), c));
    expect(t1.events).toContainEqual({ type: 'lifeline_saved', instanceId: 'p_queen_77' });
    expect(t1.session.tally!.piecesLost).toBe(0);
    const { session } = value(commit(t1.session, mv('e1', 'e8'), c));
    expect(session.run.history[0]!.piecesLost).toBe(0);
    expect(session.run.deck.find(p => p.instanceId === 'p_queen_77')).toMatchObject({ status: 'in_deck', usedOnce: ['lifeline'] });
  });

  it('a piece spent by its last summon counts as lost at the stage end', () => {
    // the rook at 1/2 is summoned once more: spent, removed by endStage
    const shop = winOne(rookRun()).session;
    const waiting = value(leave(shop, c)).session;
    const { session, events } = value(commit(deploy(waiting), mv('e1', 'e8'), c));
    expect(events).toContainEqual({ type: 'piece_removed', instanceId: ROOK_ID, reason: 'spent' });
    expect(session.run.history[1]).toMatchObject({ outcome: 'win', piecesLost: 1 });
    expect(session.run.deck.some(p => p.instanceId === ROOK_ID)).toBe(false);
  });
});

/** Deck: King, starter 2N 2B, the rook, and `extra` (non-king total 5 + extra.length). */
const fullDeck = (extra: PieceInstance[]) => rookRun(extra);
const THREE_MORE = [normal('p_fill_01', 'knight'), normal('p_fill_02', 'bishop'), normal('p_fill_03', 'bishop')];

describe('the deck gate in the shop (Review Focus 4)', () => {
  /** Deck at 8, one promotion (b7-b8=N) on turn 1, the mate on turn 2: the shop at 9 pieces. */
  const shopAtNine = () => {
    const start8 = fullDeck(THREE_MORE);
    expect(nonKing(start8.run)).toBe(8);
    const action = deploy(start8, promotionOverflowStage);
    const t1 = value(commit(action, mv('b7', 'b8', 'knight'), c)).session;
    return value(commit(t1, mv('e1', 'e8'), c));
  };

  it('a won stage with a promotion goes to the shop even at 9 pieces', () => {
    const won = shopAtNine();
    expect(won.session).toMatchObject({ phase: 'shop', stage: null, entryStage: null, tally: null, outcome: null });
    expect('chooser' in won.session).toBe(false);
    expect(nonKing(won.session.run)).toBe(9);
    expect(won.session.shop).toMatchObject({ act: 1, stageNumber: 0, roll: 0, rerollsUsed: 0, recovery: false });
    expect(won.session.next).toMatchObject({ stage: null, request: { actIndex: 0, stageIndex: 1 } });
    expect(won.events.map(e => e.type)).not.toContain('chooser_opened');
    expect(won.events.at(-1)).toEqual({ type: 'shop_opened', act: 1, recovery: false });
    expect(won.session.run.history).toHaveLength(1);
    expect(won.session.run.coins).toBe(10);
  });

  it('leave is refused with deck_over_capacity at 9 and allowed at 8', () => {
    const won = shopAtNine().session;
    const gate = { kind: 'deck_over_capacity', size: 9, capacity: c.deck.capacity };
    expect(error(leave(won, c))).toEqual(gate);
    // with the next stage ready, too
    const ready = value(provideStage(won, mateInOneStage(seedOf(won)), c)).session;
    expect(error(leave(ready, c))).toEqual(gate);
    // buying a piece is refused as before
    const rich = deepFreeze({ ...ready, run: { ...ready.run, coins: 500 } });
    const slot = rich.shop!.slots.findIndex(o => o.kind === 'piece') + 1;
    expect(error(buy(rich, slot, {}, c))).toEqual({ kind: 'deck_full' });

    const victim = ready.run.deck.find(p => p.instanceId === 'p_fill_01')!;
    const coins = sellPrice(victim, 1, c);
    expect(coins).toBeGreaterThan(0);
    const sold = value(sell(ready, 'p_fill_01', c));
    expect(sold.session.phase).toBe('shop');
    expect(sold.events).toEqual([{ type: 'piece_sold', instanceId: 'p_fill_01', coins }]);
    expect(nonKing(sold.session.run)).toBe(8);
    expect(sold.session.run.coins).toBe(10 + coins);
    // the wallet the sale filled is the one the shop spends: repair the rook out of 10 + sale
    const repaired = value(repair(sold.session, ROOK_ID, c)).session;
    expect(repaired.run.coins).toBe(10 + coins - c.run.services.repair);
    const { session, events } = value(leave(repaired, c));
    expect(session.phase).toBe('deployment');
    expect(events).toEqual([{ type: 'stage_entered', stageNumber: 1 }]);
  });

  it('selling a promoted piece pays 0', () => {
    const won = shopAtNine().session;
    const promoted = won.run.deck.find(p => p.origin === 'promotion')!;
    expect(promoted).toMatchObject({ pieceType: 'knight', rarity: 'normal', pricePaid: 0, status: 'in_deck' });
    expect(promoted.durability).toBe(promoted.durabilityMax);
    const { session, events } = value(sell(won, promoted.instanceId, c));
    expect(events).toEqual([{ type: 'piece_sold', instanceId: promoted.instanceId, coins: 0 }]);
    expect(session.run.coins).toBe(won.run.coins);
    expect(session.run.deck.some(p => p.instanceId === promoted.instanceId)).toBe(false);
    expect(value(leave(session, c)).session.phase).toBe('awaiting_stage');
  });

  it('overflow 2 needs two removals; leave stays refused after the first', () => {
    const action = deploy(fullDeck(THREE_MORE), doublePromotionStage);
    const t1 = value(commit(action, mv('b7', 'b8', 'knight'), c)).session;
    const t2 = value(commit(t1, mv('c7', 'c8', 'knight'), c)).session;
    const won = value(commit(t2, mv('e1', 'e8'), c)).session;
    expect(won.phase).toBe('shop');
    expect(nonKing(won.run)).toBe(10);
    expect(error(leave(won, c))).toEqual({ kind: 'deck_over_capacity', size: 10, capacity: c.deck.capacity });

    const one = value(sell(won, 'p_fill_02', c));
    expect(one.session.phase).toBe('shop');
    expect(one.events.map(e => e.type)).toEqual(['piece_sold']);
    expect(error(leave(one.session, c))).toEqual({ kind: 'deck_over_capacity', size: 9, capacity: c.deck.capacity });
    const two = value(cut(one.session, 'p_fill_03', c));
    expect(two.session.phase).toBe('shop');
    expect(two.events).toEqual([{ type: 'piece_cut', instanceId: 'p_fill_03' }]);
    expect(nonKing(two.session.run)).toBe(8);
    expect(value(leave(two.session, c)).session.phase).toBe('awaiting_stage');
  });

  it('a merge (3 → 1) clears an overflow of 2 in one action', () => {
    const action = deploy(fullDeck(THREE_MORE), doublePromotionStage);
    const t1 = value(commit(action, mv('b7', 'b8', 'knight'), c)).session;
    const t2 = value(commit(t1, mv('c7', 'c8', 'knight'), c)).session;
    const won = value(commit(t2, mv('e1', 'e8'), c)).session;
    const ids = ['p_knight_02', 'p_knight_03', 'p_fill_01'];
    const { session, events } = value(merge(won, ids, c));
    expect(session.phase).toBe('shop');
    expect(nonKing(session.run)).toBe(8);
    expect(events).toHaveLength(1);
    const made = events[0]!;
    expect(made).toMatchObject({ type: 'pieces_merged', inputs: ids });
    const result = session.run.deck.find(p => p.instanceId === (made as { result: string }).result)!;
    expect(result).toMatchObject({ pieceType: 'knight', rarity: 'rare', origin: 'merge', acquiredAtStage: 0 });
    expect(value(leave(session, c)).session.phase).toBe('awaiting_stage');
  });

  it('refusals at 9 are typed and change nothing', () => {
    const won = shopAtNine().session;
    expect(error(sell(won, 'p_king_01', c))).toEqual({ kind: 'cannot_sell', instanceId: 'p_king_01', reason: 'king' });
    expect(error(cut(won, 'p_king_01', c))).toEqual({ kind: 'cannot_cut', instanceId: 'p_king_01', reason: 'king' });
    expect(error(merge(won, ['p_knight_02'], c))).toEqual({ kind: 'merge_invalid', reason: 'count' });
  });

  it('merge, sell and cut are refused outside the shop', () => {
    const awaiting = fullDeck(THREE_MORE);
    const deployment = value(provideStage(awaiting, promotionOverflowStage(seedOf(awaiting)), c)).session;
    const action = value(start(deployment, KING_ROOK, c)).session;
    const t1 = value(commit(action, mv('b7', 'b8', 'knight'), c)).session;
    expect(nonKing(t1.run)).toBe(9);
    const ended = value(abandon(t1)).session;
    const ids = ['p_knight_02', 'p_knight_03', 'p_fill_01'];
    for (const s of [awaiting, deployment, action, t1, ended]) {
      for (const r of [merge(s, ids, c), sell(s, 'p_fill_02', c), cut(s, 'p_fill_03', c)]) {
        expect(error(r), s.phase).toEqual({ kind: 'wrong_phase', expected: ['shop'] });
      }
    }
  });

  it('a promoted piece the enemy captures counts in piecesLost and can open the recovery offer', () => {
    // deck: King, 2 knights, the rook (3 non-king). b7-b8=Q+ is answered by Nxb8 in the same COMMIT.
    const fresh = rookRun();
    const s = deepFreeze({ ...fresh, run: { ...fresh.run, deck: fresh.run.deck.filter(p => p.pieceType !== 'bishop') } });
    const action = deploy(s, promotionCapturedStage);
    const t1 = value(commit(action, mv('b7', 'b8', 'queen'), c));
    const promoted = t1.events.find(e => e.type === 'pawn_promoted') as Extract<RunEvent, { type: 'pawn_promoted' }>;
    expect(promoted).toMatchObject({ square: 'b8', pieceType: 'queen', rarity: 'normal' });
    expect(t1.events).toContainEqual(expect.objectContaining({
      type: 'capture', square: 'b8', color: 'white', pieceType: 'queen', instanceId: promoted.instanceId,
    }));
    expect(t1.session.phase).toBe('action');
    expect(t1.session.tally).toEqual({ startCoins: 0, salvage: 0, piecesLost: 1 });
    expect(t1.session.run.deck.some(p => p.instanceId === promoted.instanceId)).toBe(false);
    expect(nonKing(t1.session.run)).toBe(3);

    const { session, events } = value(commit(t1.session, mv('e1', 'e8'), c));
    expect(session.run.history[0]).toMatchObject({ outcome: 'win', turnsUsed: 2, piecesLost: 1 });
    expect(nonKing(session.run)).toBe(3);
    expect(events.at(-1)).toEqual({ type: 'shop_opened', act: 1, recovery: true });
    expect(session.shop!.slots[0]).toMatchObject({ kind: 'piece', rarity: 'normal', recovery: true });
  });
});

describe('shop actions', () => {
  it('buy, repair and reroll delegate to the shop and emit their events', () => {
    const shop = winOne(rookRun()).session;
    const repaired = value(repair(shop, ROOK_ID, c));
    expect(repaired.events).toEqual([{ type: 'piece_repaired', instanceId: ROOK_ID, durability: 2 }]);
    expect(repaired.session.run.coins).toBe(shop.run.coins - c.run.services.repair);

    const rolled = value(reroll(shop, c));
    expect(rolled.session.shop!.roll).toBe(1);
    expect(rolled.events).toEqual([{ type: 'shop_rerolled', roll: 1, cost: 0 }]);

    const rich = deepFreeze({ ...shop, run: { ...shop.run, coins: 500 } });
    const slot = rich.shop!.slots.findIndex(o => o.kind === 'piece') + 1;
    const bought = value(buy(rich, slot, {}, c));
    const { sold: _sold, ...offer } = rich.shop!.slots[slot - 1]!;
    expect(bought.events).toHaveLength(1);
    expect(bought.events[0]).toMatchObject({ type: 'item_bought', slot, offer });
    const id = (bought.events[0] as { instanceId?: string }).instanceId!;
    expect(bought.session.run.deck.some(p => p.instanceId === id)).toBe(true);
    expect(bought.session.shop!.slots[slot - 1]!.sold).toBe(true);
    expect(error(buy(bought.session, slot, {}, c))).toEqual({ kind: 'slot_sold', slot });
    expect(error(buy(shop, 9, {}, c))).toEqual({ kind: 'no_such_slot', slot: 9 });
  });

  it('recovery_withdrawn only when a buy of another slot flips recovery off', () => {
    // 3 non-king pieces and a loss in the last stage: recovery fires
    const shop = winOne(rookRun()).session;
    const deck = shop.run.deck.filter(p => !['p_knight_02', 'p_bishop_04'].includes(p.instanceId));
    const history = shop.run.history.map(h => ({ ...h, piecesLost: 1 }));
    const run = { ...shop.run, deck, history, coins: 500 };
    const slots = [
      { kind: 'piece' as const, pieceType: 'knight' as const, rarity: 'normal' as const, price: 4, recovery: true as const, sold: false },
      { kind: 'piece' as const, pieceType: 'bishop' as const, rarity: 'normal' as const, price: 8, sold: false },
      { kind: 'piece' as const, pieceType: 'knight' as const, rarity: 'normal' as const, price: 8, sold: false },
      { kind: 'piece' as const, pieceType: 'rook' as const, rarity: 'normal' as const, price: 10, sold: false },
    ];
    const rec = deepFreeze({ ...shop, run, shop: { ...shop.shop!, recovery: true, slots } });
    expect(nonKing(rec.run)).toBe(3);

    const other = value(buy(rec, 2, {}, c));
    expect(other.session.shop!.recovery).toBe(false);
    expect(other.events.map(e => e.type)).toEqual(['item_bought', 'recovery_withdrawn']);

    const itself = value(buy(rec, 1, {}, c));
    expect(itself.session.shop!.recovery).toBe(true);
    expect(itself.events.map(e => e.type)).toEqual(['item_bought']);
    // after buying the recovery offer, another purchase withdraws nothing (slot 1 is already sold)
    const after = value(buy(itself.session, 2, {}, c));
    expect(after.events.map(e => e.type)).toEqual(['item_bought']);
  });

  it('sell in the shop uses the act of the stage just cleared and stays in the shop', () => {
    const shop = winOne(rookRun()).session;
    const knight = shop.run.deck.find(p => p.instanceId === 'p_knight_02')!;
    const { session, events } = value(sell(shop, 'p_knight_02', c));
    expect(session.phase).toBe('shop');
    expect(events).toEqual([{ type: 'piece_sold', instanceId: 'p_knight_02', coins: sellPrice(knight, 1, c) }]);
    expect(session.shop).toEqual(shop.shop);
  });
});

describe('the free Twin Step (Review Focus 1)', () => {
  const toShopAfterStage1 = (): RunSession => winOne(winOne(rookRun()).session).session;

  it('is granted on entering stage 2 with a free slot, and only there', () => {
    const first = value(provideStage(rookRun(), mateInOneStage(seedOf(rookRun())), c));
    expect(first.events.some(e => e.type === 'skill_granted')).toBe(false);
    const shop1 = toShopAfterStage1();
    expect(shop1.next!.request).toMatchObject({ actIndex: 0, stageIndex: 2 });
    const waiting = value(leave(shop1, c)).session;
    const { session, events } = value(provideStage(waiting, mateInOneStage(seedOf(waiting)), c));
    expect(c.run.freeSkill).toEqual({ stageNumber: 2, skillId: 'twin_step' });
    expect(events).toEqual([{ type: 'stage_entered', stageNumber: 2 }, { type: 'skill_granted', skillId: 'twin_step' }]);
    expect(session.run.loadout).toEqual([{ skillId: 'twin_step' }]);
  });

  it('is skipped with a full loadout', () => {
    const shop1 = toShopAfterStage1();
    const loadout = [{ skillId: 'lockdown' }, { skillId: 'gallop' }, { skillId: 'bulwark' }];
    const full = deepFreeze({ ...shop1, run: { ...shop1.run, loadout } });
    const ready = value(provideStage(full, mateInOneStage(seedOf(full)), c)).session;
    const { session, events } = value(leave(ready, c));
    expect(events).toEqual([{ type: 'stage_entered', stageNumber: 2 }]);
    expect(session.run.loadout).toEqual(loadout);
  });

  it('is never granted again by the Deployment it was granted in (a JSON round trip, then start)', () => {
    // The grant lives only on the transition into Deployment. Task 9 adds the loadSave(serializeSave(s)) form.
    const shop1 = toShopAfterStage1();
    const waiting = value(leave(shop1, c)).session;
    const granted = value(provideStage(waiting, mateInOneStage(seedOf(waiting)), c)).session;
    const reloaded = deepFreeze(JSON.parse(JSON.stringify(granted)) as RunSession);
    expect(reloaded).toEqual(granted);
    const kingOnly = [{ instanceId: 'p_king_01', to: 'd1' }];
    const { session, events } = value(start(reloaded, kingOnly, c));
    expect(session.run.loadout).toEqual([{ skillId: 'twin_step' }]);
    expect(events.some(e => e.type === 'skill_granted')).toBe(false);
  });
});

describe('abandon', () => {
  it('in Deployment ends the run lost/abandoned without a history record', () => {
    const s = deepFreeze(newRun(SEED, c));
    const dep = value(provideStage(s, mateInOneStage(seedOf(s)), c)).session;
    const { session, events } = value(abandon(dep));
    expect(session).toMatchObject({ phase: 'ended', stage: null, tally: null, next: null, shop: null });
    expect(session.outcome).toEqual({ result: 'lost', endReason: 'abandoned' });
    expect(session.run.status).toBe('lost');
    expect(session.run.history).toEqual([]);
    expect(events).toEqual([{ type: 'run_ended', result: 'lost', endReason: 'abandoned' }]);
  });

  it('in action before a turn writes no record; after a turn writes a loss record', () => {
    const action = deploy(rookRun(), promotionOverflowStage);
    expect(value(abandon(action)).session.run.history).toEqual([]);
    const t1 = value(commit(action, mv('b7', 'b8', 'knight'), c)).session;
    const { session } = value(abandon(t1));
    expect(session.run.history).toEqual([{
      stageSeed: expectedSeed(SEED, 0, 0), templateId: 'tpl-act1-open-field', outcome: 'loss', turnsUsed: 1, coinsEarned: 0, piecesLost: 0,
    }]);
  });

  it('in the shop or awaiting_stage keeps the history as it is', () => {
    const shop = winOne(rookRun()).session;
    expect(value(abandon(shop)).session.run.history).toEqual(shop.run.history);
    const waiting = value(leave(shop, c)).session;
    expect(value(abandon(waiting)).session).toMatchObject({ phase: 'ended', outcome: { result: 'lost', endReason: 'abandoned' } });
  });
});

describe('wrong_phase', () => {
  const NON_ENDED: RunPhase[] = ['awaiting_stage', 'deployment', 'action', 'shop'];
  const actions: [string, RunPhase[], (s: RunSession) => RunResult][] = [
    ['provideStage', ['awaiting_stage', 'shop'], s => provideStage(s, mateInOneStage('0000-0000'), c)],
    ['start', ['deployment'], s => start(s, KING_ROOK, c)],
    ['commit', ['action'], s => commit(s, mv('e1', 'e8'), c)],
    ['merge', ['shop'], s => merge(s, ['p_knight_02', 'p_knight_03', 'p_fill_01'], c)],
    ['sell', ['shop'], s => sell(s, 'p_bishop_04', c)],
    ['cut', ['shop'], s => cut(s, 'p_bishop_05', c)],
    ['buy', ['shop'], s => buy(s, 1, {}, c)],
    ['repair', ['shop'], s => repair(s, ROOK_ID, c)],
    ['reroll', ['shop'], s => reroll(s, c)],
    ['leave', ['shop'], s => leave(s, c)],
    ['abandon', NON_ENDED, s => abandon(s)],
  ];

  const sessions = (): Record<RunPhase, RunSession> => {
    const awaiting = fullDeck(THREE_MORE);
    const deployment = value(provideStage(awaiting, promotionOverflowStage(seedOf(awaiting)), c)).session;
    const action = value(start(deployment, KING_ROOK, c)).session;
    const t1 = value(commit(action, mv('b7', 'b8', 'knight'), c)).session;
    const shop = value(commit(t1, mv('e1', 'e8'), c)).session;
    const ended = value(abandon(shop)).session;
    return { awaiting_stage: awaiting, deployment, action, shop, ended };
  };

  it('every action outside its phases is refused with the phases it accepts', () => {
    const byPhase = sessions();
    for (const [phase, s] of Object.entries(byPhase) as [RunPhase, RunSession][]) {
      expect(s.phase).toBe(phase);
      for (const [name, allowed, act] of actions) {
        const e = error(act(s));
        if (allowed.includes(phase)) {
          expect(e?.kind, `${name} in ${phase}`).not.toBe('wrong_phase');
        } else {
          expect(e, `${name} in ${phase}`).toEqual({ kind: 'wrong_phase', expected: allowed });
        }
      }
    }
  });
});
