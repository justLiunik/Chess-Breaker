import type { BoardPiece, PieceType, Rarity } from '@checkbreaker/engine';

export const RARITY_NAME: Record<Rarity, string> = {
  normal: 'Normal', rare: 'Rare', unique: 'Unique', legendary: 'Legendary',
};

export const PIECE_NAME: Record<PieceType, string> = {
  king: 'king', queen: 'queen', rook: 'rook', bishop: 'bishop', knight: 'knight', pawn: 'pawn',
};

const GLYPH: Record<PieceType, string> = {
  king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟',
};

/** The frame shape tells the tier apart without colour: square, circle, diamond, octagon. */
const FRAME: Record<Rarity, string> = {
  normal: 'M14 14H86V86H14Z',
  rare: 'M50 10A40 40 0 1 1 49.99 10Z',
  unique: 'M50 6L94 50L50 94L6 50Z',
  legendary: 'M32 8H68L92 32V68L68 92H32L8 68V32Z',
};

/** The frame alone, for places that show a tier without a piece. */
export function TierFrame({ rarity }: { rarity: Rarity }) {
  return (
    <svg className="tier-frame" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path className={`frame frame-${rarity}`} d={FRAME[rarity]} />
    </svg>
  );
}

export function PieceGlyph({ piece, rarity }: { piece: Pick<BoardPiece, 'pieceType' | 'color'>; rarity?: Rarity | null }) {
  const tier = rarity ?? null;
  return (
    <svg className={`piece piece-${piece.color}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {tier && <path className={`frame frame-${tier}`} d={FRAME[tier]} />}
      <text x="50" y="68" textAnchor="middle" fontSize="60" className="glyph">{GLYPH[piece.pieceType]}</text>
    </svg>
  );
}
