export type Square = string;
export type PieceType = 'king' | 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';
export type Color = 'white' | 'black';
export type Rarity = 'normal' | 'rare' | 'unique' | 'legendary';

export interface BoardPiece {
  pieceType: PieceType;
  color: Color;
  instanceId?: string;
  /** Stable id of a Stage Piece (no instanceId): s01, s02, ... Hero Pieces are identified by instanceId instead. */
  stageId?: string;
  spawned?: true;
  rarity?: Rarity;
  promotesTo?: { pieceType: 'knight' | 'bishop' | 'rook' | 'queen'; rarity: Rarity };
  transformed?: { pieceType: PieceType; modifierId: string };
}

export interface EnemyPolicy {
  type: 'best_move' | 'scripted';
  depth?: number;
  seed?: string;
  line?: string[];
  fallbackDepth?: number;
  cursor?: number;
  fellBack?: boolean;
}

export interface ActiveModifier {
  modifierId: string;
  primitive:
    | 'grant_move_credit' | 'grant_focus' | 'set_piece_type' | 'override_moveset'
    | 'ignore_blockers' | 'suppress_piece' | 'shield_king' | 'remove_piece'
    | 'place_piece' | 'displace_piece' | 'return_to_deck' | 'shield_piece'
    | 'reveal_intent' | 'add_plan_undo';
  source?: string;
  /** Id of the targeted piece: its `instanceId ?? stageId`, not a square (squares change as pieces move). */
  target?: string;
  duration: 'instant' | 'this_turn' | 'next_enemy_turn' | 'permanent';
  appliedOnTurn?: number;
}

export type EndReason =
  | 'checkmate' | 'enemy_stalemated' | 'out_of_turns' | 'player_mated' | 'player_stalemated';

export interface StageState {
  stageSeed: string;
  templateId: string;
  playerColor: Color;
  phase: 'deployment' | 'action';
  board: Record<Square, BoardPiece>;
  turnsUsed: number;
  turnLimit: number;
  focus: number;
  focusPool: number;
  moveCredits: number;
  /** Summon budget: the summons' total spawnCost must fit (docs/02 §5). Deployment ranks are global (rules.deploymentRanks). */
  spawnPoints: number;
  modifiers: ActiveModifier[];
  /** Skills used this stage, in order; restrictions such as distinct_targets read it. */
  skillLog: { skillId: string; turn: number; targetId?: string }[];
  enemyPolicy: EnemyPolicy;
  status: 'active' | 'won' | 'lost';
  endReason?: EndReason;
  provenance?: {
    templateId?: string;
    seed?: string;
    attempts?: number;
    validationFailed?: boolean;
  };
}

export interface PieceInstance {
  instanceId: string;
  pieceType: 'king' | 'knight' | 'bishop' | 'rook' | 'queen';
  rarity: Rarity | null;
  durability: number | null;
  durabilityMax: number | null;
  origin: 'starter' | 'shop' | 'promotion' | 'merge' | 'reward';
  acquiredAtStage: number;
  usedOnce?: 'lifeline'[];
  status: 'in_deck' | 'deployed' | 'captured' | 'spent';
}

export interface RunState {
  version: number;
  seed: string;
  actIndex: number;
  stageIndex: number;
  coins: number;
  deckCapacity: 8;
  deck: PieceInstance[];
  loadout: { skillId: string; charges: number; chargesMax: number }[];
  history: {
    stageSeed: string;
    templateId: string;
    outcome: 'win' | 'loss';
    turnsUsed: number;
    coinsEarned: number;
    piecesLost: number;
  }[];
  rngCursor: number;
  status: 'in_progress' | 'won' | 'lost';
}

export type Action =
  | { type: 'MOVE'; from: Square; to: Square }
  | { type: 'ACTIVATE_SKILL'; skillId: string; target?: string };

export type MoveRejection = 'no_piece' | 'not_your_piece' | 'unreachable' | 'own_piece' | 'king_square';

export type CommitError =
  | {
      kind: 'king_in_check_at_end';
      square: Square;
      checkers: Square[];
      /** True when the King is attacked only on the board R1 reverted, not before the revert. */
      afterRevert: boolean;
    }
  | { kind: 'focus_exceeded'; atStep: number; needed: number; available: number }
  | { kind: 'credits_exceeded'; atStep: number }
  | { kind: 'empty_queue' }
  | { kind: 'illegal_move'; atStep: number; from: Square; to: Square; reason: MoveRejection }
  | { kind: 'stage_not_active' }
  | { kind: 'stage_not_won'; status: StageState['status'] }
  | { kind: 'wrong_phase'; expected: 'deployment' | 'action' }
  | { kind: 'durability_unavailable'; instanceId: string }
  | {
      kind: 'invalid_deployment';
      to: Square;
      reason: 'occupied' | 'outside_zone' | 'king_missing' | 'king_in_check' | 'not_in_deck' | 'duplicate';
    }
  | { kind: 'spawn_points_exceeded'; budget: number; cost: number }
  | { kind: 'skill_unavailable'; atStep: number; skillId: string; reason: 'not_in_loadout' | 'not_implemented' | 'no_charges' | 'once_per_turn' }
  | { kind: 'invalid_target'; atStep: number; skillId: string; target?: string; reason: 'no_target' | 'wrong_target' | 'excluded' | 'already_targeted' }
  | { kind: 'invariant_violation'; invariant: 'I1' | 'I2' | 'I3'; detail: string };

