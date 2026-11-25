import { commitQueue, durabilityMaxOf, endStage, hash, pendingBase, startStage } from '@checkbreaker/engine';
import type { Action, PieceInstance, Result, RunState, Square, StageState } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';
import type {
  ClueSquare, CluePlacement, GenRequest, Offer, RunError, RunEvent, RunPhase, RunResult, RunSession, StageTally,
} from './types';
import { cutPiece, mergePieces, repairPiece, sellPiece } from './deck';
import { buyOffer, openShop, rerollShop } from './shop';

type History = RunState['history'][number];

const DECK_TYPES = ['knight', 'bishop', 'rook', 'queen'] as const;
const NON_ENDED: RunPhase[] = ['awaiting_stage', 'deployment', 'action', 'shop'];

const done = (session: RunSession, events: RunEvent[]): RunResult => ({ ok: true, value: { session, events } });
const fail = (error: RunError): RunResult => ({ ok: false, error });
const wrongPhase = (expected: RunPhase[]): RunResult => fail({ kind: 'wrong_phase', expected });

const nonKingCount = (run: RunState): number => run.deck.filter(p => p.pieceType !== 'king').length;
/** 0-8: `actIndex x stagesPerAct + stageIndex` of the stage being played or just cleared. */
const stageNumberOf = (run: RunState, c: RunConfig): number => run.actIndex * c.run.stagesPerAct + run.stageIndex;

/**
 * The stage seed gen's G0 derives for (run seed, act, stage): the 32-bit hash as `XXXX-XXXX`,
 * byte for byte the code in packages/gen/src/generate.ts (cross-checked by a gen test).
 */
