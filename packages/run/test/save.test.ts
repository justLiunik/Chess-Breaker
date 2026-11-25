import { describe, expect, it } from 'vitest';
import type { Action, PieceInstance, PromotionType, StageState } from '@checkbreaker/engine';
import * as runPackage from '../src';
import { abandon, buy, commit, expectedSeed, leave, newRun, provideStage, repair, reroll, sell, start } from '../src/session';
import { SAVE_VERSION, loadSave, memoryStorage, serializeSave } from '../src/save';
import type { SaveError } from '../src/save';
import type { RunEvent, RunPhase, RunResult, RunSession } from '../src/types';
import {
  ROOK_ID, deepFreeze, losingStage, mateInOneStage, promotionOverflowStage, runConfig as c, runWithRook,
} from './fixtures';

const SEED = 'C0DE-5A7E';
const SAVED_AT = '2026-11-16T09:30:00.000Z';
const KING_ROOK = [{ instanceId: 'p_king_01', to: 'd1' }, { instanceId: ROOK_ID, to: 'e1' }];
const ALL_PHASES: RunPhase[] = ['awaiting_stage', 'deployment', 'action', 'shop', 'ended'];
const mv = (from: string, to: string, promotion?: PromotionType): Action[] =>
  [{ type: 'MOVE', from, to, ...(promotion !== undefined && { promotion }) }];
const nonKing = (s: RunSession): number => s.run.deck.filter(p => p.pieceType !== 'king').length;
const normal = (id: string, pieceType: PieceInstance['pieceType']): PieceInstance => ({
  instanceId: id, pieceType, rarity: 'normal', durability: 2, durabilityMax: 2,
  origin: 'starter', acquiredAtStage: 0, status: 'in_deck',
});

