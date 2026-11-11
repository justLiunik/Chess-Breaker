import { describe, expect, it } from 'vitest';
import type { PieceInstance, RunState, StageState } from '@checkbreaker/engine';
import { fileOf, rankOf, spawnCostOf, startStage, toIndex } from '@checkbreaker/engine';
import * as internal from '@checkbreaker/engine/internal';
import { deploymentCandidates } from '../src/solver/deployment';
import { config, deckRun, deepFreeze, generatedStages } from './helpers';

const act1 = generatedStages('tpl-act1-first-steps', 3).map((g) => g.stage);
const act2 = generatedStages('tpl-act2-fortress', 3).map((g) => g.stage);

const byId = (run: RunState, id: string): PieceInstance => run.deck.find((p) => p.instanceId === id)!;
const kingOnly = (run: RunState): RunState => deepFreeze({ ...run, deck: run.deck.filter((p) => p.pieceType === 'king') });

describe('deploymentCandidates', () => {
  it('gives at most maxCandidates candidates for the starter deck on Act I, all accepted by startStage', () => {
    const run = deckRun('starter', 0, 0);
    for (const stage of act1) {
      const cands = deploymentCandidates(run, stage, config);
      expect(cands.length).toBeGreaterThan(0);
      expect(cands.length).toBeLessThanOrEqual(config.gen.solver.deployment.maxCandidates);
      for (const c of cands) expect(startStage(run, stage, c, config).ok).toBe(true);
    }
  });

  it('spreads King squares over at least two ranks when they are safe', () => {
    const run = deckRun('starter', 0, 0);
    for (const stage of act1) {
      const b = internal.fromBoard(stage.board);
      const ranks = new Set(deploymentCandidates(run, stage, config).map((c) => c[0]!.to[1]));
      const safe = (r: number) => [0, 1, 2, 3, 4, 5, 6, 7].some((f) => b[f + 8 * (r - 1)] === 0 && !internal.isAttacked(b, f + 8 * (r - 1), 'black'));
      if (safe(1) && safe(2)) expect(ranks.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives no candidates when every deployment square is attacked', () => {
    const run = deckRun('starter', 0, 0);
    const stage = act1[0]!;
    const board = { ...stage.board };
    for (const f of 'abcdefgh') for (const r of [1, 2, 3, 4]) delete board[`${f}${r}`];
    for (const f of 'abcdefgh') board[`${f}5`] = { pieceType: 'rook', color: 'black', stageId: `x${f}` };
    const walled = deepFreeze({ ...stage, board });
    expect(deploymentCandidates(run, walled, config)).toEqual([]);
  });

  it('every candidate includes the King', () => {
    const run = deckRun('starter', 0, 0);
    for (const c of deploymentCandidates(run, act1[0]!, config)) {
      expect(c.some((p) => byId(run, p.instanceId).pieceType === 'king')).toBe(true);
    }
  });

  it('never yields two candidates that differ only in which identical instance is used', () => {
    const run = deckRun('starter', 0, 0);
    const key = (c: { instanceId: string; to: string }[]) =>
      c.map((p) => `${byId(run, p.instanceId).pieceType}:${byId(run, p.instanceId).rarity}@${p.to}`).sort().join(',');
    for (const stage of act1) {
      const keys = deploymentCandidates(run, stage, config).map(key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('no King square is attacked or on an open line to a Black slider', () => {
    const run = deckRun('mid', 1, 0);
    for (const stage of [...act1, ...act2]) {
      const b = internal.fromBoard(stage.board);
      for (const c of deploymentCandidates(run, stage, config)) {
        const k = c.find((p) => byId(run, p.instanceId).pieceType === 'king')!;
        const sq = toIndex(k.to);
        expect(internal.isAttacked(b, sq, 'black')).toBe(false);
        for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          let f = fileOf(sq) + df;
          let r = rankOf(sq) + dr;
          while (f >= 0 && f < 8 && r >= 0 && r < 8) {
            const v = b[f + 8 * r]!;
            if (v !== 0) {
              const diag = df !== 0 && dr !== 0;
              const slider = diag ? [-internal.BISHOP, -internal.QUEEN] : [-internal.ROOK, -internal.QUEEN];
              expect(slider).not.toContain(v);
              break;
            }
            f += df;
            r += dr;
          }
        }
      }
    }
  });

  it("the first candidate's subset is maximal: no further deck piece fits", () => {
    for (const [run, stage] of [[deckRun('starter', 0, 0), act1[0]!], [deckRun('mid', 1, 0), act2[0]!]] as const) {
      const first = deploymentCandidates(run, stage, config)[0]!;
      const used = new Set(first.map((p) => p.instanceId));
      const spent = first.reduce((s, p) => {
        const i = byId(run, p.instanceId);
        return i.pieceType === 'king' ? s : s + spawnCostOf(i.pieceType, i.rarity ?? 'normal', config);
      }, 0);
      for (const i of run.deck) {
        if (i.pieceType === 'king' || used.has(i.instanceId) || i.status !== 'in_deck' || (i.durability ?? 0) < 1) continue;
        expect(spent + spawnCostOf(i.pieceType, i.rarity ?? 'normal', config)).toBeGreaterThan(stage.spawnPoints);
      }
    }
  });

  it('a King-only deck gives candidates with only the King', () => {
    const run = kingOnly(deckRun('starter', 0, 0));
    const cands = deploymentCandidates(run, act1[0]!, config);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(c).toHaveLength(1);
    for (const c of cands) expect(startStage(run, act1[0]!, c, config).ok).toBe(true);
  });

  it('the reversed deck array gives the same list', () => {
    const run = deckRun('mid', 1, 0);
    const rev = deepFreeze({ ...run, deck: [...run.deck].reverse() });
    for (const stage of [act1[0]!, act2[0]!] as StageState[]) {
      expect(deploymentCandidates(rev, stage, config)).toEqual(deploymentCandidates(run, stage, config));
    }
  });

  it('the same input twice gives deep equality', () => {
    const run = deckRun('starter', 0, 0);
    expect(deploymentCandidates(run, act1[0]!, config)).toEqual(deploymentCandidates(run, act1[0]!, config));
  });
});
