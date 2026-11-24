import {
  TIERS, legalPlayerMoves, promotionChoices, simulate, spawnCostOf, startStage, toIndex,
} from '@checkbreaker/engine';
import type { Action, EngineConfig, PieceInstance, RunState, Square, StageState } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';
import type { RunResult, RunSession } from './types';
import { mergePieces } from './deck';
import { sellPrice } from './prices';
import { buy, leave, merge, repair, reroll, sell } from './session';

// The headless bot's decisions (spec section 9.2). The bot is a test driver, not an AI player: every choice
// is a fixed, deterministic rule, so a run is reproducible from its seed. Generation and I/O live in
// scripts/run-bot.ts; this module is pure, like the rest of the run layer.

export type ShopMove =
  | { kind: 'merge'; ids: string[] }
  | { kind: 'repair'; id: string }
  | { kind: 'buy'; slot: number }
  | { kind: 'reroll' }
  | { kind: 'leave' };

export type ChooserMove = { kind: 'merge'; ids: string[] } | { kind: 'sell'; id: string };

/** The placement shape `startStage` takes. */
export type BotPlacement = { instanceId: string; to: Square };

const byId = (a: PieceInstance, b: PieceInstance): number => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0);
const nonKingCount = (run: RunState): number => run.deck.filter(p => p.pieceType !== 'king').length;

/** The act and stage number (0-8) of the stage just cleared: the shop's, or the run's in the chooser. */
function clearedStage(s: RunSession, c: RunConfig): { act: 1 | 2 | 3; stageNumber: number } {
  if (s.shop) return { act: s.shop.act, stageNumber: s.shop.stageNumber };
  const stageNumber = s.run.actIndex * c.run.stagesPerAct + s.run.stageIndex;
  return { act: (Math.floor(stageNumber / c.run.stagesPerAct) + 1) as 1 | 2 | 3, stageNumber };
}

/**
 * The first triple the run layer would merge, none of it protected: groups of the same type and rarity in a
 * fixed order (deck types, then tiers), the three lowest-durability members of a group (ties by instanceId).
 */
function findMerge(s: RunSession, protectedIds: ReadonlySet<string>, c: RunConfig): string[] | null {
  const { act, stageNumber } = clearedStage(s, c);
  const n = c.run.merge.inputs;
  const pool = s.run.deck.filter(p =>
    p.pieceType !== 'king' && p.status === 'in_deck' && (p.durability ?? 0) >= 1 && !protectedIds.has(p.instanceId));
  for (const type of ['knight', 'bishop', 'rook', 'queen'] as const) {
    for (const tier of TIERS) {
      const group = pool
        .filter(p => p.pieceType === type && p.rarity === tier)
        .sort((a, b) => (a.durability ?? 0) - (b.durability ?? 0) || byId(a, b));
      if (group.length < n) continue;
      const ids = group.slice(0, n).map(p => p.instanceId);
      if (mergePieces(s.run, ids, act, stageNumber, c).ok) return ids;
    }
  }
  return null;
}

/** The repairable piece with the lowest durability / max (ties by instanceId), or null. */
function mostDamaged(run: RunState): PieceInstance | null {
  const hurt = run.deck.filter(p =>
    p.pieceType !== 'king' && p.status === 'in_deck' && p.durability !== null && p.durabilityMax !== null
    && p.durability < p.durabilityMax);
  // a/b < c/d  <=>  a*d < c*b for positive maxima: no floating point in the order
  hurt.sort((a, b) => a.durability! * b.durabilityMax! - b.durability! * a.durabilityMax! || byId(a, b));
  return hurt[0] ?? null;
}

/**
 * The bot's next shop move, in the fixed order of spec section 9.2: merge any valid triple (never a protected
 * piece); repair the most damaged piece while coins cover a repair; buy the cheapest affordable piece if the
 * deck has room; buy the cheapest affordable skill if a loadout slot is free; one free reroll when no offer is
 * affordable; else leave. Ties between offers go to the lower slot. The bot never sells or cuts in the shop.
 */
export function chooseShopAction(s: RunSession, protectedIds: ReadonlySet<string>, c: RunConfig): ShopMove {
  const shop = s.shop;
  if (s.phase !== 'shop' || !shop) return { kind: 'leave' };
  const ids = findMerge(s, protectedIds, c);
  if (ids) return { kind: 'merge', ids };

  const coins = s.run.coins;
  const damaged = mostDamaged(s.run);
  if (damaged && coins >= c.run.services.repair) return { kind: 'repair', id: damaged.instanceId };

  const affordable = shop.slots
    .map((offer, k) => ({ offer, slot: k + 1 }))
    .filter(({ offer }) => !offer.sold && offer.price <= coins)
    .sort((a, b) => a.offer.price - b.offer.price || a.slot - b.slot);
  const piece = affordable.find(({ offer }) => offer.kind === 'piece');
  if (piece && nonKingCount(s.run) < c.deck.capacity) return { kind: 'buy', slot: piece.slot };
  const skill = affordable.find(({ offer }) => offer.kind === 'skill');
  if (skill && s.run.loadout.length < c.run.loadoutSlots) return { kind: 'buy', slot: skill.slot };

  const free = c.run.services;
  if (affordable.length === 0 && shop.rerollsUsed === 0 && free.freeRerollsPerVisit > 0 && free.maxRerollsPerVisit > 0) {
    return { kind: 'reroll' };
  }
  return { kind: 'leave' };
}

