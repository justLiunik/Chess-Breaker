import { describe, expect, it } from 'vitest';
import { commit, expectedSeed, newRun, provideStage, restartStage, start } from '../src/session';
import { loadSave, serializeSave } from '../src/save';
import type { RunEvent, RunResult, RunSession } from '../src/types';
import { ROOK_ID, deepFreeze, mateInOneStage, runConfig as c, runWithRook } from './fixtures';

const SEED = 'B0B0-1234';
const KING_ROOK = [{ instanceId: 'p_king_01', to: 'd1' }, { instanceId: ROOK_ID, to: 'e1' }];

const ok = (r: RunResult): { session: RunSession; events: RunEvent[] } => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return { session: deepFreeze(r.value.session), events: r.value.events };
};
const rookOf = (s: RunSession) => s.run.deck.find(p => p.instanceId === ROOK_ID)!;

/** A session in Deployment of a mate-in-one stage; `rookDurability` sets the rook before the stage. */
function deployed(rookDurability = 2): RunSession {
  const fresh = newRun(SEED, c);
  const run = runWithRook(fresh.run);
  const deck = run.deck.map(p => (p.instanceId === ROOK_ID ? { ...p, durability: rookDurability } : p));
  const s = { ...fresh, run: { ...run, deck } };
  const { actIndex, stageIndex } = s.next!.request;
  return ok(provideStage(s, mateInOneStage(expectedSeed(s.run.seed, actIndex, stageIndex)), c)).session;
}
const started = (s: RunSession): RunSession => ok(start(s, KING_ROOK, c)).session;

describe('restartStage', () => {
  it('back to Deployment with the entry stage', () => {
    const d = deployed();
    const a = started(d);
    expect(rookOf(a).durability).toBe(1);
    const { session, events } = ok(restartStage(a, c));
    expect(session.phase).toBe('deployment');
    expect(session.stage).toEqual(session.entryStage);
    expect(session.stage).toEqual(d.entryStage);
    expect(rookOf(session)).toMatchObject({ status: 'in_deck', durability: 1 });
    expect(session.run.deck.find(p => p.pieceType === 'king')!.status).toBe('in_deck');
    expect(session.tally).toEqual(a.tally);
    expect(session.run.coins).toBe(a.run.coins);
    expect(events).toEqual([{ type: 'stage_restarted' }]);
  });

  it('a piece START took to 0 stays spent', () => {
    const r = ok(restartStage(started(deployed(1)), c)).session;
    expect(rookOf(r)).toMatchObject({ status: 'spent', durability: 0 });
    const again = start(r, KING_ROOK, c);
    expect(again).toEqual({ ok: false, error: { kind: 'engine', error: expect.objectContaining({ kind: 'invalid_deployment', reason: 'not_in_deck' }) } });
  });

  it('second START pays again', () => {
    const r = ok(restartStage(started(deployed(2)), c)).session;
    expect(rookOf(started(r)).durability).toBe(0);
  });

  it('refused after a commit; wrong phase elsewhere', () => {
    const a = started(deployed());
    const committed = ok(commit(a, [{ type: 'MOVE', from: 'e1', to: 'e2' }], c)).session;
    expect(committed.phase).toBe('action');
    expect(committed.stage!.turnsUsed).toBe(1);
    expect(restartStage(committed, c)).toEqual({ ok: false, error: { kind: 'restart_unavailable' } });
    expect(restartStage(deployed(), c)).toEqual({ ok: false, error: { kind: 'wrong_phase', expected: ['action'] } });
    const won = ok(commit(a, [{ type: 'MOVE', from: 'e1', to: 'e8' }], c)).session;
    expect(won.phase).toBe('shop');
    expect(won.entryStage).toBeNull();
    expect(restartStage(won, c)).toEqual({ ok: false, error: { kind: 'wrong_phase', expected: ['action'] } });
  });

  it('save round trip after restart', () => {
    const r = ok(restartStage(started(deployed(2)), c)).session;
    const loaded = loadSave(serializeSave(r), c);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    expect(loaded.value).toEqual(r);
    expect(rookOf(started(loaded.value)).durability).toBe(0);
  });

  it('a save with entryStage missing in deployment is refused', () => {
    const json = JSON.parse(serializeSave(deployed())) as Record<string, any>;
    const holder = json.session ?? json;
    holder.entryStage = null;
    expect(loadSave(JSON.stringify(json), c).ok).toBe(false);
  });
});
