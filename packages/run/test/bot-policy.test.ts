import { describe, expect, it } from 'vitest';
import { TIERS, commitQueue, simulate, spawnCostOf, startStage } from '@checkbreaker/engine';
import type { Action, PieceInstance, PromotionType, RunState, StageState } from '@checkbreaker/engine';
import {
  applyChooserMove, applyShopMove, chooseChooserAction, chooseShopAction, fallbackPlacements, fallbackQueue,
} from '../src/bot-policy';
import { commit, expectedSeed, newRun, provideStage, requestFor, start } from '../src/session';
import { sellPrice } from '../src/prices';
import type { Offer, RunResult, RunSession, ShopState } from '../src/types';
import {
  ROOK_ID, doublePromotionStage, losingStage, mateInOneStage, promotionOverflowStage, runConfig as c, runWithRook,
  starterRun,
} from './fixtures';

const SEED = '7F3A-2210';
const NONE: ReadonlySet<string> = new Set();
const KING = starterRun().deck[0]!;
const KING_ROOK = [{ instanceId: 'p_king_01', to: 'd1' }, { instanceId: ROOK_ID, to: 'e1' }];
const MVP_SKILL = Object.keys(c.skills).find(id => c.skills[id]!.status === 'mvp')!;

const piece = (id: string, pieceType: PieceInstance['pieceType'], over: Partial<PieceInstance> = {}): PieceInstance => ({
  instanceId: id, pieceType, rarity: 'normal', durability: 2, durabilityMax: 2,
  origin: 'starter', acquiredAtStage: 0, status: 'in_deck', ...over,
});
const pieceOffer = (pieceType: 'knight' | 'bishop' | 'rook' | 'queen', price: number): Offer =>
  ({ kind: 'piece', pieceType, rarity: 'normal', price });
const skillOffer = (price: number): Offer => ({ kind: 'skill', skillId: MVP_SKILL, price });
const fill = (n: number, prefix = 'p_fill'): PieceInstance[] =>
  Array.from({ length: n }, (_, i) => piece(`${prefix}_${String(i).padStart(2, '0')}`, i % 2 ? 'bishop' : 'knight'));
/** `n` pieces with no three of the same type and rarity (two of each type per tier), so no merge applies. */
const distinct = (n: number): PieceInstance[] => Array.from({ length: n }, (_, i) =>
  piece(`p_dst_${String(i).padStart(2, '0')}`, (['knight', 'bishop', 'rook', 'queen'] as const)[i % 4]!, { rarity: TIERS[Math.floor(i / 8)]! }));

/** A shop visit after stage 1 (Act I) with `deck` (the King added), `coins` and the given stock. */
function shopSession(
  deck: PieceInstance[], coins: number, offers: Offer[],
  over: { shop?: Partial<ShopState>; loadout?: RunState['loadout'] } = {},
): RunSession {
  const run: RunState = { ...starterRun(SEED), stageIndex: 1, coins, deck: [KING, ...deck], loadout: over.loadout ?? [] };
  const shop: ShopState = {
    act: 1, stageNumber: 1, roll: 0, rerollsUsed: 0, recovery: false, slots: offers.map(o => ({ ...o, sold: false })), ...over.shop,
  };
  return {
    version: 1, run, phase: 'shop', stage: null, entryStage: null, tally: null, chooser: null, shop,
    next: { request: requestFor(run, 2, c), stage: null }, outcome: null,
  };
}

/** The chooser after stage 1 (Act I) with `deck` (the King added). */
function chooserSession(deck: PieceInstance[]): RunSession {
  const run: RunState = { ...starterRun(SEED), stageIndex: 1, deck: [KING, ...deck] };
  return {
    version: 1, run, phase: 'chooser', stage: null, entryStage: null, tally: null, chooser: { overCapacity: deck.length - c.deck.capacity },
    shop: null, next: null, outcome: null,
  };
}

const ok = (r: RunResult): RunSession => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value.session;
};
const engineOk = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

/** Provides `make(seed)` for the session's pending request and deploys King d1 + rook e1. */
function deployed(s: RunSession, make: (seed: string) => StageState = mateInOneStage): RunSession {
  const seed = expectedSeed(s.run.seed, s.next!.request.actIndex, s.next!.request.stageIndex);
  return ok(start(ok(provideStage(s, make(seed), c)), KING_ROOK, c));
}
const rookRun = (extra: PieceInstance[] = []): RunSession => {
  const s = newRun(SEED, c);
  return { ...s, run: { ...runWithRook(s.run), deck: [...runWithRook(s.run).deck, ...extra] } };
};
const mv = (from: string, to: string, promotion?: PromotionType): Action[] =>
  [{ type: 'MOVE', from, to, ...(promotion !== undefined && { promotion }) }];