/**
 * The bot's next chooser move: merge a valid triple if one exists (never a protected piece), else sell the
 * sellable piece with the lowest sale price (ties by instanceId), a protected one only when nothing else can go.
 */
export function chooseChooserAction(s: RunSession, protectedIds: ReadonlySet<string>, c: RunConfig): ChooserMove {
  const ids = findMerge(s, protectedIds, c);
  if (ids) return { kind: 'merge', ids };
  const { act } = clearedStage(s, c);
  const sellable = s.run.deck
    .filter(p => p.pieceType !== 'king' && p.status === 'in_deck')
    .sort((a, b) => sellPrice(a, act, c) - sellPrice(b, act, c) || byId(a, b));
  const pick = sellable.find(p => !protectedIds.has(p.instanceId)) ?? sellable[0];
  if (!pick) throw new Error('chooser: no piece to merge or sell');
  return { kind: 'sell', id: pick.instanceId };
}

/** Plays a shop move through the run layer. */
export function applyShopMove(s: RunSession, m: ShopMove, c: RunConfig): RunResult {
  switch (m.kind) {
    case 'merge': return merge(s, m.ids, c);
    case 'repair': return repair(s, m.id, c);
    case 'buy': return buy(s, m.slot, {}, c);
    case 'reroll': return reroll(s, c);
    case 'leave': return leave(s, c);
  }
}

/** Plays a chooser move through the run layer. */
export function applyChooserMove(s: RunSession, m: ChooserMove, c: RunConfig): RunResult {
  return m.kind === 'merge' ? merge(s, m.ids, c) : sell(s, m.id, c);
}

/**
 * The fallback turn for a stage without a usable solution: a single MOVE that mates if `simulate` finds one,
 * else the first single MOVE the engine accepts, pieces by square index and targets by square index
 * (`legalPlayerMoves` lists targets without the end-of-queue check rule, so each candidate is simulated).
 * A pawn reaching rank 8 promotes to a queen. Empty when no single MOVE is accepted.
 */
export function fallbackQueue(run: RunState, stage: StageState, c: EngineConfig): Action[] {
  const froms = Object.keys(stage.board)
    .filter(sq => stage.board[sq]!.color === 'white')
    .sort((a, b) => toIndex(a) - toIndex(b));
  let first: Action[] | null = null;
  for (const from of froms) {
    const targets = legalPlayerMoves(stage, from, c).sort((a, b) => toIndex(a) - toIndex(b));
    for (const to of targets) {
      const promotes = stage.board[from]!.pieceType === 'pawn' && to.endsWith('8')
        && promotionChoices(stage, from, to, c) !== null;
      const queue: Action[] = [!promotes
        ? { type: 'MOVE', from, to }
        : { type: 'MOVE', from, to, promotion: 'queen' }];
      const r = simulate(run, stage, queue, c);
      if (!r.ok) continue;
      if (r.value.stage.status === 'won') return queue;
      first ??= queue;
    }
  }
  return first ?? [];
}

/** Deployment squares in the bot's order: rank by rank from the back (ranks 1-2 first), files e d f c g b h a. */
function deploymentOrder(c: EngineConfig): Square[] {
  const files = 'edfcgbha';
  const ranks = [...c.rules.deploymentRanks].sort((a, b) => a - b);
  return ranks.flatMap(r => [...files].map(f => `${f}${r}`));
}

/**
 * The fallback Deployment: the King on the first empty square of the deployment order whose placement
 * `startStage` accepts (it is not in check), then the cheapest summons (spawn cost, ties by instanceId) that
 * still fit `stage.spawnPoints`, each on the next free square. Pieces below 1 durability are not summoned.
 * Empty when the deck has no King or no square is safe for it.
 */
export function fallbackPlacements(run: RunState, stage: StageState, c: EngineConfig): BotPlacement[] {
  const king = run.deck.find(p => p.pieceType === 'king' && p.status === 'in_deck');
  if (!king) return [];
  const free = deploymentOrder(c).filter(sq => !stage.board[sq]);
  const kingSq = free.find(to => startStage(run, stage, [{ instanceId: king.instanceId, to }], c).ok);
  if (kingSq === undefined) return [];
  const placements: BotPlacement[] = [{ instanceId: king.instanceId, to: kingSq }];
  const squares = free.filter(sq => sq !== kingSq);

  const cost = (p: PieceInstance): number => spawnCostOf(p.pieceType, p.rarity ?? 'normal', c);
  const summons = run.deck
    .filter(p => p.pieceType !== 'king' && p.status === 'in_deck' && (p.durability ?? 0) >= 1)
    .sort((a, b) => cost(a) - cost(b) || byId(a, b));
  let budget = stage.spawnPoints;
  for (const p of summons) {
    const to = squares[placements.length - 1];
    if (to === undefined) break;
    if (cost(p) > budget) continue;
    budget -= cost(p);
    placements.push({ instanceId: p.instanceId, to });
  }
  return placements;
}
