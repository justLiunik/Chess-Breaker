import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { saveErrorText } from '../src/messages';
import { loadSave, memoryStorage, newRun, serializeSave } from '@checkbreaker/run';
import type { GenRequest } from '@checkbreaker/run';
import { runConfig } from '../src/config';
import { RunProvider, useRun } from '../src/state/store';
import type { UiAction } from '../src/state/store';
import type { StageSource } from '../src/state/stageSource';
import { STARTER_MATE, testStageSource } from './doubles';

type Api = ReturnType<typeof useRun>;
let api: Api;
function Probe() {
  api = useRun();
  return null;
}
const mount = (source: StageSource, storage = memoryStorage()) => {
  render(<RunProvider source={source} storage={storage}><Probe /></RunProvider>);
  return storage;
};
const send = async (a: UiAction) => { await act(async () => { api.dispatch(a); }); };
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

describe('store', () => {
  it('new run requests stage 0 and enters Deployment', async () => {
    const seen: GenRequest[] = [];
    const inner = testStageSource();
    mount({ request: (id, req) => { seen.push(req); return inner.request(id, req); } });
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    expect(seen).toHaveLength(1);
    expect([seen[0]!.actIndex, seen[0]!.stageIndex]).toEqual([0, 0]);
    expect(api.session?.phase).toBe('deployment');
    expect(api.error).toBeNull();
    expect(api.generating).toBe(false);
  });

  it("the source's clue reaches session.clue", async () => {
    mount(testStageSource());
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    expect(api.session?.clue).toEqual([
      { instanceId: 'p_king_01', to: 'e1', pieceType: 'king' },
      { instanceId: 'p_bishop_04', to: 'a3', pieceType: 'bishop', rarity: 'normal' },
    ]);
  });

  it('a reload in Deployment keeps the clue without a new request', async () => {
    const storage = mount(testStageSource());
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    const saved = api.session!.clue;
    expect(saved).not.toBeNull();
    document.body.innerHTML = '';
    mount({ request: () => { throw new Error('no request expected'); } }, storage);
    await send({ type: 'continue' });
    await flush();
    expect(api.session!.phase).toBe('deployment');
    expect(api.session!.clue).toEqual(saved);
  });

  it('generates an XXXX-XXXX seed when none is given', async () => {
    mount(testStageSource());
    await send({ type: 'new_run' });
    await flush();
    expect(api.session?.run.seed).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it('every ok action autosaves', async () => {
    const storage = mount(testStageSource());
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    await send({ type: 'start', placements: STARTER_MATE.placements });
    const back = loadSave(storage.read()!, runConfig);
    expect(back.ok && back.value).toEqual(api.session);
    expect(api.session?.phase).toBe('action');
    await send({ type: 'commit', queue: [STARTER_MATE.move] });
    const back2 = loadSave(storage.read()!, runConfig);
    expect(back2.ok && back2.value).toEqual(api.session);
  });

  it('a refused action shows the error and leaves the session', async () => {
    mount(testStageSource());
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    const before = api.session;
    await send({ type: 'reroll' });
    expect(api.error).toBeTruthy();
    expect(api.session).toBe(before);
  });

  it('stale answer is dropped', async () => {
    const inner = testStageSource();
    let calls = 0;
    let releaseFirst!: () => void;
    const source: StageSource = {
      request(id, req) {
        calls++;
        if (calls > 1) return inner.request(id, req);
        return new Promise((resolve) => { releaseFirst = () => resolve(inner.request(id, req)); });
      },
    };
    mount(source);
    await send({ type: 'new_run', seed: '1111-1111' });
    await send({ type: 'abandon' });
    await send({ type: 'new_run', seed: '2222-2222' });
    await flush();
    expect(api.session?.phase).toBe('deployment');
    expect(api.session?.run.seed).toBe('2222-2222');
    await act(async () => { releaseFirst(); await new Promise((r) => setTimeout(r, 0)); });
    expect(api.session?.run.seed).toBe('2222-2222');
    expect(api.session?.phase).toBe('deployment');
    expect(api.error).toBeNull();
  });

  it('reload while awaiting_stage re-requests', async () => {
    const storage = memoryStorage();
    storage.write(serializeSave(newRun('7F3A-2210', runConfig), '2026-01-01T00:00:00.000Z'));
    const seen: GenRequest[] = [];
    const inner = testStageSource();
    mount({ request: (id, req) => { seen.push(req); return inner.request(id, req); } }, storage);
    await send({ type: 'continue' });
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(newRun('7F3A-2210', runConfig).next!.request);
    expect(api.session?.phase).toBe('deployment');
  });

  it('worker failure shows Retry', async () => {
    const inner = testStageSource();
    let fail = true;
    let calls = 0;
    mount({
      request(id, req) {
        calls++;
        return fail ? Promise.resolve({ id, ok: false as const, message: 'boom' }) : inner.request(id, req);
      },
    });
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    expect(api.genError).toContain('boom');
    expect(api.error).toBeNull();
    expect(api.session?.phase).toBe('awaiting_stage');
    expect(api.generating).toBe(false);
    fail = false;
    await send({ type: 'retry' });
    await flush();
    expect(calls).toBe(2);
    expect(api.genError).toBeNull();
    expect(api.session?.phase).toBe('deployment');
  });

  it('a generation failure in the shop survives later actions, and Retry still posts (I1)', async () => {
    const inner = testStageSource();
    let calls = 0;
    let fail = true;
    mount({
      request(id, req) {
        calls++;
        return calls > 1 && fail ? Promise.resolve({ id, ok: false as const, message: 'boom' }) : inner.request(id, req);
      },
    });
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    await send({ type: 'start', placements: STARTER_MATE.placements });
    await send({ type: 'commit', queue: [STARTER_MATE.move] });
    await flush();
    expect(api.session?.phase).toBe('shop');
    expect(api.genError).toContain('boom');
    await send({ type: 'reroll' });
    await send({ type: 'leave' });
    expect(api.session?.phase).toBe('awaiting_stage');
    expect(api.genError).toContain('boom');
    expect(api.generating).toBe(false);
    fail = false;
    await send({ type: 'retry' });
    await flush();
    expect(calls).toBe(3);
    expect(api.genError).toBeNull();
    expect(api.session?.phase).toBe('deployment');
  });

  it('a rejected promise is a failure too', async () => {
    mount({ request: () => Promise.reject(new Error('worker died')) });
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    expect(api.genError).toContain('worker died');
  });

  it('set_dev persists the toggle', async () => {
    mount(testStageSource());
    expect(api.dev).toBe(false);
    await send({ type: 'set_dev', on: true });
    expect(api.dev).toBe(true);
    expect(localStorage.getItem('checkbreaker.dev')).toBe('1');
    await send({ type: 'set_dev', on: false });
    expect(api.dev).toBe(false);
  });

  it('a corrupt save shows its error once and new_run clears it', async () => {
    const storage = memoryStorage();
    storage.write('not json');
    mount(testStageSource(), storage);
    await send({ type: 'continue' });
    const refused = loadSave('not json', runConfig);
    expect(refused.ok).toBe(false);
    expect(api.error).toBe(saveErrorText((refused as { ok: false; error: Parameters<typeof saveErrorText>[0] }).error));
    expect(api.session).toBeNull();
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    expect(api.error).toBeNull();
    expect(api.session?.phase).toBe('deployment');
    const back = loadSave(storage.read()!, runConfig);
    expect(back.ok && back.value).toEqual(api.session);
  });

  it('double retry while a request is pending posts exactly once', async () => {
    let calls = 0;
    mount({ request: () => { calls++; return new Promise(() => {}); } });
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await send({ type: 'retry' });
    await send({ type: 'retry' });
    expect(calls).toBe(1);
    expect(api.generating).toBe(true);
  });

  it('a stage with the wrong seed is refused without crashing', async () => {
    const inner = testStageSource();
    mount({
      async request(id, req) {
        const a = await inner.request(id, req);
        return a.ok ? { ...a, stage: { ...a.stage, stageSeed: 'FFFF-FFFF' } } : a;
      },
    });
    await send({ type: 'new_run', seed: '7F3A-2210' });
    await flush();
    expect(api.session?.phase).toBe('awaiting_stage');
    expect(api.genError).toBeTruthy();
    expect(api.generating).toBe(false);
  });
});
