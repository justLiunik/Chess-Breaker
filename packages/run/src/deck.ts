import { TIERS, durabilityMaxOf, hash } from '@checkbreaker/engine';
import type { PieceInstance, Result, RunState } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';
import type { RunError } from './types';
import { sellPrice } from './prices';

const ok = <T>(value: T): Result<T, RunError> => ({ ok: true, value });
const fail = (error: RunError): Result<never, RunError> => ({ ok: false, error });
const without = (run: RunState, ids: string[]): PieceInstance[] => run.deck.filter(p => !ids.includes(p.instanceId));

export function mergePieces(
  run: RunState, ids: string[], act: 1 | 2 | 3, stageNumber: number, c: RunConfig,
): Result<{ run: RunState; resultId: string }, RunError> {
  const bad = (reason: Extract<RunError, { kind: 'merge_invalid' }>['reason']) => fail({ kind: 'merge_invalid', reason });
  if (ids.length !== c.run.merge.inputs || new Set(ids).size !== ids.length) return bad('count');
  const pieces: PieceInstance[] = [];
  for (const id of ids) {
    const p = run.deck.find(d => d.instanceId === id);
    if (!p || (p.status !== 'in_deck' && p.status !== 'spent')) return bad('not_in_deck');
    pieces.push(p);
  }
  if (pieces.some(p => p.pieceType === 'king')) return bad('king');
  if (pieces.some(p => p.status !== 'in_deck' || (p.durability ?? 0) < 1)) return bad('durability');
  const first = pieces[0]!;
  if (pieces.some(p => p.pieceType !== first.pieceType || p.rarity !== first.rarity)) return bad('mismatch');
  const tier = TIERS.indexOf(first.rarity!);
  if (tier > TIERS.indexOf(c.run.merge.maxInputTier)) return bad('legendary');
  const ceiling = TIERS.indexOf(c.run.rarityPool[`act${act}` as 'act1' | 'act2' | 'act3'].ceiling);
  if (tier + 1 > ceiling) return bad('ceiling');
  const rarity = TIERS[tier + 1]!;
  const resultId = 'p_' + hash(run.seed, 'merge', ...[...ids].sort()).toString(16);
  const durabilityMax = durabilityMaxOf(first.pieceType as Exclude<PieceInstance['pieceType'], 'king'>, rarity, c);
  const made: PieceInstance = {
    instanceId: resultId, pieceType: first.pieceType, rarity, durability: durabilityMax, durabilityMax,
    origin: 'merge', acquiredAtStage: stageNumber, status: 'in_deck',
  };
  return ok({ run: { ...run, deck: [...without(run, ids), made] }, resultId });
}

export function sellPiece(run: RunState, id: string, act: 1 | 2 | 3, c: RunConfig): Result<{ run: RunState; coins: number }, RunError> {
  const p = run.deck.find(d => d.instanceId === id);
  if (!p || (p.status !== 'in_deck' && p.status !== 'spent')) return fail({ kind: 'cannot_sell', instanceId: id, reason: 'not_in_deck' });
  if (p.pieceType === 'king') return fail({ kind: 'cannot_sell', instanceId: id, reason: 'king' });
  if (p.status === 'spent') return fail({ kind: 'cannot_sell', instanceId: id, reason: 'spent' });
  const coins = sellPrice(p, act, c);
  return ok({ run: { ...run, coins: run.coins + coins, deck: without(run, [id]) }, coins });
}

export function cutPiece(run: RunState, id: string): Result<{ run: RunState }, RunError> {
  const p = run.deck.find(d => d.instanceId === id);
  if (!p || (p.status !== 'in_deck' && p.status !== 'spent')) return fail({ kind: 'cannot_cut', instanceId: id, reason: 'not_in_deck' });
  if (p.pieceType === 'king') return fail({ kind: 'cannot_cut', instanceId: id, reason: 'king' });
  return ok({ run: { ...run, deck: without(run, [id]) } });
}

export function repairPiece(run: RunState, id: string, c: RunConfig): Result<{ run: RunState; durability: number }, RunError> {
  const p = run.deck.find(d => d.instanceId === id);
  if (!p || (p.status !== 'in_deck' && p.status !== 'spent')) return fail({ kind: 'cannot_repair', instanceId: id, reason: 'not_in_deck' });
  if (p.pieceType === 'king') return fail({ kind: 'cannot_repair', instanceId: id, reason: 'king' });
  if (p.status === 'spent') return fail({ kind: 'cannot_repair', instanceId: id, reason: 'spent' });
  const max = p.durabilityMax ?? 0;
  if ((p.durability ?? 0) >= max) return fail({ kind: 'not_damaged', instanceId: id });
  const price = c.run.services.repair;
  if (run.coins < price) return fail({ kind: 'insufficient_coins', price, coins: run.coins });
  const durability = (p.durability ?? 0) + 1;
  return ok({
    run: { ...run, coins: run.coins - price, deck: run.deck.map(d => (d.instanceId === id ? { ...d, durability } : d)) },
    durability,
  });
}
