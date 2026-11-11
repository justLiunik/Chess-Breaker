import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { TIERS, draw, fileOf, rankOf, toIndex } from '@checkbreaker/engine';
import type { BoardPiece, Rarity } from '@checkbreaker/engine';
import type { ActKey } from '@checkbreaker/content';
import { bonusPawnSquares, drawPar, makeBonusPawn, placeSpawnedPawns, rollPromotion, rollRarity } from '../src/spawn';
import { buildStage } from '../src/stage';
import { enemyBoard } from '../src/board';
import { config, stubFormations, tpl } from './helpers';

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
const seedOf = (i: number) => `${hex4(Math.floor(i / 65536))}-${hex4(i % 65536)}`;
const ACTS: ActKey[] = ['act1', 'act2', 'act3'];

describe('drawPar', () => {
  it('stays in range for 1000 seeds and hits both ends', () => {
    const t = tpl({ id: 'p', mateIn: [2, 5] });
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const p = drawPar(t, seedOf(i));
      expect(p).toBeGreaterThanOrEqual(2);
      expect(p).toBeLessThanOrEqual(5);
      seen.add(p);
    }
    expect(seen.has(2) && seen.has(5)).toBe(true);
  });
});

describe('rollRarity', () => {
  it('Act I gives only normal or rare at about 75/25', () => {
    const counts: Record<string, number> = {};
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const r = rollRarity('act1', draw('rar', i), config);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['normal', 'rare']);
    expect(Math.abs(counts.normal! / n - 0.75)).toBeLessThan(0.02);
    expect(Math.abs(counts.rare! / n - 0.25)).toBeLessThan(0.02);
  });
});

