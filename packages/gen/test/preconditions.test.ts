import { describe, expect, it } from 'vitest';
import type { BoardPiece, PieceInstance, Rarity, RunState, Square, StageState } from '@checkbreaker/engine';
import { toSquare } from '@checkbreaker/engine';
import type { PreconditionId, Template } from '@checkbreaker/content';
import { checkPreconditions, firstTurnMate } from '../src/preconditions';
import { buildStage } from '../src/stage';
import { config, deepFreeze, exampleRun, generatedStages, tpl } from './helpers';

const ALL: PreconditionId[] = [
  'enemy_king_on_board',
  'safe_king_square',
  'no_first_turn_mate',
  'enemy_has_moves',
  'enemy_value_in_band',
  'deployment_squares_available',
  'spawned_pawns_placed',
];

const TYPES: Record<string, BoardPiece['pieceType']> = {
  K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn',
};

/**
 * A board as G2-G4 leave it: Black pieces from `'Kg8 Pf7 …'`, and spawned White pawns on the
 * squares of `spawned` (Normal, promoting to a Normal knight), every piece with a stageId.
 */
function board(black: string, spawned = ''): Record<Square, BoardPiece> {
  const out: Record<Square, BoardPiece> = {};
  let n = 0;
  const id = () => `s${String(++n).padStart(2, '0')}`;
  for (const w of black.split(' ').filter(Boolean)) {
    out[w.slice(1)] = { pieceType: TYPES[w[0]!]!, color: 'black', stageId: id() };
  }
  for (const sq of spawned.split(' ').filter(Boolean)) {
    out[sq] = {
      pieceType: 'pawn', color: 'white', spawned: true, stageId: id(),
      rarity: 'normal', promotesTo: { pieceType: 'knight', rarity: 'normal' },
    };
  }
  return out;
}

type Piece = [Exclude<PieceInstance['pieceType'], 'king'>, Rarity, Partial<PieceInstance>?];

/** A run whose deck holds the King and one instance per entry, `<type>-<rarity>-<n>`, in deck with durability 2. */
function deck(...pieces: Piece[]): RunState {
  const king: PieceInstance = {
    instanceId: 'king', pieceType: 'king', rarity: null, durability: null, durabilityMax: null,
    origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
  };
  return deepFreeze({
    version: 1, seed: 'TEST-0001', actIndex: 0, stageIndex: 0, coins: 0, deckCapacity: 8,
    deck: [king, ...pieces.map(([pieceType, rarity, over], i): PieceInstance => ({
      instanceId: `${pieceType}-${rarity}-${i + 1}`, pieceType, rarity, durability: 2, durabilityMax: 2,
      origin: 'starter', acquiredAtStage: 0, status: 'in_deck', ...over,
    }))],
    loadout: [], history: [], rngCursor: 0, status: 'in_progress',
  } as RunState);
}

function stageOf(t: Template, b: Record<Square, BoardPiece>): StageState {
  return deepFreeze(buildStage(t, b, `act${t.act}`, t.tier, 'TEST-0001', t.mateIn[0], config));
}

const check = (run: RunState, stage: StageState, t: Template, extraPawns = 0) =>
  checkPreconditions(run, stage, t, { extraPawns }, config);

/** Every precondition the stage fails, each checked on its own. */
const failing = (run: RunState, stage: StageState, t: Template, extraPawns = 0) =>
  ALL.filter((id) => check(run, stage, { ...t, preconditions: [id] }, extraPawns) !== null);

const only = (id: PreconditionId) => [id];

// The base board (Act I, 9 spawn points): value 7, the a-file open, luft on h7.
const BASE_T = tpl({ id: 'tpl-test', preconditions: ALL });
const BASE_BLACK = 'Kg8 Pb7 Pc7 Pd7 Pe7 Pf7 Pg7 Ph6';
const ROOK = deck(['rook', 'normal']);
const base = () => stageOf(BASE_T, board(BASE_BLACK, 'd3'));

describe('checkPreconditions', () => {
  it('passes the base board on all seven preconditions', () => {
    expect(failing(ROOK, base(), BASE_T)).toEqual([]);
    expect(check(ROOK, base(), BASE_T)).toBeNull();
  });

  it("returns the first failing id in the template's order, and checks only the listed ones", () => {
    const s = stageOf(BASE_T, board('Pb7 Pc7 Pd7 Pe7 Pf7 Pg7', 'd3')); // no king, value 6
    expect(failing(ROOK, s, BASE_T)).toEqual(['enemy_king_on_board', 'enemy_value_in_band']);
    expect(check(ROOK, s, BASE_T)).toBe('enemy_king_on_board');
    expect(check(ROOK, s, { ...BASE_T, preconditions: [...ALL].reverse() })).toBe('enemy_value_in_band');
    expect(check(ROOK, s, { ...BASE_T, preconditions: [] })).toBeNull();
  });
});

