import { describe, expect, it } from 'vitest';
import { threatMap, deploymentStatus } from '../src/view';
import { startStage } from '../src/deployment';
import { attackedBy } from '../src/movegen';
import { fromBoard } from '../src/position';
import { spawnCostOf } from '../src/abilities';
import { toIndex, toSquare } from '../src/square';
import {
  config, deepFreeze, deploymentStageOf, fenToStage, GAME_FENS, RARITY_FENS, rarityStage, runOf, stageOf,
} from './helpers';
import type { Square, StageState } from '../src/types';

/**
 * Brute force: the Black piece at `from` attacks `sq` iff, with every other Black piece made a White
 * pawn (still a blocker, no longer an attacker), the engine's own attack test says so.
 */
function reference(stage: StageState): Record<Square, Square[]> {
  const b = fromBoard(stage.board);
  const out: Record<Square, Square[]> = {};
  for (let from = 0; from < 64; from++) {
    if (b[from]! >= 0) continue;
    const solo = b.map((c, i) => (c < 0 && i !== from ? 1 : c)) as Int8Array;
    for (let sq = 0; sq < 64; sq++) {
      if (sq === from) continue;
      if (attackedBy(solo, sq, -1)) (out[toSquare(sq)] ??= []).push(toSquare(from));
    }
  }
  for (const list of Object.values(out)) list.sort((x, y) => toIndex(x) - toIndex(y));
  return out;
}

const normalise = (m: Record<Square, { attackers: Square[] }>): Record<Square, Square[]> => {
  const o: Record<Square, Square[]> = {};
  for (const [sq, v] of Object.entries(m)) o[sq] = [...v.attackers].sort((x, y) => toIndex(x) - toIndex(y));
  return o;
};

describe('threatMap', () => {
  it('matches a brute-force reference on the golden positions', () => {
    for (const fen of GAME_FENS) {
      const s = fenToStage(fen);
      expect(normalise(threatMap(runOf(), s, config))).toEqual(reference(s));
    }
  });
  it('has an entry only for squares with an attacker', () => {
    const s = fenToStage(GAME_FENS[0]!);
    for (const v of Object.values(threatMap(runOf(), s, config))) expect(v.attackers.length).toBeGreaterThan(0);
  });
  it('on rarity boards still matches the reference (Black attacks are the engine\'s, White rarity changes none)', () => {
    for (const { fen, rarity } of RARITY_FENS) {
      const s = rarityStage(fen, rarity);
      expect(normalise(threatMap(runOf(), s, config))).toEqual(reference(s));
    }
  });
  it('counts pawn diagonals, defended pieces and slider blocking', () => {
    const s = stageOf({ e8: 'k', d5: 'p', a8: 'r', a4: 'P', h1: 'K' });
    const m = threatMap(runOf(), s, config);
    expect(m['c4']?.attackers).toEqual(['d5']);
    expect(m['e4']?.attackers).toEqual(['d5']);
    expect(m['d5']).toBeUndefined();
    expect(m['a5']?.attackers).toEqual(['a8']);
    expect(m['a4']?.attackers).toEqual(['a8']);
    expect(m['a3']).toBeUndefined();
  });
});

const P = (instanceId: string, to: string) => ({ instanceId, to });
const dstage = (over: Partial<StageState> = {}): StageState => deploymentStageOf({ e8: 'k' }, over);

