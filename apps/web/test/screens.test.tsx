import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abandon, commit, expectedSeed, loadSave, memoryStorage, newRun, provideStage, serializeSave, start } from '@checkbreaker/run';
import type { RunSession, RunStorage } from '@checkbreaker/run';
import type { StageState } from '@checkbreaker/engine';
import { App } from '../src/App';
import { runConfig } from '../src/config';
import { saveErrorText } from '../src/messages';
import { DEV_KEY } from '../src/storage';
import type { StageSource } from '../src/state/stageSource';
import { STARTER_MATE, starterMateStage, testStageSource } from './doubles';

const SEED = '7F3A-2210';
const c = runConfig;
const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`unexpected refusal: ${JSON.stringify(r.error)}`);
  return r.value;
};

/** A session in the Action phase of the mate-in-one stage; `mut` may edit it (deck, coins, loadout) first. */
function actionSession(mut?: (s: RunSession) => void, stage?: (s: StageState) => StageState): RunSession {
  let s = newRun(SEED, c);
  const base = starterMateStage(expectedSeed(SEED, 0, 0));
  s = ok(provideStage(s, stage ? stage(base) : base, c)).session;
  s = ok(start(s, STARTER_MATE.placements, c)).session;
  mut?.(s);
  return s;
}
/** The same after the mate: the Shop (or the Chooser when the mutation left the deck over capacity). */
function wonSession(mut?: (s: RunSession) => void): RunSession {
  return ok(commit(actionSession(mut), [STARTER_MATE.move], c)).session;
}
const knight = (n: number) => ({
  instanceId: `p_x_${n}`, pieceType: 'knight' as const, rarity: 'normal' as const, durability: 2, durabilityMax: 2,
  origin: 'shop' as const, acquiredAtStage: 0, pricePaid: 8, status: 'in_deck' as const,
});

const at = '2026-11-16T00:00:00.000Z';
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount(session: RunSession | null, source: StageSource = testStageSource(), storage: RunStorage = memoryStorage()) {
  if (session) storage.write(serializeSave(session, at));
  render(<App source={source} makeStorage={() => storage} />);
  const u = userEvent.setup();
  if (session) { await u.click(screen.getByRole('button', { name: /^Continue/ })); await flush(); }
  return { u, storage };
}
const square = (sq: string) => screen.getByRole('button', { name: new RegExp(`^${sq},`) });

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Title', () => {
  it('offers Continue for a valid save, marking a debug run', () => {
    const s = { ...wonSession(), debug: true as const };
    render(<App source={testStageSource()} makeStorage={() => { const m = memoryStorage(); m.write(serializeSave(s, at)); return m; }} />);
    expect(screen.getByRole('button', { name: /^Continue/ })).toBeTruthy();
    expect(screen.getByText('DEBUG RUN')).toBeTruthy();
  });

  it('shows a corrupt save once, and New run replaces it', async () => {
    const storage = memoryStorage();
    storage.write('{"version":1,"session":{"nope":true}}');
    const bad = loadSave(storage.read()!, c);
    if (bad.ok) throw new Error('fixture should be corrupt');
    const { u } = await mount(null, testStageSource(), storage);
    expect(screen.getAllByText(saveErrorText(bad.error))).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'New run' }));
    await flush();
    expect(screen.queryByText(saveErrorText(bad.error))).toBeNull();
    expect(loadSave(storage.read()!, c).ok).toBe(true);
  });

  it('asks before New run replaces a valid save; Cancel keeps it', async () => {
    const storage = memoryStorage();
    storage.write(serializeSave(wonSession(), at));
    const before = storage.read();
    render(<App source={testStageSource()} makeStorage={() => storage} />);
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'New run' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(storage.read()).toBe(before);
    await u.click(screen.getByRole('button', { name: 'New run' }));
    await u.click(screen.getByRole('button', { name: /Replace/ }));
    await flush();
    expect(storage.read()).not.toBe(before);
  });

  it('an optional seed is upper-cased and used; an invalid one shows a message and starts nothing', async () => {
    const storage = memoryStorage();
    render(<App source={testStageSource()} makeStorage={() => storage} />);
    const u = userEvent.setup();
    const box = screen.getByRole('textbox', { name: /Seed/ });
    await u.type(box, 'cd');
    expect(screen.queryByRole('dialog')).toBeNull();
    await u.clear(box);
    await u.type(box, 'nope');
    await u.click(screen.getByRole('button', { name: 'New run' }));
    expect(screen.getByRole('alert').textContent).toMatch(/seed looks like/);
    expect(storage.read()).toBeNull();
    await u.clear(box);
    await u.type(box, '7f3a-2210');
    await u.click(screen.getByRole('button', { name: 'New run' }));
    await flush();
    expect(loadSave(storage.read()!, c)).toMatchObject({ ok: true, value: { run: { seed: SEED } } });
  });

  it('the dev switch reflects and writes devToggle', async () => {
    localStorage.setItem(DEV_KEY, '1');
    render(<App source={testStageSource()} makeStorage={() => memoryStorage()} />);
    const sw = screen.getByRole('switch', { name: /Developer tools/ }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    await userEvent.setup().click(sw);
    expect(localStorage.getItem(DEV_KEY)).toBeNull();
    expect(sw.checked).toBe(false);
  });
});

