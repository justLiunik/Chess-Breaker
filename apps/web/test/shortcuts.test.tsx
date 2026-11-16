import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage, newRun, serializeSave } from '@checkbreaker/run';
import { runConfig } from '../src/config';
import { useShortcuts } from '../src/input/shortcuts';
import type { Shortcuts } from '../src/input/shortcuts';
import { reducedMotion } from '../src/settings';
import { Action as ActionScreen } from '../src/screens/Action';
import { RunProvider, useRun } from '../src/state/store';
import { STARTER_MATE, testStageSource } from './doubles';

function Host(props: Shortcuts) {
  useShortcuts(props);
  return <input aria-label="name" />;
}
const spies = () => ({ commit: vi.fn(), undo: vi.fn(), stepPrev: vi.fn(), stepNext: vi.fn(), codex: vi.fn(), deck: vi.fn(), escape: vi.fn() });
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

describe('useShortcuts', () => {
  it('maps each key to its callback', () => {
    const s = spies();
    render(<Host {...s} />);
    key(' '); key('z'); key('Z'); key('ArrowLeft'); key('ArrowRight'); key('c'); key('d'); key('Escape');
    expect(s.commit).toHaveBeenCalledTimes(1);
    expect(s.undo).toHaveBeenCalledTimes(2);
    expect(s.stepPrev).toHaveBeenCalledTimes(1);
    expect(s.stepNext).toHaveBeenCalledTimes(1);
    expect(s.codex).toHaveBeenCalledTimes(1);
    expect(s.deck).toHaveBeenCalledTimes(1);
    expect(s.escape).toHaveBeenCalledTimes(1);
  });

  it('is ignored while a text input has focus, and with Ctrl/Meta/Alt held', () => {
    const s = spies();
    render(<Host {...s} />);
    screen.getByLabelText('name').focus();
    fireEvent.keyDown(screen.getByLabelText('name'), { key: 'z' });
    fireEvent.keyDown(screen.getByLabelText('name'), { key: ' ' });
    (document.activeElement as HTMLElement).blur();
    key('z', { ctrlKey: true });
    key('c', { metaKey: true });
    expect(s.undo).not.toHaveBeenCalled();
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.codex).not.toHaveBeenCalled();
  });

  it('missing callbacks are harmless', () => {
    render(<Host />);
    expect(() => { key('c'); key('d'); key(' '); }).not.toThrow();
  });
});

