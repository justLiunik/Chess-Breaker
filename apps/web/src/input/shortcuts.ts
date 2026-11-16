import { useEffect, useRef } from 'react';

export interface Shortcuts {
  commit?: () => void;
  undo?: () => void;
  stepPrev?: () => void;
  stepNext?: () => void;
  codex?: () => void;
  deck?: () => void;
  escape?: () => void;
}

const BY_KEY: Record<string, keyof Shortcuts> = {
  ' ': 'commit', z: 'undo', ArrowLeft: 'stepPrev', ArrowRight: 'stepNext', c: 'codex', d: 'deck', Escape: 'escape',
};

function typing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

/**
 * Space is COMMIT only when nothing else would use it: focus on the page itself, the board container, or the COMMIT
 * button. On any other focused control (a square, a skill, a remove or dialog button) the browser activates it.
 */
function spaceIsCommit(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return true;
  return t === document.body || t === document.documentElement || t.classList.contains('board') || t.classList.contains('commit');
}

/**
 * Window-level keyboard shortcuts. Ignored while a text field has focus or Ctrl/Meta/Alt is held.
 * Where Space does act, its default is cancelled on keydown and keyup so a focused COMMIT button is not also clicked.
 */
export function useShortcuts(handlers: Shortcuts): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    let spaceHandled = false;
    const onDown = (e: KeyboardEvent): void => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' && !spaceIsCommit(e.target)) return;
      const name = BY_KEY[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      const fn = name ? ref.current[name] : undefined;
      if (!fn) return;
      e.preventDefault();
      if (e.key === ' ') spaceHandled = true;
      if (!e.repeat) fn();
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === ' ' && spaceHandled) { spaceHandled = false; e.preventDefault(); }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);
}
