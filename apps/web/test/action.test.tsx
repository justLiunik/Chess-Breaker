import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { hudEconomy, simulate } from '@checkbreaker/engine';
import type { StageState } from '@checkbreaker/engine';
import { memoryStorage, newRun, serializeSave } from '@checkbreaker/run';
import { engineConfig, runConfig } from '../src/config';
import { commitErrorText } from '../src/messages';
import { Action as ActionScreen } from '../src/screens/Action';
import { RunProvider, useRun } from '../src/state/store';
import type { StageSource } from '../src/state/stageSource';
import { STARTER_MATE, testStageSource } from './doubles';

type Api = ReturnType<typeof useRun>;
let api: Api;
function Probe() {
  api = useRun();
  return api.session?.phase === 'action' ? <ActionScreen /> : null;
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** The doubles' stages with `patch` applied to the stage that is generated. */
function patched(patch: (s: StageState) => StageState): StageSource {
  const base = testStageSource();
  return {
    async request(id, req) {
      const a = await base.request(id, req);
      return a.ok ? { ...a, stage: patch(a.stage) } : a;
    },
  };
}

async function setup(source: StageSource = testStageSource(), loadout: string[] = []) {
  const session = newRun('7F3A-2210', runConfig);
  session.run.loadout.push(...loadout.map((skillId) => ({ skillId })));
  const storage = memoryStorage();
  storage.write(serializeSave(session, '2026-11-16T00:00:00.000Z'));
  render(<RunProvider source={source} storage={storage}><Probe /></RunProvider>);
  await act(async () => { api.dispatch({ type: 'continue' }); });
  await flush();
  await act(async () => { api.dispatch({ type: 'start', placements: STARTER_MATE.placements }); });
}

const user = () => userEvent.setup();
const square = (sq: string) => screen.getByRole('button', { name: new RegExp(`^${sq},`) });
const label = (sq: string) => square(sq).getAttribute('aria-label');
const commitButton = () => screen.getByRole('button', { name: /^COMMIT/ });
const entry = (i: number) => screen.getByTestId(`queue-entry-${i}`);
async function playMove(u: ReturnType<typeof user>, from: string, to: string) {
  await u.click(square(from));
  await u.click(square(to));
}

afterEach(() => { cleanup(); localStorage.clear(); });

describe('Action screen', () => {
  it('a click-click move appends MOVE, ghosts the board and shows the exact award; COMMIT pays it (I10)', async () => {
    await setup();
    const u = user();
    const before = api.session!;
    await playMove(u, 'a3', 'b2');
    expect(entry(0).textContent).toContain('a3→b2');
    expect(label('b2')).toBe('b2, white bishop');
    expect(square('b2').getAttribute('data-ghost')).not.toBeNull();
    // N from `simulate` itself, independent of the preview the HUD reads.
    const sim = simulate(before.run, before.stage!, [STARTER_MATE.move], engineConfig);
    if (!sim.ok) throw new Error('the mate queue must simulate');
    const n = sim.value.award!.coins;
    expect(n).toBeGreaterThan(0);
    expect(screen.getByTestId('hud-win').textContent).toBe(`WIN NOW +${n} ◈`);
    await u.click(commitButton());
    await flush();
    expect(api.session!.run.coins - before.run.coins).toBe(n);
  });

  it('a selected piece highlights its legal destinations from the engine', async () => {
    await setup();
    const u = user();
    await u.click(square('a3'));
    expect(square('b2').className).toContain('highlight');
    expect(square('a4').className).not.toContain('highlight');
  });

  it('a skill-only queue disables COMMIT with the empty_queue text', async () => {
    await setup(testStageSource(), ['twin_step']);
    const u = user();
    await u.click(screen.getByRole('button', { name: /Twin Step/ }));
    expect(entry(0).textContent).toContain('Twin Step');
    expect((commitButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('queue-error').textContent).toBe(commitErrorText({ kind: 'empty_queue' }));
  });

  it('an unaffordable entry is marked and the text names its step', async () => {
    await setup(patched((s) => ({ ...s, focus: 0, focusPool: 0 })), ['twin_step']);
    const u = user();
    await playMove(u, 'a3', 'b2');
    await u.click(screen.getByRole('button', { name: /Twin Step/ }));
    expect(entry(1).textContent).toContain('unaffordable');
    expect(entry(1).getAttribute('data-unaffordable')).not.toBeNull();
    expect(entry(0).getAttribute('data-problem')).toBeNull();
    expect(screen.getByTestId('queue-error').textContent).toBe(
      commitErrorText({ kind: 'focus_exceeded', atStep: 1, needed: 1, available: 0 }),
    );
    expect(screen.getByTestId('queue-error').textContent).toContain('step 2');
  });

  it('dragging entry 2 before entry 1 reorders; clicking an entry removes it', async () => {
    await setup();
    const u = user();
    await playMove(u, 'e1', 'e2');
    await playMove(u, 'a3', 'b2');
    expect(entry(0).textContent).toContain('e1→e2');
    expect(entry(1).textContent).toContain('a3→b2');
    const dataTransfer = { setData: () => undefined, getData: () => '', effectAllowed: '' };
    fireEvent.dragStart(entry(1), { dataTransfer });
    fireEvent.dragOver(entry(0), { dataTransfer });
    fireEvent.drop(entry(0), { dataTransfer });
    expect(entry(0).textContent).toContain('a3→b2');
    expect(entry(1).textContent).toContain('e1→e2');
    await u.click(within(entry(0)).getByRole('button', { name: /^Remove step 1/ }));
    expect(entry(0).textContent).toContain('e1→e2');
    expect(screen.queryByTestId('queue-entry-1')).toBeNull();
  });

  it('the Move later button reorders too', async () => {
    await setup();
    const u = user();
    await playMove(u, 'e1', 'e2');
    await playMove(u, 'a3', 'b2');
    await u.click(within(entry(0)).getByRole('button', { name: /^Move step 1 later/ }));
    expect(entry(0).textContent).toContain('a3→b2');
  });

  it('COMMIT shows a thinking state first, locks input, then commits on the next tick; Space skips the playback', async () => {
    await setup();
    const u = user();
    const turns = () => api.session!.stage!.turnsUsed;
    await playMove(u, 'a3', 'b4');
    fireEvent.click(commitButton());
    expect(screen.getByTestId('thinking')).toBeTruthy();
    expect(turns()).toBe(0);
    expect((commitButton() as HTMLButtonElement).disabled).toBe(true);
    await flush();
    expect(turns()).toBe(1);
    // The player's resolved position first, the enemy's reply (h7h6) only after the playback.
    expect(label('b4')).toBe('b4, white bishop');
    expect(label('h7')).toBe('h7, black pawn');
    expect(label('h6')).toBe('h6, empty');
    fireEvent.keyDown(window, { key: ' ' });
    expect(label('h7')).toBe('h7, empty');
    expect(label('h6')).toBe('h6, black pawn');
    expect(screen.queryByTestId('thinking')).toBeNull();
  });

  it('a click skips the playback as well', async () => {
    await setup();
    const u = user();
    await playMove(u, 'a3', 'b4');
    fireEvent.click(commitButton());
    await flush();
    expect(label('h7')).toBe('h7, black pawn');
    fireEvent.click(screen.getByTestId('action-screen'));
    expect(label('h6')).toBe('h6, black pawn');
  });

  it('a stalemating queue shows the banner; COMMIT confirms; Cancel changes nothing, Confirm commits', async () => {
    const queen = { pieceType: 'queen', color: 'white', spawned: true, rarity: 'normal', stageId: 's01' } as const;
    await setup(patched((s) => ({ ...s, board: { h8: { pieceType: 'king', color: 'black' }, e7: queen } })));
    const u = user();
    await playMove(u, 'e7', 'f7');
    expect(screen.getByTestId('hud-loss').textContent).toBe('STALEMATE — YOU LOSE');
    const before = api.session;
    await u.click(commitButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.session).toBe(before);
    expect(entry(0).textContent).toContain('e7→f7');
    await u.click(commitButton());
    await u.click(screen.getByRole('button', { name: /^Confirm/ }));
    await flush();
    expect(api.session).not.toBe(before);
  });

  it('Restart shows only on turn one and dispatches restart; Skip only with the dev toggle', async () => {
    await setup();
    const u = user();
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
    await act(async () => { api.dispatch({ type: 'set_dev', on: true }); });
    expect(screen.getByRole('button', { name: /Skip/ })).toBeTruthy();
    await playMove(u, 'a3', 'b4');
    await u.click(screen.getByRole('button', { name: /Restart/ }));
    expect(api.session!.phase).toBe('deployment');
    await act(async () => { api.dispatch({ type: 'start', placements: STARTER_MATE.placements }); });
    expect(screen.queryByTestId('queue-entry-0')).toBeNull();
    await playMove(u, 'a3', 'b4');
    fireEvent.click(commitButton());
    await flush();
    expect(screen.queryByRole('button', { name: /Restart/ })).toBeNull();
  });

  it('shows LAST PAR TURN on the par turn and the overtime figures past it', async () => {
    await setup();
    const u = user();
    expect(screen.getByTestId('hud-lastpar').textContent).toBe('LAST PAR TURN');
    expect(screen.queryByTestId('hud-overtime')).toBeNull();
    await playMove(u, 'a3', 'b4');
    fireEvent.click(commitButton());
    await flush();
    fireEvent.keyDown(window, { key: ' ' });
    const s = api.session!;
    const eco = hudEconomy(s.run, s.stage!, engineConfig);
    expect(screen.queryByTestId('hud-lastpar')).toBeNull();
    const text = screen.getByTestId('hud-overtime').textContent!;
    expect(text).toContain(`OVERTIME −${eco.overtimeCost} ◈ / turn`);
    expect(text).toContain(`pending reward ${eco.pendingBase} ◈`);
    expect(text).toContain(`wallet ${s.run.coins} ◈`);
  });

  it('Undo and Clear shrink the queue and leave the session untouched', async () => {
    await setup();
    const u = user();
    const before = api.session;
    await playMove(u, 'a3', 'b4');
    await playMove(u, 'b4', 'c5');
    await u.click(screen.getByRole('button', { name: 'Undo' }));
    expect(entry(0).textContent).toContain('a3→b4');
    expect(screen.queryByTestId('queue-entry-1')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('queue-empty')).toBeTruthy();
    expect(api.session).toBe(before);
  });

  it('step-through shows the board after the chosen step', async () => {
    await setup(testStageSource(), ['twin_step']);
    const u = user();
    await playMove(u, 'a3', 'b4');
    await u.click(screen.getByRole('button', { name: /Twin Step/ }));
    await playMove(u, 'b4', 'c5');
    expect(label('c5')).toBe('c5, white bishop');
    await u.click(within(entry(0)).getByRole('button', { name: /^Show position after step 1/ }));
    expect(label('b4')).toBe('b4, white bishop');
    expect(label('c5')).toBe('c5, empty');
    await u.click(within(entry(2)).getByRole('button', { name: /^Show position after step 3/ }));
    expect(label('c5')).toBe('c5, white bishop');
  });

  it('a second copy of a once_per_turn skill is disabled once the queue holds the first, as the engine rules (I5)', async () => {
    await setup(testStageSource(), ['twin_step', 'twin_step']);
    const u = user();
    const btn = () => within(screen.getByTestId('skills')).getByRole('button', { name: /Twin Step/ }) as HTMLButtonElement;
    expect(btn().disabled).toBe(false);
    await u.click(btn());
    expect(entry(0).textContent).toContain('Twin Step');
    expect(btn().disabled).toBe(true);
    expect(btn().textContent).toMatch(/used this turn/);
    await u.click(within(entry(0)).getByRole('button', { name: /^Remove/ }));
    expect(btn().disabled).toBe(false);
  });

  it('a targeted skill waits for a square, then appends ACTIVATE_SKILL with that target', async () => {
    await setup(testStageSource(), ['ascension']);
    const u = user();
    await u.click(screen.getByRole('button', { name: /Ascension/ }));
    expect(screen.getByTestId('skill-prompt').textContent).toContain('Ascension');
    expect(screen.queryByTestId('queue-entry-0')).toBeNull();
    await u.click(square('a3'));
    expect(entry(0).textContent).toContain('Ascension on a3');
    expect(entry(0).getAttribute('data-problem')).toBeNull();
    expect(screen.queryByTestId('skill-prompt')).toBeNull();
    // Ascension makes the bishop a queen for the turn: the queue previews it as such.
    await u.click(square('a3'));
    expect(square('a4').className).toContain('highlight');
  });

  it('shows the muted next-turn potential from hudEconomy when the queue does not mate', async () => {
    await setup();
    const u = user();
    const eco = () => hudEconomy(api.session!.run, api.session!.stage!, engineConfig);
    expect(screen.getByTestId('hud-next').textContent).toContain(`+${eco().nextTurnPotential} ◈`);
    await playMove(u, 'a3', 'b4');
    expect(screen.queryByTestId('hud-win')).toBeNull();
    expect(screen.getByTestId('hud-next').textContent).toBe(`Mate next turn: about +${eco().nextTurnPotential} ◈`);
  });

  it('marks an entry after the first failing step as blocked', async () => {
    await setup(patched((s) => ({ ...s, focus: 0, focusPool: 0 })), ['twin_step']);
    const u = user();
    await playMove(u, 'a3', 'b4');
    await u.click(screen.getByRole('button', { name: /Twin Step/ }));
    await playMove(u, 'b4', 'c5');
    expect(entry(0).getAttribute('data-problem')).toBeNull();
    expect(entry(1).getAttribute('data-problem')).toBe('unaffordable');
    expect(entry(2).getAttribute('data-problem')).toBe('blocked');
    expect(entry(2).textContent).toContain('blocked');
  });
  describe('promotion picker', () => {
    const withPawn = () => patched((s) => ({
      ...s, board: { ...s.board, a7: { pieceType: 'pawn', color: 'white', spawned: true, rarity: 'rare', stageId: 's99' } },
    }));
    const picker = () => screen.queryByRole('dialog', { name: /Promote/ });

    it('moving a spawned pawn to rank 8 opens the picker with the four engine choices', async () => {
      await setup(withPawn());
      const u = user();
      await playMove(u, 'a7', 'a8');
      const p = picker();
      expect(p).not.toBeNull();
      const names = within(p!).getAllByRole('button').map((b) => b.textContent ?? '');
      expect(names.slice(0, 4).map((n) => n.toLowerCase().match(/queen|rook|bishop|knight/)?.[0])).toEqual(['queen', 'rook', 'bishop', 'knight']);
      expect(within(p!).getByRole('button', { name: /Cancel/ })).toBeTruthy();
      expect(screen.queryByTestId('queue-entry-0')).toBeNull();
    });

    it('choosing Rook appends MOVE with promotion rook and ghosts a rook', async () => {
      await setup(withPawn());
      const u = user();
      await playMove(u, 'a7', 'a8');
      await u.click(within(picker()!).getByRole('button', { name: /Rook/ }));
      expect(picker()).toBeNull();
      expect(entry(0).textContent).toContain('a7→a8=R');
      expect(label('a8')).toBe('a8, white rook (rare)');
      expect(square('a8').getAttribute('data-ghost')).not.toBeNull();
    });

    it('Esc cancels the picker and drops the move', async () => {
      await setup(withPawn());
      const u = user();
      await playMove(u, 'a7', 'a8');
      await u.keyboard('{Escape}');
      expect(picker()).toBeNull();
      expect(screen.queryByTestId('queue-entry-0')).toBeNull();
    });

    it('a pawn moved earlier in the queue gets its picker on the planned position', async () => {
      await setup(patched((s) => ({
        ...s, board: { ...s.board, a6: { pieceType: 'pawn', color: 'white', spawned: true, rarity: 'normal', stageId: 's99' } },
      })), ['twin_step']);
      const u = user();
      await playMove(u, 'a6', 'a7');
      await playMove(u, 'a7', 'a8');
      expect(picker()).not.toBeNull();
    });

    it('with the picker open a skill click does not append', async () => {
      await setup(withPawn(), ['twin_step']);
      const u = user();
      await playMove(u, 'a7', 'a8');
      const skill = screen.getByRole('button', { name: /Twin Step/ });
      expect((skill as HTMLButtonElement).disabled).toBe(true);
      await u.click(skill);
      expect(screen.queryByTestId('queue-entry-0')).toBeNull();
    });

    it('with the picker open a queue reorder does not happen', async () => {
      await setup(withPawn());
      const u = user();
      await playMove(u, 'e1', 'e2');
      await playMove(u, 'a3', 'b2');
      await playMove(u, 'a7', 'a8');
      const dataTransfer = { setData: () => undefined, getData: () => '', effectAllowed: '' };
      fireEvent.dragStart(entry(1), { dataTransfer });
      fireEvent.dragOver(entry(0), { dataTransfer });
      fireEvent.drop(entry(0), { dataTransfer });
      await u.click(within(entry(1)).getByRole('button', { name: /^Move step 2 earlier/ }));
      expect(entry(0).textContent).toContain('e1→e2');
      expect(entry(1).textContent).toContain('a3→b2');
    });

    it('with the picker open the arrow keys do not change the shown step', async () => {
      await setup(withPawn());
      const u = user();
      await playMove(u, 'e1', 'e2');
      await playMove(u, 'a3', 'b2');
      await playMove(u, 'a7', 'a8');
      expect(entry(1).getAttribute('data-current')).not.toBeNull();
      await u.keyboard('{ArrowLeft}');
      expect(entry(1).getAttribute('data-current')).not.toBeNull();
      expect(entry(0).getAttribute('data-current')).toBeNull();
    });

    it('COMMIT after a promotion shows the piece on the board', async () => {
      await setup(withPawn());
      const u = user();
      await playMove(u, 'a7', 'a8');
      await u.click(within(picker()!).getByRole('button', { name: /Queen/ }));
      await u.click(commitButton());
      await flush();
      expect(api.session!.stage!.board['a8']).toMatchObject({ pieceType: 'queen', color: 'white', rarity: 'rare' });
      await act(async () => { await new Promise((r) => setTimeout(r, 1000)); });
      expect(label('a8')).toBe('a8, white queen (rare)');
    });
  });
});