describe('enemy_king_on_board', () => {
  it('passes with exactly one black king, no Hero Piece and the deployment phase', () => {
    expect(failing(ROOK, base(), BASE_T)).toEqual([]);
  });

  it('fails without a black king', () => {
    const s = stageOf(BASE_T, board('Pb7 Pc7 Pd7 Pe7 Pf7 Pg7 Ph6', 'd3'));
    expect(failing(ROOK, s, BASE_T)).toEqual(only('enemy_king_on_board'));
  });

  it('fails with two black kings', () => {
    const s = stageOf(BASE_T, board(`${BASE_BLACK} Kc5`, 'd3'));
    expect(failing(ROOK, s, BASE_T)).toEqual(only('enemy_king_on_board'));
  });

  it('fails with a White Hero Piece on the board', () => {
    const b = { ...board(BASE_BLACK, 'd3'), h1: { pieceType: 'knight', color: 'white', instanceId: 'x', rarity: 'normal' } } as const;
    expect(failing(ROOK, stageOf(BASE_T, b), BASE_T)).toEqual(only('enemy_king_on_board'));
  });

  it('fails outside the deployment phase', () => {
    const s = deepFreeze({ ...base(), phase: 'action' as const });
    expect(failing(ROOK, s, BASE_T)).toEqual(only('enemy_king_on_board'));
  });
});

describe('safe_king_square', () => {
  // Act III (band 14-22): Black rooks on the a-file sweep ranks 1-4.
  const T = tpl({ id: 'tpl-test-3', act: 3, spawnedPawns: { count: [1, 1], ranks: [5] }, preconditions: ALL });

  it('passes when one empty deployment square is not attacked', () => {
    expect(failing(ROOK, stageOf(T, board('Kg8 Ra1 Ra2 Ra3', 'h5')), T)).toEqual([]);
  });

  it('fails when every empty deployment square is attacked', () => {
    expect(failing(ROOK, stageOf(T, board('Kg8 Ra1 Ra2 Ra3 Ra4', 'h5')), T)).toEqual(only('safe_king_square'));
  });
});

