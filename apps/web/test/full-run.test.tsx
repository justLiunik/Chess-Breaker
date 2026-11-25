import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buy, loadSave, memoryStorage } from '@checkbreaker/run';
import type { RunSession } from '@checkbreaker/run';
import { App } from '../src/App';
import { runConfig } from '../src/config';
import { STARTER_MATE, testStageSource } from './doubles';

const c = runConfig;
const STAGES = c.run.acts * c.run.stagesPerAct;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const square = (sq: string) => screen.getByRole('button', { name: new RegExp(`^${sq},`) });

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('M5 acceptance: a whole run in the browser UI', () => {
  it('plays 9 stages from the title screen to a won run, by clicking only', async () => {
    const errors = vi.spyOn(console, 'error');

    const storage = memoryStorage();
    const saved = (): RunSession => {
      const r = loadSave(storage.read()!, c);
      if (!r.ok) throw new Error('save unreadable');
      return r.value;
    };
    render(<App source={testStageSource()} makeStorage={() => storage} />);
    const u = userEvent.setup();

    await u.click(screen.getByRole('switch', { name: /Developer tools/ }));
    await u.type(screen.getByRole('textbox', { name: /Seed/ }), '7f3a-2210');
    await u.click(screen.getByRole('button', { name: 'New run' }));
    await flush();
    expect(saved().run.seed).toBe('7F3A-2210');

    let shops = 0;
    for (let stage = 0; stage < STAGES; stage++) {
      // Run Map, then Deployment: the King (and for stage 0 the bishop) go on the board.
      await u.click(await screen.findByRole('button', { name: 'Continue' }));
      await screen.findByTestId('deployment-screen');
      for (const p of stage === 0 ? STARTER_MATE.placements : STARTER_MATE.placements.slice(0, 1)) {
        await u.click(screen.getByTestId(`tray-${p.instanceId}`));
        await u.click(square(p.to));
      }
      await u.click(screen.getByRole('button', { name: 'START' }));
      await screen.findByTestId('action-screen');

      if (stage === 0) {
        await u.click(square('a3'));
        await u.click(square('b2'));
        const preview = Number(/WIN NOW \+(\d+)/.exec(screen.getByTestId('hud-win').textContent!)![1]);
        const before = saved().run.coins;
        await u.click(screen.getByRole('button', { name: /^COMMIT/ }));
        await flush();
        const results = await screen.findByTestId('stage-results');
        expect(saved().run.coins - before).toBe(preview);
        expect(preview).toBeGreaterThan(0);
        expect(results.textContent).toContain(`+${preview}`);
        await u.click(within(results).getByRole('button', { name: 'Continue' }));
      } else {
        await u.click(screen.getByRole('button', { name: /^Skip stage/ }));
      }
      await flush();

      // After a win: the shop (or, after stage 9, the run Results). No stage here promotes, so the deck gate never shows.
      if (stage === STAGES - 1) break;
      await screen.findByTestId('shop');
      shops++;
      // Ruling R6: buy the first offer the run layer would accept; if none, just leave.
      const s = saved();
      const slot = s.shop!.slots.findIndex((o, i) => !o.sold && buy(s, i + 1, {}, c).ok) + 1;
      if (slot > 0) {
        const coins = s.run.coins;
        await u.click(within(screen.getByTestId(`shop-slot-${slot}`)).getByRole('button', { name: /^Buy/ }));
        expect(saved().run.coins).toBeLessThan(coins);
      }
      await u.click(screen.getByRole('button', { name: 'Leave shop' }));
      await flush();
    }

    expect(shops).toBe(STAGES - 1);
    const results = await waitFor(() => screen.getByTestId('run-results'));
    expect(results.textContent).toMatch(/RUN WON/);
    expect(results.textContent).toContain('DEBUG RUN');
    expect(results.textContent).toContain('7F3A-2210');
    const end = saved();
    expect(end.outcome?.result).toBe('won');
    expect(end.run.history).toHaveLength(STAGES);
    expect(errors).not.toHaveBeenCalled();
  }, 120_000);
});
