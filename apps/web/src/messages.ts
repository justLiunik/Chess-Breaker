import type { CommitError } from '@checkbreaker/engine';
import type { RunError, RunPhase, SaveError } from '@checkbreaker/run';

const step = (atStep: number): number => atStep + 1;

const REJECTION: Record<Extract<CommitError, { kind: 'illegal_move' }>['reason'], string> = {
  no_piece: 'there is no piece on the starting square',
  not_your_piece: 'that piece is not yours',
  unreachable: 'that piece cannot reach the target square',
  own_piece: 'your own piece is on the target square',
  king_square: 'the target square holds a King, which cannot be captured',
};

const DEPLOY_REASON: Record<Extract<CommitError, { kind: 'invalid_deployment' }>['reason'], string> = {
  occupied: 'that square is already occupied',
  outside_zone: 'that square is outside your deployment zone',
  king_missing: 'your King must be placed first',
  king_in_check: 'the King would start in check',
  not_in_deck: 'that piece is not in your deck',
  duplicate: 'that piece is already placed',
};

const SKILL_REASON: Record<Extract<CommitError, { kind: 'skill_unavailable' }>['reason'], string> = {
  not_in_loadout: 'it is not in your loadout',
  not_implemented: 'it is not available in this version',
  once_per_turn: 'it can only be used once per turn',
};

const TARGET_REASON: Record<Extract<CommitError, { kind: 'invalid_target' }>['reason'], string> = {
  no_target: 'it needs a target and none was chosen',
  wrong_target: 'that is not a valid target for it',
  excluded: 'that target is excluded',
  already_targeted: 'that target was already chosen',
};

export function commitErrorText(e: CommitError): string {
  switch (e.kind) {
    case 'king_in_check_at_end':
      return e.afterRevert
        ? `Your King on ${e.square} would be in check once the revert is applied. Fix the queue or drop the revert.`
        : `Your King on ${e.square} would still be in check at the end of the queue.`;
    case 'focus_exceeded':
      return `Not enough Focus at step ${step(e.atStep)}: needs ${e.needed}, you have ${e.available}.`;
    case 'credits_exceeded':
      return `Not enough free moves left at step ${step(e.atStep)}.`;
    case 'empty_queue':
      return 'The queue is empty. Add at least one move before committing.';
    case 'illegal_move':
      return `Step ${step(e.atStep)} cannot move ${e.from} to ${e.to}: ${REJECTION[e.reason]}.`;
    case 'stage_not_active':
      return 'This stage is already over.';
    case 'stage_not_won':
      return `The stage has not been won yet (it is ${e.status === 'lost' ? 'lost' : 'still active'}).`;
    case 'wrong_phase':
      return e.expected === 'deployment'
        ? 'That can only be done while deploying pieces.'
        : 'That can only be done once deployment is finished.';
    case 'durability_unavailable':
      return `Piece ${e.instanceId} has no durability left to spend.`;
    case 'invalid_deployment':
      return `Cannot deploy on ${e.to}: ${DEPLOY_REASON[e.reason]}.`;
    case 'spawn_points_exceeded':
      return `Not enough spawn points: the deployment costs ${e.cost}, the budget is ${e.budget}.`;
    case 'skill_unavailable':
      return `Step ${step(e.atStep)} cannot use skill ${e.skillId}: ${SKILL_REASON[e.reason]}.`;
    case 'invalid_target':
      return `Step ${step(e.atStep)} cannot use skill ${e.skillId} that way: ${TARGET_REASON[e.reason]}.`;
    case 'invariant_violation':
      return `Internal error (${e.invariant}): ${e.detail}`;
    default:
      return assertNever(e);
  }
}

const PHASE: Record<RunPhase, string> = {
  awaiting_stage: 'waiting for the next stage',
  deployment: 'deployment',
  action: 'the action phase',
  chooser: 'the deck chooser',
  shop: 'the shop',
  ended: 'a finished run',
};

const MERGE_REASON: Record<Extract<RunError, { kind: 'merge_invalid' }>['reason'], string> = {
  count: 'pick exactly the number of pieces a merge needs',
  mismatch: 'the pieces must share the same type and tier',
  durability: 'the pieces must all be at full durability',
  legendary: 'legendary pieces cannot be merged further',
  ceiling: 'the result would be above the highest tier allowed',
  king: 'the King cannot be merged',
  not_in_deck: 'one of the pieces is not in your deck',
};

const ITEM_REASON = {
  king: 'the King cannot be',
  spent: 'a spent piece cannot be',
  not_in_deck: 'that piece is not in your deck, so it cannot be',
} as const;

export function runErrorText(e: RunError): string {
  switch (e.kind) {
    case 'wrong_phase':
      return `That is not possible right now; it belongs to ${e.expected.map((p) => PHASE[p]).join(' or ')}.`;
    case 'insufficient_coins':
      return `Not enough coins: it costs ${e.price}, you have ${e.coins}.`;
    case 'deck_full':
      return 'Your deck is full. Sell or cut a piece first.';
    case 'loadout_full':
      return 'Your skill loadout is full. Replace a skill instead.';
    case 'replace_not_needed':
      return 'There is a free loadout slot, so nothing needs to be replaced.';
    case 'restart_unavailable':
      return 'This stage can no longer be restarted.';
    case 'slot_sold':
      return `Shop slot ${e.slot} has already been bought.`;
    case 'no_such_slot':
      return `There is no shop slot ${e.slot}.`;
    case 'not_damaged':
      return `Piece ${e.instanceId} is not damaged, so there is nothing to repair.`;
    case 'cannot_repair':
      return `Cannot repair piece ${e.instanceId}: ${ITEM_REASON[e.reason]} repaired.`;
    case 'cannot_sell':
      return `Cannot sell piece ${e.instanceId}: ${ITEM_REASON[e.reason]} sold.`;
    case 'cannot_cut':
      return e.reason === 'king'
        ? `Cannot cut piece ${e.instanceId}: the King cannot be cut.`
        : `Cannot cut piece ${e.instanceId}: it is not in your deck.`;
    case 'merge_invalid':
      return `Cannot merge these pieces: ${MERGE_REASON[e.reason]}.`;
    case 'rerolls_exhausted':
      return 'No more rerolls left on this shop visit.';
    case 'stage_mismatch':
      return `The stage does not match: expected ${e.expected}, got ${e.got}.`;
    case 'stage_already_provided':
      return 'A stage has already been provided for this step.';
    case 'not_ready':
      return 'The run is not ready for that yet.';
    case 'engine':
      return commitErrorText(e.error);
    default:
      return assertNever(e);
  }
}

export function saveErrorText(e: SaveError): string {
  switch (e.kind) {
    case 'malformed':
      return `The saved run could not be read: ${e.detail}.`;
    case 'unknown_version':
      return `The saved run is from another version: ${e.message}.`;
    case 'invalid_session':
      return `The saved run is damaged and cannot be resumed: ${e.detail}.`;
    default:
      return assertNever(e);
  }
}

function assertNever(x: never): never {
  throw new Error(`unhandled error kind: ${JSON.stringify(x)}`);
}