describe('no_first_turn_mate', () => {
  const BACK_RANK = 'Kg8 Pb7 Pc7 Pd7 Pe7 Pf7 Pg7 Ph7';

  it('passes when the deck cannot mate on turn 1 (luft on h7)', () => {
    expect(failing(ROOK, base(), BASE_T)).toEqual([]);
    expect(firstTurnMate(ROOK, base(), config)).toBeNull();
  });

  it('fails a back-rank board through Ra1-a8', () => {
    const s = stageOf(BASE_T, board(BACK_RANK, 'd3'));
    expect(failing(ROOK, s, BASE_T)).toEqual(only('no_first_turn_mate'));
    expect(firstTurnMate(ROOK, s, config)).toEqual({
      placements: [{ instanceId: 'rook-normal-1', to: 'a1' }],
      moves: [{ from: 'a1', to: 'a8' }],
    });
  });

  it('counts only in-deck pieces with durability of at least 1', () => {
    const s = stageOf(BASE_T, board(BACK_RANK, 'd3'));
    expect(failing(deck(['rook', 'normal', { durability: 0 }]), s, BASE_T)).toEqual([]);
    expect(failing(deck(['rook', 'normal', { status: 'deployed' }]), s, BASE_T)).toEqual([]);
  });

  describe('a board that mates only with a bishop and knight pair', () => {
    // Bishop on the long diagonal checks h8; only Ng4-h6 covers g8 without blocking it.
    const BN = 'Kh8 Pa7 Pb7 Pc7 Nb8 Pg6 Ph7'; // value 8
    const s = () => stageOf(BASE_T, board(BN, 'd3'));
    const pair = deck(['bishop', 'normal'], ['knight', 'normal']);

    it('fails with both pieces in the deck', () => {
      expect(failing(pair, s(), BASE_T)).toEqual(only('no_first_turn_mate'));
      expect(firstTurnMate(pair, s(), config)).toEqual({
        placements: [{ instanceId: 'bishop-normal-1', to: 'a1' }, { instanceId: 'knight-normal-2', to: 'g4' }],
        moves: [{ from: 'g4', to: 'h6' }],
      });
    });

    it('passes with either piece alone', () => {
      expect(failing(deck(['bishop', 'normal']), s(), BASE_T)).toEqual([]);
      expect(failing(deck(['knight', 'normal']), s(), BASE_T)).toEqual([]);
    });

    it('passes when the pair does not fit the spawn points', () => {
      const t = { ...BASE_T, spawnPoints: 5 };
      expect(failing(pair, stageOf(t, board(BN, 'd3')), t)).toEqual([]);
    });
  });

  it('tries two identical instances as a pair', () => {
    // Ra8 needs a second rook on the h-file to cover h7 and h8; two rooks need Act II's 12 points.
    const s = stageOf({ ...BASE_T, act: 2 }, board('Kg8 Pc7 Pd7 Pe7 Pf7 Pg7', 'd3'));
    expect(firstTurnMate(deck(['rook', 'normal'], ['rook', 'normal']), stageOf(BASE_T, s.board), config)).toBeNull();
    expect(firstTurnMate(ROOK, s, config)).toBeNull();
    expect(firstTurnMate(deck(['rook', 'normal'], ['rook', 'normal']), s, config)).toEqual({
      placements: [{ instanceId: 'rook-normal-1', to: 'a1' }, { instanceId: 'rook-normal-2', to: 'h1' }],
      moves: [{ from: 'a1', to: 'a8' }],
    });
  });

  describe('rarity abilities (docs/02 §2.3)', () => {
    it('a Rare rook leaps the spawned pawn on a4', () => {
      const s = stageOf(BASE_T, board(BACK_RANK, 'a4'));
      expect(firstTurnMate(ROOK, s, config)).toBeNull();
      expect(firstTurnMate(deck(['rook', 'rare']), s, config)).toEqual({
        placements: [{ instanceId: 'rook-rare-1', to: 'a1' }],
        moves: [{ from: 'a1', to: 'a8' }],
      });
    });

    it("a Rare knight's straight leap smothers h8 from g6", () => {
      // f4 and h4 hold spawned pawns, so no Normal knight reaches g6.
      const s = stageOf(BASE_T, board('Kh8 Rh7 Bg8 Pg7', 'f4 h4'));
      expect(firstTurnMate(deck(['knight', 'normal']), s, config)).toBeNull();
      expect(firstTurnMate(deck(['knight', 'rare']), s, config)).toEqual({
        placements: [{ instanceId: 'knight-rare-1', to: 'g4' }],
        moves: [{ from: 'g4', to: 'g6' }],
      });
    });

    it("a Legendary knight's free second move reaches the smothered mate on f7", () => {
      const s = stageOf(BASE_T, board('Kh8 Rg8 Pg7 Ph7'));
      expect(firstTurnMate(deck(['knight', 'unique']), s, config)).toBeNull();
      const m = firstTurnMate(deck(['knight', 'legendary']), s, config);
      expect(m?.moves).toHaveLength(2);
      expect(m?.moves[0]!.to).toBe(m?.moves[1]!.from);
      expect(m?.moves[1]!.to).toBe('f7');
    });

    it('a Legendary rook multi-captures a7 and a8 to mate on the back rank', () => {
      const s = stageOf(BASE_T, board('Kg8 Na8 Pa7 Pb7 Pc7 Pd7 Pe7 Pf7 Pg7 Ph7'));
      expect(firstTurnMate(deck(['rook', 'unique']), s, config)).toBeNull();
      expect(firstTurnMate(deck(['rook', 'legendary']), s, config)).toEqual({
        placements: [{ instanceId: 'rook-legendary-1', to: 'a1' }],
        moves: [{ from: 'a1', to: 'a8' }],
      });
    });
  });

  it('gives the same result and witness on 50 generated boards with the deck in reversed order', () => {
    const run = exampleRun('mid');
    const reversed = deepFreeze({ ...run, deck: [...run.deck].reverse() });
    for (const { tpl: t, stage } of generatedStages('tpl-act2-fortress', 50)) {
      expect(check(reversed, stage, t)).toBe(check(run, stage, t));
      expect(firstTurnMate(reversed, stage, config)).toEqual(firstTurnMate(run, stage, config));
    }
  });
});

describe('enemy_has_moves', () => {
  // Every Black pawn is blocked; the spawned pawns on a6, b6 (and c7) take the king's squares.
  const T = tpl({ id: 'tpl-test-stale', spawnedPawns: { count: [5, 6], ranks: [4, 6, 7] }, preconditions: ALL });
  const BLACK = 'Ka8 Pd7 Pd6 Pd5 Pf7 Pf6 Pf5 Ph7 Ph6 Ph5'; // value 9
  const KING_ONLY = deck();

  it('passes when the enemy has a legal move (Kb8)', () => {
    expect(failing(KING_ONLY, stageOf(T, board(BLACK, 'a6 b6 d4 f4 h4')), T)).toEqual([]);
  });

  it('fails a stalemate', () => {
    expect(failing(KING_ONLY, stageOf(T, board(BLACK, 'a6 b6 c7 d4 f4 h4')), T)).toEqual(only('enemy_has_moves'));
  });
});

