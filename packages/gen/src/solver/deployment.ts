import * as internal from '@checkbreaker/engine/internal';
import { fileOf, rankOf, spawnCostOf, startStage, toSquare } from '@checkbreaker/engine';
import type { DeckType, PieceInstance, Rarity, RunState, StageState } from '@checkbreaker/engine';
import type { GenConfig } from '@checkbreaker/content';
import type { Placement } from '../types';

const { BISHOP, KING, KNIGHT, QUEEN, ROOK, TIERS, abilityTargetsInto, fromBoard, isAttacked, tiersOf } = internal;

const CODE: Record<DeckType, number> = { knight: KNIGHT, bishop: BISHOP, rook: ROOK, queen: QUEEN };
/** The files King squares are taken from, in this order (the centre first, so the choices spread out). */
const KING_FILES = [4, 3, 5, 2, 6, 1, 7, 0];

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The deck pieces of one type and tier, interchangeable, ids sorted. */
type Group = { type: DeckType; tier: number; ids: string[]; cost: number; value: number };
type Subset = { counts: number[]; value: number; text: string };

/**
 * §9.2: a bounded, ranked set of deployments for the solver to try, best first. Every candidate
 * places the King, and every one passes `startStage`. The summons are the maximal type-and-tier
 * subsets that fit the spawn points (the highest total piece value first); the King goes on one of
 * the safe squares (none safe gives `[]`); each summon goes on one of its top-scored squares.
 */
export function deploymentCandidates(run: RunState, stage: StageState, config: GenConfig): Placement[][] {
  const opts = config.gen.solver.deployment;
  const king = run.deck
    .filter((p) => p.pieceType === 'king' && p.status === 'in_deck')
    .sort((a, b) => byText(a.instanceId, b.instanceId))[0];
  if (king === undefined) return [];

  const groups = deckGroups(run, stage, config);
  const subsets = maximalSubsets(groups, stage.spawnPoints).slice(0, opts.maxSubsets);

  const b = fromBoard(stage.board);
  const t = tiersOf(stage.board);
  const kingSquares = safeKingSquares(b, config).slice(0, opts.kingSquares);
  const ranked = groups.map((g) => rankedSquares(b, t, g, config).slice(0, opts.squaresPerPiece));

  // Per (subset, King square) pair: the greedy assignment first, then its single-piece variants.
  const lists: Placement[][][] = [];
  for (const sub of subsets) {
    const pieces: { id: string; group: number }[] = [];
    sub.counts.forEach((n, g) => groups[g]!.ids.slice(0, n).forEach((id) => pieces.push({ id, group: g })));
    for (const ks of kingSquares) lists.push(assignments(king, ks, pieces, ranked));
  }

  // Interleaved round-robin over the pairs; a candidate counts only if `startStage` accepts it.
  const out: Placement[][] = [];
  const seen = new Set<string>();
  const kind = new Map(run.deck.map((p) => [p.instanceId, `${p.pieceType}${p.rarity ?? 'normal'}`]));
  for (let round = 0; out.length < opts.maxCandidates; round++) {
    let any = false;
    for (const list of lists) {
      const cand = list[round];
      if (cand === undefined) continue;
      any = true;
      if (out.length >= opts.maxCandidates) break;
      // The same pieces on the same squares are one candidate, whichever identical instances carry them.
      const key = cand.map((p) => `${kind.get(p.instanceId)}@${p.to}`).sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      if (startStage(run, stage, cand, config).ok) out.push(cand);
    }
    if (!any) break;
  }
  return out;
}

/** Summonable deck pieces (in deck, durability ≥ 1, affordable alone) grouped by type and tier, sorted by (type, tier, instanceId). */
function deckGroups(run: RunState, stage: StageState, config: GenConfig): Group[] {
  const pieces = run.deck
    .filter((p) => p.pieceType !== 'king' && p.status === 'in_deck' && (p.durability ?? 0) >= 1)
    .map((p: PieceInstance) => {
      const rarity: Rarity = p.rarity ?? 'normal';
      return { id: p.instanceId, type: p.pieceType as DeckType, rarity, tier: Math.max(0, TIERS.indexOf(rarity)) };
    })
    .sort((a, b) => byText(a.type, b.type) || a.tier - b.tier || byText(a.id, b.id));
  const groups: Group[] = [];
  for (const p of pieces) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.type === p.type && last.tier === p.tier) {
      last.ids.push(p.id);
      continue;
    }
    groups.push({
      type: p.type, tier: p.tier, ids: [p.id],
      cost: spawnCostOf(p.type, p.rarity, config), value: config.pieceValues[p.type],
    });
  }
  return groups.filter((g) => g.cost <= stage.spawnPoints);
}

