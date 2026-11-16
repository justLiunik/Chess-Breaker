import { afterEach, describe, expect, it, vi } from 'vitest';
import { clear, colorFor, empty, toggleArrow, toggleMark } from '../src/board/arrows';
import { reducedMotion } from '../src/settings';

const none = { shiftKey: false, ctrlKey: false, altKey: false };

describe('planning arrow state', () => {
  it('colorFor: none 1, Shift 2, Ctrl 3, Alt 4', () => {
    expect(colorFor(none)).toBe(1);
    expect(colorFor({ ...none, shiftKey: true })).toBe(2);
    expect(colorFor({ ...none, ctrlKey: true })).toBe(3);
    expect(colorFor({ ...none, altKey: true })).toBe(4);
  });

  it('the same arrow again removes it; the same squares in another colour recolour it', () => {
    let s = toggleArrow(empty, { from: 'e2', to: 'e4', color: 1 });
    expect(s.arrows).toEqual([{ from: 'e2', to: 'e4', color: 1 }]);
    s = toggleArrow(s, { from: 'e2', to: 'e4', color: 2 });
    expect(s.arrows).toEqual([{ from: 'e2', to: 'e4', color: 2 }]);
    s = toggleArrow(s, { from: 'e2', to: 'e4', color: 2 });
    expect(s.arrows).toEqual([]);
  });

  it('marks toggle the same way, and clear empties both', () => {
    let s = toggleMark(empty, { square: 'd5', color: 1 });
    s = toggleArrow(s, { from: 'a1', to: 'a2', color: 3 });
    expect(s.marks).toHaveLength(1);
    expect(toggleMark(s, { square: 'd5', color: 1 }).marks).toEqual([]);
    expect(clear()).toEqual({ arrows: [], marks: [] });
  });
});

describe('reduced-motion setting', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('defaults to the media query, tolerating a missing matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(reducedMotion.read()).toBe(false);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    expect(reducedMotion.read()).toBe(true);
  });

  it('a user override wins over the media query; null clears it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    reducedMotion.write(false);
    expect(reducedMotion.read()).toBe(false);
    reducedMotion.write(null);
    expect(reducedMotion.read()).toBe(true);
  });

  it('survives unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } });
    expect(() => reducedMotion.write(true)).not.toThrow();
    expect(reducedMotion.read()).toBe(false);
  });
});