describe('chooseShopAction', () => {
  it('merges a valid triple before buying', () => {
    const s = shopSession([piece('p_k1', 'knight'), piece('p_k2', 'knight'), piece('p_k3', 'knight'), piece('p_b1', 'bishop')], 100,
      [pieceOffer('knight', 8), pieceOffer('bishop', 8), skillOffer(3), pieceOffer('rook', 10)]);
    expect(chooseShopAction(s, NONE, c)).toEqual({ kind: 'merge', ids: ['p_k1', 'p_k2', 'p_k3'] });
  });

  it('never merges a protected piece', () => {
    const four = [piece('p_k1', 'knight'), piece('p_k2', 'knight'), piece('p_k3', 'knight'), piece('p_k4', 'knight')];
    const s = shopSession(four, 100, [pieceOffer('knight', 8)]);
    expect(chooseShopAction(s, new Set(['p_k2']), c)).toEqual({ kind: 'merge', ids: ['p_k1', 'p_k3', 'p_k4'] });
    // with only three knights and one protected, no merge applies: the policy goes on to buy
    const three = shopSession(four.slice(0, 3), 100, [pieceOffer('knight', 8)]);
    expect(chooseShopAction(three, new Set(['p_k2']), c)).toEqual({ kind: 'buy', slot: 1 });
  });

  it('skips triples the run layer refuses (over the act ceiling, spent, the King)', () => {
    const rare = (id: string) => piece(id, 'knight', { rarity: 'rare' });
    // Act I's ceiling is Rare, so three Rare knights cannot merge to Unique
    const s = shopSession([rare('p_r1'), rare('p_r2'), rare('p_r3')], 0, []);
    expect(chooseShopAction(s, NONE, c).kind).not.toBe('merge');
  });

  it('repairs the most damaged piece (lowest durability / max, ties by instanceId) before buying', () => {
    const deck = [
      piece('p_a', 'knight', { durability: 2, durabilityMax: 3 }),
      piece('p_c', 'bishop', { durability: 1, durabilityMax: 2 }),
      piece('p_b', 'rook', { durability: 1, durabilityMax: 2 }),
      piece('p_d', 'knight'),
    ];
    const s = shopSession(deck, 100, [pieceOffer('knight', 8)]);
    expect(chooseShopAction(s, NONE, c)).toEqual({ kind: 'repair', id: 'p_b' });
    // protected pieces are still repaired: repair never breaks a deployment
    expect(chooseShopAction(s, new Set(['p_b']), c)).toEqual({ kind: 'repair', id: 'p_b' });
  });

  it('repairs only while coins cover the repair', () => {
    const repairCost = c.run.services.repair;
    const deck = [piece('p_b', 'rook', { durability: 1 }), piece('p_d', 'knight')];
    const s = shopSession(deck, repairCost - 1, [pieceOffer('knight', repairCost - 1)]);
    expect(chooseShopAction(s, NONE, c)).toEqual({ kind: 'buy', slot: 1 });
  });

  it('buys the cheapest affordable piece if the deck has room (ties by slot), skipping sold slots', () => {
    const offers = [pieceOffer('knight', 9), pieceOffer('bishop', 7), skillOffer(3), pieceOffer('rook', 7)];
    const s = shopSession(fill(4), 8, offers);
    expect(chooseShopAction(s, NONE, c)).toEqual({ kind: 'buy', slot: 2 });
    const sold = { ...s, shop: { ...s.shop!, slots: s.shop!.slots.map((o, k) => (k === 1 ? { ...o, sold: true } : o)) } };
    expect(chooseShopAction(sold, NONE, c)).toEqual({ kind: 'buy', slot: 4 });
  });

  it('buys the cheapest affordable skill when the deck is full and a loadout slot is free', () => {
    const offers = [pieceOffer('knight', 8), skillOffer(6), skillOffer(4), pieceOffer('rook', 10)];
    const full = shopSession(distinct(c.deck.capacity), 100, offers);
    expect(chooseShopAction(full, NONE, c)).toEqual({ kind: 'buy', slot: 3 });
    const loadout = Array.from({ length: c.run.loadoutSlots }, () => ({ skillId: MVP_SKILL }));
    const noRoom = shopSession(distinct(c.deck.capacity), 100, offers, { loadout });
    // affordable but unusable offers: no reroll, the bot leaves
    expect(chooseShopAction(noRoom, NONE, c)).toEqual({ kind: 'leave' });
  });

  it('rerolls once for free when nothing is affordable, then leaves', () => {
    const offers = [pieceOffer('knight', 8), pieceOffer('bishop', 8), skillOffer(5), pieceOffer('rook', 10)];
    expect(chooseShopAction(shopSession(fill(4), 0, offers), NONE, c)).toEqual({ kind: 'reroll' });
    const after = shopSession(fill(4), 0, offers, { shop: { rerollsUsed: 1, roll: 1 } });
    expect(chooseShopAction(after, NONE, c)).toEqual({ kind: 'leave' });
  });

  it('drives a real shop visit to leave, every move accepted by the run layer', () => {
    const won = ok(commit(deployed(rookRun()), mv('e1', 'e8'), c));
    expect(won.phase).toBe('shop');
    let s = won;
    const moves: string[] = [];
    for (let i = 0; i < 50 && s.phase === 'shop'; i++) {
      const m = chooseShopAction(s, NONE, c);
      moves.push(m.kind);
      s = ok(applyShopMove(s, m, c));
    }
    expect(s.phase).toBe('awaiting_stage');
    expect(moves.at(-1)).toBe('leave');
    expect(moves[0]).toBe('repair'); // the rook came back at 1/2
    expect(s.run.deck.find(p => p.instanceId === ROOK_ID)!.durability).toBe(2);
  });
});