/** Every maximal multiset of groups within `budget` (no unused piece still fits), best total value first, then text. */
function maximalSubsets(groups: Group[], budget: number): Subset[] {
  const out: Subset[] = [];
  const counts: number[] = [];
  const walk = (g: number, left: number, value: number): void => {
    if (g === groups.length) {
      if (groups.some((x, i) => counts[i]! < x.ids.length && x.cost <= left)) return;
      const text = groups.map((x, i) => `${x.type}${x.tier}x${counts[i]}`).join(',');
      out.push({ counts: [...counts], value, text });
      return;
    }
    const grp = groups[g]!;
    for (let n = 0; n <= grp.ids.length && n * grp.cost <= left; n++) {
      counts[g] = n;
      walk(g + 1, left - n * grp.cost, value + n * grp.value);
    }
    counts.length = g;
  };
  walk(0, budget, 0);
  return out.sort((a, b) => b.value - a.value || byText(a.text, b.text));
}

/**
 * Up to `kingSquares` safe squares, one per file in `KING_FILES` order, skipping files with none.
 * The k-th chosen square prefers rank `deploymentRanks[k % 2]` (ranks 1 and 2 alternately) and falls
 * back to the file's lowest safe rank. Safe means empty and not attacked by Black (an open line to a
 * Black rook, bishop or queen is an attack on the square).
 */
function safeKingSquares(b: Int8Array, config: GenConfig): number[] {
  const ranks = config.rules.deploymentRanks;
  const out: number[] = [];
  for (const f of KING_FILES) {
    if (out.length >= config.gen.solver.deployment.kingSquares) break;
    const safe = ranks.filter((r) => b[f + 8 * (r - 1)] === 0 && !isAttacked(b, f + 8 * (r - 1), 'black'));
    if (safe.length === 0) continue;
    const want = ranks[out.length % 2]!;
    out.push(f + 8 * ((safe.includes(want) ? want : Math.min(...safe)) - 1));
  }
  return out;
}

const TO = new Int8Array(80);
const VIA = new Int8Array(80);

/**
 * The empty deployment squares for a piece of the group, best first. Score = kingZone × (squares around the
 * Black king it attacks) + advance × (moves into advanceRanks) − attacked × (attacked by Black), the piece alone on the
 * generated board; ties by square name.
 */
function rankedSquares(b: Int8Array, t: Int8Array, g: Group, config: GenConfig): number[] {
  const k = b.indexOf(-KING);
  const near = new Set<number>();
  if (k >= 0) {
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        const f = fileOf(k) + df;
        const r = rankOf(k) + dr;
        if ((df !== 0 || dr !== 0) && f >= 0 && f < 8 && r >= 0 && r < 8) near.add(f + 8 * r);
      }
    }
  }
  const advance = new Set(config.gen.solver.deployment.advanceRanks);
  const w = config.gen.solver.deployment.score;
  const scored: { s: number; name: string; score: number }[] = [];
  for (let s = 0; s < 64; s++) {
    if (b[s] !== 0 || !config.rules.deploymentRanks.includes(rankOf(s) + 1)) continue;
    b[s] = CODE[g.type];
    t[s] = g.tier;
    const n = abilityTargetsInto(b, t, s, config.abilities, TO, VIA);
    let attacks = 0;
    let forward = 0;
    for (let i = 0; i < n; i++) {
      if (near.has(TO[i]!)) attacks++;
      if (advance.has(rankOf(TO[i]!) + 1)) forward++;
    }
    const score = w.kingZone * attacks + w.advance * forward - (isAttacked(b, s, 'black') ? w.attacked : 0);
    b[s] = 0;
    t[s] = 0;
    scored.push({ s, name: toSquare(s), score });
  }
  scored.sort((a, c) => c.score - a.score || byText(a.name, c.name));
  return scored.map((x) => x.s);
}

/** The greedy assignment, then each single-piece variant (one piece on its next free square). */
function assignments(
  king: PieceInstance, kingSq: number, pieces: { id: string; group: number }[], ranked: number[][],
): Placement[][] {
  const build = (squares: number[]): Placement[] => [
    { instanceId: king.instanceId, to: toSquare(kingSq) },
    ...pieces.map((p, i) => ({ instanceId: p.id, to: toSquare(squares[i]!) })),
  ];
  const free = (taken: Set<number>, list: number[], after: number): number | undefined =>
    list.find((s, i) => i > after && !taken.has(s));

  const greedy: number[] = [];
  const taken = new Set<number>([kingSq]);
  for (const p of pieces) {
    const s = free(taken, ranked[p.group]!, -1);
    if (s === undefined) return [];
    greedy.push(s);
    taken.add(s);
  }
  const out = [build(greedy)];
  for (let i = 0; i < pieces.length; i++) {
    const list = ranked[pieces[i]!.group]!;
    const others = new Set<number>([kingSq, ...greedy.filter((_, j) => j !== i)]);
    const next = free(others, list, list.indexOf(greedy[i]!));
    if (next === undefined) continue;
    out.push(build(greedy.map((s, j) => (j === i ? next : s))));
  }
  return out;
}
