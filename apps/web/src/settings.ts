export const REDUCED_MOTION_KEY = 'checkbreaker.reducedMotion';

function systemPrefersReduced(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** Reduced motion: the user's override when there is one, otherwise the system preference. A per-browser convenience only. */
export const reducedMotion = {
  read(): boolean {
    try {
      const v = localStorage.getItem(REDUCED_MOTION_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {
      // Fall through to the system preference.
    }
    return systemPrefersReduced();
  },
  /** `null` removes the override. */
  write(on: boolean | null): void {
    try {
      if (on === null) localStorage.removeItem(REDUCED_MOTION_KEY);
      else localStorage.setItem(REDUCED_MOTION_KEY, on ? '1' : '0');
    } catch {
      // Not persisting the override is harmless.
    }
  },
};
