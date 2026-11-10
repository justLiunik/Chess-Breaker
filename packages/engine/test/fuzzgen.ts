import { TIERS, fromBoard, tiersOf } from '../src/position';
import { inCheck, legalMoves } from '../src/legality';
import { pseudoMoves } from '../src/movegen';
import type { Move } from '../src/movegen';
import { applyPlayerMove } from '../src/queue';
import { hasBonusMove } from '../src/abilities';
import { rng, hash } from '../src/rng';
import { toSquare } from '../src/square';
import type { Action, BoardPiece, PieceInstance, RunState, Square, StageState } from '../src/types';
import { config, runOf, stageOf } from './helpers';

export interface Case { run: RunState; stage: StageState; queue: Action[]; credits: number }

/**
 * All randomness comes from `rng`; one stream per case index. Consecutive FNV draws are correlated
 * in their top bits, so each is finished with a murmur-style mix before scaling (as `randomBoard`).
 */
function stream(label: string, i: number) {
  let cursor = 0;
  return (n: number): number => {
    const r = rng(`${label}:${i}`, cursor);
    cursor = r.next;
    let h = r.value * 2 ** 32 >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return Math.floor(((h >>> 0) / 2 ** 32) * n);
  };
}

const KINDS = ['q', 'r', 'b', 'n', 'p'];
const LAUNCH_SKILLS = ['twin_step', 'ascension', 'lockdown'];

/**
 * Gives each White knight, bishop, rook and queen a random rarity, and builds the deck to match the
 * board: one instance per Hero Piece, same id and rarity, `deployed` or `spent` as `startStage`
 * leaves a summon (queens sometimes with their lifeline used). R5 captures then hit real instances.
 */
function heroDeck(stage: StageState, sub: (n: number) => number): { stage: StageState; deck: PieceInstance[] } {
  const board: Record<Square, BoardPiece> = {};
  const deck: PieceInstance[] = [];
  for (const [sq, piece] of Object.entries(stage.board)) {
    if (piece.color !== 'white' || piece.instanceId === undefined) {
      board[sq] = piece;
      continue;
    }
    if (piece.pieceType === 'king') {
      board[sq] = piece;
      deck.push({
        instanceId: piece.instanceId, pieceType: 'king', rarity: null, durability: null, durabilityMax: null,
        origin: 'starter', acquiredAtStage: 0, status: 'deployed',
      });
      continue;
    }
    const pieceType = piece.pieceType as Exclude<PieceInstance['pieceType'], 'king'>;
    const rarity = TIERS[sub(TIERS.length)]!;
    board[sq] = { ...piece, rarity };
    const durability = sub(3);
    deck.push({
      instanceId: piece.instanceId, pieceType, rarity, durability, durabilityMax: 2,
      origin: 'starter', acquiredAtStage: 0, status: durability === 0 ? 'spent' : 'deployed',
      ...(pieceType === 'queen' && sub(4) === 0 && { usedOnce: ['lifeline' as const] }),
    });
  }
  return { stage: { ...stage, board }, deck };
}

const LINES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Sometimes plants a White rook or queen with two Black pieces adjacent on one of its lines, the
 * squares between empty: the shape a Legendary rook's or queen's multi-capture needs (sparse random
 * boards almost never have it). Does nothing when a square is off the board or taken.
 */
function plantLine(sub: (n: number) => number, taken: Set<number>, pieces: Record<Square, string>): void {
  const queen = sub(2) === 0;
  const [df, dr] = LINES[queen ? sub(8) : sub(4)]!;
  const k = 1 + sub(3);
  const from = sub(64);
  const line: number[] = [from];
  for (let j = 1; j <= k + 1; j++) {
    const f = (from & 7) + j * df;
    const r = (from >> 3) + j * dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) return;
    line.push(f + 8 * r);
  }
  if (line.some((sq) => taken.has(sq))) return;
  const x = line[k]!;
  const y = line[k + 1]!;
  const black = (sq: number): string => {
    const letter = ['n', 'b', 'r', 'p'][sub(4)]!;
    return letter === 'p' && (sq < 8 || sq >= 56) ? 'n' : letter;
  };
  for (const [sq, letter] of [[from, queen ? 'Q' : 'R'], [x, black(x)], [y, black(y)]] as const) {
    taken.add(sq);
    pieces[toSquare(sq)] = letter;
  }
}

/**
 * A legal position (kings plus a few pieces, neither side in check as White's rarity abilities see
 * it, Black can move), White's Hero Pieces at random rarities with a matching deck, plus a short
 * queue. Moves are mostly White's legal ability moves on the board as the queue leaves it (preferring
 * a Legendary knight and multi-captures, and often moving a knight again so the bonus move is tried).
 */
