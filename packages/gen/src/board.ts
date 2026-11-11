import { draw, fileOf, isSquare, rankOf, toIndex, toSquare } from '@checkbreaker/engine';
import type { BoardPiece, PieceType, Square } from '@checkbreaker/engine';
import type { Formation, GenConfig, Template } from '@checkbreaker/content';

const LETTERS: Record<string, PieceType> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/**
 * Random-fallback placement order after the king: strongest first, pawns last. Big pieces have the
 * fewest legal squares to need, pawns are the most numerous and the only type with a rank
 * restriction, so they fill whatever remains.
 */
const TYPE_ORDER: PieceType[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

/** FEN placement field (rank 8 first, lowercase Black pieces) to a square map. */
export function parsePlacement(black: string): Record<Square, PieceType> {
  const out: Record<Square, PieceType> = {};
  black.split('/').forEach((row, i) => {
    let file = 0;
    for (const c of row) {
      if (/\d/.test(c)) file += Number(c);
      else {
        out[`${'abcdefgh'[file]}${8 - i}`] = LETTERS[c]!;
        file++;
      }
    }
  });
  return out;
}

function mirror(placement: Record<Square, PieceType>): Record<Square, PieceType> {
  const out: Record<Square, PieceType> = {};
  for (const sq of Object.keys(placement)) out[`${'abcdefgh'[7 - fileOf(toIndex(sq))]}${sq[1]}`] = placement[sq]!;
  return out;
}

function randomPlacement(tpl: Template, stageSeed: string, attempt: number, config: GenConfig): Record<Square, PieceType> | null {
  const types: PieceType[] = ['king'];
  for (const type of TYPE_ORDER) {
    const range = tpl.enemyArmy?.[type];
    if (!range) continue;
    const n = range[0] + Math.floor(draw(stageSeed, 'army', attempt, type) * (range[1] - range[0] + 1));
    for (let k = 0; k < n; k++) types.push(type);
  }
  const zone = new Set(tpl.enemyZone ?? [1, 2, 3, 4, 5, 6, 7, 8]);
  for (let placeTry = 0; placeTry < config.gen.maxPlacementTries; placeTry++) {
    const placed: Record<Square, PieceType> = {};
    const taken = new Set<number>();
    let ok = true;
    for (let i = 0; i < types.length && ok; i++) {
      const type = types[i]!;
      const free: number[] = [];
      for (let s = 0; s < 64; s++) {
        if (taken.has(s) || !zone.has(rankOf(s) + 1)) continue;
        if (type === 'pawn' && rankOf(s) === 7) continue;
        free.push(s);
      }
      if (free.length === 0) {
        ok = false;
        break;
      }
      const s = free[Math.floor(draw(stageSeed, 'place', attempt, placeTry, i) * free.length)]!;
      taken.add(s);
      placed[toSquare(s)] = type;
    }
    if (ok) return placed;
  }
  return null;
}

/** G2: the Black army for one attempt, from `fixedEnemy`, a formation, or random placement in `enemyZone`. */
export function enemyBoard(
  tpl: Template,
  formations: Formation[],
  stageSeed: string,
  attempt: number,
  config: GenConfig,
): { board: Record<Square, BoardPiece>; formationId: string | null; mirrored: boolean } | null {
  let placement: Record<Square, PieceType> | null;
  let formationId: string | null = null;
  let mirrored = false;
  if (tpl.placement === 'fixed') {
    if (!tpl.fixedEnemy) throw new Error(`fixed template ${tpl.id} has no fixedEnemy`);
    placement = tpl.fixedEnemy;
  } else if (formations.length > 0) {
    const f = formations[Math.floor(draw(stageSeed, 'formation', attempt) * formations.length)]!;
    formationId = f.id;
    placement = parsePlacement(f.black);
    if (draw(stageSeed, 'mirror', attempt) < 0.5) {
      placement = mirror(placement);
      mirrored = true;
    }
  } else {
    placement = randomPlacement(tpl, stageSeed, attempt, config);
  }
  if (!placement) return null;
  const board: Record<Square, BoardPiece> = {};
  Object.keys(placement)
    .filter(isSquare)
    .sort((a, b) => toIndex(a) - toIndex(b))
    .forEach((sq, i) => {
      board[sq] = { pieceType: placement![sq]!, color: 'black', stageId: `s${String(i + 1).padStart(2, '0')}` };
    });
  return { board, formationId, mirrored };
}
