import * as internal from '@checkbreaker/engine/internal';
import type { Move } from '@checkbreaker/engine/internal';
import { rankOf, spawnCostOf, toIndex, toSquare } from '@checkbreaker/engine';
import type { AbilityTable, DeckType, Rarity, RunState, Square, StageState } from '@checkbreaker/engine';
import { enemyArmyValue, valueBandFor } from '@checkbreaker/content';
import type { ActKey, GenConfig, PreconditionId, Template } from '@checkbreaker/content';
import type { Placement } from './types';

// Imported bindings are copied into module constants once (see packages/engine/src/movegen.ts):
// the turn-1 mate search calls them in hot loops.
const {
  BISHOP, KING, KNIGHT, QUEEN, ROOK, TIERS, abilityAttacked, abilityTargetsInto, analyse, fromBoard, inCheck,
  isAttacked, legalMoves, makeMoveTiered, newSafety, safeMove, targetsInto, tiersOf, unmakeMoveTiered,
} = internal;

const DECK_TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];
const CODE: Record<DeckType, number> = { knight: KNIGHT, bishop: BISHOP, rook: ROOK, queen: QUEEN };

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A turn-1 mate: the summons and where they go, then the move, or a move and its bonus move. */
export type FirstTurnMate = { placements: Placement[]; moves: { from: Square; to: Square }[] };

/**
 * G5: the template's preconditions (docs/04 §4), checked in the template's order on the generated
 * board. Returns the first that fails, or null. `extraPawns` widens the spawned-pawn count for the
 * bonus pawn (G7).
 */
export function checkPreconditions(
  run: RunState,
  stage: StageState,
  tpl: Template,
  opts: { extraPawns: number },
  config: GenConfig,
): PreconditionId | null {
  for (const id of tpl.preconditions) {
    if (!passes(id, run, stage, tpl, opts.extraPawns, config)) return id;
  }
  return null;
}

function passes(
  id: PreconditionId,
  run: RunState,
  stage: StageState,
  tpl: Template,
  extraPawns: number,
  config: GenConfig,
): boolean {
  switch (id) {
    case 'enemy_king_on_board':
      return enemyKingOnBoard(stage);
    case 'safe_king_square': {
      const b = fromBoard(stage.board);
      return emptyDeploymentSquares(b, config).some((s) => !isAttacked(b, s, 'black'));
    }
    case 'no_first_turn_mate':
      return firstTurnMate(run, stage, config) === null;
    case 'enemy_has_moves': {
      const tiers = { t: tiersOf(stage.board), table: config.abilities };
      return legalMoves(fromBoard(stage.board), 'black', undefined, tiers).length > 0;
    }
    case 'enemy_value_in_band': {
      const black = Object.values(stage.board).filter((p) => p.color === 'black').map((p) => p.pieceType);
      const value = enemyArmyValue(black, config);
      const [lo, hi] = valueBandFor(tpl.act, tpl.tier, config);
      return value >= lo && value <= hi;
    }
    case 'deployment_squares_available': {
      const cheapest = Math.min(...DECK_TYPES.flatMap((type) => TIERS.map((r) => spawnCostOf(type, r, config))));
      // The King's square, plus one per summon the budget allows at the cheapest spawn cost.
      const need = Math.floor(stage.spawnPoints / cheapest) + 1;
      return emptyDeploymentSquares(fromBoard(stage.board), config).length >= need;
    }
    case 'spawned_pawns_placed':
      return spawnedPawnsPlaced(stage, tpl, extraPawns, config);
  }
}

/** Exactly one black king, no White Hero Piece (only spawned pawns are White), in the Deployment phase. */
function enemyKingOnBoard(stage: StageState): boolean {
  let kings = 0;
  for (const p of Object.values(stage.board)) {
    if (p.color === 'white' && (p.spawned !== true || p.instanceId !== undefined)) return false;
    if (p.color === 'black' && p.pieceType === 'king') kings++;
  }
  return kings === 1 && stage.phase === 'deployment';
}

/** Every spawned pawn on a spawn rank with a rarity and `promotesTo` at most the act ceiling; the count in range. */
function spawnedPawnsPlaced(stage: StageState, tpl: Template, extraPawns: number, config: GenConfig): boolean {
  const ceiling = TIERS.indexOf(config.gen.rarityPool[`act${tpl.act}` as ActKey].ceiling);
  const within = (r: Rarity | undefined): boolean => {
    const i = r === undefined ? -1 : TIERS.indexOf(r);
    return i >= 0 && i <= ceiling;
  };
  let count = 0;
  for (const [sq, p] of Object.entries(stage.board)) {
    if (p.spawned !== true) continue;
    count++;
    if (p.pieceType !== 'pawn' || p.color !== 'white') return false;
    if (!tpl.spawnedPawns.ranks.includes(rankOf(toIndex(sq)) + 1)) return false;
    if (!within(p.rarity) || p.promotesTo === undefined || !within(p.promotesTo.rarity)) return false;
  }
  const [lo, hi] = tpl.spawnedPawns.count;
  return count >= lo && count <= hi + extraPawns;
}

