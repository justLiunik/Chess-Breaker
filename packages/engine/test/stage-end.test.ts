import { describe, expect, it } from 'vitest';
import { endStage } from '../src/stage-end';
import { startStage } from '../src/deployment';
import { commitQueue } from '../src/rules';
import { legalPlayerMoves } from '../src/legality';
import { applyPlayerMove } from '../src/queue';
import { rng } from '../src/rng';
import { config, deepFreeze, deploymentStageOf, runOf, stageOf } from './helpers';
import type { Action, PieceInstance, RunState, StageState } from '../src/types';

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
const won = (over: Partial<StageState> = {}): StageState => stageOf({ e1: 'K', e8: 'k' }, { status: 'won', ...over });
const withStatus = (run: RunState, id: string, patch: Partial<PieceInstance>): RunState =>
  deepFreeze({ ...run, deck: run.deck.map((p) => (p.instanceId === id ? { ...p, ...patch } : p)) });
const find = (run: RunState, id: string): PieceInstance | undefined => run.deck.find((p) => p.instanceId === id);
const queenOf = (over: Partial<PieceInstance> = {}): PieceInstance => ({
  instanceId: 'p_queen_d3', pieceType: 'queen', rarity: 'unique', durability: 4, durabilityMax: 4,
  origin: 'starter', acquiredAtStage: 0, status: 'in_deck', ...over,
});

describe('endStage', () => {
  it.each(['active', 'lost'] as const)('refuses a %s stage', (status) => {
    const r = endStage(runOf(), won({ status }), config);
    expect(r).toEqual({ ok: false, error: { kind: 'stage_not_won', status } });
  });

  it('returns a deployed piece to in_deck with its durability', () => {
    const run = withStatus(runOf(), 'p_knight_02', { status: 'deployed', durability: 1 });
    const v = ok(endStage(run, won(), config));
    expect(find(v.run, 'p_knight_02')).toMatchObject({ status: 'in_deck', durability: 1 });
    expect(v.events).toContainEqual({ type: 'piece_returned', instanceId: 'p_knight_02', durability: 1 });
  });

  it('returns the King to in_deck', () => {
    const run = withStatus(runOf(), 'p_king_01', { status: 'deployed' });
    const v = ok(endStage(run, won(), config));
    expect(find(v.run, 'p_king_01')?.status).toBe('in_deck');
  });

  it('removes a spent piece only at endStage', () => {
    const dep = deploymentStageOf({ e8: 'k', h7: 'p' }, { enemyPolicy: { type: 'scripted', line: ['h7h6'] } });
    const run = withStatus(runOf(), 'p_knight_02', { durability: 1 });
    const started = ok(startStage(run, dep, [
      { instanceId: 'p_king_01', to: 'e1' }, { instanceId: 'p_knight_02', to: 'b1' },
    ], config));
    expect(find(started.run, 'p_knight_02')?.status).toBe('spent');
    const committed = ok(commitQueue(started.run, started.stage, [{ type: 'MOVE', from: 'e1', to: 'f1' }], config));
    expect(find(committed.run, 'p_knight_02')?.status).toBe('spent');
    const v = ok(endStage(committed.run, won(), config));
    expect(find(v.run, 'p_knight_02')).toBeUndefined();
    expect(v.events).toContainEqual({ type: 'piece_removed', instanceId: 'p_knight_02', reason: 'spent' });
  });

  it('returns a lifeline queen in_deck with durability 1', () => {
    const base = runOf();
    const run = deepFreeze({ ...base, deck: [...base.deck, queenOf({ status: 'captured', durability: 3, usedOnce: ['lifeline'] })] });
    const v = ok(endStage(run, won(), config));
    expect(find(v.run, 'p_queen_d3')).toMatchObject({ status: 'in_deck', durability: 1, usedOnce: ['lifeline'] });
    expect(v.events).toContainEqual({ type: 'piece_returned', instanceId: 'p_queen_d3', durability: 1 });
  });

  it('Review Focus 5: a lifeline queen captured again next stage is removed with no lifeline_saved', () => {
    const capture = (run: RunState) => {
      const dep = deploymentStageOf({ e8: 'k', e4: 'p' }, { enemyPolicy: { type: 'scripted', line: ['e4d3'] } });
      const s = ok(startStage(run, dep, [
        { instanceId: 'p_king_01', to: 'e1' }, { instanceId: 'p_queen_d3', to: 'd3' },
      ], config));
      return ok(commitQueue(s.run, s.stage, [{ type: 'MOVE', from: 'e1', to: 'f1' }], config));
    };
    const base = runOf();
    const run0 = deepFreeze({ ...base, deck: [...base.deck, queenOf()] });
    const first = capture(run0);
    expect(first.events).toContainEqual({ type: 'lifeline_saved', instanceId: 'p_queen_d3' });
    expect(find(first.run, 'p_queen_d3')?.status).toBe('captured');
    const ended = ok(endStage(first.run, won(), config));
    expect(find(ended.run, 'p_queen_d3')).toMatchObject({ status: 'in_deck', durability: 1 });
    const second = capture(ended.run);
    expect(second.events.some((e) => e.type === 'lifeline_saved')).toBe(false);
    expect(find(second.run, 'p_queen_d3')).toBeUndefined();
  });

  it('overCapacity counts non-King pieces over 8 (8 + one promotion → 1)', () => {
    const mk = (n: number): PieceInstance => ({
      instanceId: `p_knight_x${n}`, pieceType: 'knight', rarity: 'normal', durability: 2, durabilityMax: 2,
      origin: 'promotion', acquiredAtStage: 0, status: 'in_deck',
    });
    const king = runOf().deck[0]!;
    const eight = deepFreeze({ ...runOf(), deck: [king, ...Array.from({ length: config.deck.capacity }, (_, n) => mk(n + 1))] });
    expect(ok(endStage(eight, won(), config)).overCapacity).toBe(0);
    const nine = deepFreeze({ ...runOf(), deck: [...eight.deck, mk(config.deck.capacity + 1)] });
    expect(ok(endStage(nine, won(), config)).overCapacity).toBe(1);
  });
});