describe('chooseChooserAction', () => {
  // Act I, no triple of the same type and rarity: 2 of each type at Normal plus a Rare knight (9 pieces).
  const mixed = (): PieceInstance[] => [
    piece('p_n1', 'knight'), piece('p_n2', 'knight'), piece('p_b1', 'bishop'), piece('p_b2', 'bishop'),
    piece('p_r1', 'rook'), piece('p_r2', 'rook'), piece('p_q1', 'queen'), piece('p_q2', 'queen'),
    piece('p_x1', 'knight', { rarity: 'rare', origin: 'shop', pricePaid: 1 }),
  ];

  it('merges when a triple exists', () => {
    const deck = [...fill(8), piece('p_z', 'knight')];
    const s = chooserSession(deck);
    const m = chooseChooserAction(s, NONE, c);
    expect(m.kind).toBe('merge');
    const after = ok(applyChooserMove(s, m, c));
    expect(after.phase).toBe('shop');
  });

  it('sells the lowest-priced sellable piece, never a protected one while another is left', () => {
    const s = chooserSession(mixed());
    expect(sellPrice(mixed()[8]!, 1, c)).toBe(1);
    expect(chooseChooserAction(s, NONE, c)).toEqual({ kind: 'sell', id: 'p_x1' });
    // next lowest: the Normal knights and bishops; ties by instanceId
    const prices = mixed().slice(0, 8).map(p => sellPrice(p, 1, c));
    const min = Math.min(...prices);
    const expected = mixed().slice(0, 8).filter(p => sellPrice(p, 1, c) === min).map(p => p.instanceId).sort()[0];
    expect(chooseChooserAction(s, new Set(['p_x1']), c)).toEqual({ kind: 'sell', id: expected });
  });

  it('falls back to a protected piece only when nothing else can go', () => {
    const s = chooserSession(mixed());
    const all = new Set(mixed().map(p => p.instanceId));
    expect(chooseChooserAction(s, all, c)).toEqual({ kind: 'sell', id: 'p_x1' });
  });

  it('clears a real overflow (promotion at a full deck) with accepted moves', () => {
    const extra = [piece('p_fill_01', 'knight'), piece('p_fill_02', 'bishop'), piece('p_fill_03', 'bishop')];
    const t0 = deployed(rookRun(extra), doublePromotionStage);
    const t1 = ok(commit(t0, mv('b7', 'b8', 'knight'), c));
    const t2 = ok(commit(t1, mv('c7', 'c8', 'knight'), c));
    let s = ok(commit(t2, mv('e1', 'e8'), c));
    expect(s.phase).toBe('chooser');
    for (let i = 0; i < 10 && s.phase === 'chooser'; i++) s = ok(applyChooserMove(s, chooseChooserAction(s, NONE, c), c));
    expect(s.phase).toBe('shop');
    expect(s.run.deck.filter(p => p.pieceType !== 'king').length).toBeLessThanOrEqual(c.deck.capacity);
  });
});

