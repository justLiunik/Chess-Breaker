import { describe, expect, it } from 'vitest';
import type { CommitError, DropRefusal } from '@checkbreaker/engine';
import type { RunError, SaveError } from '@checkbreaker/run';
import { commitErrorText, deckGateText, dropRefusalText, runErrorText, saveErrorText } from '../src/messages';

const commit: Record<CommitError['kind'], CommitError> = {
  king_in_check_at_end: { kind: 'king_in_check_at_end', square: 'e1', checkers: ['e8'], afterRevert: false },
  focus_exceeded: { kind: 'focus_exceeded', atStep: 2, needed: 2, available: 1 },
  credits_exceeded: { kind: 'credits_exceeded', atStep: 4 },
  empty_queue: { kind: 'empty_queue' },
  illegal_move: { kind: 'illegal_move', atStep: 0, from: 'a2', to: 'h7', reason: 'unreachable' },
  stage_not_active: { kind: 'stage_not_active' },
  stage_not_won: { kind: 'stage_not_won', status: 'active' },
  wrong_phase: { kind: 'wrong_phase', expected: 'deployment' },
  durability_unavailable: { kind: 'durability_unavailable', instanceId: 'n1' },
  invalid_deployment: { kind: 'invalid_deployment', to: 'c4', reason: 'occupied' },
  spawn_points_exceeded: { kind: 'spawn_points_exceeded', budget: 5, cost: 7 },
  skill_unavailable: { kind: 'skill_unavailable', atStep: 1, skillId: 'x', reason: 'once_per_turn' },
  invalid_target: { kind: 'invalid_target', atStep: 1, skillId: 'x', reason: 'no_target' },
  invariant_violation: { kind: 'invariant_violation', invariant: 'I1', detail: 'oops' },
};

const run: Record<RunError['kind'], RunError> = {
  wrong_phase: { kind: 'wrong_phase', expected: ['shop'] },
  insufficient_coins: { kind: 'insufficient_coins', price: 9, coins: 4 },
  deck_full: { kind: 'deck_full' },
  deck_over_capacity: { kind: 'deck_over_capacity', size: 9, capacity: 8 },
  loadout_full: { kind: 'loadout_full' },
  replace_not_needed: { kind: 'replace_not_needed' },
  restart_unavailable: { kind: 'restart_unavailable' },
  slot_sold: { kind: 'slot_sold', slot: 1 },
  no_such_slot: { kind: 'no_such_slot', slot: 7 },
  not_damaged: { kind: 'not_damaged', instanceId: 'n1' },
  cannot_repair: { kind: 'cannot_repair', instanceId: 'n1', reason: 'spent' },
  cannot_sell: { kind: 'cannot_sell', instanceId: 'n1', reason: 'king' },
  cannot_cut: { kind: 'cannot_cut', instanceId: 'n1', reason: 'not_in_deck' },
  merge_invalid: { kind: 'merge_invalid', reason: 'mismatch' },
  rerolls_exhausted: { kind: 'rerolls_exhausted' },
  stage_mismatch: { kind: 'stage_mismatch', expected: 'a', got: 'b' },
  stage_already_provided: { kind: 'stage_already_provided' },
  not_ready: { kind: 'not_ready' },
  engine: { kind: 'engine', error: { kind: 'empty_queue' } },
};

const save: Record<SaveError['kind'], SaveError> = {
  malformed: { kind: 'malformed', detail: 'not JSON' },
  unknown_version: { kind: 'unknown_version', version: 1, message: 'unknown save version 1; this build reads save version 2' },
  invalid_session: { kind: 'invalid_session', detail: 'deck: bad' },
};

function checkTable(texts: string[]) {
  for (const t of texts) expect(t.trim().length).toBeGreaterThan(0);
  expect(new Set(texts).size).toBe(texts.length);
}

describe('error messages', () => {
  it('commit texts are non-empty and distinct', () => {
    checkTable(Object.values(commit).map(commitErrorText));
  });
  it('run texts are non-empty and distinct', () => {
    checkTable(Object.values(run).map(runErrorText));
  });
  it('save texts are non-empty and distinct', () => {
    checkTable(Object.values(save).map(saveErrorText));
  });

  it('names the cause', () => {
    const f = commitErrorText(commit.focus_exceeded);
    expect(f).toContain('step 3');
    expect(f).toContain('needs 2');
    expect(f).toContain('have 1');
    expect(f).toContain('Focus');
    const m = commitErrorText(commit.illegal_move);
    expect(m).toContain('a2');
    expect(m).toContain('h7');
    expect(
      commitErrorText({ kind: 'king_in_check_at_end', square: 'e1', checkers: ['e8'], afterRevert: true }),
    ).toMatch(/revert/i);
    expect(commitErrorText(commit.king_in_check_at_end)).not.toMatch(/revert/i);
    expect(saveErrorText(save.unknown_version)).toContain('unknown save version 1; this build reads save version 2');
    expect(runErrorText(run.insufficient_coins)).toMatch(/9.*4/);
    // the deck gate names the size, the limit and the way out (M5.1)
    const gate = runErrorText(run.deck_over_capacity);
    expect(gate).toMatch(/9.*8/);
    expect(gate).toMatch(/sell/i);
    expect(gate).not.toBe(runErrorText(run.deck_full));
    expect(runErrorText({ kind: 'deck_over_capacity', size: 10, capacity: 8 })).toContain('2 pieces');
    expect(runErrorText(run.engine)).toBe(commitErrorText({ kind: 'empty_queue' }));
  });

  it('distinguishes sub-reasons', () => {
    const reasons = [
      'no_piece', 'not_your_piece', 'unreachable', 'own_piece', 'king_square', 'promotion_required', 'promotion_not_allowed',
    ] as const;
    checkTable(reasons.map((reason) => commitErrorText({ kind: 'illegal_move', atStep: 0, from: 'a2', to: 'a3', reason })));
    const merge = ['count', 'mismatch', 'durability', 'legendary', 'ceiling', 'king', 'not_in_deck'] as const;
    checkTable(merge.map((reason) => runErrorText({ kind: 'merge_invalid', reason })));
  });

  it('names the deployment reasons, including the M5.1 ones', () => {
    const reasons = [
      'occupied', 'outside_zone', 'king_missing', 'king_in_check', 'gives_check', 'queen_limit', 'not_in_deck', 'duplicate',
    ] as const;
    checkTable(reasons.map((reason) => commitErrorText({ kind: 'invalid_deployment', to: 'c4', reason })));
    expect(commitErrorText({ kind: 'invalid_deployment', to: 'c4', reason: 'gives_check' })).toMatch(/check/i);
    expect(commitErrorText({ kind: 'invalid_deployment', to: 'c4', reason: 'queen_limit' })).toMatch(/queen/i);
    expect(dropRefusalText('gives_check')).toMatch(/block the line first/i);
    expect(deckGateText({ size: 9, capacity: 8 })).toBe('Deck 9/8: sell, merge or cut to continue');
    const drops: DropRefusal[] = [
      'occupied', 'outside_zone', 'king_in_check', 'gives_check', 'queen_limit', 'not_in_deck', 'duplicate', 'spawn_points_exceeded',
    ];
    checkTable(drops.map(dropRefusalText));
  });
});