describe('Run Map', () => {
  it('shows progress, coins, deck size and the seed, which copies on click, then Continue opens Deployment', async () => {
    const s = ok(provideStage(newRun(SEED, c), starterMateStage(expectedSeed(SEED, 0, 0)), c)).session;
    const { u } = await mount(s);
    // user-event installs its own clipboard on setup(); spy on that one.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const map = screen.getByTestId('run-map');
    expect(map.textContent).toMatch(/Act 1 of 3/);
    expect(map.textContent).toMatch(/Stage 1 of 3/);
    expect(map.textContent).toContain(`${s.run.coins}`);
    expect(map.textContent).toMatch(/Deck 4 \/ 8/);
    await u.click(screen.getByRole('button', { name: new RegExp(SEED) }));
    expect(writeText).toHaveBeenCalledWith(SEED);
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('deployment-screen')).toBeTruthy();
  });
});

describe('Building', () => {
  it('shows while the next stage is generated, and a failure offers Retry', async () => {
    let fail = true;
    const base = testStageSource();
    const source: StageSource = {
      request: (id, req) => (fail ? Promise.resolve({ id, ok: false as const, message: 'boom' }) : base.request(id, req)),
    };
    const { u } = await mount(newRun(SEED, c), source);
    expect(screen.getByTestId('building')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('boom');
    fail = false;
    await u.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByTestId('run-map')).toBeTruthy();
  });
});

