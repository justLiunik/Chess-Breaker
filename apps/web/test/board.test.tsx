import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BoardPiece } from '@checkbreaker/engine';
import { Board } from '../src/board/Board';

afterEach(cleanup);

const pawn: BoardPiece = { pieceType: 'pawn', color: 'white', stageId: 's01', spawned: true, rarity: 'normal' };
const stage = { board: { e2: pawn, h8: { pieceType: 'king', color: 'black' } as BoardPiece } };
const square = (sq: string) => screen.getByRole('button', { name: new RegExp(`^${sq},`) });

describe('Board ghost', () => {
  it('without a ghost renders stage.board plainly', () => {
    render(<Board stage={stage} />);
    expect(square('e2').getAttribute('aria-label')).toBe('e2, white pawn');
    expect(square('e2').hasAttribute('data-vacated')).toBe(false);
  });

  it('a ghost moving e2 to e4 fades the e2 piece and draws a ghost piece on e4', () => {
    const ghost = { e4: pawn, h8: stage.board.h8 };
    render(<Board stage={stage} overlays={{ ghost }} />);
    expect(square('e2').hasAttribute('data-vacated')).toBe(true);
    expect(square('e2').querySelector('svg.piece')).not.toBeNull();
    expect(square('e4').hasAttribute('data-ghost')).toBe(true);
    expect(square('e4').querySelector('svg.piece')).not.toBeNull();
    expect(square('e4').getAttribute('aria-label')).toBe('e4, white pawn');
    expect(square('h8').hasAttribute('data-ghost')).toBe(false);
  });

  it('drag eligibility is an explicit prop', () => {
    render(<Board stage={stage} draggable={(sq) => sq === 'e2'} />);
    expect(square('e2').getAttribute('draggable')).toBe('true');
    expect(square('h8').getAttribute('draggable')).toBe('false');
  });
});

describe('Board clue overlay', () => {
  it('the clue overlay draws a ghost and names it in the label', () => {
    render(<Board stage={{ board: {} }} overlays={{ clue: [{ square: 'a3', piece: { pieceType: 'bishop', color: 'white', rarity: 'normal' }, note: 'you no longer have this piece' }] }} />);
    const label = square('a3').getAttribute('aria-label')!;
    expect(label).toContain('clue: white bishop');
    expect(label).toContain('you no longer have this piece');
    expect(square('a3').querySelector('[data-clue="bishop"]')).not.toBeNull();
  });
});
