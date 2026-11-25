import { describe, expect, expectTypeOf, it } from 'vitest';
import { startStage } from '../src/deployment';
import { commitQueue } from '../src/rules';
import { config, deepFreeze, deploymentStageOf, runOf } from './helpers';
import type { Action, CommitError, RunState, StageState } from '../src/types';

const stage = (): StageState => deploymentStageOf({ e8: 'k' });
const P = (instanceId: string, to: string) => ({ instanceId, to });
const K = P('p_king_01', 'e1');

function refused(run: RunState, s: StageState, placements: { instanceId: string; to: string }[], error: object): void {
  const r = startStage(run, s, placements, config);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toEqual(error);
  expect('value' in r).toBe(false);
}

describe('startStage refusals (each spends nothing; inputs are frozen)', () => {
  it('refuses an active-phase stage', () => {
    refused(runOf(), deploymentStageOf({ e8: 'k' }, { phase: 'action' }), [K], { kind: 'wrong_phase', expected: 'deployment' });
  });
  it('refuses a finished stage', () => {
    refused(runOf(), deploymentStageOf({ e8: 'k' }, { status: 'won' }), [K], { kind: 'stage_not_active' });
  });
  it('refuses an unknown instance', () => {
    refused(runOf(), stage(), [K, P('p_nope', 'd1')], { kind: 'invalid_deployment', to: 'd1', reason: 'not_in_deck' });
  });
  it('refuses an instance that is not in the deck', () => {
    const run = runOf();
    const deck = run.deck.map((p) => (p.instanceId === 'p_knight_02' ? { ...p, status: 'deployed' as const } : p));
    refused(deepFreeze({ ...run, deck }), stage(), [K, P('p_knight_02', 'd1')], { kind: 'invalid_deployment', to: 'd1', reason: 'not_in_deck' });
  });
  it('refuses an instance placed twice', () => {
    refused(runOf(), stage(), [K, P('p_knight_02', 'd1'), P('p_knight_02', 'f1')], { kind: 'invalid_deployment', to: 'f1', reason: 'duplicate' });
  });
  it('refuses durability 0', () => {
    const run = runOf();
    const deck = run.deck.map((p) => (p.instanceId === 'p_knight_02' ? { ...p, durability: 0 } : p));
    refused(deepFreeze({ ...run, deck }), stage(), [K, P('p_knight_02', 'd1')], { kind: 'durability_unavailable', instanceId: 'p_knight_02' });
  });
  it('refuses rank 5', () => {
    refused(runOf(), stage(), [K, P('p_knight_02', 'd5')], { kind: 'invalid_deployment', to: 'd5', reason: 'outside_zone' });
  });
  it('refuses an occupied square, including one taken by an earlier placement', () => {
    refused(runOf(), deploymentStageOf({ e8: 'k', d2: 'p' }), [K, P('p_knight_02', 'd2')], { kind: 'invalid_deployment', to: 'd2', reason: 'occupied' });
    refused(runOf(), stage(), [K, P('p_knight_02', 'e1')], { kind: 'invalid_deployment', to: 'e1', reason: 'occupied' });
  });
  it('refuses no King', () => {
    refused(runOf(), stage(), [P('p_knight_02', 'd1')], { kind: 'invalid_deployment', to: 'd1', reason: 'king_missing' });
  });
  it('refuses knight+bishop+rook (11) over 9', () => {
    const run = runOf();
    const deck = [...run.deck, { ...run.deck[1]!, instanceId: 'p_rook_06', pieceType: 'rook' as const }];
    refused(deepFreeze({ ...run, deck }), stage(),
      [K, P('p_knight_02', 'a1'), P('p_bishop_04', 'b1'), P('p_rook_06', 'c1')],
      { kind: 'spawn_points_exceeded', budget: 9, cost: 11 });
  });
  it('counts a Legendary bishop as 5', () => {
    const run = runOf();
    const deck = run.deck.map((p) => (p.instanceId === 'p_bishop_04' ? { ...p, rarity: 'legendary' as const } : p));
    refused(deepFreeze({ ...run, deck }), stage(),
      [K, P('p_bishop_04', 'a1'), P('p_knight_02', 'b1'), P('p_knight_03', 'c1')],
      { kind: 'spawn_points_exceeded', budget: 9, cost: 11 });
  });
  it('refuses a King left in check', () => {
    refused(runOf(), deploymentStageOf({ e8: 'k', e7: 'r' }), [K],
      { kind: 'invalid_deployment', to: 'e1', reason: 'king_in_check' });
  });
});

