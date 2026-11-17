import { describe, expect, it } from 'vitest';
import { pendingBase } from '@checkbreaker/engine';
import { commit, devSkipStage, expectedSeed, leave, newRun, provideStage, sell, start } from '../src/session';
import { loadSave, serializeSave } from '../src/save';
import type { RunEvent, RunResult, RunSession } from '../src/types';
import { ROOK_ID, deepFreeze, mateInOneStage, runConfig as c, runWithRook } from './fixtures';

const SEED = 'B0B0-1234';
const KING_ROOK = [{ instanceId: 'p_king_01', to: 'd1' }, { instanceId: ROOK_ID, to: 'e1' }];
const WRONG = { ok: false, error: { kind: 'wrong_phase', expected: ['deployment', 'action'] } };

const ok = (r: RunResult): { session: RunSession; events: RunEvent[] } => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return { session: deepFreeze(r.value.session), events: r.value.events };
};
const rook = (s: RunSession) => s.run.deck.find(p => p.instanceId === ROOK_ID);

/** Deployment of stage `n` (0-8) of a run holding a rook. */
function deployedAt(n: number): RunSession {
  const fresh = newRun(SEED, c);
  const run = { ...runWithRook(fresh.run), actIndex: Math.floor(n / 3), stageIndex: n % 3 };
  const request = { ...fresh.next!.request, run, actIndex: run.actIndex, stageIndex: run.stageIndex };
  const s: RunSession = { ...fresh, run, next: { request, stage: null } };
  return ok(provideStage(s, mateInOneStage(expectedSeed(SEED, run.actIndex, run.stageIndex)), c)).session;
}

describe('devSkipStage', () => {
  it('skip in Deployment pays the base reward only', () => {
    const d = deployedAt(0);
    const base = pendingBase(d.run, d.stage!, c);
    expect(base).toBeGreaterThan(0);
    const { session, events } = ok(devSkipStage(d, c));
    expect(session.phase).toBe('shop');
    expect(session.run.coins).toBe(d.run.coins + base);
    expect(session.run.history.at(-1)).toMatchObject({ outcome: 'win', turnsUsed: 0, coinsEarned: base });
    expect(session.debug).toBe(true);
    expect(session.stage).toBeNull();
    expect(session.entryStage).toBeNull();
    expect(session.run.deck).toEqual(d.run.deck);
    expect(events).toContainEqual({ type: 'stage_skipped', coins: base });
    expect(events.some(e => e.type === 'stage_won')).toBe(false);
    expect(events.some(e => e.type === 'shop_opened')).toBe(true);
  });

  it('skip in Action keeps START costs and returns deployed pieces', () => {
    const a = ok(start(deployedAt(0), KING_ROOK, c)).session;
    expect(rook(a)!.durability).toBe(1);
    const { session } = ok(devSkipStage(a, c));
    expect(rook(session)).toMatchObject({ status: 'in_deck', durability: 1 });
    expect(session.run.deck.find(p => p.pieceType === 'king')!.status).toBe('in_deck');
    expect(session.run.history.at(-1)!.piecesLost).toBe(0);
  });

  it('skip in Action removes a piece START took to 0, as endStage does', () => {
    const d = deployedAt(0);
    const worn = { ...d, run: { ...d.run, deck: d.run.deck.map(p => (p.instanceId === ROOK_ID ? { ...p, durability: 1 } : p)) } };
    const { session, events } = ok(devSkipStage(ok(start(worn, KING_ROOK, c)).session, c));
    expect(rook(session)).toBeUndefined();
    expect(events).toContainEqual({ type: 'piece_removed', instanceId: ROOK_ID, reason: 'spent' });
    expect(session.run.history.at(-1)!.piecesLost).toBe(1);
  });

  it('skip after overtime pays the pending base', () => {
    const d = deployedAt(0);
    const full = pendingBase(d.run, d.stage!, c);
    const paid = (n: number): RunSession => {
      const stage = { ...d.stage!, overtimePaid: n };
      return { ...d, stage, entryStage: stage };
    };
    const some = paid(2);
    expect(ok(devSkipStage(some, c)).session.run.coins).toBe(d.run.coins + Math.max(0, full - 2));
    expect(ok(devSkipStage(paid(full + 50), c)).session.run.coins).toBe(d.run.coins);
  });

  it('skip on the Act III boss ends the run won', () => {
    const { session, events } = ok(devSkipStage(deployedAt(8), c));
    expect(session.phase).toBe('ended');
    expect(session.outcome).toEqual({ result: 'won' });
    expect(session.run.status).toBe('won');
    expect(session.debug).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'run_ended', result: 'won' });
  });

  it('skip that overflows the deck opens the chooser', () => {
    const d = deployedAt(0);
    const over = c.deck.capacity + 1 - d.run.deck.filter(p => p.pieceType !== 'king').length;
    const extras = Array.from({ length: over }, (_, i) => ({ ...d.run.deck[1]!, instanceId: `p_extra_${i}` }));
    const s = { ...d, run: { ...d.run, deck: [...d.run.deck, ...extras] } };
    const { session, events } = ok(devSkipStage(s, c));
    expect(session.phase).toBe('chooser');
    expect(session.chooser).toEqual({ overCapacity: 1 });
    expect(events).toContainEqual({ type: 'chooser_opened', overCapacity: 1 });
    expect(session.run.history.at(-1)!.outcome).toBe('win');
    expect(ok(sell(session, 'p_extra_0', c)).session.phase).toBe('shop');
  });

  it('debug survives save and is never cleared', () => {
    const skipped = ok(devSkipStage(deployedAt(0), c)).session;
    const loaded = loadSave(serializeSave(skipped), c);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    expect(loaded.value.debug).toBe(true);
    const withStage = ok(provideStage(loaded.value, mateInOneStage(expectedSeed(SEED, 0, 1)), c)).session;
    const next = ok(leave(withStage, c)).session;
    expect(next.phase).toBe('deployment');
    expect(next.debug).toBe(true);
    const played = ok(commit(ok(start(next, KING_ROOK, c)).session, [{ type: 'MOVE', from: 'e1', to: 'e8' }], c)).session;
    expect(played.phase).toBe('shop');
    expect(played.debug).toBe(true);
  });

  it('a normal session has no debug key; loadSave refuses debug other than true', () => {
    const d = deployedAt(0);
    expect('debug' in d).toBe(false);
    for (const bad of [false, 'true', 1, null]) {
      const r = loadSave(JSON.stringify({ version: 1, session: { ...d, debug: bad } }), c);
      expect(r).toEqual({ ok: false, error: expect.objectContaining({ kind: 'invalid_session' }) });
    }
    expect(loadSave(JSON.stringify({ version: 1, session: { ...d, debug: true } }), c).ok).toBe(true);
  });

  it('refused outside deployment/action', () => {
    expect(devSkipStage(newRun(SEED, c), c)).toEqual(WRONG);
    expect(devSkipStage(ok(devSkipStage(deployedAt(0), c)).session, c)).toEqual(WRONG);
  });
});
