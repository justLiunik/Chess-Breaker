import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { devToggle, localStorageRunStorage } from '../src/storage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('localStorageRunStorage', () => {
  it('round-trips write, read and clear under checkbreaker.save.1', () => {
    const onError = vi.fn();
    const s = localStorageRunStorage(onError);
    expect(s.read()).toBeNull();
    s.write('hello');
    expect(localStorage.getItem('checkbreaker.save.1')).toBe('hello');
    expect(s.read()).toBe('hello');
    s.clear();
    expect(s.read()).toBeNull();
    expect(localStorage.getItem('checkbreaker.save.1')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('survives a throwing setItem: reports once and keeps the last text in memory', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const onError = vi.fn();
    const s = localStorageRunStorage(onError);
    expect(() => {
      s.write('a');
      s.write('b');
      s.write('c');
    }).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(s.read()).toBe('c');
  });

  it('survives a throwing getItem and removeItem', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const onError = vi.fn();
    const s = localStorageRunStorage(onError);
    expect(s.read()).toBeNull();
    expect(() => s.clear()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('removeItem failures', () => {
  it('clear() survives a throwing removeItem, reports once, and reads back null', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const onError = vi.fn();
    const s = localStorageRunStorage(onError);
    s.write('x');
    expect(() => s.clear()).not.toThrow();
    expect(() => s.clear()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(s.read()).toBeNull();
  });
});

describe('devToggle', () => {
  it('write(false) survives a throwing removeItem', () => {
    devToggle.write(true);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => devToggle.write(false)).not.toThrow();
  });

  it('is off by default and persists under checkbreaker.dev', () => {
    expect(devToggle.read()).toBe(false);
    devToggle.write(true);
    expect(localStorage.getItem('checkbreaker.dev')).toBe('1');
    expect(devToggle.read()).toBe(true);
    devToggle.write(false);
    expect(devToggle.read()).toBe(false);
  });

  it('does not throw when storage fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(devToggle.read()).toBe(false);
    expect(() => devToggle.write(true)).not.toThrow();
  });
});
