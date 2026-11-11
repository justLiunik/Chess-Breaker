import { TIERS, draw, fileOf, rankOf, toIndex, toSquare } from '@checkbreaker/engine';
import type { BoardPiece, DeckType, Rarity, Square } from '@checkbreaker/engine';
import type { ActKey, GenConfig, Template } from '@checkbreaker/content';

const TYPE_ORDER: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];

/** G3: the par, a uniform draw from the template's `mateIn` range. */
export function drawPar(tpl: Template, stageSeed: string): number {
  const [lo, hi] = tpl.mateIn;
  return lo + Math.floor(draw(stageSeed, 'par') * (hi - lo + 1));
}

/** A cumulative pick over the act's rarity weights in tier order. */
export function rollRarity(act: ActKey, u: number, config: GenConfig): Rarity {
  const weights = config.gen.rarityPool[act].weights;
  const total = TIERS.reduce((s, t) => s + weights[t], 0);
  let acc = 0;
  let last: Rarity = TIERS[0]!;
  for (const t of TIERS) {
    if (weights[t] <= 0) continue;
    acc += weights[t];
    last = t;
    if (u * total < acc) return t;
  }
  return last;
}

/** What a spawned pawn becomes on reaching rank 8: type, then a tier-up capped at the act ceiling, then retention. */
export function rollPromotion(
  act: ActKey,
  tier: Rarity,
  stream: (field: string) => number,
  config: GenConfig,
): { pieceType: DeckType; rarity: Rarity } {
  const { resultTypeWeights, tierUpChance } = config.gen.promotion;
  const total = TYPE_ORDER.reduce((s, t) => s + resultTypeWeights[t], 0);
  const u = stream('type') * total;
  let acc = 0;
  let pieceType: DeckType = TYPE_ORDER[TYPE_ORDER.length - 1]!;
  for (const t of TYPE_ORDER) {
    acc += resultTypeWeights[t];
    if (u < acc) {
      pieceType = t;
      break;
    }
  }
  const ceiling = TIERS.indexOf(config.gen.rarityPool[act].ceiling);
  let idx = TIERS.indexOf(tier);
  if (stream('tierUp') < tierUpChance) idx = Math.min(idx + 1, ceiling);
  const keep = config.gen.retention[pieceType]?.[TIERS[idx]!];
  if (keep !== undefined && stream('retention') >= keep) idx = Math.max(idx - 1, 0);
  return { pieceType, rarity: TIERS[idx]! };
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

function nextStageNumber(board: Record<Square, BoardPiece>): number {
  let max = 0;
  for (const p of Object.values(board)) {
    const m = /^s(\d+)$/.exec(p.stageId ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

const stageId = (n: number) => `s${String(n).padStart(2, '0')}`;

function spawnedPawn(
  id: string | undefined,
  act: ActKey,
  uRarity: number,
  stream: (f: string) => number,
  config: GenConfig,
): BoardPiece {
  const rarity = rollRarity(act, uRarity, config);
  return {
    pieceType: 'pawn',
    color: 'white',
    spawned: true,
    ...(id === undefined ? {} : { stageId: id }),
    rarity,
    promotesTo: rollPromotion(act, rarity, stream, config),
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
      (f) => draw(stageSeed, 'spawn', attempt, i, f),
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
    (f) => draw(stageSeed, 'bonus-pawn', f),
    config,
  );
}