describe('rollPromotion', () => {
  it('never exceeds the act ceiling', () => {
    for (const act of ACTS) {
      const ceiling = TIERS.indexOf(config.gen.rarityPool[act].ceiling);
      for (let i = 0; i < 10000; i++) {
        const start = rollRarity(act, draw('pr', act, i, 'r'), config);
        const r = rollPromotion(act, start, (f) => draw('pr', act, i, f), config);
        expect(TIERS.indexOf(r.rarity)).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it('Act III queen legendary appears at about 0.2 of its unretained rate', () => {
    const keep = config.gen.retention.queen!.legendary!;
    const n = 200000;
    let observed = 0;
    let unretained = 0;
    for (let i = 0; i < n; i++) {
      const start = rollRarity('act3', draw('q', i, 'r'), config);
      const stream = (f: string) => draw('q', i, f);
      const r = rollPromotion('act3', start, stream, config);
      if (r.pieceType === 'queen' && r.rarity === 'legendary') observed++;
      // the same roll without the retention step: the result before the retention check
      const noRetention = { ...config, gen: { ...config.gen, retention: {} } };
      const u = rollPromotion('act3', start, stream, noRetention);
      if (u.pieceType === 'queen' && u.rarity === 'legendary') unretained++;
    }
    expect(unretained).toBeGreaterThan(1000);
    expect(Math.abs(observed / unretained / keep - 1)).toBeLessThan(0.3);
  });
});

const base = () => enemyBoard(tpl({ id: 'e', enemyZone: [7, 8] }), stubFormations, 'ABCD-0001', 0, config)!.board;
const kingSq = (b: Record<string, BoardPiece>) => Object.keys(b).find((s) => b[s]!.pieceType === 'king')!;
const attacksKing = (sq: string, king: string) => {
  const s = toIndex(sq);
  const k = toIndex(king);
  return (k === s + 7 && fileOf(s) !== 0) || (k === s + 9 && fileOf(s) !== 7);
};

describe('placeSpawnedPawns', () => {
  it('places only on spawn ranks, never attacks the king, keeps enemies, continues ids', () => {
    const t = tpl({ id: 's', spawnedPawns: { count: [2, 4], ranks: [6, 7] } });
    for (let i = 0; i < 200; i++) {
      const b = base();
      const before = JSON.stringify(b);
      const out = placeSpawnedPawns(b, t, seedOf(i), 0, config)!;
      expect(JSON.stringify(b)).toBe(before);
      const ks = kingSq(b);
      const enemyN = Object.keys(b).length;
      let pawns = 0;
      for (const [sq, p] of Object.entries(out)) {
        if (!p.spawned) {
          expect(b[sq]).toEqual(p);
          continue;
        }
        pawns++;
        expect([6, 7]).toContain(rankOf(toIndex(sq)) + 1);
        expect(attacksKing(sq, ks)).toBe(false);
        expect(p.color).toBe('white');
        expect(p.instanceId).toBeUndefined();
        expect(Number(p.stageId!.slice(1))).toBeGreaterThan(enemyN);
      }
      expect(pawns).toBeGreaterThanOrEqual(2);
      expect(pawns).toBeLessThanOrEqual(4);
      expect(Object.keys(out).length).toBe(enemyN + pawns);
    }
  });

  it('returns null when there is no square', () => {
    const t = tpl({ id: 's', spawnedPawns: { count: [3, 3], ranks: [1] } });
    const empty: Record<string, BoardPiece> = { h8: { pieceType: 'king', color: 'black', stageId: 's01' } };
    expect(placeSpawnedPawns(empty, t, 'ABCD-0001', 0, config)).not.toBeNull();
    const full: Record<string, BoardPiece> = { ...empty };
    for (const f of 'abcdefgh') full[`${f}1`] = { pieceType: 'rook', color: 'black', stageId: `s1${f}` };
    expect(placeSpawnedPawns(full, t, 'ABCD-0001', 0, config)).toBeNull();
  });

  it('is deterministic', () => {
    const t = tpl({ id: 's', spawnedPawns: { count: [2, 3], ranks: [3, 4] } });
    expect(placeSpawnedPawns(base(), t, 'ABCD-0002', 1, config)).toEqual(placeSpawnedPawns(base(), t, 'ABCD-0002', 1, config));
  });
});

describe('bonus pawn', () => {
  it('orders free, non-attacking spawn squares by the bonus stream, and builds a valid pawn', () => {
    const t = tpl({ id: 'b', spawnedPawns: { count: [1, 1], ranks: [7] } });
    const b = base();
    const sqs = bonusPawnSquares(b, t, 'ABCD-0003');
    const ks = kingSq(b);
    expect(sqs.length).toBeGreaterThan(0);
    expect(new Set(sqs).size).toBe(sqs.length);
    for (const s of sqs) {
      expect(b[s]).toBeUndefined();
      expect(rankOf(toIndex(s))).toBe(6);
      expect(attacksKing(s, ks)).toBe(false);
    }
    const us = sqs.map((s) => draw('ABCD-0003', 'bonus-pawn', s));
    expect([...us].sort((a, c) => a - c)).toEqual(us);
    const p = makeBonusPawn(sqs[0]!, 'act2', 'ABCD-0003', config);
    expect(p.spawned).toBe(true);
    expect(p.pieceType).toBe('pawn');
    expect(TIERS).toContain(p.rarity as Rarity);
    expect(p.promotesTo).toBeDefined();
  });
});

describe('buildStage', () => {
  const schema = JSON.parse(readFileSync(new URL('../../../schemas/stage.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

  it('emits schema-valid deployment state', () => {
    for (const act of ACTS) {
      const t = tpl({ id: 'tpl-v', act: Number(act[3]) as 1 | 2 | 3, spawnedPawns: { count: [2, 3], ranks: [3, 4] } });
      const board = placeSpawnedPawns(base(), t, 'ABCD-0004', 0, config)!;
      const s = buildStage(t, board, act, 'normal', 'ABCD-0004', drawPar(t, 'ABCD-0004'), config);
      expect(validate(s), JSON.stringify(validate.errors)).toBe(true);
      expect(s.phase).toBe('deployment');
      expect(s.spawnPoints).toBe(config.rules.spawnPoints[act].normal);
      expect(s.moveCredits).toBe(config.rules.freeMovesPerTurn);
    }
  });

  it('caps template spawnPoints at the budget, adds a scripted cursor, falls back to the rules focus pool', () => {
    const t = tpl({
      id: 'tpl-v',
      spawnPoints: 99,
      focusPool: undefined as never,
      enemyPolicy: { type: 'scripted', line: ['c6e5'], fallbackDepth: 2 },
    });
    const s = buildStage(t, {}, 'act1', 'boss', 'ABCD-0004', 3, config);
    expect(s.spawnPoints).toBe(config.rules.spawnPoints.act1.boss);
    expect(s.enemyPolicy).toEqual({ type: 'scripted', line: ['c6e5'], fallbackDepth: 2, cursor: 0 });
    expect(s.focus).toBe(config.rules.focusPool);
    expect(s.focusPool).toBe(config.rules.focusPool);
    expect(t.enemyPolicy).not.toHaveProperty('cursor');
    const low = buildStage(tpl({ id: 'tpl-v', spawnPoints: 4 }), {}, 'act1', 'normal', 'ABCD-0004', 3, config);
    expect(low.spawnPoints).toBe(4);
  });
});
