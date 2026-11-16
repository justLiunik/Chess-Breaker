import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage, newRun, serializeSave } from '@checkbreaker/run';
import { runConfig } from '../src/config';
import { useShortcuts } from '../src/input/shortcuts';
import type { Shortcuts } from '../src/input/shortcuts';
import { reducedMotion, useReducedMotion } from '../src/settings';
import { Action as ActionScreen } from '../src/screens/Action';
import { RunProvider, useRun } from '../src/state/store';
import type { StageSource } from '../src/state/stageSource';
import { STARTER_MATE, testStageSource } from './doubles';


const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
/** The declaration block of the rule whose selector list starts with `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`) >= 0 ? css.indexOf(`${selector} {`) : css.indexOf(`${selector},`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}
const zIndex = (selector: string): number => Number(/z-index:\s*(\d+)/.exec(rule(selector))?.[1]);

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
let storage = memoryStorage();
async function setup(loadout: string[] = []) {
  const session = newRun('7F3A-2210', runConfig);
  session.run.loadout.push(...loadout.map((skillId) => ({ skillId })));
  storage = memoryStorage();
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

  it('Space on a focused skill button activates that button and does not commit', async () => {
    await setup(['twin_step']);
    const u = userEvent.setup();
    await playMove(u, 'a3', 'b4');
    const skill = screen.getByRole('button', { name: /Twin Step/ });
    skill.focus();
    await u.keyboard(' ');
    expect(entry(1)!.textContent).toContain('Twin Step');
    expect(screen.queryByTestId('thinking')).toBeNull();
    expect(api.session!.stage!.turnsUsed).toBe(0);
  });

  it('Space with the confirm dialog open activates the focused dialog button', async () => {
    const queen = { pieceType: 'queen', color: 'white', spawned: true, rarity: 'normal', stageId: 's01' } as const;
    const base = testStageSource();
    const source: StageSource = {
      async request(id, req) {
        const a = await base.request(id, req);
        return a.ok ? { ...a, stage: { ...a.stage, board: { h8: { pieceType: 'king', color: 'black' }, e7: queen } } } : a;
      },
    };
    const session = newRun('7F3A-2210', runConfig);
    storage = memoryStorage();
    storage.write(serializeSave(session, '2026-11-16T00:00:00.000Z'));
    render(<RunProvider source={source} storage={storage}><Probe /></RunProvider>);
    await act(async () => { api.dispatch({ type: 'continue' }); });
    await flush();
    await act(async () => { api.dispatch({ type: 'start', placements: STARTER_MATE.placements }); });
    const u = userEvent.setup();
    await playMove(u, 'e7', 'f7');
    await u.click(screen.getByRole('button', { name: /^COMMIT/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    await u.keyboard(' ');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.session!.stage!.turnsUsed).toBe(0);
  });

  it('Space on the COMMIT button itself commits', async () => {
    await setup();
    const u = userEvent.setup();
    await playMove(u, 'a3', 'b4');
    screen.getByRole('button', { name: /^COMMIT/ }).focus();
    await u.keyboard(' ');
    await flush();
    expect(api.session!.stage!.turnsUsed).toBe(1);
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

  it('COMMIT clears all; planning marks are not engine markers and never reach the saved text', async () => {
    await setup();
    const u = userEvent.setup();
    await playMove(u, 'a3', 'b4');
    rightDrag('h1', 'h5');
    rightDrag('g4', 'g4');
    expect(document.querySelector('[data-mark]')).toBeNull();
    const before = storage.read();
    expect(before).toBeTruthy();
    expect(storage.read()).toBe(before); // drawing writes nothing
    key(' ');
    await flush();
    expect(arrow('h1', 'h5')).toBeNull();
    expect(mark('g4')).toBeNull();
    // The commit autosaved: the text changed, and carries no planning data.
    const after = storage.read()!;
    expect(after).not.toBe(before);
    expect(after).not.toMatch(/plan|"arrows"|"marks"/i);
    key(' '); // skip the playback so the board takes input again
    rightDrag('h1', 'h5');
    expect(arrow('h1', 'h5')).not.toBeNull();
    await act(async () => { api.dispatch({ type: 'set_dev', on: true }); });
    expect(storage.read()!).not.toMatch(/plan|"arrows"|"marks"/i);
  });

  it('stacks the plan layer under the pieces and the preview overlay (DOM order and z-index contract)', async () => {
    await setup();
    const u = userEvent.setup();
    await playMove(u, 'a3', 'b4');
    rightDrag('e2', 'e4');
    const kids = [...screen.getByRole('group', { name: 'Board' }).children];
    expect(kids.findIndex((k) => k.classList.contains('plan-overlay'))).toBe(0); // before every square
    expect(kids.findIndex((k) => k.matches('svg.overlay:not(.plan-overlay)'))).toBeGreaterThan(0);
    expect(square('b4').getAttribute('data-ghost')).not.toBeNull();
    const plan = zIndex('.plan-overlay');
    expect(plan).toBeGreaterThan(0);
    expect(zIndex('.board .piece')).toBeGreaterThan(plan);
    expect(zIndex('.board .overlay:not(.plan-overlay)')).toBeGreaterThan(zIndex('.board .piece'));
  });
});

describe('reduced motion on the board', () => {
  const boardClass = () => screen.getByRole('group', { name: 'Board' }).className;

  it('the class follows the setting, and an override beats the media query', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await setup();
    expect(boardClass()).toContain('motion-fade');
    act(() => reducedMotion.write(false));
    expect(boardClass()).toContain('motion-travel');
    expect(boardClass()).not.toContain('motion-fade');
    act(() => reducedMotion.write(true));
    expect(boardClass()).toContain('motion-fade');
  });

  it('re-reads when the OS preference changes (matchMedia change listener)', () => {
    const state = { matches: false };
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({
      get matches() { return state.matches; },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    function Probe2() { return <p data-testid="rm">{String(useReducedMotion())}</p>; }
    render(<Probe2 />);
    expect(screen.getByTestId('rm').textContent).toBe('false');
    expect(listeners.size).toBeGreaterThan(0);
    act(() => { state.matches = true; listeners.forEach((l) => l()); });
    expect(screen.getByTestId('rm').textContent).toBe('true');
    cleanup();
    expect(listeners.size).toBe(0);
  });

  it('the stylesheet keys the animations on the class, not the media query', () => {
    expect(css).not.toMatch(/prefers-reduced-motion/);
    expect(rule('.board.motion-travel .square.ghost .piece')).toMatch(/animation:\s*piece-slide-in/);
    expect(rule('.board.motion-fade .square.ghost .piece')).toMatch(/animation:\s*piece-fade-in/);
    expect(css).toMatch(/@keyframes piece-fade-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/);
  });
});