export function expectedSeed(runSeed: string, actIndex: number, stageIndex: number): string {
  const h = hash(runSeed, actIndex, stageIndex).toString(16).toUpperCase().padStart(8, '0');
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

/** The generation request for stage `stageNumber` (0-8): gen's `GenInput` for the run as it is now. */
export function requestFor(run: RunState, stageNumber: number, c: RunConfig): GenRequest {
  const actIndex = Math.floor(stageNumber / c.run.stagesPerAct);
  const stageIndex = stageNumber % c.run.stagesPerAct;
  const previousTemplateId = run.history.at(-1)?.templateId;
  return {
    run: { ...run, actIndex, stageIndex },
    actIndex,
    stageIndex,
    ...(previousTemplateId !== undefined && { previousTemplateId }),
  };
}

/**
 * A fresh run waiting for stage 0: the starter deck (`p_king_01`, then `p_<type>_NN` in `starterDeck`
 * order, all Normal at full durability), `starterCoins`, an empty loadout and history.
 */
export function newRun(seed: string, c: RunConfig): RunSession {
  const deck: PieceInstance[] = [{
    instanceId: 'p_king_01', pieceType: 'king', rarity: null, durability: null, durabilityMax: null,
    origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
  }];
  for (const pieceType of DECK_TYPES) {
    for (let i = 0; i < c.run.starterDeck[pieceType]; i++) {
      const durabilityMax = durabilityMaxOf(pieceType, 'normal', c);
      deck.push({
        instanceId: `p_${pieceType}_${String(deck.length + 1).padStart(2, '0')}`, pieceType, rarity: 'normal',
        durability: durabilityMax, durabilityMax, origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
      });
    }
  }
  const run: RunState = {
    version: 1, seed, actIndex: 0, stageIndex: 0, coins: c.run.starterCoins, deckCapacity: c.deck.capacity as 8,
    deck, loadout: [], history: [], rngCursor: 0, status: 'in_progress',
  };
  return {
    version: 1, run, phase: 'awaiting_stage', stage: null, entryStage: null, clue: null, tally: null, shop: null,
    next: { request: requestFor(run, 0, c), stage: null, clue: null }, outcome: null,
  };
}

/**
 * The only way into a stage's Deployment (from `provideStage` in awaiting_stage, or `leave` with the stage
 * ready): the run advances to the requested stage, the tally starts, and the onboarding skill is granted
 * when due and a loadout slot is free. A session loaded in Deployment never passes here again, so the grant
 * cannot repeat (Review Focus 1).
 */
function enterDeployment(
  s: RunSession, request: GenRequest, stage: StageState, clue: ClueSquare[] | null, c: RunConfig,
): RunResult {
  const stageNumber = request.actIndex * c.run.stagesPerAct + request.stageIndex;
  let run: RunState = { ...s.run, actIndex: request.actIndex, stageIndex: request.stageIndex };
  const events: RunEvent[] = [{ type: 'stage_entered', stageNumber }];
  const free = c.run.freeSkill;
  if (free && free.stageNumber === stageNumber && run.loadout.length < c.run.loadoutSlots) {
    run = { ...run, loadout: [...run.loadout, { skillId: free.skillId }] };
    events.push({ type: 'skill_granted', skillId: free.skillId });
  }
  const tally: StageTally = { startCoins: run.coins, salvage: 0, piecesLost: 0 };
  return done({ ...s, run, phase: 'deployment', stage, entryStage: stage, clue, tally, shop: null, next: null }, events);
}

/** Copies each entry's piece type and rarity from the snapshot's deck; null when there is no clue or an instance is missing. */
function resolveClue(clue: CluePlacement[] | null, run: RunState): ClueSquare[] | null {
  if (!clue) return null;
  const out: ClueSquare[] = [];
  for (const { instanceId, to } of clue) {
    const piece = run.deck.find(p => p.instanceId === instanceId);
    if (!piece) return null;
    out.push({ instanceId, to, pieceType: piece.pieceType, ...(piece.rarity != null && { rarity: piece.rarity }) });
  }
  return out;
}

/**
 * Hands the session the stage its request asked for. Refused unless the stage's seed is the request's
 * (`stage_mismatch`) and no stage was provided yet (`stage_already_provided`). In awaiting_stage the stage's
 * Deployment begins; in the shop it is kept in `next.stage` and the phase does not change. The worker's
 * `clue` is resolved against the request's deck snapshot (type and rarity copied); an entry naming an
 * instance that is not in it makes the whole clue null.
 */
export function provideStage(s: RunSession, stage: StageState, c: RunConfig, clue: CluePlacement[] | null = null): RunResult {
  if (s.phase !== 'awaiting_stage' && s.phase !== 'shop') return wrongPhase(['awaiting_stage', 'shop']);
  const next = s.next;
  if (!next) return fail({ kind: 'not_ready' });
  if (next.stage !== null) return fail({ kind: 'stage_already_provided' });
  const expected = expectedSeed(s.run.seed, next.request.actIndex, next.request.stageIndex);
  if (stage.stageSeed !== expected) return fail({ kind: 'stage_mismatch', expected, got: stage.stageSeed });
  const resolved = resolveClue(clue, next.request.run);
  if (s.phase === 'awaiting_stage') return enterDeployment(s, next.request, stage, resolved, c);
  return done({ ...s, next: { ...next, stage, clue: resolved } }, []);
}

/** Deployment: `startStage` with the placements; engine refusals come back as `{ kind: 'engine' }`. */
export function start(s: RunSession, placements: { instanceId: string; to: Square }[], c: RunConfig): RunResult {
  if (s.phase !== 'deployment') return wrongPhase(['deployment']);
  if (!s.stage) return fail({ kind: 'not_ready' });
  const r = startStage(s.run, s.stage, placements, c);
  if (!r.ok) return fail({ kind: 'engine', error: r.error });
  return done({ ...s, run: r.value.run, stage: r.value.stage, phase: 'action' }, r.value.events);
}

/**
 * Action, before the stage's first COMMIT: back to Deployment with the stage as provided. Durability paid at
 * START stays paid; placed pieces return to the tray, a piece START took to 0 stays spent. Nothing else changes.
 */
export function restartStage(s: RunSession, c: RunConfig): RunResult {
  void c;
  if (s.phase !== 'action') return wrongPhase(['action']);
  if (!s.stage || !s.entryStage) return fail({ kind: 'not_ready' });
  if (s.stage.turnsUsed !== 0) return fail({ kind: 'restart_unavailable' });
  const deck = s.run.deck.map(p => (p.status === 'deployed' ? { ...p, status: 'in_deck' as const } : p));
  return done({ ...s, run: { ...s.run, deck }, phase: 'deployment', stage: s.entryStage }, [{ type: 'stage_restarted' }]);
}

/**
 * Action: `commitQueue` with the queue. Salvage and lost Hero Pieces (a promoted piece the enemy takes
 * included: it carries its instanceId) are folded into the tally. A turn that ends the stage writes its
 * history record: a loss ends the run; a win runs `endStage`, then goes on to the shop or the run end,
 * whatever the deck size (spec section 8.2; M5.1 spec section 4.2).
 */
export function commit(s: RunSession, queue: Action[], c: RunConfig): RunResult {
  if (s.phase !== 'action') return wrongPhase(['action']);
  if (!s.stage) return fail({ kind: 'not_ready' });
  const r = commitQueue(s.run, s.stage, queue, c);
  if (!r.ok) return fail({ kind: 'engine', error: r.error });
  const { stage, award } = r.value;
  let run = r.value.run;
  const events: RunEvent[] = r.value.events;

  const prior = s.tally ?? { startCoins: s.run.coins, salvage: 0, piecesLost: 0 };
  let salvage = prior.salvage;
  let piecesLost = prior.piecesLost;
  for (const e of r.value.events) {
    if (e.type === 'capture' && e.color === 'black') salvage += e.salvage;
    if (e.type === 'capture' && e.color === 'white' && e.instanceId !== undefined) piecesLost++;
    if (e.type === 'lifeline_saved') piecesLost--;
  }
  const tally: StageTally = { ...prior, salvage, piecesLost };

  if (stage.status === 'active') return done({ ...s, run, stage, tally }, events);

  const record = (outcome: History['outcome'], coinsEarned: number, lost: number): History => ({
    stageSeed: stage.stageSeed, templateId: stage.templateId, outcome, turnsUsed: stage.turnsUsed, coinsEarned, piecesLost: lost,
  });

  if (stage.status === 'lost') {
    run = { ...run, history: [...run.history, record('loss', tally.salvage, tally.piecesLost)] };
    return endRun(s, run, events, 'lost', stage.endReason);
  }

  return finishWin(s, run, stage, award?.coins ?? 0, tally, events, c);
}

/**
 * The shared post-win path (a mate in `commit`, or `devSkipStage`): `endStage` returns deployed pieces and
 * removes spent ones, the history record is written (`coinsEarned` = `awardCoins` + salvage; the wallet
 * already holds the award), then `proceed`. A deck a promotion overflowed is trimmed in the shop: `leave`
 * refuses the next stage until it fits.
 */
function finishWin(
  s: RunSession, run: RunState, stage: StageState, awardCoins: number, tally: StageTally, events: RunEvent[], c: RunConfig,
): RunResult {
  const ended = endStage(run, stage, c);
  if (!ended.ok) return fail({ kind: 'engine', error: ended.error });
  const removed = ended.value.events.filter(e => e.type === 'piece_removed').length;
  const win: History = {
    stageSeed: stage.stageSeed, templateId: stage.templateId, outcome: 'win', turnsUsed: stage.turnsUsed,
    coinsEarned: awardCoins + tally.salvage, piecesLost: tally.piecesLost + removed,
  };
  const next: RunState = { ...ended.value.run, history: [...ended.value.run.history, win] };
  const all = [...events, ...ended.value.events];
  return proceed({ ...s, run: next, stage: null, entryStage: null, clue: null, tally: null }, all, c);
}

/**
 * Development tool (spec section 6.2), Deployment or Action: counts the stage as won through the same
 * post-win path as a mate. Pays only the stage's pending base reward (no par bonus, no interest); START costs
 * already paid stay paid. The session is flagged `debug: true` for good.
 */
export function devSkipStage(s: RunSession, c: RunConfig): RunResult {
  if (s.phase !== 'deployment' && s.phase !== 'action') return wrongPhase(['deployment', 'action']);
  if (!s.stage) return fail({ kind: 'not_ready' });
  const coins = pendingBase(s.run, s.stage, c);
  const run: RunState = { ...s.run, coins: s.run.coins + coins };
  const tally = s.tally ?? { startCoins: s.run.coins, salvage: 0, piecesLost: 0 };
  return finishWin({ ...s, debug: true }, run, { ...s.stage, status: 'won' }, coins, tally, [{ type: 'stage_skipped', coins }], c);
}

/**
 * After a won stage, whatever the deck size: stage 9 ends the run won (the size no longer matters), any other
 * opens the shop and requests the next stage.
 */
function proceed(s: RunSession, events: RunEvent[], c: RunConfig): RunResult {
  const stageNumber = stageNumberOf(s.run, c);
  if (stageNumber >= c.run.acts * c.run.stagesPerAct - 1) return endRun(s, s.run, events, 'won');
  const piecesLost = s.run.history.at(-1)?.piecesLost ?? 0;
  const shop = openShop(s.run, stageNumber, piecesLost, c);
  const next = { request: requestFor(s.run, stageNumber + 1, c), stage: null, clue: null };
  return done(
    { ...s, phase: 'shop', shop, next },
    [...events, { type: 'shop_opened', act: shop.act, recovery: shop.recovery }],
  );
}

function endRun(
  s: RunSession, run: RunState, events: RunEvent[], result: 'won' | 'lost', endReason?: NonNullable<RunSession['outcome']>['endReason'],
): RunResult {
  const outcome = { result, ...(endReason !== undefined && { endReason }) };
  return done(
    { ...s, run: { ...run, status: result }, phase: 'ended', stage: null, entryStage: null, clue: null, tally: null, shop: null, next: null, outcome },
    [...events, { type: 'run_ended', ...outcome }],
  );
}

/**
 * A merge, sale or cut, in the shop only, at the act of the stage just cleared. The phase never changes: a deck
 * brought back to `deck.capacity` lets `leave` go on (Review Focus 4).
 */
function deckAction(
  s: RunSession,
  apply: (run: RunState, act: 1 | 2 | 3, stageNumber: number) => Result<{ run: RunState; event: RunEvent }, RunError>,
): RunResult {
  if (s.phase !== 'shop') return wrongPhase(['shop']);
  if (!s.shop) return fail({ kind: 'not_ready' });
  const r = apply(s.run, s.shop.act, s.shop.stageNumber);
  if (!r.ok) return fail(r.error);
  return done({ ...s, run: r.value.run }, [r.value.event]);
}

/** Shop: three identical pieces become one a tier up (docs/06 section 4.5). */
export function merge(s: RunSession, ids: string[], c: RunConfig): RunResult {
  return deckAction(s, (run, act, stageNumber) => {
    const r = mergePieces(run, ids, act, stageNumber, c);
    return r.ok ? { ok: true, value: { run: r.value.run, event: { type: 'pieces_merged', inputs: [...ids], result: r.value.resultId } } } : r;
  });
}

/**
 * Shop: sells a piece at the act of the stage just cleared (docs/07 section 4). A promoted piece paid nothing
 * (`pricePaid: 0`), so the sale cap makes it sell for 0.
 */
export function sell(s: RunSession, id: string, c: RunConfig): RunResult {
  return deckAction(s, (run, act) => {
    const r = sellPiece(run, id, act, c);
    return r.ok ? { ok: true, value: { run: r.value.run, event: { type: 'piece_sold', instanceId: id, coins: r.value.coins } } } : r;
  });
}

/** Shop: removes a piece for nothing. */
export function cut(s: RunSession, id: string, c: RunConfig): RunResult {
  void c;
  return deckAction(s, (run) => {
    const r = cutPiece(run, id);
    return r.ok ? { ok: true, value: { run: r.value.run, event: { type: 'piece_cut', instanceId: id } } } : r;
  });
}

/**
 * Shop: buys slot `slot` (1-4). `recovery_withdrawn` is emitted only when buying another slot than the
 * recovery offer's switched the offer off (buying the offer itself leaves `shop.recovery` as it was).
 */
export function buy(s: RunSession, slot: number, opts: { replace?: number }, c: RunConfig): RunResult {
  if (s.phase !== 'shop') return wrongPhase(['shop']);
  if (!s.shop) return fail({ kind: 'not_ready' });
  const r = buyOffer(s.run, s.shop, slot, opts, c);
  if (!r.ok) return fail(r.error);
  const { sold: _sold, ...offer } = s.shop.slots[slot - 1]!;
  const { instanceId } = r.value;
  const events: RunEvent[] = [{ type: 'item_bought', slot, offer: offer as Offer, ...(instanceId !== undefined && { instanceId }) }];
  if (slot !== 1 && s.shop.recovery && !r.value.shop.recovery) events.push({ type: 'recovery_withdrawn' });
  return done({ ...s, run: r.value.run, shop: r.value.shop }, events);
}

/** Shop: +1 durability for `services.repair` coins, repeatable. */
export function repair(s: RunSession, id: string, c: RunConfig): RunResult {
  if (s.phase !== 'shop') return wrongPhase(['shop']);
  const r = repairPiece(s.run, id, c);
  if (!r.ok) return fail(r.error);
  return done({ ...s, run: r.value.run }, [{ type: 'piece_repaired', instanceId: id, durability: r.value.durability }]);
}

/** Shop: redraws slots 1-4 (docs/07 section 2). */
export function reroll(s: RunSession, c: RunConfig): RunResult {
  if (s.phase !== 'shop') return wrongPhase(['shop']);
  if (!s.shop) return fail({ kind: 'not_ready' });
  const r = rerollShop(s.run, s.shop, c);
  if (!r.ok) return fail(r.error);
  return done({ ...s, run: r.value.run, shop: r.value.shop }, [{ type: 'shop_rerolled', roll: r.value.shop.roll, cost: r.value.cost }]);
}

/**
 * Shop: leaves (banking whatever is unspent) for the next stage's Deployment, or awaiting_stage if it is not
 * generated yet. Refused with `deck_over_capacity` while the non-king deck holds more than `deck.capacity`
 * pieces (a promotion overflowed it): the deck gate (I9; docs/07 section 1). Selling, merging or cutting
 * opens it again.
 */
export function leave(s: RunSession, c: RunConfig): RunResult {
  if (s.phase !== 'shop') return wrongPhase(['shop']);
  const size = nonKingCount(s.run);
  if (size > c.deck.capacity) return fail({ kind: 'deck_over_capacity', size, capacity: c.deck.capacity });
  if (!s.next) return fail({ kind: 'not_ready' });
  if (s.next.stage) return enterDeployment({ ...s, shop: null }, s.next.request, s.next.stage, s.next.clue, c);
  return done({ ...s, phase: 'awaiting_stage', shop: null }, []);
}

/** Any phase but ended: the run is lost, `abandoned`. A stage with at least one turn played gets a loss record. */
export function abandon(s: RunSession): RunResult {
  if (s.phase === 'ended') return wrongPhase(NON_ENDED);
  let run = s.run;
  if (s.stage && s.stage.turnsUsed >= 1) {
    const record: History = {
      stageSeed: s.stage.stageSeed, templateId: s.stage.templateId, outcome: 'loss', turnsUsed: s.stage.turnsUsed,
      coinsEarned: s.tally?.salvage ?? 0, piecesLost: s.tally?.piecesLost ?? 0,
    };
    run = { ...run, history: [...run.history, record] };
  }
  return endRun(s, run, [], 'lost', 'abandoned');
}
