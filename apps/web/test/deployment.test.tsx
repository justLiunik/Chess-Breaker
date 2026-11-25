import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { pendingBase, spawnCostOf } from '@checkbreaker/engine';
import type { PieceInstance } from '@checkbreaker/engine';
import { memoryStorage, newRun, serializeSave } from '@checkbreaker/run';
import { engineConfig, runConfig } from '../src/config';
import { dropRefusalText } from '../src/messages';
import { DEV_KEY } from '../src/storage';
import { Deployment } from '../src/screens/Deployment';
import { RunProvider, useRun } from '../src/state/store';
import type { StageSource } from '../src/state/stageSource';
import { testStageSource } from './doubles';

type Api = ReturnType<typeof useRun>;
let api: Api;
function Probe() {
  api = useRun();
  return api.session?.phase === 'deployment' ? <Deployment /> : null;
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** A run whose deck also holds a Normal rook (the starter deck has none), continued into stage 0. */
async function setup(source: StageSource = testStageSource(), extra: PieceInstance[] = []) {
  const session = newRun('7F3A-2210', runConfig);
  session.run.deck.push(...extra);
  session.run.deck.push({
    instanceId: 'p_rook_01', pieceType: 'rook', rarity: 'normal', durability: 2, durabilityMax: 2,
    origin: 'reward', acquiredAtStage: 0, status: 'in_deck',
  });
  const storage = memoryStorage();
  storage.write(serializeSave(session, '2026-11-16T00:00:00.000Z'));
  render(<RunProvider source={source} storage={storage}><Probe /></RunProvider>);
  await act(async () => { api.dispatch({ type: 'continue' }); });
  await flush();
}

const user = () => userEvent.setup();
const square = (sq: string) => screen.getByRole('button', { name: new RegExp(`^${sq},`) });
const tray = () => screen.getByTestId('tray');
const trayPiece = (id: string) => within(tray()).getByTestId(`tray-${id}`);

afterEach(() => { cleanup(); localStorage.clear(); });

describe('Deployment screen', () => {
  it('offers Skip stage (dev) only with the dev toggle on (I3)', async () => {
    await setup();
    expect(screen.queryByRole('button', { name: /^Skip stage/ })).toBeNull();
  });

  it('Skip stage (dev) reaches the shop paying the base reward, with no durability change (I3)', async () => {
    localStorage.setItem(DEV_KEY, '1');
    await setup();
    const before = api.session!;
    const base = pendingBase(before.run, before.stage!, engineConfig);
    await user().click(screen.getByRole('button', { name: /^Skip stage/ }));
    const after = api.session!;
    expect(after.phase).toBe('shop');
    expect(after.debug).toBe(true);
    expect(after.run.coins).toBe(before.run.coins + base);
    expect(after.run.deck).toEqual(before.run.deck);
  });

  it('tray shows durability pips and rarity names', async () => {
    await setup();
    const bishop = api.session!.run.deck.find((i) => i.instanceId === 'p_bishop_04')!;
    expect(within(trayPiece('p_bishop_04')).getByText('Normal')).toBeTruthy();
    expect(within(screen.getByTestId('pips-p_bishop_04')).getAllByTestId('pip')).toHaveLength(bishop.durabilityMax!);
    expect(screen.getByTestId('pips-p_bishop_04').getAttribute('aria-label')).toBe(`durability ${bishop.durability} of ${bishop.durabilityMax}`);
  });

  it('every square is a labelled button', async () => {
    await setup();
    expect(screen.getAllByRole('button', { name: /^[a-h][1-8], / }).length).toBe(64);
    expect(square('h8').getAttribute('aria-label')).toBe('h8, black king');
    expect(square('e1').getAttribute('aria-label')).toBe('e1, empty');
  });

  it('dropping the rook on e1 moves the spawn counter by its cost', async () => {
    await setup();
    const u = user();
    expect(screen.getByTestId('spawn-counter').textContent).toContain('0 / 9');
    await u.click(trayPiece('p_rook_01'));
    await u.click(square('e1'));
    const cost = spawnCostOf('rook', 'normal', engineConfig);
    expect(screen.getByTestId('spawn-counter').textContent).toContain(`${cost} / 9`);
    expect(square('e1').getAttribute('aria-label')).toBe('e1, white rook');
  });

  it('a rank-5 drop shows the outside_zone text and places nothing', async () => {
    await setup();
    const u = user();
    await u.click(trayPiece('p_bishop_04'));
    await u.click(square('e5'));
    expect(screen.getByRole('alert').textContent).toContain(dropRefusalText('outside_zone'));
    expect(square('e5').getAttribute('aria-label')).toBe('e5, empty');
    expect(screen.getByTestId('spawn-counter').textContent).toContain('0 / 9');
  });

  it('START is disabled until the King is placed and shows the cost summary', async () => {
    await setup();
    const u = user();
    const start = screen.getByRole('button', { name: /^start/i }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await u.click(trayPiece('p_bishop_04'));
    await u.click(square('a3'));
    expect(start.disabled).toBe(true);
    await u.click(trayPiece('p_king_01'));
    await u.click(square('e1'));
    expect(start.disabled).toBe(false);
    expect(screen.getByTestId('start-cost').textContent).toContain('2→1');
  });

  it('a placed piece can be picked up again', async () => {
    await setup();
    const u = user();
    await u.click(trayPiece('p_rook_01'));
    await u.click(square('e1'));
    await u.click(square('e1'));
    expect(square('e1').getAttribute('aria-label')).toBe('e1, empty');
    expect(screen.getByTestId('spawn-counter').textContent).toContain('0 / 9');
  });

  it('hovering a square lists its attackers; threatened squares carry an icon', async () => {
    await setup();
    const u = user();
    expect(square('g6').querySelector('[data-threat]')).not.toBeNull();
    expect(square('e1').querySelector('[data-threat]')).toBeNull();
    await u.hover(square('g6'));
    expect(screen.getByTestId('attackers').textContent).toContain('h7');
    expect(screen.getByTestId('capture-line-h7')).toBeTruthy();
    await u.unhover(square('g6'));
    expect(screen.queryByTestId('attackers')).toBeNull();
  });

  it('deployment ranks are hatched', async () => {
    await setup();
    expect(square('e1').hasAttribute('data-hatch')).toBe(true);
    expect(square('e5').hasAttribute('data-hatch')).toBe(false);
  });

  it('START dispatches start with the placements', async () => {
    await setup();
    const u = user();
    await u.click(trayPiece('p_king_01'));
    await u.click(square('e1'));
    await u.click(screen.getByRole('button', { name: /^start/i }));
    expect(api.session!.phase).toBe('action');
    expect(api.session!.stage!.board.e1).toMatchObject({ pieceType: 'king', instanceId: 'p_king_01' });
  });

  it('shows MATE IN X', async () => {
    await setup();
    expect(screen.getByText(/MATE IN 1/)).toBeTruthy();
  });

  it('tray tiles carry the rarity frame shape', async () => {
    await setup();
    expect(trayPiece('p_bishop_04').querySelector('.frame-normal')).not.toBeNull();
    expect(trayPiece('p_king_01').querySelector('.frame')).toBeNull();
  });

  it('a stale refusal does not outlive a newer one', async () => {
    await setup();
    const u = user();
    await u.click(trayPiece('p_bishop_04'));
    await u.click(square('e5'));
    expect(screen.getByRole('alert')).toBeTruthy();
    await u.click(square('e2'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('drag and drop', () => {
    const dt = () => {
      const data: Record<string, string> = {};
      return { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '', effectAllowed: '', dropEffect: '' };
    };

    it('tray to square, then square to another square', async () => {
      await setup();
      const t = dt();
      fireEvent.dragStart(trayPiece('p_rook_01'), { dataTransfer: t });
      fireEvent.drop(square('e1'), { dataTransfer: t });
      expect(square('e1').getAttribute('aria-label')).toBe('e1, white rook');
      const cost = spawnCostOf('rook', 'normal', engineConfig);
      const t2 = dt();
      fireEvent.dragStart(square('e1'), { dataTransfer: t2 });
      fireEvent.drop(square('c2'), { dataTransfer: t2 });
      expect(square('e1').getAttribute('aria-label')).toBe('e1, empty');
      expect(square('c2').getAttribute('aria-label')).toBe('c2, white rook');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByTestId('spawn-counter').textContent).toContain(`${cost} / 9`);
    });

    it('board to tray unplaces', async () => {
      await setup();
      const t = dt();
      fireEvent.dragStart(trayPiece('p_rook_01'), { dataTransfer: t });
      fireEvent.drop(square('e1'), { dataTransfer: t });
      const t2 = dt();
      fireEvent.dragStart(square('e1'), { dataTransfer: t2 });
      fireEvent.drop(tray(), { dataTransfer: t2 });
      expect(square('e1').getAttribute('aria-label')).toBe('e1, empty');
      expect(screen.getByTestId('spawn-counter').textContent).toContain('0 / 9');
    });
  });

  describe('King safety marks', () => {
    const attacked = (): StageSource => {
      const inner = testStageSource();
      return {
        async request(id, req) {
          const a = await inner.request(id, req);
          if (!a.ok) return a;
          a.stage.board.a8 = { pieceType: 'rook', color: 'black', stageId: 's09' };
          return a;
        },
      };
    };

    it('marks the squares where the King would start in check while it is selected', async () => {
      await setup(attacked());
      const u = user();
      expect(square('a1').querySelector('[data-mark="king-unsafe"]')).toBeNull();
      await u.click(trayPiece('p_king_01'));
      expect(square('a1').querySelector('[data-mark="king-unsafe"]')).not.toBeNull();
      expect(square('a1').getAttribute('aria-label')).toMatch(/King would start in check/);
      expect(square('b1').querySelector('[data-mark="king-unsafe"]')).toBeNull();
      await u.click(trayPiece('p_king_01'));
      expect(square('a1').querySelector('[data-mark="king-unsafe"]')).toBeNull();
    });

    it('marks them while the King is dragged', async () => {
      await setup(attacked());
      const data: Record<string, string> = {};
      const t = { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '' };
      fireEvent.dragStart(trayPiece('p_king_01'), { dataTransfer: t });
      expect(square('a1').querySelector('[data-mark="king-unsafe"]')).not.toBeNull();
      fireEvent.dragEnd(trayPiece('p_king_01'), { dataTransfer: t });
      expect(square('a1').querySelector('[data-mark="king-unsafe"]')).toBeNull();
    });
  });

  describe('START-check and queen marks (M5.1)', () => {
    /** The h7 pawn is gone, so a rook on the h-file gives check to the h8 king. */
    const open = (): StageSource => {
      const inner = testStageSource();
      return {
        async request(id, req) {
          const a = await inner.request(id, req);
          if (!a.ok) return a;
          delete a.stage.board.h7;
          return a;
        },
      };
    };
    const queen = (n: number): PieceInstance => ({
      instanceId: `p_queen_${n}`, pieceType: 'queen', rarity: 'normal', durability: 2, durabilityMax: 2,
      origin: 'reward', acquiredAtStage: 0, status: 'in_deck',
    });

    it('deployment marks a checking square gives_check and names the way out', async () => {
      await setup(open());
      const u = user();
      await u.click(trayPiece('p_rook_01'));
      expect(square('h1').querySelector('[data-mark="deploy-refused"]')).not.toBeNull();
      expect(square('h1').getAttribute('aria-label')).toMatch(/gives check.*block the line first/i);
      expect(square('b1').querySelector('[data-mark="deploy-refused"]')).toBeNull();
      await u.click(square('h1'));
      expect(screen.getByRole('alert').textContent).toMatch(/block the line first/i);
      expect(square('h1').getAttribute('aria-label')).not.toMatch(/white rook/);
    });

    it('a second queen in the tray reads one queen per stage', async () => {
      await setup(testStageSource(), [queen(7), queen(8)]);
      const u = user();
      await u.click(trayPiece('p_queen_7'));
      await u.click(square('b1'));
      expect(trayPiece('p_queen_8').textContent).toMatch(/one queen per stage/i);
      expect(trayPiece('p_queen_8').hasAttribute('disabled')).toBe(true);
      await u.click(trayPiece('p_queen_7'));
      expect(trayPiece('p_queen_8').textContent).not.toMatch(/one queen per stage/i);
    });
  });

  it('spawned pawns show their rarity and that they promote to any piece', async () => {
    const inner = testStageSource();
    await setup({
      async request(id, req) {
        const a = await inner.request(id, req);
        if (!a.ok) return a;
        a.stage.board.e2 = {
          pieceType: 'pawn', color: 'white', spawned: true, stageId: 's09', rarity: 'rare',
        };
        return a;
      },
    });
    expect(screen.getByTestId('stage-pieces').textContent).toContain('Rare pawn on e2, promotes to any piece');
  });
});
