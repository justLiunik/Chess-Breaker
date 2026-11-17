import type { ReactNode } from 'react';
import { useShortcuts } from '../input/shortcuts';

/** A reference overlay: it takes the keyboard (Escape closes it) while every screen behind it is paused. */
export function Modal({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  useShortcuts({ escape: onClose }, { overlay: true });
  return (
    <div className="modal-backdrop" data-overlay="" role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal">
        <button type="button" className="modal-close" autoFocus onClick={onClose}>Close</button>
        {children}
      </div>
    </div>
  );
}
