import { draw, fileOf, rankOf, rollTier, toIndex, toSquare } from '@checkbreaker/engine';
import type { BoardPiece, Rarity, Square } from '@checkbreaker/engine';
import type { ActKey, GenConfig, Template } from '@checkbreaker/content';

/** G3: the par, a uniform draw from the template's `mateIn` range. */
export function drawPar(tpl: Template, stageSeed: string): number {
  const [lo, hi] = tpl.mateIn;
  return lo + Math.floor(draw(stageSeed, 'par') * (hi - lo + 1));
}

/** A cumulative pick over the act's rarity weights in tier order. */
export function rollRarity(act: ActKey, u: number, config: GenConfig): Rarity {
  return rollTier(config.gen.rarityPool[act].weights, u);
}

function blackKing(board: Record<Square, BoardPiece>): number | null {
  for (const sq of Object.keys(board)) {
    const p = board[sq]!;
    if (p.pieceType === 'king' && p.color === 'black') return toIndex(sq);
  }
  return null;
}

/** Empty spawn-rank squares in index order, minus squares from which a White pawn would attack the Black king. */
function freeSpawnSquares(board: Record<Square, BoardPiece>, tpl: Template): Square[] {
  const ranks = new Set(tpl.spawnedPawns.ranks);
  const king = blackKing(board);
  const out: Square[] = [];
  for (let s = 0; s < 64; s++) {
    const sq = toSquare(s);
    if (!ranks.has(rankOf(s) + 1) || board[sq]) continue;
    if (king !== null && ((king === s + 7 && fileOf(s) !== 0) || (king === s + 9 && fileOf(s) !== 7))) continue;
    out.push(sq);
  }
  return out;
}

export function nextStageNumber(board: Record<Square, BoardPiece>): number {
  let max = 0;
  for (const p of Object.values(board)) {
    const m = /^s(\d+)$/.exec(p.stageId ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export const stageId = (n: number) => `s${String(n).padStart(2, '0')}`;

function spawnedPawn(
  id: string | undefined,
  act: ActKey,
  uRarity: number,
  config: GenConfig,
): BoardPiece {
  const rarity = rollRarity(act, uRarity, config);
  return {
    pieceType: 'pawn',
    color: 'white',
    spawned: true,
    ...(id === undefined ? {} : { stageId: id }),
    rarity,
  };
}

/** G4: the free White pawns on the template's spawn ranks. `null` when a pawn has no square. */
export function placeSpawnedPawns(
  board: Record<Square, BoardPiece>,
  tpl: Template,
  stageSeed: string,
  attempt: number,
  config: GenConfig,
): Record<Square, BoardPiece> | null {
  const act = `act${tpl.act}` as ActKey;
  const [lo, hi] = tpl.spawnedPawns.count;
  const count = lo + Math.floor(draw(stageSeed, 'spawn', attempt, 'count') * (hi - lo + 1));
  const out = { ...board };
  const first = nextStageNumber(board);
  for (let i = 0; i < count; i++) {
    const free = freeSpawnSquares(out, tpl);
    if (free.length === 0) return null;
    const sq = free[Math.floor(draw(stageSeed, 'spawn', attempt, i, 'square') * free.length)]!;
    out[sq] = spawnedPawn(
      stageId(first + i),
      act,
      draw(stageSeed, 'spawn', attempt, i, 'rarity'),
      config,
    );
  }
  return out;
}

/** Squares a bonus pawn could take, in the order they are tried. */
export function bonusPawnSquares(board: Record<Square, BoardPiece>, tpl: Template, stageSeed: string): Square[] {
  return freeSpawnSquares(board, tpl)
    .map((sq) => ({ sq, u: draw(stageSeed, 'bonus-pawn', sq) }))
    .sort((a, b) => a.u - b.u || (a.sq < b.sq ? -1 : a.sq > b.sq ? 1 : 0))
    .map((x) => x.sq);
}

/** One extra spawned pawn for a stage that needs help. It has no `stageId`: the caller numbers it when it places it on `square`. */
export function makeBonusPawn(_square: Square, act: ActKey, stageSeed: string, config: GenConfig): BoardPiece {
  return spawnedPawn(
    undefined,
    act,
    draw(stageSeed, 'bonus-pawn', 'rarity'),
    config,
  );
}