/** Empty squares of the deployment ranks, in index order. */
function emptyDeploymentSquares(b: Int8Array, config: GenConfig): number[] {
  const out: number[] = [];
  for (let s = 0; s < 64; s++) {
    if (b[s] === 0 && config.rules.deploymentRanks.includes(rankOf(s) + 1)) out.push(s);
  }
  return out;
}

/** The summonable deck pieces of one type and tier, tried once for all its instances (ids sorted). */
type Group = { code: number; tier: number; ids: string[]; cost: number; bonus: boolean };

/**
 * The deck pieces that can be summoned (in deck, durability ≥ 1, not the King), grouped by type and
 * tier, sorted by (type, tier, instanceId) whatever the deck's array order.
 */
function deckGroups(run: RunState, config: GenConfig): Group[] {
  const pieces = run.deck
    .filter((p) => p.pieceType !== 'king' && p.status === 'in_deck' && (p.durability ?? 0) >= 1)
    .map((p) => {
      const rarity: Rarity = p.rarity ?? 'normal';
      return { id: p.instanceId, type: p.pieceType as DeckType, rarity, tier: Math.max(0, TIERS.indexOf(rarity)) };
    })
    .sort((a, b) => byText(a.type, b.type) || a.tier - b.tier || byText(a.id, b.id));
  const groups: (Group & { type: DeckType })[] = [];
  for (const p of pieces) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.type === p.type && last.tier === p.tier) {
      last.ids.push(p.id);
      continue;
    }
    groups.push({
      type: p.type,
      code: CODE[p.type],
      tier: p.tier,
      ids: [p.id],
      cost: spawnCostOf(p.type, p.rarity, config),
      bonus: config.abilities[p.type][p.tier as 0 | 1 | 2 | 3].bonusSelfMove,
    });
  }
  return groups;
}

type Tiers = { t: Int8Array; table: AbilityTable };

/**
 * `no_first_turn_mate`'s search (docs/04 §4): each deck piece alone, then each pair whose spawn
 * costs fit the stage's spawn points, on every empty deployment square, without the King (the
 * approximation). Returns the first mate found, or null when there is none.
 *
 * A placed piece's moves are its ability targets (`abilityTargetsInto`: pseudo-legal, so they need
 * no White King; for a tiered piece they add ally leaps, extra leaps and steps, and multi-captures),
 * and a piece with a bonus move (the Legendary knight) also tries each second move. A position is
 * tested for mate only when Black is in check, with White's tiers (`abilityAttacked`).
 *
 * Check first, cheaply: after a move, only the mover can give check unless another White piece
 * could attack the king from where it stands. So when no other piece's square is in its reach
 * (`reachOf`), a move is made and tested only if it lands in the mover's reach. This skips only
 * moves after which Black cannot be in check, and `kingCanMove` settles only positions that
 * `legalMoves` would also find not mated: the result is the same as testing every move in full.
 */
export function firstTurnMate(run: RunState, stage: StageState, config: GenConfig): FirstTurnMate | null {
  const b = fromBoard(stage.board);
  const k = b.indexOf(-KING); // the king `inCheck` reads
  if (k < 0) return null;
  const table = config.abilities;
  const tiers: Tiers = { t: tiersOf(stage.board), table };
  const t = tiers.t;
  let staticReach = false; // a White piece of the generated board (a spawned pawn) could give check
  for (let s = 0; s < 64; s++) if (b[s]! > 0 && attacksAlone(b[s]!, t[s]!, s, k, table)) staticReach = true;
  const squares = emptyDeploymentSquares(b, config);
  const groups = deckGroups(run, config).filter((g) => g.cost <= stage.spawnPoints);
  const reach = groups.map((g) => reachOf(g.code, g.tier, k, table));
  const found = (placed: [string, number][], from: number, line: number[]): FirstTurnMate => ({
    placements: placed.map(([instanceId, s]) => ({ instanceId, to: toSquare(s) })),
    moves: line.map((to, i) => ({ from: toSquare(i === 0 ? from : line[i - 1]!), to: toSquare(to) })),
  });

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    for (const s of squares) {
      b[s] = g.code;
      t[s] = g.tier;
      const line = mateBy(b, tiers, s, g.bonus, staticReach ? null : reach[i]!, 0);
      if (line) return found([[g.ids[0]!, s]], s, line);
      b[s] = 0;
      t[s] = 0;
    }
  }

  for (let i = 0; i < groups.length; i++) {
    for (let j = i; j < groups.length; j++) {
      const gi = groups[i]!;
      const gj = groups[j]!;
      if (i === j && gi.ids.length < 2) continue;
      if (gi.cost + gj.cost > stage.spawnPoints) continue;
      const second = i === j ? gi.ids[1]! : gj.ids[0]!;
      const ri = reach[i]!;
      const rj = reach[j]!;
      for (let x = 0; x < squares.length; x++) {
        const s1 = squares[x]!;
        b[s1] = gi.code;
        t[s1] = gi.tier;
        // Two identical pieces give the same board either way round: each square pair once.
        for (let y = i === j ? x + 1 : 0; y < squares.length; y++) {
          const s2 = squares[y]!;
          if (s2 === s1) continue;
          b[s2] = gj.code;
          t[s2] = gj.tier;
          const first = mateBy(b, tiers, s1, gi.bonus, staticReach || rj[s2] === 1 ? null : ri, 0);
          if (first) return found([[gi.ids[0]!, s1], [second, s2]], s1, first);
          const other = mateBy(b, tiers, s2, gj.bonus, staticReach || ri[s1] === 1 ? null : rj, 0);
          if (other) return found([[gi.ids[0]!, s1], [second, s2]], s2, other);
          b[s2] = 0;
          t[s2] = 0;
        }
        b[s1] = 0;
        t[s1] = 0;
      }
    }
  }
  return null;
}