type Api = ReturnType<typeof useRun>;
let api: Api;
function Probe() {
  api = useRun();
  return api.session?.phase === 'action' ? <ActionScreen /> : null;
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function setup() {
  const session = newRun('7F3A-2210', runConfig);
  const storage = memoryStorage();
  storage.write(serializeSave(session, '2026-11-16T00:00:00.000Z'));
  render(<RunProvider source={testStageSource()} storage={storage}><Probe /></RunProvider>);
  await act(async () => { api.dispatch({ type: 'continue' }); });
  await flush();
  await act(async () => { api.dispatch({ type: 'start', placements: STARTER_MATE.placements }); });
}
const square = (sq: string) => screen.getByRole('button', { name: new RegExp(`^${sq},`) });
const entry = (i: number) => screen.queryByTestId(`queue-entry-${i}`);
async function playMove(u: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await u.click(square(from));
  await u.click(square(to));
}
const rightDrag = (from: string, to: string, init: MouseEventInit = {}) => {
  fireEvent.mouseDown(square(from), { button: 2, ...init });
  fireEvent.mouseUp(square(to), { button: 2, ...init });
};

describe('Action shortcuts', () => {
  it('Z removes the last entry; Space commits a valid queue and does nothing on an empty one', async () => {
    await setup();
    const u = userEvent.setup();
    key(' ');
    await flush();
    expect(api.session!.stage!.turnsUsed).toBe(0);
    await playMove(u, 'a3', 'b4');
    await playMove(u, 'b4', 'c5');
    expect(entry(1)).not.toBeNull();
    key('z');
    expect(entry(1)).toBeNull();
    expect(entry(0)).not.toBeNull();
    key(' ');
    expect(screen.queryByTestId('thinking')).not.toBeNull();
    await flush();
    expect(api.session!.stage!.turnsUsed).toBe(1);
  });

  it('ArrowLeft/ArrowRight move the preview step', async () => {
    await setup();
    const u = userEvent.setup();
    await playMove(u, 'e1', 'e2');
    await playMove(u, 'a3', 'b4');
    expect(entry(1)!.className).toContain('current');
    key('ArrowLeft');
    expect(entry(0)!.className).toContain('current');
    key('ArrowLeft');
    expect(entry(0)!.className).toContain('current');
    key('ArrowRight');
    expect(entry(1)!.className).toContain('current');
  });

  it('Escape cancels a selection', async () => {
    await setup();
    const u = userEvent.setup();
    await u.click(square('a3'));
    expect(square('b4').className).toContain('highlight');
    key('Escape');
    expect(square('b4').className).not.toContain('highlight');
  });

  it('C and D are safe no-ops until the overlays exist', async () => {
    await setup();
    expect(() => { key('c'); key('d'); }).not.toThrow();
  });
});

describe('planning arrows on the Action screen', () => {
  const arrow = (a: string, b: string) => screen.queryByTestId(`plan-arrow-${a}-${b}`);
  const mark = (sq: string) => screen.queryByTestId(`plan-mark-${sq}`);

  it('right-drag draws one arrow, repeating removes it, with no context menu', async () => {
    await setup();
    rightDrag('e2', 'e4');
    expect(arrow('e2', 'e4')).not.toBeNull();
    expect(document.querySelectorAll('[data-testid^="plan-arrow-"]')).toHaveLength(1);
    const ctx = fireEvent.contextMenu(square('e4'));
    expect(ctx).toBe(false); // preventDefault was called
    rightDrag('e2', 'e4');
    expect(arrow('e2', 'e4')).toBeNull();
  });

  it('right-click marks a square; modifiers pick colours', async () => {
    await setup();
    rightDrag('d5', 'd5');
    expect(mark('d5')).not.toBeNull();
    expect(mark('d5')!.getAttribute('data-color')).toBe('1');
    rightDrag('a1', 'a4', { shiftKey: true });
    expect(arrow('a1', 'a4')!.getAttribute('data-color')).toBe('2');
    rightDrag('b1', 'b4', { ctrlKey: true });
    expect(arrow('b1', 'b4')!.getAttribute('data-color')).toBe('3');
    rightDrag('c1', 'c4', { altKey: true });
    expect(arrow('c1', 'c4')!.getAttribute('data-color')).toBe('4');
    rightDrag('d5', 'd5');
    expect(mark('d5')).toBeNull();
  });

  it('a left click on the board clears all', async () => {
    await setup();
    const u = userEvent.setup();
    rightDrag('e2', 'e4');
    rightDrag('d5', 'd5');
    await u.click(square('h1'));
    expect(arrow('e2', 'e4')).toBeNull();
    expect(mark('d5')).toBeNull();
  });

  it('COMMIT clears all, and planning marks are not engine markers or saved', async () => {
    await setup();
    const u = userEvent.setup();
    await playMove(u, 'a3', 'b4');
    rightDrag('e2', 'e4');
    expect(document.querySelector('[data-mark]')).toBeNull();
    expect(localStorage.getItem('checkbreaker.save.1') ?? '').not.toContain('plan-arrow');
    key(' ');
    await flush();
    expect(arrow('e2', 'e4')).toBeNull();
  });

  it('draws the planning layer before (under) the preview overlay', async () => {
    await setup();
    rightDrag('e2', 'e4');
    const svgs = [...document.querySelectorAll('svg.overlay')];
    expect(svgs[0]!.classList.contains('plan-overlay')).toBe(true);
  });
});

describe('reduced motion on the board', () => {
  it('piece travel is a fade when reduced, a slide otherwise', async () => {
    reducedMotion.write(true);
    await setup();
    expect(screen.getByRole('group', { name: 'Board' }).className).toContain('motion-fade');
    cleanup();
    reducedMotion.write(false);
    await setup();
    expect(screen.getByRole('group', { name: 'Board' }).className).toContain('motion-travel');
  });
});
