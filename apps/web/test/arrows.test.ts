import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('plan palette vs engine styling', () => {
  const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
  type Rgb = [number, number, number];
  const hex = (name: string): Rgb => {
    const m = new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i').exec(css);
    if (!m) throw new Error(`--${name} not declared`);
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const hue = ([r, g, b]: Rgb): number => {
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (d === 0) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const gap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const dist = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('no plan colour equals, or has a hue within 30 degrees of, --threat or --highlight', () => {
    for (const engine of ['threat', 'highlight']) {
      for (const n of [1, 2, 3, 4]) {
        expect(dist(hex(`plan-${n}`), hex(engine)), `plan-${n} vs ${engine} colour`).toBeGreaterThan(90);
        expect(gap(hue(hex(`plan-${n}`)), hue(hex(engine))), `plan-${n} vs ${engine} hue`).toBeGreaterThan(30);
      }
    }
  });

  it('the four plan colours differ from one another', () => {
    for (let i = 1; i <= 4; i++) for (let j = i + 1; j <= 4; j++) expect(dist(hex(`plan-${i}`), hex(`plan-${j}`))).toBeGreaterThan(70);
  });
});
