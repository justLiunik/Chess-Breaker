import { commitQueue, durabilityMaxOf, endStage, hash, startStage } from '@checkbreaker/engine';
import type { Action, PieceInstance, Result, RunState, Square, StageState } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';
import type { GenRequest, Offer, RunError, RunEvent, RunPhase, RunResult, RunSession, StageTally } from './types';
import { cutPiece, mergePieces, repairPiece, sellPiece } from './deck';
import { buyOffer, openShop, rerollShop } from './shop';

type History = RunState['history'][number];

const DECK_TYPES = ['knight', 'bishop', 'rook', 'queen'] as const;
const NON_ENDED: RunPhase[] = ['awaiting_stage', 'deployment', 'action', 'chooser', 'shop'];

const done = (session: RunSession, events: RunEvent[]): RunResult => ({ ok: true, value: { session, events } });
const fail = (error: RunError): RunResult => ({ ok: false, error });
const wrongPhase = (expected: RunPhase[]): RunResult => fail({ kind: 'wrong_phase', expected });

const nonKingCount = (run: RunState): number => run.deck.filter(p => p.pieceType !== 'king').length;
/** 0-8: `actIndex x stagesPerAct + stageIndex` of the stage being played or just cleared. */
const stageNumberOf = (run: RunState, c: RunConfig): number => run.actIndex * c.run.stagesPerAct + run.stageIndex;
const actOf = (stageNumber: number, c: RunConfig): 1 | 2 | 3 => (Math.floor(stageNumber / c.run.stagesPerAct) + 1) as 1 | 2 | 3;

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
    version: 1, run, phase: 'awaiting_stage', stage: null, tally: null, chooser: null, shop: null,
    next: { request: requestFor(run, 0, c), stage: null }, outcome: null,
  };
}

/**
 * The only way into a stage's Deployment (from `provideStage` in awaiting_stage, or `leave` with the stage
 * ready): the run advances to the requested stage, the tally starts, and the onboarding skill is granted
 * when due and a loadout slot is free. A session loaded in Deployment never passes here again, so the grant
 * cannot repeat (Review Focus 1).
 */
function enterDeployment(s: RunSession, request: GenRequest, stage: StageState, c: RunConfig): RunResult {
  const stageNumber = request.actIndex * c.run.stagesPerAct + request.stageIndex;
  let run: RunState = { ...s.run, actIndex: request.actIndex, stageIndex: request.stageIndex };
  const events: RunEvent[] = [{ type: 'stage_entered', stageNumber }];
  const free = c.run.freeSkill;
  if (free && free.stageNumber === stageNumber && run.loadout.length < c.run.loadoutSlots) {
    run = { ...run, loadout: [...run.loadout, { skillId: free.skillId }] };
    events.push({ type: 'skill_granted', skillId: free.skillId });
  }
  const tally: StageTally = { startCoins: run.coins, salvage: 0, piecesLost: 0 };
  return done({ ...s, run, phase: 'deployment', stage, tally, chooser: null, shop: null, next: null }, events);
}

/**
 * Hands the session the stage its request asked for. Refused unless the stage's seed is the request's
 * (`stage_mismatch`) and no stage was provided yet (`stage_already_provided`). In awaiting_stage the stage's
 * Deployment begins; in the shop it is kept in `next.stage` and the phase does not change.
 */
