import type { PromotionType, Rarity, Square } from '@checkbreaker/engine';
import { PieceGlyph, PIECE_NAME } from '../board/pieces';

/** The letter a promotion shows in the queue ("g7→g8=Q"). */
export const PROMOTION_LETTER: Record<PromotionType, string> = { queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };

export interface PromotionPickerProps {
  /** Exactly what the engine's `promotionChoices` returned, in its order. */
  choices: PromotionType[];
  to: Square;
  rarity: Rarity;
  onPick(type: PromotionType): void;
  onCancel(): void;
}

/** The choice a pawn makes on reaching rank 8. Esc (handled by the screen) and Cancel drop the planned move. */
export function PromotionPicker({ choices, to, rarity, onPick, onCancel }: PromotionPickerProps) {
  return (
    <div className="promotion-picker" role="dialog" aria-modal="true" aria-label={`Promote the pawn on ${to}`} data-testid="promotion-picker">
      <p><strong>Promote to</strong></p>
      {choices.map((type, i) => (
        <button key={type} type="button" autoFocus={i === 0} onClick={() => onPick(type)}>
          <span className="promotion-icon" aria-hidden="true"><PieceGlyph piece={{ pieceType: type, color: 'white' }} rarity={rarity} /></span>
          {' '}{PIECE_NAME[type][0]!.toUpperCase() + PIECE_NAME[type].slice(1)}
        </button>
      ))}
      {' '}
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  );
}
