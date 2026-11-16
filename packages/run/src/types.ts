import type { CommitError, DeckType, EndReason, GameEvent, Rarity, Result, RunState, StageState } from '@checkbreaker/engine';

export type RunPhase = 'awaiting_stage' | 'deployment' | 'action' | 'chooser' | 'shop' | 'ended';

export type GenRequest = { run: RunState; actIndex: number; stageIndex: number; previousTemplateId?: string };

export type Offer =
  | { kind: 'piece'; pieceType: DeckType; rarity: Rarity; price: number; recovery?: true }
  | { kind: 'skill'; skillId: string; price: number };

export interface ShopState {
  act: 1 | 2 | 3;
  stageNumber: number;
  roll: number;
  rerollsUsed: number;
  /** Stays true after the recovery offer itself is bought, until the next reroll: a UI shows the offer as live only when `recovery && !slots[0].sold`. */
  recovery: boolean;
  slots: (Offer & { sold: boolean })[];
}

export interface StageTally { startCoins: number; salvage: number; piecesLost: number }

export interface RunSession {
  version: 1;
  run: RunState;
  phase: RunPhase;
  stage: StageState | null;
  /** The stage as provided, kept in deployment and action so `restartStage` can go back to it; null elsewhere. */
  entryStage: StageState | null;
  tally: StageTally | null;
  chooser: { overCapacity: number } | null;
  shop: ShopState | null;
  next: { request: GenRequest; stage: StageState | null } | null;
  outcome: { result: 'won' | 'lost'; endReason?: EndReason | 'abandoned' } | null;
}

export type RunError =
  | { kind: 'wrong_phase'; expected: RunPhase[] }
  | { kind: 'insufficient_coins'; price: number; coins: number }
  | { kind: 'deck_full' }
  | { kind: 'loadout_full' }
  | { kind: 'replace_not_needed' }
  | { kind: 'restart_unavailable' }
  | { kind: 'slot_sold'; slot: number }
  | { kind: 'no_such_slot'; slot: number }
  | { kind: 'not_damaged'; instanceId: string }
  | { kind: 'cannot_repair'; instanceId: string; reason: 'king' | 'spent' | 'not_in_deck' }
  | { kind: 'cannot_sell'; instanceId: string; reason: 'king' | 'spent' | 'not_in_deck' }
  | { kind: 'cannot_cut'; instanceId: string; reason: 'king' | 'not_in_deck' }
  | { kind: 'merge_invalid'; reason: 'count' | 'mismatch' | 'durability' | 'legendary' | 'ceiling' | 'king' | 'not_in_deck' }
  | { kind: 'rerolls_exhausted' }
  | { kind: 'stage_mismatch'; expected: string; got: string }
  | { kind: 'stage_already_provided' }
  | { kind: 'not_ready' }
  | { kind: 'engine'; error: CommitError };

export type RunEvent =
  | GameEvent
  | { type: 'stage_entered'; stageNumber: number }
  | { type: 'stage_restarted' }
  | { type: 'skill_granted'; skillId: string }
  | { type: 'chooser_opened'; overCapacity: number }
  | { type: 'shop_opened'; act: number; recovery: boolean }
  | { type: 'item_bought'; slot: number; offer: Offer; instanceId?: string }
  | { type: 'piece_repaired'; instanceId: string; durability: number }
  | { type: 'piece_sold'; instanceId: string; coins: number }
  | { type: 'piece_cut'; instanceId: string }
  | { type: 'pieces_merged'; inputs: string[]; result: string }
  | { type: 'shop_rerolled'; roll: number; cost: number }
  | { type: 'recovery_withdrawn' }
  | { type: 'run_ended'; result: 'won' | 'lost'; endReason?: EndReason | 'abandoned' };

export type RunResult = Result<{ session: RunSession; events: RunEvent[] }, RunError>;