describe('I15: no queue adds a Hero Piece to the board after startStage', () => {
  it('the set of instanceIds on the board only shrinks (500 chained random queues)', () => {
    const dep = deploymentStageOf({ e8: 'k', c7: 'p', f7: 'p', a8: 'r' }, { enemyPolicy: { type: 'best_move', depth: 1 } });
    const started = ok(startStage(runOf(), dep, [
      { instanceId: 'p_king_01', to: 'e1' }, { instanceId: 'p_knight_02', to: 'b1' }, { instanceId: 'p_bishop_04', to: 'c1' },
    ], config));
    const ids = (s: StageState): Set<string> =>
      new Set(Object.values(s.board).flatMap((p) => (p.instanceId !== undefined ? [p.instanceId] : [])));
    const before = ids(started.stage);
    expect(before.size).toBe(3);
    let cursor = 0;
    const pick = (n: number): number => { const r = rng('I15', cursor); cursor = r.next; return Math.floor(r.value * n); };
    let commits = 0;
    let current = { run: started.run, stage: started.stage };
    for (let i = 0; i < 500; i++) {
      // Chain turns from the previous result; pick every queued move from the board at that point.
      const queue: Action[] = [];
      let board = current.stage.board;
      const length = 1 + pick(current.stage.moveCredits);
      for (let q = 0; q < length; q++) {
        const whites = Object.entries(board).filter(([, p]) => p.instanceId !== undefined).map(([sq]) => sq);
        if (whites.length === 0) break;
        const from = whites[pick(whites.length)]!;
        const tos = legalPlayerMoves({ ...current.stage, board }, from);
        if (tos.length === 0) continue;
        const to = tos[pick(tos.length)]!;
        queue.push({ type: 'MOVE', from, to });
        board = applyPlayerMove(board, from, to, config).board;
      }
      if (queue.length === 0) { current = { run: started.run, stage: started.stage }; continue; }
      const r = commitQueue(current.run, current.stage, queue, config);
      if (!r.ok) { current = { run: started.run, stage: started.stage }; continue; }
      commits++;
      for (const id of ids(r.value.stage)) expect(before.has(id)).toBe(true);
      // An ended stage restarts from the deployed state.
      current = r.value.stage.status === 'active' ? { run: r.value.run, stage: r.value.stage } : { run: started.run, stage: started.stage };
    }
    expect(commits).toBeGreaterThanOrEqual(100);
  });
});