describe('fallbackQueue', () => {
  it('returns a mating MOVE when one exists (mate-in-one fixture)', () => {
    const s = deployed(rookRun());
    expect(fallbackQueue(s.run, s.stage!, c)).toEqual(mv('e1', 'e8'));
  });

  it('otherwise returns the first accepted MOVE by (from, to) square index', () => {
    // King c1 against rooks a2/b8: c1-b1 comes first by index but walks into the b8 rook; c1-d1 is the first legal move
    const run = starterRun(SEED);
    const st = engineOk(startStage(run, losingStage('AAAA-0001'), [{ instanceId: 'p_king_01', to: 'c1' }], c));
    const q = fallbackQueue(st.run, st.stage, c);
    expect(q).toEqual(mv('c1', 'd1'));
    expect(simulate(st.run, st.stage, mv('c1', 'b1'), c).ok).toBe(false);
    expect(commitQueue(st.run, st.stage, q, c).ok).toBe(true);
  });

  it('returns an empty queue when no single MOVE is accepted', () => {
    const run = starterRun(SEED);
    const st = engineOk(startStage(run, losingStage('AAAA-0001'), [{ instanceId: 'p_king_01', to: 'c1' }], c));
    const stuck = { ...st.stage, status: 'won' as const };
    expect(fallbackQueue(st.run, stuck, c)).toEqual([]);
  });
});

describe('fallbackPlacements', () => {
  const stages = [mateInOneStage, losingStage, promotionOverflowStage, doublePromotionStage];
  const runs = [starterRun(SEED), runWithRook(starterRun(SEED))];

  it('passes startStage on every fixture stage', () => {
    for (const make of stages) {
      for (const run of runs) {
        const stage = make('AAAA-0001');
        const placements = fallbackPlacements(run, stage, c);
        expect(placements[0]).toEqual({ instanceId: 'p_king_01', to: 'e1' });
        expect(startStage(run, stage, placements, c).ok).toBe(true);
      }
    }
  });

  it('adds the cheapest summons that fit the spawn points, on the next free squares', () => {
    const run = runWithRook(starterRun(SEED));
    const stage = mateInOneStage('AAAA-0001');
    const placements = fallbackPlacements(run, stage, c);
    const cost = (id: string) => {
      const p = run.deck.find(d => d.instanceId === id)!;
      return p.pieceType === 'king' ? 0 : spawnCostOf(p.pieceType, p.rarity ?? 'normal', c);
    };
    expect(placements.reduce((t, p) => t + cost(p.instanceId), 0)).toBeLessThanOrEqual(stage.spawnPoints);
    // the rook (the dearest) is left out of a 9-point budget, three 3-point minors fill it
    expect(placements.map(p => p.instanceId)).not.toContain(ROOK_ID);
    expect(placements.map(p => p.to)).toEqual(['e1', 'd1', 'f1', 'c1']);
    const tight = { ...stage, spawnPoints: 4 };
    expect(fallbackPlacements(run, tight, c)).toHaveLength(2);
    expect(fallbackPlacements(run, { ...stage, spawnPoints: 0 }, c)).toEqual([{ instanceId: 'p_king_01', to: 'e1' }]);
  });

  it('never puts the King on a square in check', () => {
    const base = mateInOneStage('AAAA-0001');
    // a Black rook on e8 sees down the open e-file, so e1 is in check and the King goes to d1
    const stage = { ...base, board: { ...base.board, e8: { pieceType: 'rook' as const, color: 'black' as const, stageId: 's09' } } };
    const placements = fallbackPlacements(starterRun(SEED), stage, c);
    expect(placements[0]).toEqual({ instanceId: 'p_king_01', to: 'd1' });
    expect(startStage(starterRun(SEED), stage, placements, c).ok).toBe(true);
  });

  it('leaves out spent and durability-0 pieces', () => {
    const run = { ...starterRun(SEED), deck: [KING, piece('p_dead', 'knight', { durability: 0 }), piece('p_ok', 'knight')] };
    const ids = fallbackPlacements(run, mateInOneStage('AAAA-0001'), c).map(p => p.instanceId);
    expect(ids).toEqual(['p_king_01', 'p_ok']);
  });
});
