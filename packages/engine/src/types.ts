export type Square = string;
export type PieceType = 'king' | 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';
export type Color = 'white' | 'black';
export type Rarity = 'normal' | 'rare' | 'unique' | 'legendary';

export interface BoardPiece {
  pieceType: PieceType;
  color: Color;
  instanceId?: string;
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
    | 'place_piece' | 'displace_piece' | 'reveal_intent' | 'add_plan_undo';
  source?: string;
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
  summonLimit: number;
  deploymentRanks: number[];
  modifiers: ActiveModifier[];
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
  | { kind: 'king_in_check_at_end'; square: Square; checkers: Square[] }
  | { kind: 'focus_exceeded'; atStep: number; needed: number; available: number }
  | { kind: 'credits_exceeded'; atStep: number }
  | { kind: 'empty_queue' }
  | { kind: 'illegal_move'; atStep: number; from: Square; to: Square; reason: MoveRejection }
  | { kind: 'stage_not_active' }
  | { kind: 'wrong_phase'; expected: 'deployment' | 'action' }
  | { kind: 'durability_unavailable'; instanceId: string }
  | { kind: 'invalid_deployment'; to: Square; reason: string }
  | { kind: 'summon_limit_exceeded'; limit: number; placed: number }
  | { kind: 'unsupported_action'; atStep: number; actionType: 'ACTIVATE_SKILL' }
  | { kind: 'invariant_violation'; invariant: 'I1' | 'I2' | 'I3'; detail: string };

export interface Award {
  coins: number;
  base: number;
  turnBonus: number;
}

export type GameEvent =
  | { type: 'move'; from: Square; to: Square; pieceType: PieceType; color: Color }
  | { type: 'capture'; square: Square; pieceType: PieceType; color: Color; salvage: number }
  | { type: 'pawn_promoted'; square: Square; promotesTo: { pieceType: 'knight' | 'bishop' | 'rook' | 'queen'; rarity: Rarity } }
  | { type: 'enemy_promoted'; square: Square }
  | { type: 'check'; king: Color; square: Square }
  | { type: 'stage_won'; award: Award }
  | { type: 'stage_lost'; endReason: EndReason }
  | { type: 'enemy_move'; from: Square; to: Square }
  | { type: 'enemy_fell_back'; cursor: number }
  | { type: 'turn_started'; turn: number };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface EngineConfig {
  rules: { freeMovesPerTurn: number; focusPool: number; minMovesPerQueue: number };
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