describe('Shop', () => {
  it('keeps unaffordable offers visible and disabled with their price', async () => {
    const s = wonSession();
    await mount({ ...s, run: { ...s.run, coins: 0 } });
    const row = screen.getByTestId('shop-slot-2');
    expect(row.textContent).toContain(`${s.shop!.slots[1]!.price}`);
    expect((within(row).getByRole('button', { name: /Buy/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the recovery offer live only while recovery holds and slot 1 is unsold', async () => {
    const s = wonSession();
    const recoverySlot = { kind: 'piece' as const, pieceType: 'knight' as const, rarity: 'normal' as const, price: 4, recovery: true as const, sold: false };
    const live: RunSession = { ...s, shop: { ...s.shop!, recovery: true, slots: s.shop!.slots.map((o, i) => (i === 0 ? recoverySlot : o)) } };
    await mount(live);
    expect(screen.getByTestId('shop-recovery')).toBeTruthy();
    cleanup();
    const sold: RunSession = { ...live, shop: { ...live.shop!, slots: live.shop!.slots.map((o, i) => (i === 0 ? { ...o, sold: true } : o)) } };
    await mount(sold);
    expect(screen.queryByTestId('shop-recovery')).toBeNull();
  });

  it('shows the reroll cost and how many remain', async () => {
    const { u } = await mount(wonSession());
    const btn = () => screen.getByRole('button', { name: /^Reroll/ });
    expect(btn().textContent).toMatch(/free/i);
    expect(btn().textContent).toContain(`${c.run.services.maxRerollsPerVisit} left`);
    await u.click(btn());
    expect(btn().textContent).toContain(`${c.run.services.reroll}`);
    expect(btn().textContent).toContain(`${c.run.services.maxRerollsPerVisit - 1} left`);
  });

  const skillShop = (): RunSession => {
    const s = wonSession((x) => { x.run.loadout.push({ skillId: 'twin_step' }, { skillId: 'twin_step' }, { skillId: 'twin_step' }); });
    const slots = s.shop!.slots.map((o, i) => (i === 2 ? { kind: 'skill' as const, skillId: 'lockdown', price: 1, sold: false } : o));
    return { ...s, run: { ...s.run, coins: 50 }, shop: { ...s.shop!, slots } };
  };

  it('buying a skill with a full loadout asks which slot; Cancel buys nothing', async () => {
    const s = skillShop();
    expect(s.run.loadout).toHaveLength(c.run.loadoutSlots);
    const { u } = await mount(s);
    await u.click(within(screen.getByTestId('shop-slot-3')).getByRole('button', { name: /Buy/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('run-coins').textContent).toContain('50');
    expect(within(screen.getByTestId('shop-slot-3')).getByRole('button', { name: /Buy/ })).toBeTruthy();
  });

  it('choosing slot 2 replaces loadout entry 1 (replace: 1)', async () => {
    const { u, storage } = await mount(skillShop());
    await u.click(within(screen.getByTestId('shop-slot-3')).getByRole('button', { name: /Buy/ }));
    await u.click(screen.getByRole('button', { name: /^Slot 2/ }));
    const saved = loadSave(storage.read()!, c);
    if (!saved.ok) throw new Error('save');
    expect(saved.value.run.loadout.map((l) => l.skillId)).toEqual(['twin_step', 'lockdown', 'twin_step']);
    expect(saved.value.run.coins).toBe(49);
  });

  it('previews the next stage without its par, and Leave goes to the Run Map', async () => {
    const { u } = await mount(wonSession());
    await waitFor(() => expect(screen.getByTestId('next-preview').querySelector('[aria-label="Board"]')).toBeTruthy());
    expect(screen.getByTestId('next-preview').textContent).not.toMatch(/MATE IN|par/i);
    await u.click(screen.getByRole('button', { name: 'Leave shop' }));
    expect(screen.getByTestId('run-map')).toBeTruthy();
  });
});

describe('Chooser', () => {
  it('shows the over-capacity count and closes when the deck fits', async () => {
    const s = wonSession((x) => { for (let i = 0; i < 5; i++) x.run.deck.push(knight(i)); });
    expect(s.phase).toBe('chooser');
    const { u } = await mount(s);
    expect(screen.getByTestId('chooser').textContent).toMatch(/1 piece over/);
    await u.click(within(screen.getByTestId('deck-piece-p_x_0')).getByRole('button', { name: /Cut/ }));
    expect(screen.queryByTestId('chooser')).toBeNull();
    expect(screen.getByTestId('shop')).toBeTruthy();
  });
});

describe('overlays', () => {
  it('Codex has a core-rules section naming checkmate and stalemate', async () => {
    const { u } = await mount(wonSession());
    await u.keyboard('c');
    const rules = within(screen.getByRole('dialog', { name: 'Codex' })).getByTestId('codex-rules');
    expect(rules.textContent).toMatch(/checkmate/i);
    expect(rules.textContent).toMatch(/stalemat/i);
    expect(rules.textContent).toMatch(/COMMIT/);
  });

  it('Codex lists every skill with its rule and every deck piece type with its rarity abilities; Escape closes', async () => {
    const yaml = readFileSync(resolve(__dirname, '../../../content/examples/skills.yaml'), 'utf8');
    const names = [...yaml.matchAll(/^\s+name: (.+)$/gm)].map((m) => m[1]!.trim());
    const rules = [...yaml.matchAll(/^\s+ruleBroken: "(.+)"$/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(3);
    expect(rules).toHaveLength(names.length);
    const { u } = await mount(wonSession());
    await u.keyboard('c');
    const codex = screen.getByRole('dialog', { name: 'Codex' });
    for (const n of names) expect(codex.textContent).toContain(n);
    for (const r of rules) expect(codex.textContent).toContain(r);
    for (const t of ['Knight', 'Bishop', 'Rook', 'Queen']) expect(codex.textContent).toContain(t);
    expect(codex.textContent).toContain('Can also leap two squares in a straight line.');
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Codex' })).toBeNull();
  });

  it('the Deck overlay keeps its order across a repair', async () => {
    const s = wonSession((x) => { x.run.deck.find((p) => p.instanceId === 'p_knight_02')!.durability = 1; });
    const { u } = await mount({ ...s, run: { ...s.run, coins: 50 } });
    const order = () => within(screen.getByRole('dialog', { name: 'Deck' })).getAllByTestId(/^deck-piece-/).map((e) => e.dataset.testid);
    await u.keyboard('d');
    const before = order();
    await u.keyboard('{Escape}');
    await u.click(within(screen.getByTestId('shop')).getByTestId('deck-piece-p_knight_02').querySelector('button[aria-label^="Repair"]')!);
    await u.keyboard('d');
    expect(order()).toEqual(before);
    expect(within(screen.getByRole('dialog', { name: 'Deck' })).getByTestId('pips-p_knight_02').getAttribute('aria-label')).toMatch(/2 of 2/);
  });
});

describe('stage and run endings', () => {
  it('a mating commit shows the resolved board in Results above the award; Continue reaches the Shop', async () => {
    const { u } = await mount(actionSession());
    await u.click(square('a3'));
    await u.click(square('b2'));
    await u.click(screen.getByRole('button', { name: /^COMMIT/ }));
    await flush();
    const res = screen.getByTestId('stage-results');
    expect(within(res).getByTestId('results-board').querySelector('[aria-label^="b2,"]')?.getAttribute('aria-label')).toMatch(/bishop/i);
    expect(res.textContent).toMatch(/\+\d+/);
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('shop')).toBeTruthy();
  });

  const queenStage = (s: StageState): StageState => ({
    ...s,
    board: {
      h8: { pieceType: 'king', color: 'black' },
      e7: { pieceType: 'queen', color: 'white', spawned: true, rarity: 'normal', stageId: 's01' },
    },
  });
  const loseWithQueen = async () => {
    const { u } = await mount(actionSession(undefined, queenStage));
    await u.click(square('e7'));
    await u.click(square('f7'));
    await u.click(screen.getByRole('button', { name: /^COMMIT/ }));
    await u.click(screen.getByRole('button', { name: /Confirm: commit and lose/ }));
    await flush();
    return u;
  };

  it('a losing commit shows the resolved position before run Results; a click skips', async () => {
    const u = await loseWithQueen();
    const play = screen.getByTestId('playback');
    expect(within(play).getByTestId('playback-resolved')).toBeTruthy();
    expect(screen.queryByTestId('run-results')).toBeNull();
    await u.click(play);
    const results = screen.getByTestId('run-results');
    expect(results.textContent).toMatch(/RUN LOST/);
    expect(results.textContent).toContain(SEED);
  });

  it('Space also skips the playback', async () => {
    await loseWithQueen();
    expect(screen.getByTestId('playback')).toBeTruthy();
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(screen.getByTestId('run-results')).toBeTruthy());
  });

  it('run Results shows result, reason, stages cleared, seed and DEBUG RUN', async () => {
    const ended = ok(abandon({ ...wonSession(), debug: true as const })).session;
    await mount(ended);
    const r = screen.getByTestId('run-results');
    expect(r.textContent).toMatch(/RUN LOST/);
    expect(r.textContent).toMatch(/abandon/i);
    expect(r.textContent).toMatch(/Stages cleared: 1/);
    expect(r.textContent).toContain(SEED);
    expect(r.textContent).toContain('DEBUG RUN');
  });
});

describe('storage banner', () => {
  it('shows a dismissible banner after the first write failure', async () => {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith('checkbreaker.save')) throw new Error('quota');
      return real.call(this, k, v);
    });
    render(<App source={testStageSource()} />);
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'New run' }));
    await flush();
    expect(screen.getByText(/Saving is unavailable in this browser; this run will be lost when the tab closes/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Saving is unavailable/)).toBeNull();
  });
});