export function makeCase(label: string, i: number): Case {
  const pick = stream(label, i);
  for (let attempt = 0; ; attempt++) {
    const sub = stream(`${label}/${attempt}`, i);
    const pieces: Record<Square, string> = {};
    const taken = new Set<number>();
    const place = (letter: string, pawn = false): void => {
      for (;;) {
        const sq = sub(64);
        if (taken.has(sq)) continue;
        if (pawn && (sq < 8 || sq >= 56)) continue;
        taken.add(sq);
        pieces[toSquare(sq)] = letter;
        return;
      }
    };
    place('K');
    place('k');
    if (sub(3) === 0) plantLine(sub, taken, pieces);
    const others = 2 + sub(7);
    for (let n = 0; n < others; n++) {
      const kind = sub(5) === 0 ? 'b' : KINDS[sub(KINDS.length)]!;
      const letter = sub(2) === 0 ? kind.toUpperCase() : kind;
      place(letter, kind === 'p');
    }
    const credits = 1 + pick(2);
    const plain = stageOf(pieces, {
      moveCredits: credits, focus: sub(6) === 0 ? 0 : 1 + sub(3), focusPool: 3, enemyPolicy: { type: 'best_move', depth: 1 },
      turnsUsed: sub(6), turnLimit: 8,
    });
    const { stage, deck } = heroDeck(plain, sub);
    const b = fromBoard(stage.board);
    const tiers = { t: tiersOf(stage.board), table: config.abilities };
    if (inCheck(b, 'white') || inCheck(b, 'black', tiers) || legalMoves(b, 'black', undefined, tiers).length === 0) continue;
    const queue: Action[] = [];
    const length = 1 + sub(3);
    // Random loadout of the launch skills, with random charges (0 sometimes).
    const loadout = LAUNCH_SKILLS.filter(() => sub(4) > 0)
      .map((skillId) => ({ skillId, charges: sub(6) === 0 ? 0 : 1 + sub(2), chargesMax: 3 }));
    const occupied = Object.keys(stage.board);
    let board: StageState['board'] = stage.board;
    let lastKnight: Square | null = null;
    for (let q = 0; q < length; q++) {
      if (sub(q === 0 ? 2 : 4) === 0) {
        // A skill: mostly from the loadout (or a stranger), a target that is usually a real piece.
        const skillId = sub(8) === 0 ? ['gallop', 'nonsense'][sub(2)]! : LAUNCH_SKILLS[sub(3)]!;
        // Usually the kind of piece the skill wants; sometimes any piece or a random square.
        const wanted = Object.entries(stage.board).filter(([, p]) =>
          skillId === 'ascension' ? p.color === 'white' && p.pieceType === 'bishop' : p.color === 'black')
          .map(([sq]) => sq);
        const roll = sub(8);
        const target = skillId === 'twin_step' && roll > 0 ? undefined
          : roll === 0 ? toSquare(sub(64))
          : roll === 1 ? occupied[sub(occupied.length)]!
          : wanted.length > 0 ? wanted[sub(wanted.length)]! : undefined;
        queue.push({ type: 'ACTIVATE_SKILL', skillId, ...(target !== undefined && { target }) });
        continue;
      }
      const cb = fromBoard(board);
      const legal = legalMoves(cb, 'white', undefined, { t: tiersOf(board), table: config.abilities });
      const again: Move[] = lastKnight === null ? [] : legal.filter((m) => toSquare(m.from) === lastKnight);
      const multi = legal.filter((m) => m.via >= 0);
      const bonusMover = legal.filter((m) => hasBonusMove(board[toSquare(m.from)]!, config));
      const roll = sub(10);
      let move: { from: Square; to: Square } | null = null;
      if (roll === 0) {
        move = { from: toSquare(sub(64)), to: toSquare(sub(64)) };
      } else if (roll <= 2 || legal.length === 0) {
        // M1 pseudo-legal moves: some leave the king in check.
        const pseudo = pseudoMoves(cb, 'white');
        const m = pseudo.length > 0 ? pseudo[sub(pseudo.length)]! : null;
        move = m && { from: toSquare(m.from), to: toSquare(m.to) };
      } else {
        const pool: Move[] = again.length > 0 && sub(4) > 0 ? again
          : bonusMover.length > 0 && sub(2) === 0 ? bonusMover
          : multi.length > 0 && sub(4) > 0 ? multi
          : legal;
        const m = pool[sub(pool.length)]!;
        move = { from: toSquare(m.from), to: toSquare(m.to) };
      }
      if (move === null) continue;
      queue.push({ type: 'MOVE', ...move });
      const mover: BoardPiece | undefined = board[move.from];
      lastKnight = mover?.color === 'white' && mover.pieceType === 'knight' ? move.to : null;
      if (mover?.color === 'white' && legal.some((m) => toSquare(m.from) === move.from && toSquare(m.to) === move.to)) {
        board = applyPlayerMove(board, move.from, move.to, config).board;
      }
    }
    return { run: runOf({ seed: `F${hash(label, i)}`, loadout, deck }), stage, queue, credits };
  }
}
