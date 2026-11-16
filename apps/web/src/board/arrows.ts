import type { Square } from '@checkbreaker/engine';

export type PlanColor = 1 | 2 | 3 | 4;
export type PlanArrow = { from: Square; to: Square; color: PlanColor };
export type PlanMark = { square: Square; color: PlanColor };
/** Planning annotations: UI-only, never saved. */
export type Plan = { arrows: PlanArrow[]; marks: PlanMark[] };

export const FILES = 'abcdefgh';
/** The centre of `sq` in board units (a square is 1x1, a8 at the top left). */
export const centre = (sq: Square): { x: number; y: number } => ({ x: FILES.indexOf(sq[0]!) + 0.5, y: 8 - Number(sq[1]) + 0.5 });

export const empty: Plan = { arrows: [], marks: [] };

/** Colour from the held modifiers: none 1, Shift 2, Ctrl 3, Alt 4. */
export function colorFor(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }): PlanColor {
  if (e.shiftKey) return 2;
  if (e.ctrlKey) return 3;
  if (e.altKey) return 4;
  return 1;
}

/** Drawing the same arrow again removes it; the same squares in another colour recolour it. */
export function toggleArrow(plan: Plan, arrow: PlanArrow): Plan {
  const same = plan.arrows.find((a) => a.from === arrow.from && a.to === arrow.to);
  const rest = plan.arrows.filter((a) => a !== same);
  if (same && same.color === arrow.color) return { ...plan, arrows: rest };
  return { ...plan, arrows: [...rest, arrow] };
}

export function toggleMark(plan: Plan, mark: PlanMark): Plan {
  const same = plan.marks.find((m) => m.square === mark.square);
  const rest = plan.marks.filter((m) => m !== same);
  if (same && same.color === mark.color) return { ...plan, marks: rest };
  return { ...plan, marks: [...rest, mark] };
}

export const clear = (): Plan => ({ arrows: [], marks: [] });