describe('losing playback reaches the reply', () => {
  const matedStage = (s: StageState): StageState => ({
    ...s,
    mateIn: 1,
    board: {
      b8: { pieceType: 'king', color: 'black' },
      a2: { pieceType: 'rook', color: 'black' },
      h8: { pieceType: 'rook', color: 'black' },
    },
    enemyPolicy: { type: 'scripted', line: ['h8h1'], fallbackDepth: 1 },
  });
  it('shows the resolved board, then a different board after the enemy reply', async () => {
    const { u } = await mount(actionSession(undefined, matedStage));
    await u.click(square('a3'));
    await u.click(square('b4'));
    await u.click(screen.getByRole('button', { name: /^COMMIT/ }));
    await flush();
    const resolved = screen.getByTestId('playback-resolved').innerHTML;
    await waitFor(() => expect(screen.getByTestId('playback-after')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('playback-after').innerHTML).not.toBe(resolved);
    expect(screen.queryByTestId('run-results')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('run-results').textContent).toMatch(/checkmated/), { timeout: 3000 });
  });
});

describe('merge from the deck UI', () => {
  it('three identical pieces enable Merge, and merging changes the deck', async () => {
    const s = wonSession((x) => { x.run.deck.push(knight(9)); });
    const { u } = await mount(s);
    const boxes = screen.getAllByRole('checkbox', { name: /Merge Normal Knight/ });
    expect(boxes).toHaveLength(3);
    const merge = () => screen.getByRole('button', { name: /^Merge selected/ }) as HTMLButtonElement;
    expect(merge().disabled).toBe(true);
    for (const b of boxes) await u.click(b);
    expect(merge().disabled).toBe(false);
    await u.click(merge());
    const deck = screen.getByTestId('decklist');
    expect(within(deck).getByText('Rare Knight')).toBeTruthy();
    expect(within(deck).queryByTestId('deck-piece-p_x_9')).toBeNull();
    expect(within(deck).queryByTestId('deck-piece-p_knight_02')).toBeNull();
  });
});

