import type { RunStorage } from '@checkbreaker/run';

export const SAVE_KEY = 'checkbreaker.save.1';
export const DEV_KEY = 'checkbreaker.dev';

/**
 * A `RunStorage` over `localStorage`. Every call is guarded: the first failure calls `onError` once and from then on
 * the last written text is served from memory, so the run keeps working without persistence.
 */
export function localStorageRunStorage(onError: (e: unknown) => void): RunStorage {
  let memory: string | null = null;
  let failed = false;
  const fail = (e: unknown): void => {
    if (!failed) {
      failed = true;
      onError(e);
    }
  };
  return {
    read(): string | null {
      if (failed) return memory;
      try {
        const text = localStorage.getItem(SAVE_KEY);
        memory = text;
        return text;
      } catch (e) {
        fail(e);
        return memory;
      }
    },
    write(text: string): void {
      memory = text;
      if (failed) return;
      try {
        localStorage.setItem(SAVE_KEY, text);
      } catch (e) {
        fail(e);
      }
    },
    clear(): void {
      memory = null;
      if (failed) return;
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch (e) {
        fail(e);
      }
    },
  };
}

/** The developer toggle; off by default, and off whenever storage is unavailable. */
export const devToggle = {
  read(): boolean {
    try {
      return localStorage.getItem(DEV_KEY) === '1';
    } catch {
      return false;
    }
  },
  write(on: boolean): void {
    try {
      if (on) localStorage.setItem(DEV_KEY, '1');
      else localStorage.removeItem(DEV_KEY);
    } catch {
      // Not persisting the toggle is harmless.
    }
  },
};