describe('enemy_value_in_band', () => {
  it('passes at both ends of the Act I band', () => {
    expect(failing(ROOK, base(), BASE_T)).toEqual([]); // 7
    expect(failing(ROOK, stageOf(BASE_T, board(`${BASE_BLACK} Pa7 Pa6`, 'd3')), BASE_T)).toEqual([]); // 9
  });

  it('fails below and above the band', () => {
    const low = stageOf(BASE_T, board('Kg8 Pc7 Pd7 Pe7 Pf7 Pg7 Ph6', 'd3')); // 6
    const high = stageOf(BASE_T, board(`${BASE_BLACK} Nb8`, 'd3')); // 10
    expect(failing(ROOK, low, BASE_T)).toEqual(only('enemy_value_in_band'));
    expect(failing(ROOK, high, BASE_T)).toEqual(only('enemy_value_in_band'));
  });

  it("uses a boss template's scaled band", () => {
    const t = { ...BASE_T, tier: 'boss' as const };
    expect(failing(ROOK, stageOf(t, board(BASE_BLACK, 'd3')), t)).toEqual(only('enemy_value_in_band')); // 7
    expect(failing(ROOK, stageOf(t, board(`${BASE_BLACK} Pa7 Pa6`, 'd3')), t)).toEqual([]); // 9
  });
});

describe('deployment_squares_available', () => {
  const T = tpl({ id: 'tpl-test-deploy', spawnedPawns: { count: [1, 32], ranks: [1, 2, 3, 4] }, preconditions: ALL });
  /** Spawned pawns on ranks 1-4 except the first `free` squares in index order. */
  const filled = (free: number) =>
    board(BASE_BLACK, Array.from({ length: 32 - free }, (_, i) => toSquare(free + i)).join(' '));
  // docs/04 §9: floor(spawnPoints / 3) + 1, the cheapest summon costing 3.
  const need = Math.floor(config.rules.spawnPoints.act1.normal / 3) + 1;

  it('passes with floor(spawnPoints / cheapest spawn cost) + 1 empty squares', () => {
    expect(failing(ROOK, stageOf(T, filled(need)), T)).toEqual([]);
  });

  it('fails with one square fewer', () => {
    expect(failing(ROOK, stageOf(T, filled(need - 1)), T)).toEqual(only('deployment_squares_available'));
  });

  it("reads the stage's spawn points, which a template may lower", () => {
    const t = { ...T, spawnPoints: 3 * (need - 2) };
    expect(failing(ROOK, stageOf(t, filled(need - 1)), t)).toEqual([]);
  });
});

describe('spawned_pawns_placed', () => {
  const pawn = (over: Partial<BoardPiece>, sq = 'd3') => {
    const b = board(BASE_BLACK, '');
    return stageOf(BASE_T, { ...b, [sq]: { ...board('', 'd3').d3!, ...over } });
  };

  it('passes a Rare pawn promoting to a Rare piece in Act I', () => {
    expect(failing(ROOK, pawn({ rarity: 'rare', promotesTo: { pieceType: 'bishop', rarity: 'rare' } }), BASE_T)).toEqual([]);
  });

  it('fails a pawn off the spawn ranks', () => {
    expect(failing(ROOK, pawn({}, 'e4'), BASE_T)).toEqual(only('spawned_pawns_placed'));
  });

  it('fails a rarity or promotesTo above the act ceiling, or missing', () => {
    expect(failing(ROOK, pawn({ rarity: 'unique' }), BASE_T)).toEqual(only('spawned_pawns_placed'));
    expect(failing(ROOK, pawn({ promotesTo: { pieceType: 'rook', rarity: 'unique' } }), BASE_T)).toEqual(only('spawned_pawns_placed'));
    expect(failing(ROOK, pawn({ rarity: undefined }), BASE_T)).toEqual(only('spawned_pawns_placed'));
    expect(failing(ROOK, pawn({ promotesTo: undefined }), BASE_T)).toEqual(only('spawned_pawns_placed'));
  });

  it('fails a count outside the range; extraPawns raises the upper end', () => {
    const none = stageOf(BASE_T, board(BASE_BLACK));
    const two = stageOf(BASE_T, board(BASE_BLACK, 'd3 e3'));
    expect(failing(ROOK, none, BASE_T)).toEqual(only('spawned_pawns_placed'));
    expect(failing(ROOK, two, BASE_T)).toEqual(only('spawned_pawns_placed'));
    expect(failing(ROOK, two, BASE_T, 1)).toEqual([]);
    expect(failing(ROOK, none, BASE_T, 1)).toEqual(only('spawned_pawns_placed'));
  });
});