export interface Award {
  coins: number;
  base: number;
  turnBonus: number;
}

export type GameEvent =
  | { type: 'move'; from: Square; to: Square; pieceType: PieceType; color: Color }
  | { type: 'capture'; square: Square; pieceType: PieceType; color: Color; salvage: number; instanceId?: string; stageId?: string }
  | { type: 'pawn_promoted'; square: Square; promotesTo: { pieceType: 'knight' | 'bishop' | 'rook' | 'queen'; rarity: Rarity }; instanceId: string }
  | { type: 'enemy_promoted'; square: Square }
  | { type: 'check'; king: Color; square: Square }
  | { type: 'stage_won'; award: Award }
  | { type: 'stage_lost'; endReason: EndReason }
  | { type: 'enemy_move'; from: Square; to: Square }
  | { type: 'enemy_fell_back'; cursor: number }
  | { type: 'turn_started'; turn: number }
  | { type: 'piece_summoned'; instanceId: string; square: Square }
  | { type: 'lifeline_saved'; instanceId: string }
  | { type: 'piece_returned'; instanceId: string; durability: number | null }
  | { type: 'piece_removed'; instanceId: string; reason: 'spent' }
  | { type: 'stage_started' }
  | { type: 'skill_activated'; skillId: string; target?: Square }
  | { type: 'piece_transformed'; target: string; pieceType: PieceType }
  | { type: 'piece_suppressed'; target: string }
  | { type: 'transform_reverted'; target: string }
  | { type: 'modifier_expired'; modifierId: string };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type DeckType = 'knight' | 'bishop' | 'rook' | 'queen';

export interface AbilityFlags {
  /** 0 none · 1 may pass allies, no capture after · 2 may capture after */
  leapAllies: 0 | 1 | 2;
  /** Extra (df, dr) offsets, every symmetric image listed. */
  leapers: [number, number][];
  extraRays: ('orthogonal' | 'diagonal')[];
  /** 0 none · 1 only on a move that passed no ally · 2 any move */
  multiCapture: 0 | 1 | 2;
  bonusSelfMove: boolean;
  lifeline: boolean;
}

/** Cumulative abilities by tier index (normal, rare, unique, legendary). */
export type AbilityTable = Record<DeckType, [AbilityFlags, AbilityFlags, AbilityFlags, AbilityFlags]>;

export interface SkillDef {
  id: string;
  status: 'mvp' | 'future';
  cost: number;
  charges: number;
  price: number;
  target: {
    kind: 'none' | 'own_piece' | 'enemy_piece' | 'board_square';
    pieceType?: PieceType;
    excludes?: PieceType[];
    excludesRarity?: Rarity[];
    must_be_on_board?: boolean;
  };
  effects: {
    primitive: ActiveModifier['primitive'];
    params?: Record<string, unknown>;
    duration: ActiveModifier['duration'];
  }[];
  restrictions: ('once_per_turn' | 'distinct_targets' | 'requires_bishop_on_board')[];
}

export interface EngineConfig {
  /** `focusPool` is the default pool for stage generation (M3); the engine reads `stage.focusPool`. */
  rules: {
    freeMovesPerTurn: number;
    focusPool: number;
    minMovesPerQueue: number;
    deploymentRanks: number[];
    summonCostsDurability: number;
    spawnPoints: Record<'act1' | 'act2' | 'act3', { normal: number; boss: number }>;
  };
  pieces: Record<
    'king' | DeckType,
    {
      spawnCost: number;
      spawnCostByRarity: Partial<Record<Rarity, number>>;
      durabilityMax: number | null;
      durabilityMaxByRarity: Partial<Record<Rarity, number>>;
    }
  >;
  abilities: AbilityTable;
  skills: Record<string, SkillDef>;
  deck: { capacity: number };
  pieceValues: Record<PieceType, number>;
  economy: {
    baseReward: { act1: number; act2: number; act3: number; bossMultiplier: number };
    coinRate: { act1: number; act2: number; act3: number };
    salvage: { enabled: boolean; divisor: number };
  };
  enemyAI: {
    search: { transpositionTable: boolean; quiescenceMaxDepth: number; defaultFallbackDepth: number };
    terminal: { playerMated: number; playerOutOfTurns: number; enemyMated: number };
    weights: {
      kingEscapeSquare: number;
      kingZoneAttacked: number;
      kingInCheck: number;
      materialPerPoint: number;
      mobilityPerMove: number;
    };
  };
}
