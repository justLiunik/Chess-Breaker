import { describe, expect, it } from 'vitest';
import type { StageState } from '@checkbreaker/engine';
import { hash } from '@checkbreaker/engine';
import { loadFormations, loadTemplates } from '@checkbreaker/content';
import type { Template } from '@checkbreaker/content';
import { generateWith } from '../src/generate';
import { selectTemplates } from '../src/select';
import type { SolveResult } from '../src/types';
import { config, deckRun, tpl } from './helpers';

const templates = loadTemplates();
const formations = loadFormations();
const content = { templates, formations };
const ZERO = { screenNodes: 0, deepNodes: 0, deployments: 0, enemyCalls: 0, memoHits: 0 };
const proof = (nodes = 0): SolveResult => ({
  win: { placements: [], line: [], mateTurn: 1 },
  stats: { ...ZERO, screenNodes: nodes },
});
const none: SolveResult = { win: null, stats: ZERO };

const stageSeedOf = (seed: string): string => {
  const h = hash(seed, 0, 0).toString(16).toUpperCase().padStart(8, '0');
  return `${h.slice(0, 4)}-${h.slice(4)}`;
};
const input = { run: deckRun('mid', 1, 0), actIndex: 1, stageIndex: 0 };
const spawned = (s: StageState) => Object.values(s.board).filter((p) => p.spawned).length;
const black = (s: StageState) =>
  Object.entries(s.board)
    .filter(([, p]) => p.color === 'black')
    .sort(([a], [b]) => (a < b ? -1 : 1));

describe('generateWith', () => {
  it('emits the first board when it is proven', () => {
    const calls: StageState[] = [];
    const r = generateWith(input, content, config, (_run, s) => (calls.push(s), proof(5)));
    expect(calls).toHaveLength(1);
    expect(r.provenance.proven).toBe(true);
    expect(r.provenance.bonusPawn).toBe(false);
    expect(r.provenance.solverNodes).toBe(5);
    expect(r.stage.board).toEqual(calls[0]!.board);
    expect(spawned(r.stage)).toBe(spawned(calls[0]!));
  });

  it('emits the second board when only it is proven', () => {
    const calls: StageState[] = [];
    const r = generateWith(input, content, config, (_run, s) => (calls.push(s), calls.length === 2 ? proof(2) : none));
    expect(calls).toHaveLength(2);
    expect(r.stage.board).toEqual(calls[1]!.board);
    expect(r.provenance.proven).toBe(true);
    expect(r.provenance.solverNodes).toBe(2);
  });

  it('adds one spawned pawn to the first board when nothing is proven', () => {
    const calls: StageState[] = [];
    const r = generateWith(input, content, config, (_run, s) => (calls.push(s), none));
    expect(calls).toHaveLength(3);
    expect(r.provenance.proven).toBe(false);
    expect(r.provenance.bonusPawn).toBe(true);
    expect(r.provenance.validationFailed).toBeUndefined();
    expect(spawned(r.stage)).toBe(spawned(calls[0]!) + 1);
    expect(black(r.stage)).toEqual(black(calls[0]!));
    const extra = Object.keys(r.stage.board).filter((sq) => !calls[0]!.board[sq]);
    expect(extra).toHaveLength(1);
    expect(r.stage.board[extra[0]!]!.stageId).toBe(
      `s${String(Object.keys(calls[0]!.board).length + 1).padStart(2, '0')}`,
    );
  });

  const impossible = tpl({
    id: 'tpl-act1-aaa-impossible',
    enemyArmy: { queen: [8, 8] },
    enemyZone: [7, 8],
    preconditions: ['enemy_value_in_band'],
  });

  it('emits validationFailed after 20 attempts when the only template cannot pass', () => {
    const r = generateWith(
      { run: deckRun('starter', 0, 0), actIndex: 0, stageIndex: 0 },
      { templates: [impossible], formations: {} },
      config,
      () => {
        throw new Error('no board should be solved');
      },
    );
    expect(r.provenance.validationFailed).toBe(true);
    expect(r.provenance.attempts).toBe(20);
    expect(r.stage.provenance?.validationFailed).toBe(true);
    expect(r.provenance.proven).toBe(false);
  });

  it('falls through to the next template', () => {
    const valid = templates.find((t) => t.id === 'tpl-act1-open-field')!;
    const pool = [impossible, valid];
    let ran = false;
    for (let i = 0; i < 40 && !ran; i++) {
      const run = { ...deckRun('starter', 0, 0), seed: `FALL-${i}` };
      const seq = selectTemplates(pool, 1, 'normal', stageSeedOf(run.seed));
      if (seq[0] !== impossible) continue;
      ran = true;
      const r = generateWith({ run, actIndex: 0, stageIndex: 0 }, { templates: pool, formations }, config, () => proof());
      expect(r.provenance.templateId).toBe(valid.id);
      expect(r.provenance.attempts).toBeGreaterThan(20);
      expect(r.provenance.validationFailed).toBeUndefined();
    }
    expect(ran).toBe(true);
  });

  it('avoids previousTemplateId', () => {
    const a = tpl({
      id: 'tpl-act1-aaa',
      enemyArmy: { pawn: [5, 6], knight: [1, 1] },
      enemyZone: [7, 8],
      preconditions: ['enemy_king_on_board'],
    });
    const b = { ...a, id: 'tpl-act1-bbb' } as Template;
    for (const prev of [a.id, b.id]) {
      const r = generateWith(
        { run: deckRun('starter', 0, 0), actIndex: 0, stageIndex: 0, previousTemplateId: prev },
        { templates: [a, b], formations: {} },
        config,
        () => proof(),
      );
      expect(r.provenance.templateId).not.toBe(prev);
    }
  });

  it('keeps the enemy draws independent of the spawned-pawn count (spec 11)', () => {
    const fortress = templates.find((t) => t.id === 'tpl-act2-fortress')!;
    const few = { ...fortress, spawnedPawns: { ...fortress.spawnedPawns, count: [1, 1] as [number, number] } };
    const many = { ...fortress, spawnedPawns: { ...fortress.spawnedPawns, count: [3, 3] as [number, number] } };
    for (let i = 0; i < 5; i++) {
      const run = { ...deckRun('mid', 1, 0), seed: `IND-${i}` };
      const go = (t: Template) =>
        generateWith({ run, actIndex: 1, stageIndex: 0 }, { templates: [t], formations }, config, () => proof());
      const x = go(few);
      const y = go(many);
      expect(black(y.stage)).toEqual(black(x.stage));
      expect(y.provenance.formationId).toBe(x.provenance.formationId);
      expect(y.provenance.mirrored).toBe(x.provenance.mirrored);
      expect(y.stage.mateIn).toBe(x.stage.mateIn);
      expect(spawned(y.stage)).toBe(3);
      expect(spawned(x.stage)).toBe(1);
    }
  });

  it('is deterministic', () => {
    const go = () => generateWith(input, content, config, () => none);
    expect(JSON.stringify(go())).toBe(JSON.stringify(go()));
  });
});