const EMPTY_B = new Int8Array(64);
const EMPTY_T = new Int8Array(64);

/** Whether a White piece of `code` and `tier` on `s` attacks a black king on `k` on an otherwise empty board. */
function attacksAlone(code: number, tier: number, s: number, k: number, table: AbilityTable): boolean {
  EMPTY_B[k] = -KING;
  EMPTY_B[s] = code;
  EMPTY_T[s] = tier;
  const hit = abilityAttacked(EMPTY_B, EMPTY_T, k, table);
  EMPTY_B[k] = 0;
  EMPTY_B[s] = 0;
  EMPTY_T[s] = 0;
  return hit;
}

/**
 * reach[s] = 1 where the piece would attack the king on `k` with the board otherwise empty. Other
 * pieces only take attacks away (an ally leap passes allies along a line it already has), so on
 * any board the piece attacks `k` only from a square of its reach.
 */
function reachOf(code: number, tier: number, k: number, table: AbilityTable): Uint8Array {
  const out = new Uint8Array(64);
  for (let s = 0; s < 64; s++) if (s !== k && attacksAlone(code, tier, s, k, table)) out[s] = 1;
  return out;
}

const KING_TO = new Int8Array(8);

/**
 * Whether the black king has a legal move, judged as `legalMoves` judges it (`safeMove` after
 * `analyse`). Most checks are escaped by the king, so this cheap subset of `legalMoves(black)`
 * settles "not mate" first; `legalMoves` runs only when it finds nothing.
 */
function kingCanMove(b: Int8Array, tiers: Tiers): boolean {
  const sf = newSafety(tiers);
  analyse(b, -1, sf);
  const k = sf.king;
  if (k < 0) return false;
  const n = targetsInto(b, k, KING_TO);
  for (let i = 0; i < n; i++) if (safeMove(b, sf, -1, k, KING_TO[i]!)) return true;
  return false;
}

const blankMove = (): Move => ({ from: 0, to: 0, captured: 0, promotion: null, via: -1, viaCaptured: 0 });
// One buffer set per depth: depth 1 is a bonus move, tried while depth 0's loop is still running.
const TO = [new Int8Array(80), new Int8Array(80)];
const VIA = [new Int8Array(80), new Int8Array(80)];
const MOVE = [blankMove(), blankMove()];

/**
 * The destinations of a mating move by the piece on `from` (its first such move in target order),
 * with its bonus move when `bonus`: `[to]` or `[to, bonusTo]`; null when none mates. With `reach`,
 * a position is tested only when the mover ends in it (see `firstTurnMate`). Restores `b` and
 * `tiers.t`.
 */
function mateBy(
  b: Int8Array, tiers: Tiers, from: number, bonus: boolean, reach: Uint8Array | null, depth: 0 | 1,
): number[] | null {
  const to = TO[depth]!;
  const via = VIA[depth]!;
  const m = MOVE[depth]!;
  const n = abilityTargetsInto(b, tiers.t, from, tiers.table, to, via);
  for (let i = 0; i < n; i++) {
    const test = reach === null || reach[to[i]!] === 1;
    if (!test && !bonus) continue;
    m.from = from;
    m.to = to[i]!;
    m.via = via[i]!;
    m.captured = b[m.to]!;
    m.viaCaptured = m.via >= 0 ? b[m.via]! : 0;
    const saved = makeMoveTiered(b, tiers.t, m);
    let line: number[] | null = null;
    const mate = test && inCheck(b, 'black', tiers)
      && !kingCanMove(b, tiers) && legalMoves(b, 'black', undefined, tiers).length === 0;
    if (mate) {
      line = [m.to];
    } else if (bonus) {
      const rest = mateBy(b, tiers, m.to, false, reach, 1);
      if (rest) line = [m.to, ...rest];
    }
    unmakeMoveTiered(b, tiers.t, m, saved);
    if (line) return line;
  }
  return null;
}