describe('abandon', () => {
  const deploymentSession = () => ok(provideStage(newRun(SEED, c), starterMateStage(expectedSeed(SEED, 0, 0)), c)).session;
  it('Cancel keeps the run; Abandon ends it into run Results', async () => {
    const { u } = await mount(deploymentSession());
    await u.click(screen.getByRole('button', { name: 'Abandon run' }));
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('run-map')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Abandon run' }));
    await u.click(screen.getByRole('button', { name: 'Abandon' }));
    expect(screen.getByTestId('run-results').textContent).toMatch(/RUN LOST/);
  });
});

describe('C and D overlays from every in-run screen', () => {
  const deployment = () => ok(provideStage(newRun(SEED, c), starterMateStage(expectedSeed(SEED, 0, 0)), c)).session;
  const check = async (u: ReturnType<typeof userEvent.setup>) => {
    await u.keyboard('c');
    expect(screen.getByRole('dialog', { name: 'Codex' })).toBeTruthy();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await u.keyboard('d');
    expect(screen.getByRole('dialog', { name: 'Deck' })).toBeTruthy();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  };
  it('Run Map', async () => { const { u } = await mount(deployment()); await check(u); });
  it('Deployment', async () => {
    const { u } = await mount(deployment());
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('deployment-screen')).toBeTruthy();
    await check(u);
  });
  it('Action', async () => { const { u } = await mount(actionSession()); await check(u); });
  it('Shop', async () => { const { u } = await mount(wonSession()); await check(u); });
});

describe('Escape and the replace-slot dialog', () => {
  it('closes the dialog and buys nothing', async () => {
    const s = wonSession((x) => { x.run.loadout.push({ skillId: 'twin_step' }, { skillId: 'twin_step' }, { skillId: 'twin_step' }); });
    const slots = s.shop!.slots.map((o, i) => (i === 2 ? { kind: 'skill' as const, skillId: 'lockdown', price: 1, sold: false } : o));
    const { u } = await mount({ ...s, run: { ...s.run, coins: 50 }, shop: { ...s.shop!, slots } });
    await u.click(within(screen.getByTestId('shop-slot-3')).getByRole('button', { name: /Buy/ }));
    expect(screen.getByRole('dialog', { name: 'Replace a skill' })).toBeTruthy();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('run-coins').textContent).toContain('50');
  });
});

describe('resume', () => {
  const never: StageSource = { request: () => new Promise(() => undefined) };
  const cases: [string, () => RunSession, string, StageSource?][] = [
    ['deployment', () => ok(provideStage(newRun(SEED, c), starterMateStage(expectedSeed(SEED, 0, 0)), c)).session, 'run-map'],
    ['action', () => actionSession(), 'action-screen'],
    ['shop', () => wonSession(), 'shop'],
    ['chooser', () => wonSession((x) => { for (let i = 0; i < 5; i++) x.run.deck.push(knight(i)); }), 'chooser'],
    ['awaiting_stage', () => newRun(SEED, c), 'building', never],
    ['ended', () => ok(abandon(wonSession())).session, 'run-results'],
  ];
  for (const [phase, make, testid, source] of cases) {
    it(`a ${phase} save opens its screen after Continue`, async () => {
      const session = make();
      expect(session.phase).toBe(phase);
      await mount(session, source);
      expect(screen.getByTestId(testid)).toBeTruthy();
    });
  }
});