describe('no check at START and one queen summon (M5.1 I16, P10)', () => {
  const withQueens = (rarities: ('normal' | 'unique')[]): RunState => {
    const run = runOf();
    const queens = rarities.map((rarity, i) => ({
      ...run.deck[1]!, instanceId: `p_queen_${i + 7}`, pieceType: 'queen' as const, rarity,
    }));
    return deepFreeze({ ...run, deck: [...run.deck, ...queens] });
  };
  it('START refuses a summon that gives check (I16)', () => {
    // The playtest board: bishop c4 sees f7 along d5, e6.
    refused(runOf(), deploymentStageOf({ f7: 'k' }), [K, P('p_bishop_04', 'c4')],
      { kind: 'invalid_deployment', to: 'c4', reason: 'gives_check' });
  });
  it('START accepts the same bishop once the line is blocked', () => {
    const r = startStage(runOf(), deploymentStageOf({ f7: 'k', e6: 'p' }), [K, P('p_bishop_04', 'c4')], config);
    expect(r.ok).toBe(true);
  });
  it('START names a Unique bishop that gives check by leaping an ally, not another piece (I16)', () => {
    // c4 bishop, d5 spawned pawn, f7 king: a Unique bishop captures after leaping its own pieces, so it
    // attacks f7 through d5. A Rare one does not, and START accepts it (rarity abilities, docs/06 §4).
    const at = (rarity: 'rare' | 'unique'): RunState => {
      const run = runOf();
      return deepFreeze({ ...run, deck: run.deck.map((p) => (p.instanceId === 'p_bishop_04' ? { ...p, rarity } : p)) });
    };
    const s = deploymentStageOf({ f7: 'k', d5: 'P' });
    refused(at('unique'), s, [K, P('p_bishop_04', 'c4')], { kind: 'invalid_deployment', to: 'c4', reason: 'gives_check' });
    expect(startStage(at('rare'), s, [K, P('p_bishop_04', 'c4')], config).ok).toBe(true);
  });
  it('START refuses a second summoned queen of any rarity', () => {
    const s = deploymentStageOf({ e8: 'k' }, { spawnPoints: 40 });
    refused(withQueens(['normal', 'unique']), s, [K, P('p_queen_7', 'a1'), P('p_queen_8', 'b1')],
      { kind: 'invalid_deployment', to: 'b1', reason: 'queen_limit' });
    const one = startStage(withQueens(['normal', 'unique']), s, [K, P('p_queen_7', 'a1')], config);
    expect(one.ok).toBe(true);
  });
  it('a summoned queen and a promotion to a queen in the same stage are both allowed (P10)', () => {
    // The limit counts summons only: g7-g8=Q adds a second White queen after START (M5.1 spec §8).
    const started = startStage(withQueens(['normal']), deploymentStageOf({ h5: 'k', g7: 'P' }), [K, P('p_queen_7', 'a1')], config);
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const promote: Action = { type: 'MOVE', from: 'g7', to: 'g8', promotion: 'queen' };
    const r = commitQueue(started.value.run, started.value.stage, [promote], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const board = r.value.stage.board;
    expect(Object.keys(board).filter((sq) => board[sq]!.color === 'white' && board[sq]!.pieceType === 'queen').sort())
      .toEqual(['a1', 'g8']);
    expect(r.value.run.deck.filter((p) => p.pieceType === 'queen').map((p) => [p.origin, p.status]))
      .toEqual([['starter', 'deployed'], ['promotion', 'in_deck']]);
  });
});

describe('startStage check order (spec 7.2: the earlier failure wins)', () => {
  const withDeck = (f: (d: RunState['deck']) => RunState['deck']): RunState => {
    const run = runOf();
    return deepFreeze({ ...run, deck: f(run.deck) });
  };
  it('stage_not_active beats wrong_phase', () => {
    refused(runOf(), deploymentStageOf({ e8: 'k' }, { status: 'won', phase: 'action' }), [K], { kind: 'stage_not_active' });
  });
  it('not_in_deck beats a bad square in the same placement', () => {
    refused(runOf(), stage(), [K, P('p_nope', 'd5')], { kind: 'invalid_deployment', to: 'd5', reason: 'not_in_deck' });
  });
  it('durability_unavailable beats outside_zone', () => {
    const run = withDeck((d) => d.map((p) => (p.instanceId === 'p_knight_02' ? { ...p, durability: 0 } : p)));
    refused(run, stage(), [K, P('p_knight_02', 'd5')], { kind: 'durability_unavailable', instanceId: 'p_knight_02' });
  });
  it('an invalid first placement beats a later duplicate', () => {
    refused(runOf(), stage(), [K, P('p_knight_02', 'd5'), P('p_knight_03', 'd1'), P('p_knight_03', 'f1')],
      { kind: 'invalid_deployment', to: 'd5', reason: 'outside_zone' });
  });
  it('king_missing beats spawn_points_exceeded', () => {
    refused(runOf(), stage(), [P('p_knight_02', 'a1'), P('p_bishop_04', 'b1'), P('p_bishop_05', 'c1'), P('p_knight_03', 'd1')],
      { kind: 'invalid_deployment', to: 'a1', reason: 'king_missing' });
  });
  it('spawn_points_exceeded beats king_in_check', () => {
    const run = withDeck((d) => d.map((p) => (p.instanceId === 'p_bishop_04' ? { ...p, rarity: 'legendary' as const } : p)));
    refused(run, deploymentStageOf({ e8: 'k', e7: 'r' }),
      [K, P('p_bishop_04', 'a1'), P('p_knight_02', 'b1'), P('p_knight_03', 'c1')],
      { kind: 'spawn_points_exceeded', budget: 9, cost: 11 });
  });
});

describe('startStage edge cases', () => {
  it('refuses empty placements as king_missing', () => {
    refused(runOf(), stage(), [], { kind: 'invalid_deployment', to: '', reason: 'king_missing' });
  });
  it('refuses a malformed square as outside_zone without throwing', () => {
    refused(runOf(), stage(), [K, P('p_knight_02', 'zz')], { kind: 'invalid_deployment', to: 'zz', reason: 'outside_zone' });
    refused(runOf(), stage(), [K, P('p_knight_02', 'e')], { kind: 'invalid_deployment', to: 'e', reason: 'outside_zone' });
  });
  it('refuses the King placed twice as duplicate', () => {
    refused(runOf(), stage(), [K, P('p_king_01', 'd1')], { kind: 'invalid_deployment', to: 'd1', reason: 'duplicate' });
  });
  it('refuses two non-King pieces on one square as occupied', () => {
    refused(runOf(), stage(), [K, P('p_knight_02', 'd1'), P('p_knight_03', 'd1')],
      { kind: 'invalid_deployment', to: 'd1', reason: 'occupied' });
  });
});

describe('startStage success', () => {
  const run0 = runOf({ loadout: [{ skillId: 'x' }, { skillId: 'x' }] });
  const go = () => {
    const r = startStage(run0, stage(), [K, P('p_knight_02', 'd1'), P('p_knight_03', 'f1')], config);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };

  it('pays durability, marks deployed, starts the action phase', () => {
    const { run, stage: s } = go();
    const by = (id: string) => run.deck.find((p) => p.instanceId === id)!;
    expect(by('p_knight_02')).toMatchObject({ durability: 1, status: 'deployed' });
    expect(by('p_knight_03')).toMatchObject({ durability: 1, status: 'deployed' });
    expect(by('p_king_01')).toMatchObject({ durability: null, status: 'deployed' });
    expect(by('p_bishop_04').status).toBe('in_deck');
    expect(s).toMatchObject({ phase: 'action', moveCredits: 1, focus: 3, skillLog: [] });
    expect(s.board.e1).toEqual({ pieceType: 'king', color: 'white', instanceId: 'p_king_01' });
    expect(s.board.d1).toEqual({ pieceType: 'knight', color: 'white', instanceId: 'p_knight_02', rarity: 'normal' });
  });
  it('startStage leaves the loadout untouched', () => {
    // Single-use skills (M4): nothing refills, duplicates stay separate entries.
    expect(go().run.loadout).toBe(run0.loadout);
    expect(run0.loadout).toEqual([{ skillId: 'x' }, { skillId: 'x' }]);
  });
  it('turns a piece at durability 1 into spent', () => {
    const run = runOf();
    const deck = run.deck.map((p) => (p.instanceId === 'p_knight_02' ? { ...p, durability: 1 } : p));
    const r = startStage(deepFreeze({ ...run, deck }), stage(), [K, P('p_knight_02', 'd1')], config);
    expect(r.ok && r.value.run.deck.find((p) => p.instanceId === 'p_knight_02')).toMatchObject({ durability: 0, status: 'spent' });
  });
  it('emits piece_summoned in placement order, then stage_started', () => {
    expect(go().events).toEqual([
      { type: 'piece_summoned', instanceId: 'p_king_01', square: 'e1' },
      { type: 'piece_summoned', instanceId: 'p_knight_02', square: 'd1' },
      { type: 'piece_summoned', instanceId: 'p_knight_03', square: 'f1' },
      { type: 'stage_started' },
    ]);
  });
  it('allows the King alone', () => {
    const r = startStage(runOf(), stage(), [K], config);
    expect(r.ok && r.value.events).toEqual([
      { type: 'piece_summoned', instanceId: 'p_king_01', square: 'e1' }, { type: 'stage_started' },
    ]);
  });
});

describe('invalid_deployment reasons', () => {
  it('are typed as the spec §5.3 union (checked by npm run typecheck)', () => {
    expectTypeOf<Extract<CommitError, { kind: 'invalid_deployment' }>['reason']>().toEqualTypeOf<
      'occupied' | 'outside_zone' | 'king_missing' | 'king_in_check' | 'gives_check' | 'queen_limit' | 'not_in_deck' | 'duplicate'
    >();
  });
});