const ok = (r: RunResult): { session: RunSession; events: RunEvent[] } => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return { session: deepFreeze(r.value.session), events: r.value.events };
};
const loaded = (text: string): RunSession => {
  const r = loadSave(text, c);
  if (!r.ok) throw new Error(`expected a session, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const refusal = (text: string): SaveError | null => {
  const r = loadSave(text, c);
  return r.ok ? null : r.error;
};
/** A save of `s` with `edit` applied to a plain copy of the session first. */
const saveWith = (s: RunSession, edit: (x: any) => void): string => {
  const copy = structuredClone(s) as any;
  edit(copy);
  return serializeSave(copy as RunSession);
};

/** The stage the session's pending request asks for, built with the seed it expects. */
const stub = (make: (seed: string) => StageState) => (s: RunSession): StageState =>
  make(expectedSeed(s.run.seed, s.next!.request.actIndex, s.next!.request.stageIndex));

const repairRook = (s: RunSession): RunResult => {
  const rook = s.run.deck.find(p => p.instanceId === ROOK_ID)!;
  return rook.durability! < rook.durabilityMax! ? repair(s, ROOK_ID, c) : { ok: true, value: { session: s, events: [] } };
};
/** Buys the first unsold piece the wallet affords (slot 0 when none: a no_such_slot refusal fails the test). */
const buyAffordablePiece = (s: RunSession): RunResult => {
  const slot = s.shop!.slots.findIndex(o => o.kind === 'piece' && !o.sold && o.price <= s.run.coins) + 1;
  return buy(s, slot, {}, c);
};

type Step = [label: string, act: (s: RunSession) => RunResult];

/**
 * Three stages from a full deck (8 non-king pieces) and a wallet that affords a purchase: a promotion
 * overflows the deck, the shop opens at 9 pieces, sells twice, buys and rerolls twice and gets stage I-2 before leaving;
 * the next shop is left first (awaiting_stage); stage I-3 grants the free Twin Step, a turn is played
 * (the Twin Step leaves the King a way out of the rook net, so it is check, not mate) and the run is abandoned.
 */
const SCRIPT: Step[] = [
  ['provide stage I-1', s => provideStage(s, stub(promotionOverflowStage)(s), c)],
  ['deploy king + rook', s => start(s, KING_ROOK, c)],
  ['promote b7-b8: the deck overflows mid-stage', s => commit(s, mv('b7', 'b8', 'knight'), c)],
  ['mate: the shop opens at 9 pieces', s => commit(s, mv('e1', 'e8'), c)],
  ['sell in the shop: the deck fits again', s => sell(s, 'p_fill_01', c)],
  ['sell in the shop for room', s => sell(s, 'p_fill_02', c)],
  ['buy a piece', buyAffordablePiece],
  ['free reroll', s => reroll(s, c)],
  ['paid reroll', s => reroll(s, c)],
  ['provide stage I-2 in the shop', s => provideStage(s, stub(mateInOneStage)(s), c)],
  ['repair the rook', repairRook],
  ['leave into Deployment', s => leave(s, c)],
  ['deploy king + rook', s => start(s, KING_ROOK, c)],
  ['mate', s => commit(s, mv('e1', 'e8'), c)],
  ['repair the rook', repairRook],
  ['leave before stage I-3 exists', s => leave(s, c)],
  ['provide stage I-3: the free skill is granted', s => provideStage(s, stub(losingStage)(s), c)],
  ['deploy the king alone', s => start(s, [{ instanceId: 'p_king_01', to: 'e1' }], c)],
  ['walk into check', s => commit(s, mv('e1', 'f1'), c)],
  ['abandon: the run is lost', s => abandon(s)],
];
const GRANT_STEP = SCRIPT.findIndex(([label]) => label.startsWith('provide stage I-3'));

function opening(): RunSession {
  const fresh = newRun(SEED, c);
  const run = runWithRook(fresh.run);
  const fill = [normal('p_fill_01', 'knight'), normal('p_fill_02', 'bishop'), normal('p_fill_03', 'bishop')];
  return deepFreeze({ ...fresh, run: { ...run, coins: 60, deck: [...run.deck, ...fill] } });
}

/** Plays `steps` from `s`; returns the final session and every event. */
function play(s: RunSession, steps: Step[]): { session: RunSession; events: RunEvent[] } {
  let session = s;
  const events: RunEvent[] = [];
  for (const [label, act] of steps) {
    const r = act(session);
    if (!r.ok) throw new Error(`${label}: ${JSON.stringify(r.error)}`);
    session = deepFreeze(r.value.session);
    events.push(...r.value.events);
  }
  return { session, events };
}

/** The opening and the session after every step of the script, with each step's events. */
function snapshots(): { sessions: RunSession[]; events: RunEvent[][] } {
  const sessions = [opening()];
  const events: RunEvent[][] = [];
  for (const step of SCRIPT) {
    const r = play(sessions.at(-1)!, [step]);
    sessions.push(r.session);
    events.push(r.events);
  }
  return { sessions, events };
}

describe('the scripted run', () => {
  it('passes through every phase, a mid-stage overflow, and a shop after a purchase and two rerolls', () => {
    const { sessions, events } = snapshots();
    expect(new Set(sessions.map(s => s.phase))).toEqual(new Set(ALL_PHASES));
    expect(nonKing(sessions[0]!)).toBe(c.deck.capacity);
    expect(sessions.some(s => s.phase === 'action' && nonKing(s) > c.deck.capacity)).toBe(true);
    expect(sessions.some(s => s.phase === 'shop' && nonKing(s) > c.deck.capacity)).toBe(true);
    const shopAfter = sessions.find(s => s.phase === 'shop' && s.shop!.rerollsUsed === 2);
    expect(shopAfter).toBeDefined();
    expect(shopAfter!.run.deck.some(p => p.origin === 'shop')).toBe(true);
    expect(sessions.some(s => s.phase === 'shop' && s.next?.stage != null)).toBe(true);
    expect(sessions.some(s => s.phase === 'awaiting_stage' && s.run.history.length > 0)).toBe(true);
    const last = sessions.at(-1)!;
    expect(last).toMatchObject({ phase: 'ended', outcome: { result: 'lost' } });
    expect(events.flat().filter(e => e.type === 'skill_granted')).toHaveLength(1);
    expect(events[GRANT_STEP]).toContainEqual({ type: 'skill_granted', skillId: c.run.freeSkill!.skillId });
  });
});

describe('save and resume', () => {
  it('every snapshot reloads deep-equal and plays on to the same end with the same events', () => {
    const { sessions } = snapshots();
    const end = sessions.at(-1)!;
    for (const [i, snap] of sessions.entries()) {
      const tag = `snapshot ${i} (${snap.phase})`;
      const back = loaded(serializeSave(snap, SAVED_AT));
      expect(back, tag).toEqual(snap);
      const rest = SCRIPT.slice(i);
      const original = play(snap, rest);
      const resumed = play(back, rest);
      expect(resumed.session, tag).toEqual(original.session);
      expect(resumed.events, tag).toEqual(original.events);
      expect(resumed.session, tag).toEqual(end);
    }
  });

  it('a session with a committed skill (a consumed Twin Step, a skill log) reloads deep-equal and plays on the same', () => {
    const granted = snapshots().sessions[GRANT_STEP + 1]!;
    expect(granted.run.loadout).toEqual([{ skillId: 'twin_step' }]);
    const deployed = ok(start(granted, [{ instanceId: 'p_king_01', to: 'e1' }], c)).session;
    // Twin Step buys a second move: Ke1-d1-c1 meets Rb8-b1+, which the king can capture (check, not mate).
    const used = ok(commit(deployed, [
      { type: 'ACTIVATE_SKILL', skillId: 'twin_step' }, ...mv('e1', 'd1'), ...mv('d1', 'c1'),
    ], c)).session;
    expect(used.phase).toBe('action');
    expect(used.run.loadout.some(e => e.skillId === 'twin_step')).toBe(false);
    expect(used.stage!.skillLog).toEqual([{ skillId: 'twin_step', turn: 1 }]);

    const back = loaded(serializeSave(used, SAVED_AT));
    expect(back).toEqual(used);
    expect(back.run.loadout.some(e => e.skillId === 'twin_step')).toBe(false);
    const rest: Step[] = [['capture the rook', s => commit(s, mv('c1', 'b1'), c)], ['abandon', s => abandon(s)]];
    const original = play(used, rest);
    const resumed = play(back, rest);
    expect(resumed.session).toEqual(original.session);
    expect(resumed.events).toEqual(original.events);
  });

  it('a save in stage I-3\'s Deployment does not grant the free skill again (Review Focus 1)', () => {
    const { sessions } = snapshots();
    const free = c.run.freeSkill!;
    const granted = sessions[GRANT_STEP + 1]!;
    expect(granted.phase).toBe('deployment');
    expect(granted.run.actIndex * c.run.stagesPerAct + granted.run.stageIndex).toBe(free.stageNumber);
    expect(sessions[GRANT_STEP]!.run.loadout.length).toBeLessThan(c.run.loadoutSlots);
    expect(granted.run.loadout).toEqual([{ skillId: free.skillId }]);

    const back = loaded(serializeSave(granted));
    expect(back).toEqual(granted);
    const kingOnly = [{ instanceId: 'p_king_01', to: 'e1' }];
    const resumed = start(back, kingOnly, c);
    if (!resumed.ok) throw new Error(JSON.stringify(resumed.error));
    expect(resumed.value.session.run.loadout.filter(e => e.skillId === free.skillId)).toHaveLength(1);
    expect(resumed.value.session.run.loadout).toEqual([{ skillId: free.skillId }]);
    expect(resumed.value.events.some(e => e.type === 'skill_granted')).toBe(false);
    expect(resumed.value).toEqual(ok(start(granted, kingOnly, c)));
  });

  it('a run lost mid-stage with its deck still overflowing saves and loads', () => {
    const t1 = play(opening(), SCRIPT.slice(0, 3)).session;
    expect(t1.phase).toBe('action');
    expect(nonKing(t1)).toBe(c.deck.capacity + 1);
    const lost = ok(abandon(t1)).session;
    expect(lost).toMatchObject({ phase: 'ended', outcome: { result: 'lost', endReason: 'abandoned' } });
    expect(nonKing(lost)).toBe(c.deck.capacity + 1);
    expect(loaded(serializeSave(lost))).toEqual(lost);
  });
});

describe('serializeSave', () => {
  it('writes { version, savedAt?, session }, with savedAt only when the caller passes one', () => {
    const s = newRun(SEED, c);
    expect(SAVE_VERSION).toBe(2);
    const bare = JSON.parse(serializeSave(s));
    expect(bare).toEqual({ version: SAVE_VERSION, session: s });
    expect('savedAt' in bare).toBe(false);
    expect(JSON.parse(serializeSave(s, SAVED_AT))).toEqual({ version: SAVE_VERSION, savedAt: SAVED_AT, session: s });
    expect(serializeSave(s, SAVED_AT)).toBe(serializeSave(s, SAVED_AT));
    expect(loaded(serializeSave(s, SAVED_AT))).toEqual(s);
  });
});

describe('loadSave refusals', () => {
  const s = newRun(SEED, c);
  const save = (version: unknown) => JSON.stringify({ version, session: s });

  it('an unknown or future version names the version', () => {
    const v3 = refusal(save(3));
    expect(v3).toMatchObject({ kind: 'unknown_version', version: 3 });
    expect((v3 as { message: string }).message).toMatch(/\b3\b/);
    expect((v3 as { message: string }).message).toContain('newer build');
    const str = refusal(save('1'));
    expect(str).toMatchObject({ kind: 'unknown_version', version: '1' });
    expect((str as { message: string }).message).toContain('"1"');
    expect(refusal(save(0))).toMatchObject({ kind: 'unknown_version', version: 0 });
    expect(refusal(JSON.stringify({ session: s }))?.kind).toBe('unknown_version');
  });

  it('a version 1 save is refused with unknown_version', () => {
    // a pre-M5.1 save: version 1, the session still carrying the chooser field; never migrated (P8)
    const v1 = refusal(JSON.stringify({ version: 1, savedAt: SAVED_AT, session: { ...s, chooser: null } }));
    expect(v1).toEqual({
      kind: 'unknown_version', version: 1, message: 'unknown save version 1; this build reads save version 2',
    });
    // the same session under the current version loads (the old key is dropped)
    expect(loaded(JSON.stringify({ version: SAVE_VERSION, session: { ...s, chooser: null } }))).toEqual(s);
  });

  it('values nested 10,000+ deep (parse fine, overflow a recursive stringify) are typed refusals, never a throw', () => {
    // built as text: JSON.stringify itself would overflow on these
    const deeps: [string, string][] = [
      ['(an array)', '['.repeat(10_000) + ']'.repeat(10_000)],
      ['(an object)', '{"a":'.repeat(10_000) + '0' + '}'.repeat(10_000)],
      ['(an array)', '['.repeat(100_000) + ']'.repeat(100_000)],
    ];
    const session = JSON.stringify(s);
    const seedless = JSON.stringify({ ...s, run: { ...s.run, seed: '__DEEP__' } });
    for (const [shown, deep] of deeps) {
      const run = (text: string): SaveError | null => {
        let r: ReturnType<typeof loadSave> | undefined;
        expect(() => { r = loadSave(text, c); }).not.toThrow();
        return r!.ok ? null : r!.error;
      };
      const version = run(`{"version":${deep},"session":${session}}`);
      expect(version?.kind).toBe('unknown_version');
      expect((version as { message: string }).message).toContain(`unknown save version ${shown}`);
      expect(run(`{"version":${SAVE_VERSION},"savedAt":${deep},"session":${session}}`)?.kind).toBe('malformed');
      expect(run(`{"version":${SAVE_VERSION},"session":${deep}}`)?.kind).toBe('invalid_session');
      expect(run(`{"version":${SAVE_VERSION},"session":${seedless.replace('"__DEEP__"', deep)}}`)).toMatchObject({
        kind: 'invalid_session', detail: 'session.run.seed: expected a string',
      });
    }
  });

  it('text that is not a save is malformed', () => {
    const text = serializeSave(s);
    for (const bad of [text.slice(0, -1), text.slice(0, text.length >> 1), '', '{', 'null', '[]', '42', '"save"', 'true']) {
      expect(refusal(bad)?.kind, JSON.stringify(bad.slice(0, 20))).toBe('malformed');
    }
    expect(refusal(JSON.stringify({ version: SAVE_VERSION, savedAt: 42, session: s }))?.kind).toBe('malformed');
  });

  it('a session with two Kings, or none, is invalid', () => {
    const king = s.run.deck[0]!;
    const two = refusal(saveWith(s, x => { x.run.deck.push({ ...king, instanceId: 'p_king_99' }); }));
    expect(two?.kind).toBe('invalid_session');
    expect((two as { detail: string }).detail).toMatch(/king/i);
    expect(refusal(saveWith(s, x => { x.run.deck = x.run.deck.slice(1); }))?.kind).toBe('invalid_session');
  });

  it('a loadout over the configured slots is invalid', () => {
    const fill = (n: number) => Array.from({ length: n }, () => ({ skillId: 'gallop' }));
    expect(refusal(saveWith(s, x => { x.run.loadout = fill(c.run.loadoutSlots); }))).toBeNull();
    expect(refusal(saveWith(s, x => { x.run.loadout = fill(c.run.loadoutSlots + 1); }))?.kind).toBe('invalid_session');
  });

  it('a deck over capacity is invalid outside action, the shop and the end of a run', () => {
    const { sessions } = snapshots();
    const over = (x: any, k: number) => {
      for (let i = 0; i < k; i++) x.run.deck.push(normal(`p_over_${i}`, 'knight'));
    };
    for (const snap of sessions) {
      const room = c.deck.capacity - nonKing(snap);
      const text = saveWith(snap, x => over(x, room + 1));
      const exempt = snap.phase === 'action' || snap.phase === 'shop' || snap.phase === 'ended';
      if (exempt) expect(refusal(text), snap.phase).toBeNull();
      else expect(refusal(text)?.kind, snap.phase).toBe('invalid_session');
      if (room >= 0) expect(refusal(saveWith(snap, x => over(x, room))), snap.phase).toBeNull();
    }
    // a run won with a promotion in its last stage: the size no longer matters
    const ended = sessions.at(-1)!;
    const won = saveWith(ended, x => { x.outcome = { result: 'won' }; x.run.status = 'won'; over(x, c.deck.capacity + 1 - nonKing(ended)); });
    expect(refusal(won)).toBeNull();
    expect(ALL_PHASES.filter(ph => !sessions.some(x => x.phase === ph))).toEqual([]);
  });

  it('a save in the shop with 9 pieces reloads and is still gated', () => {
    const { sessions } = snapshots();
    const nine = sessions.find(x => x.phase === 'shop' && nonKing(x) === c.deck.capacity + 1)!;
    expect(nine).toBeDefined();
    const gate = { ok: false, error: { kind: 'deck_over_capacity', size: c.deck.capacity + 1, capacity: c.deck.capacity } };
    for (const snap of [nine, ok(provideStage(nine, stub(mateInOneStage)(nine), c)).session]) {
      const back = loaded(serializeSave(snap, SAVED_AT));
      expect(back).toEqual(snap);
      expect(leave(back, c)).toEqual(gate);
      const fits = ok(sell(back, 'p_fill_01', c)).session;
      expect(nonKing(fits)).toBe(c.deck.capacity);
      expect(ok(leave(fits, c)).session.phase).toBe(snap.next!.stage ? 'deployment' : 'awaiting_stage');
    }
  });

  it('a phase without the fields it needs is invalid', () => {
    const { sessions } = snapshots();
    const at = (phase: RunPhase) => sessions.find(x => x.phase === phase)!;
    const cases: [RunPhase, (x: any) => void][] = [
      ['awaiting_stage', x => { x.next = null; }],
      ['deployment', x => { x.stage = null; }],
      ['action', x => { x.stage = null; }],
      ['shop', x => { x.shop = null; }],
      ['shop', x => { x.next = null; }],
      ['ended', x => { x.outcome = null; }],
    ];
    for (const [phase, edit] of cases) {
      const e = refusal(saveWith(at(phase), edit));
      expect(e?.kind, `${phase}: ${edit.toString()}`).toBe('invalid_session');
    }
  });

  it('structurally wrong sessions are invalid, never a crash', () => {
    const wrong: ((x: any) => void)[] = [
      x => { x.run.deck = 'deck'; },
      x => { x.run.deck[1].pieceType = 'dragon'; },
      x => { x.run.deck[1] = null; },
      x => { x.run.loadout = [{ skill: 'gallop' }]; },
      x => { x.run = null; },
      x => { x.phase = 'bogus'; },
      x => { x.version = 2; },
      x => { x.next.request = 7; },
    ];
    for (const edit of wrong) expect(refusal(saveWith(s, edit))?.kind, edit.toString()).toBe('invalid_session');
    for (const session of [null, 7, 'session', [], {}]) {
      expect(refusal(JSON.stringify({ version: SAVE_VERSION, session }))?.kind, JSON.stringify(session)).toBe('invalid_session');
    }
  });

  it('never throws: every cut of a save, and every field replaced or removed, is a typed result', () => {
    const { sessions } = snapshots();
    const KINDS = ['malformed', 'unknown_version', 'invalid_session'];
    const bases = [
      sessions.find(x => x.phase === 'action')!,
      sessions.find(x => x.phase === 'shop' && x.next?.stage != null)!,
    ];
    const DELETE = Symbol('delete');
    const replacements: unknown[] = [null, 'x', 7, -1.5, true, [], {}, DELETE];
    for (const base of bases) {
      const text = serializeSave(base, SAVED_AT);
      for (let cut = 0; cut < text.length; cut++) {
        expect(refusal(text.slice(0, cut))?.kind).toBe('malformed');
      }
      const tree = JSON.parse(text);
      const paths: (string | number)[][] = [];
      const walk = (v: unknown, path: (string | number)[]) => {
        if (path.length > 0) paths.push(path);
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
        else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
      };
      walk(tree, []);
      expect(paths.length).toBeGreaterThan(100);
      let refused = 0;
      for (const path of paths) {
        for (const rep of replacements) {
          const copy = structuredClone(tree);
          let parent: any = copy;
          for (const k of path.slice(0, -1)) parent = parent[k];
          const key = path.at(-1)!;
          if (rep === DELETE) {
            if (Array.isArray(parent)) parent.splice(key as number, 1);
            else delete parent[key];
          } else {
            parent[key] = rep;
          }
          let r: ReturnType<typeof loadSave> | undefined;
          expect(() => { r = loadSave(JSON.stringify(copy), c); }, path.join('.')).not.toThrow();
          if (!r!.ok) {
            expect(KINDS).toContain(r!.error.kind);
            // the shape checks name the field: the validator's own catch-all never fires
            if (r!.error.kind === 'invalid_session') expect(r!.error.detail, path.join('.')).not.toContain('unreadable');
            refused++;
          }
        }
      }
      expect(refused).toBeGreaterThan(paths.length);
      // every field of the session and its run is required: an empty object in its place is refused
      for (const key of Object.keys(tree.session)) {
        expect(refusal(JSON.stringify({ ...tree, session: { ...tree.session, [key]: {} } }))?.kind, key).toBe('invalid_session');
      }
      for (const key of Object.keys(tree.session.run)) {
        const run = { ...tree.session.run, [key]: {} };
        expect(refusal(JSON.stringify({ ...tree, session: { ...tree.session, run } }))?.kind, `run.${key}`).toBe('invalid_session');
      }
    }
  });
});

describe('loadSave rebuilds the session from checked keys only', () => {
  it('drops unknown keys at every level', () => {
    const { sessions } = snapshots();
    const action = sessions.find(s => s.phase === 'action')!;
    const shopped = sessions.find(s => s.phase === 'shop' && s.shop!.slots.length > 0)!;
    const square = Object.keys(action.stage!.board)[0]!;
    const a = loaded(saveWith(action, x => {
      x.junk = 1; x.run.junk = 1; x.stage.board[square].junk = 1; x.stage.junk = 1; x.run.deck[0].junk = 1;
    })) as any;
    expect(a).toEqual(action);
    for (const o of [a, a.run, a.stage, a.stage.board[square], a.run.deck[0]]) expect('junk' in o).toBe(false);
    const sh = loaded(saveWith(shopped, x => { x.shop.slots[0].junk = 1; x.shop.junk = 1; })) as any;
    expect(sh).toEqual(shopped);
    expect('junk' in sh.shop.slots[0]).toBe(false);
    expect('junk' in sh.shop).toBe(false);
  });

  it('a deeply nested unknown key cannot make serializeSave throw', () => {
    const deep = '['.repeat(100_000) + '1' + ']'.repeat(100_000);
    const text = JSON.stringify({ version: SAVE_VERSION, session: newRun(SEED, c) })
      .replace('"session":{', `"session":{"junk":${deep},`);
    const r = loadSave(text, c);
    expect(r.ok).toBe(true);
    if (r.ok) expect(() => serializeSave(r.value)).not.toThrow();
  });
});

describe('memoryStorage', () => {
  it('round-trips a save, overwrites, clears, and keeps each store apart', () => {
    const { sessions } = snapshots();
    const a = memoryStorage();
    const b = memoryStorage();
    expect(a.read()).toBeNull();
    const first = sessions.find(x => x.phase === 'shop')!;
    a.write(serializeSave(first, SAVED_AT));
    expect(loaded(a.read()!)).toEqual(first);
    expect(b.read()).toBeNull();
    const second = sessions.at(-1)!;
    a.write(serializeSave(second));
    expect(loaded(a.read()!)).toEqual(second);
    a.clear();
    expect(a.read()).toBeNull();
  });

  it('is exported with the save functions from the package', () => {
    expect(runPackage.loadSave).toBe(loadSave);
    expect(runPackage.serializeSave).toBe(serializeSave);
    expect(runPackage.memoryStorage).toBe(memoryStorage);
    expect(runPackage.SAVE_VERSION).toBe(SAVE_VERSION);
  });
});