export function provideStage(s: RunSession, stage: StageState, c: RunConfig): RunResult {
  if (s.phase !== 'awaiting_stage' && s.phase !== 'shop') return wrongPhase(['awaiting_stage', 'shop']);
  const next = s.next;
  if (!next) return fail({ kind: 'not_ready' });
  if (next.stage !== null) return fail({ kind: 'stage_already_provided' });
  const expected = expectedSeed(s.run.seed, next.request.actIndex, next.request.stageIndex);
  if (stage.stageSeed !== expected) return fail({ kind: 'stage_mismatch', expected, got: stage.stageSeed });
  if (s.phase === 'awaiting_stage') return enterDeployment(s, next.request, stage, c);
  return done({ ...s, next: { ...next, stage } }, []);
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
 * Action: `commitQueue` with the queue. Salvage and lost Hero Pieces are folded into the tally. A turn that
 * ends the stage writes its history record: a loss ends the run; a win runs `endStage`, then opens the
 * chooser if the deck overflows, else goes on (spec section 8.2).
 */
export function commit(s: RunSession, queue: Action[], c: RunConfig): RunResult {
  if (s.phase !== 'action') return wrongPhase(['action']);
  if (!s.stage) return fail({ kind: 'not_ready' });
  const r = commitQueue(s.run, s.stage, queue, c);
  if (!r.ok) return fail({ kind: 'engine', error: r.error });
  const { stage, award } = r.value;
  let run = r.value.run;
  let events: RunEvent[] = r.value.events;

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

  const ended = endStage(run, stage, c);
  if (!ended.ok) return fail({ kind: 'engine', error: ended.error });
  const removed = ended.value.events.filter(e => e.type === 'piece_removed').length;
  const win = record('win', (award?.coins ?? 0) + tally.salvage, tally.piecesLost + removed);
  run = { ...ended.value.run, history: [...ended.value.run.history, win] };
  events = [...events, ...ended.value.events];
  const cleared: RunSession = { ...s, run, stage: null, tally: null };
  const over = ended.value.overCapacity;
  if (over > 0) {
    return done({ ...cleared, phase: 'chooser', chooser: { overCapacity: over } }, [...events, { type: 'chooser_opened', overCapacity: over }]);
  }
  return proceed(cleared, events, c);
}

/** After a won stage whose deck fits: stage 9 ends the run won, any other opens the shop and requests the next stage. */
function proceed(s: RunSession, events: RunEvent[], c: RunConfig): RunResult {
  const stageNumber = stageNumberOf(s.run, c);
  if (stageNumber >= c.run.acts * c.run.stagesPerAct - 1) return endRun(s, s.run, events, 'won');
  const piecesLost = s.run.history.at(-1)?.piecesLost ?? 0;
  const shop = openShop(s.run, stageNumber, piecesLost, c);
  const next = { request: requestFor(s.run, stageNumber + 1, c), stage: null };
  return done(
    { ...s, phase: 'shop', chooser: null, shop, next },
    [...events, { type: 'shop_opened', act: shop.act, recovery: shop.recovery }],
  );
}

function endRun(
  s: RunSession, run: RunState, events: RunEvent[], result: 'won' | 'lost', endReason?: NonNullable<RunSession['outcome']>['endReason'],
): RunResult {
  const outcome = { result, ...(endReason !== undefined && { endReason }) };
  return done(
    { ...s, run: { ...run, status: result }, phase: 'ended', stage: null, tally: null, chooser: null, shop: null, next: null, outcome },
    [...events, { type: 'run_ended', ...outcome }],
  );
}

/**
 * A merge, sale or cut in the chooser or the shop, at the act of the stage just cleared. In the chooser the
 * phase moves on by itself as soon as the non-king deck fits (Review Focus 4).
 */
function deckAction(
  s: RunSession, c: RunConfig,
  apply: (run: RunState, act: 1 | 2 | 3, stageNumber: number) => Result<{ run: RunState; event: RunEvent }, RunError>,
): RunResult {
  if (s.phase !== 'chooser' && s.phase !== 'shop') return wrongPhase(['chooser', 'shop']);
  const stageNumber = s.shop?.stageNumber ?? stageNumberOf(s.run, c);
  const r = apply(s.run, s.shop?.act ?? actOf(stageNumber, c), stageNumber);
  if (!r.ok) return fail(r.error);
  const { run, event } = r.value;
  if (s.phase === 'shop') return done({ ...s, run }, [event]);
  const over = nonKingCount(run) - c.deck.capacity;
  if (over > 0) return done({ ...s, run, chooser: { overCapacity: over } }, [event]);
  return proceed({ ...s, run, chooser: null }, [event], c);
}

/** Chooser or shop: three identical pieces become one a tier up (docs/06 section 4.5). */
export function merge(s: RunSession, ids: string[], c: RunConfig): RunResult {
  return deckAction(s, c, (run, act, stageNumber) => {
    const r = mergePieces(run, ids, act, stageNumber, c);
    return r.ok ? { ok: true, value: { run: r.value.run, event: { type: 'pieces_merged', inputs: [...ids], result: r.value.resultId } } } : r;
  });
}

/** Chooser or shop: sells a piece at the act of the stage just cleared (docs/07 section 4). */
export function sell(s: RunSession, id: string, c: RunConfig): RunResult {
  return deckAction(s, c, (run, act) => {
    const r = sellPiece(run, id, act, c);
    return r.ok ? { ok: true, value: { run: r.value.run, event: { type: 'piece_sold', instanceId: id, coins: r.value.coins } } } : r;
  });
}

/** Chooser or shop: removes a piece for nothing. */
export function cut(s: RunSession, id: string, c: RunConfig): RunResult {
  return deckAction(s, c, (run) => {
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

/** Shop: leaves (banking whatever is unspent) for the next stage's Deployment, or awaiting_stage if it is not generated yet. */
export function leave(s: RunSession, c: RunConfig): RunResult {
  if (s.phase !== 'shop') return wrongPhase(['shop']);
  if (!s.next) return fail({ kind: 'not_ready' });
  if (s.next.stage) return enterDeployment({ ...s, shop: null }, s.next.request, s.next.stage, c);
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