describe('deploymentStatus', () => {
  const run = runOf();
  it('fills the spawn counter by spawnCostOf; the King is free', () => {
    const st = deploymentStatus(run, dstage(), [P('p_king_01', 'e1'), P('p_knight_02', 'd1')], config);
    expect(st.spawnBudget).toBe(9);
    expect(st.spawnUsed).toBe(spawnCostOf('knight', 'normal', config));
  });
  it('marks a tray piece over the remaining points too_expensive, placed ones placed', () => {
    const cost = spawnCostOf('knight', 'normal', config);
    const s = dstage({ spawnPoints: cost });
    const st = deploymentStatus(run, s, [P('p_king_01', 'e1'), P('p_knight_02', 'd1')], config);
    expect(st.tray['p_king_01']).toEqual({ placeable: false, reason: 'placed' });
    expect(st.tray['p_knight_02']).toEqual({ placeable: false, reason: 'placed' });
    expect(st.tray['p_knight_03']).toEqual({ placeable: false, reason: 'too_expensive' });
    expect(deploymentStatus(run, s, [], config).tray['p_knight_03']).toEqual({ placeable: true });
  });
  it('marks a spent piece spent', () => {
    const deck = run.deck.map((p) => (p.instanceId === 'p_knight_02' ? { ...p, durability: 0, status: 'spent' as const } : p));
    const st = deploymentStatus(deepFreeze({ ...run, deck }), dstage(), [], config);
    expect(st.tray['p_knight_02']).toEqual({ placeable: false, reason: 'spent' });
  });
  it('lists the start cost of non-kings', () => {
    const st = deploymentStatus(run, dstage(), [P('p_king_01', 'e1'), P('p_knight_02', 'd1')], config);
    expect(st.startCost).toEqual([{
      instanceId: 'p_knight_02', from: 2, to: 2 - config.rules.summonCostsDurability,
    }]);
  });
  it('drop answers the placement checks', () => {
    const d = deploymentStatus(run, dstage(), [P('p_knight_02', 'd1')], config).drop;
    expect(d('p_knight_03', 'd5')).toEqual({ ok: false, reason: 'outside_zone' });
    expect(d('p_knight_03', 'd1')).toEqual({ ok: false, reason: 'occupied' });
    expect(d('p_knight_02', 'f1')).toEqual({ ok: false, reason: 'duplicate' });
    expect(d('p_nope', 'f1')).toEqual({ ok: false, reason: 'not_in_deck' });
    expect(d('p_knight_03', 'f1')).toEqual({ ok: true });
  });
  it('drop refuses a King into check', () => {
    const s = deploymentStageOf({ e8: 'k', e5: 'r' });
    const d = deploymentStatus(run, s, [], config).drop;
    expect(d('p_king_01', 'e1')).toEqual({ ok: false, reason: 'king_in_check' });
    expect(d('p_king_01', 'd1')).toEqual({ ok: true });
  });
  it('drop refuses over the budget', () => {
    const s = dstage({ spawnPoints: spawnCostOf('knight', 'normal', config) });
    const d = deploymentStatus(run, s, [P('p_knight_02', 'd1')], config).drop;
    expect(d('p_knight_03', 'f1')).toEqual({ ok: false, reason: 'spawn_points_exceeded' });
  });

  it('agrees with startStage on 200 random placement sets', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 2 ** 32) * n);
    };
    const ids = ['p_king_01', 'p_knight_02', 'p_knight_03', 'p_bishop_04', 'p_bishop_05', 'p_nope'];
    const squares = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'a2', 'e2', 'd2', 'e4', 'c3', 'e5', 'f2', 'x9'];
    let okCount = 0;
    for (let n = 0; n < 200; n++) {
      const deck = runOf().deck.map((p) => (rnd(8) === 0 ? { ...p, durability: 0 } : p));
      const r = deepFreeze({ ...runOf(), deck });
      const black: Record<string, string> = { e8: 'k' };
      if (rnd(2)) black['e5'] = 'r';
      if (rnd(2)) black['b4'] = 'b';
      if (rnd(3) === 0) black['d2'] = 'n';
      const s = deploymentStageOf(black, { spawnPoints: 1 + rnd(7) });
      const picked = Array.from({ length: rnd(6) }, () => P(ids[rnd(ids.length)]!, squares[rnd(squares.length)]!));
      // King last: a King dropped before its blockers is judged on the board so far.
      const placements = [
        ...picked.filter((p) => p.instanceId !== 'p_king_01'),
        ...picked.filter((p) => p.instanceId === 'p_king_01'),
      ];
      const result = startStage(r, s, placements, config);
      const reasons = placements.map((p, i) => {
        const d = deploymentStatus(r, s, placements.slice(0, i), config).drop(p.instanceId, p.to);
        return d.ok ? null : d.reason;
      });
      const perPlacement = reasons.find((x) => x !== null && x !== 'spawn_points_exceeded' && x !== 'king_in_check') ?? null;
      const kings = placements.filter((p) => p.instanceId === 'p_king_01').length;
      const expected = perPlacement ?? (kings !== 1 ? 'king_missing'
        : reasons.includes('spawn_points_exceeded') ? 'spawn_points_exceeded'
          : reasons.includes('king_in_check') ? 'king_in_check' : null);
      const note = JSON.stringify({ placements, reasons });
      if (expected === null) {
        okCount++;
        expect(result.ok, note).toBe(true);
      } else {
        expect(result.ok, note).toBe(false);
        if (!result.ok) {
          const e = result.error;
          if (e.kind === 'invalid_deployment') expect(e.reason, note).toBe(expected);
          else if (e.kind === 'spawn_points_exceeded') expect(expected, note).toBe('spawn_points_exceeded');
          else expect(expected, note).toBe('not_in_deck'); // durability_unavailable reads as not_in_deck
        }
      }
    }
    expect(okCount).toBeGreaterThan(0);
  });
});
