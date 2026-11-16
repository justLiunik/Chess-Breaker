import { TIERS, isSquare } from '@checkbreaker/engine';
import type { Result } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';
import type { RunPhase, RunSession } from './types';

/** The save file's format version (spec section 8.5); `loadSave` reads this version only. */
export const SAVE_VERSION = 1;

export type SaveError =
  | { kind: 'malformed'; detail: string }
  | { kind: 'unknown_version'; version: unknown; message: string }
  | { kind: 'invalid_session'; detail: string };

/** Where a single run's save lives. The browser `localStorage` adapter arrives in M5. */
export interface RunStorage {
  read(): string | null;
  write(text: string): void;
  clear(): void;
}

/** An in-memory `RunStorage` (tests and the bot): each call makes a separate store. */
export function memoryStorage(): RunStorage {
  let text: string | null = null;
  return {
    read: () => text,
    write: (next: string) => { text = next; },
    clear: () => { text = null; },
  };
}

/**
 * The save of `s`: JSON `{ version, savedAt?, session }`. `savedAt` is whatever the caller passes (the run
 * layer never reads a clock); without it the key is absent, so the same session always saves the same text.
 */
export function serializeSave(s: RunSession, savedAt?: string): string {
  return JSON.stringify({ version: SAVE_VERSION, ...(savedAt !== undefined && { savedAt }), session: s });
}

/**
 * Reads a save written by `serializeSave`. Never throws: text that is not a JSON save object is `malformed`,
 * a version other than SAVE_VERSION is `unknown_version`, and a session of the wrong shape or breaking an
 * invariant is `invalid_session` (spec section 8.5): exactly one King; the non-king deck within
 * `deck.capacity` except in action, the chooser, or a run lost mid-stage (promotions join the deck during a
 * stage and only the chooser trims them); the loadout within `run.loadoutSlots`; each phase has its fields.
 */
export function loadSave(text: string, c: RunConfig): Result<RunSession, SaveError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return fail({ kind: 'malformed', detail: `not JSON: ${e instanceof Error ? e.message : 'parse error'}` });
  }
  if (!isRecord(parsed)) return fail({ kind: 'malformed', detail: 'a save is a JSON object { version, savedAt?, session }' });
  const version = own(parsed, 'version');
  if (version !== SAVE_VERSION) return fail({ kind: 'unknown_version', version, message: versionMessage(version) });
  const savedAt = own(parsed, 'savedAt');
  if (savedAt !== undefined && typeof savedAt !== 'string') return fail({ kind: 'malformed', detail: 'savedAt: expected a string' });
  try {
    return { ok: true, value: checkSession(own(parsed, 'session'), c) };
  } catch (e) {
    const detail = e instanceof Invalid ? e.message : `session: unreadable (${e instanceof Error ? e.message : 'unknown error'})`;
    return fail({ kind: 'invalid_session', detail });
  }
}

const fail = (error: SaveError): Result<never, SaveError> => ({ ok: false, error });

/**
 * Names the version without serializing it: `version` is player-editable JSON, and an array or object nested
 * thousands deep parses fine but overflows the stack in `JSON.stringify`. Only primitives are printed.
 */
function versionMessage(version: unknown): string {
  if (version === undefined) return `the save has no version; this build reads save version ${SAVE_VERSION}`;
  const shown = Array.isArray(version) ? '(an array)'
    : typeof version === 'object' && version !== null ? '(an object)'
      : typeof version === 'string' ? JSON.stringify(version.slice(0, 40))
        : String(version);
  if (typeof version === 'number' && Number.isInteger(version) && version > SAVE_VERSION) {
    return `save version ${shown} comes from a newer build; this build reads save version ${SAVE_VERSION}`;
  }
  return `unknown save version ${shown}; this build reads save version ${SAVE_VERSION}`;
}

// ---------------------------------------------------------------------------------------------------------
// Shape: every field the run layer and the engine read, typed as in types.ts and the engine's types.ts.

type Obj = Record<string, unknown>;

class Invalid extends Error {}

const PHASES: readonly RunPhase[] = ['awaiting_stage', 'deployment', 'action', 'chooser', 'shop', 'ended'];
const PIECE_TYPES = ['king', 'pawn', 'knight', 'bishop', 'rook', 'queen'] as const;
const INSTANCE_TYPES = ['king', 'knight', 'bishop', 'rook', 'queen'] as const;
const DECK_TYPES = ['knight', 'bishop', 'rook', 'queen'] as const;
const COLORS = ['white', 'black'] as const;
const ORIGINS = ['starter', 'shop', 'promotion', 'merge', 'reward'] as const;
const PIECE_STATUSES = ['in_deck', 'deployed', 'captured', 'spent'] as const;
const RUN_STATUSES = ['in_progress', 'won', 'lost'] as const;
const STAGE_STATUSES = ['active', 'won', 'lost'] as const;
const END_REASONS = ['checkmate', 'enemy_stalemated', 'out_of_coins', 'player_mated', 'player_stalemated'] as const;

const isRecord = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** An own property only: JSON never sets the prototype, and `toString` and friends are not fields. */
const own = (o: Obj, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);
const bad = (path: string, what: string): never => { throw new Invalid(`${path}: ${what}`); };

function obj(v: unknown, path: string): Obj {
  return isRecord(v) ? v : bad(path, 'expected an object');
}
function arr(v: unknown, path: string): unknown[] {
  return Array.isArray(v) ? v : bad(path, 'expected an array');
}
function str(v: unknown, path: string): string {
  return typeof v === 'string' ? v : bad(path, 'expected a string');
}
function num(v: unknown, path: string): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : bad(path, 'expected a number');
}
function int(v: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : bad(path, `expected an integer in ${min}..${max}`);
}
function bool(v: unknown, path: string): boolean {
  return typeof v === 'boolean' ? v : bad(path, 'expected true or false');
}
function oneOf<T>(v: unknown, path: string, values: readonly T[]): T {
  return values.includes(v as T) ? (v as T) : bad(path, `expected one of ${values.join(' | ')}`);
}
/** Checks `o[key]` with `check` when the key is present. */
function opt(o: Obj, key: string, path: string, check: (v: unknown, path: string) => unknown): void {
  if (Object.hasOwn(o, key)) check(o[key], `${path}.${key}`);
}
function nullable(v: unknown, path: string, check: (v: unknown, path: string) => void): void {
  if (v !== null) check(v, path);
}
function each(v: unknown, path: string, check: (x: unknown, path: string) => void): unknown[] {
  const xs = arr(v, path);
  xs.forEach((x, i) => check(x, `${path}[${i}]`));
  return xs;
}

function checkPiece(v: unknown, path: string): void {
  const p = obj(v, path);
  str(own(p, 'instanceId'), `${path}.instanceId`);
  oneOf(own(p, 'pieceType'), `${path}.pieceType`, INSTANCE_TYPES);
  nullable(own(p, 'rarity'), `${path}.rarity`, (x, at) => oneOf(x, at, TIERS));
  nullable(own(p, 'durability'), `${path}.durability`, num);
  nullable(own(p, 'durabilityMax'), `${path}.durabilityMax`, num);
  oneOf(own(p, 'origin'), `${path}.origin`, ORIGINS);
  int(own(p, 'acquiredAtStage'), `${path}.acquiredAtStage`);
  opt(p, 'pricePaid', path, num);
  opt(p, 'usedOnce', path, (x, at) => each(x, at, str));
  oneOf(own(p, 'status'), `${path}.status`, PIECE_STATUSES);
}

function checkRun(v: unknown, path: string, c: RunConfig): Obj {
  const r = obj(v, path);
  oneOf(own(r, 'version'), `${path}.version`, [1]);
  str(own(r, 'seed'), `${path}.seed`);
  int(own(r, 'actIndex'), `${path}.actIndex`, 0, c.run.acts - 1);
  int(own(r, 'stageIndex'), `${path}.stageIndex`, 0, c.run.stagesPerAct - 1);
  num(own(r, 'coins'), `${path}.coins`);
  int(own(r, 'deckCapacity'), `${path}.deckCapacity`);
  each(own(r, 'deck'), `${path}.deck`, checkPiece);
  each(own(r, 'loadout'), `${path}.loadout`, (x, at) => str(own(obj(x, at), 'skillId'), `${at}.skillId`));
  each(own(r, 'history'), `${path}.history`, (x, at) => {
    const h = obj(x, at);
    str(own(h, 'stageSeed'), `${at}.stageSeed`);
    str(own(h, 'templateId'), `${at}.templateId`);
    oneOf(own(h, 'outcome'), `${at}.outcome`, ['win', 'loss']);
    for (const k of ['turnsUsed', 'coinsEarned', 'piecesLost']) num(own(h, k), `${at}.${k}`);
  });
  num(own(r, 'rngCursor'), `${path}.rngCursor`);
  oneOf(own(r, 'status'), `${path}.status`, RUN_STATUSES);
  return r;
}

function checkBoardPiece(v: unknown, path: string): void {
  const p = obj(v, path);
  oneOf(own(p, 'pieceType'), `${path}.pieceType`, PIECE_TYPES);
  oneOf(own(p, 'color'), `${path}.color`, COLORS);
  opt(p, 'instanceId', path, str);
  opt(p, 'stageId', path, str);
  opt(p, 'spawned', path, (x, at) => oneOf(x, at, [true]));
  opt(p, 'rarity', path, (x, at) => oneOf(x, at, TIERS));
  opt(p, 'promotesTo', path, (x, at) => {
    const t = obj(x, at);
    oneOf(own(t, 'pieceType'), `${at}.pieceType`, DECK_TYPES);
    oneOf(own(t, 'rarity'), `${at}.rarity`, TIERS);
  });
  opt(p, 'transformed', path, (x, at) => {
    const t = obj(x, at);
    oneOf(own(t, 'pieceType'), `${at}.pieceType`, PIECE_TYPES);
    str(own(t, 'modifierId'), `${at}.modifierId`);
  });
}

function checkStage(v: unknown, path: string): void {
  const s = obj(v, path);
  str(own(s, 'stageSeed'), `${path}.stageSeed`);
  str(own(s, 'templateId'), `${path}.templateId`);
  oneOf(own(s, 'playerColor'), `${path}.playerColor`, COLORS);
  oneOf(own(s, 'phase'), `${path}.phase`, ['deployment', 'action']);
  for (const [sq, piece] of Object.entries(obj(own(s, 'board'), `${path}.board`))) {
    if (!isSquare(sq)) bad(`${path}.board`, `${JSON.stringify(sq.slice(0, 8))} is not a square`);
    checkBoardPiece(piece, `${path}.board.${sq}`);
  }
  for (const k of ['turnsUsed', 'mateIn', 'overtimePaid', 'focus', 'focusPool', 'moveCredits', 'spawnPoints']) {
    num(own(s, k), `${path}.${k}`);
  }
  each(own(s, 'modifiers'), `${path}.modifiers`, (x, at) => {
    const m = obj(x, at);
    str(own(m, 'modifierId'), `${at}.modifierId`);
    str(own(m, 'primitive'), `${at}.primitive`);
    str(own(m, 'duration'), `${at}.duration`);
    opt(m, 'source', at, str);
    opt(m, 'target', at, str);
    opt(m, 'appliedOnTurn', at, num);
  });
  each(own(s, 'skillLog'), `${path}.skillLog`, (x, at) => {
    const e = obj(x, at);
    str(own(e, 'skillId'), `${at}.skillId`);
    num(own(e, 'turn'), `${at}.turn`);
    opt(e, 'targetId', at, str);
  });
  const policy = obj(own(s, 'enemyPolicy'), `${path}.enemyPolicy`);
  oneOf(own(policy, 'type'), `${path}.enemyPolicy.type`, ['best_move', 'scripted']);
  for (const k of ['depth', 'fallbackDepth', 'cursor']) opt(policy, k, `${path}.enemyPolicy`, num);
  opt(policy, 'seed', `${path}.enemyPolicy`, str);
  opt(policy, 'line', `${path}.enemyPolicy`, (x, at) => each(x, at, str));
  opt(policy, 'fellBack', `${path}.enemyPolicy`, bool);
  oneOf(own(s, 'status'), `${path}.status`, STAGE_STATUSES);
  opt(s, 'endReason', path, (x, at) => oneOf(x, at, END_REASONS));
  opt(s, 'provenance', path, obj);
}

function checkShop(v: unknown, path: string, c: RunConfig): void {
  const s = obj(v, path);
  int(own(s, 'act'), `${path}.act`, 1, c.run.acts);
  int(own(s, 'stageNumber'), `${path}.stageNumber`, 0, c.run.acts * c.run.stagesPerAct - 1);
  int(own(s, 'roll'), `${path}.roll`);
  int(own(s, 'rerollsUsed'), `${path}.rerollsUsed`);
  bool(own(s, 'recovery'), `${path}.recovery`);
  each(own(s, 'slots'), `${path}.slots`, (x, at) => {
    const o = obj(x, at);
    const kind = oneOf(own(o, 'kind'), `${at}.kind`, ['piece', 'skill']);
    if (kind === 'piece') {
      oneOf(own(o, 'pieceType'), `${at}.pieceType`, DECK_TYPES);
      oneOf(own(o, 'rarity'), `${at}.rarity`, TIERS);
      opt(o, 'recovery', at, (y, p) => oneOf(y, p, [true]));
    } else {
      str(own(o, 'skillId'), `${at}.skillId`);
    }
    num(own(o, 'price'), `${at}.price`);
    bool(own(o, 'sold'), `${at}.sold`);
  });
}

function checkSession(v: unknown, c: RunConfig): RunSession {
  const s = obj(v, 'session');
  oneOf(own(s, 'version'), 'session.version', [1]);
  const run = checkRun(own(s, 'run'), 'session.run', c);
  const phase = oneOf(own(s, 'phase'), 'session.phase', PHASES);
  nullable(own(s, 'stage'), 'session.stage', checkStage);
  nullable(own(s, 'tally'), 'session.tally', (x, at) => {
    const t = obj(x, at);
    for (const k of ['startCoins', 'salvage', 'piecesLost']) num(own(t, k), `${at}.${k}`);
  });
  nullable(own(s, 'chooser'), 'session.chooser', (x, at) => int(own(obj(x, at), 'overCapacity'), `${at}.overCapacity`, 1));
  nullable(own(s, 'shop'), 'session.shop', (x, at) => checkShop(x, at, c));
  nullable(own(s, 'next'), 'session.next', (x, at) => {
    const n = obj(x, at);
    const request = obj(own(n, 'request'), `${at}.request`);
    checkRun(own(request, 'run'), `${at}.request.run`, c);
    int(own(request, 'actIndex'), `${at}.request.actIndex`, 0, c.run.acts - 1);
    int(own(request, 'stageIndex'), `${at}.request.stageIndex`, 0, c.run.stagesPerAct - 1);
    opt(request, 'previousTemplateId', `${at}.request`, str);
    nullable(own(n, 'stage'), `${at}.stage`, checkStage);
  });
  nullable(own(s, 'outcome'), 'session.outcome', (x, at) => {
    const o = obj(x, at);
    oneOf(own(o, 'result'), `${at}.result`, ['won', 'lost']);
    opt(o, 'endReason', at, (y, p) => oneOf(y, p, [...END_REASONS, 'abandoned']));
  });

  // Invariants (spec section 8.5).
  const session = s as unknown as RunSession;
  const deck = session.run.deck;
  const kings = deck.filter(p => p.pieceType === 'king').length;
  if (kings !== 1) bad('session.run.deck', `expected exactly one King, found ${kings}`);
  const nonKing = deck.length - kings;
  const midStage = phase === 'action' || phase === 'chooser' || (phase === 'ended' && session.outcome?.result === 'lost');
  if (!midStage && nonKing > c.deck.capacity) {
    bad('session.run.deck', `${nonKing} non-king pieces exceed the capacity of ${c.deck.capacity} in phase ${phase}`);
  }
  const loadout = (run.loadout as unknown[]).length;
  if (loadout > c.run.loadoutSlots) bad('session.run.loadout', `${loadout} skills exceed the ${c.run.loadoutSlots} loadout slots`);
  const needs: Partial<Record<RunPhase, (keyof RunSession)[]>> = {
    awaiting_stage: ['next'], deployment: ['stage'], action: ['stage'], chooser: ['chooser'], shop: ['shop', 'next'], ended: ['outcome'],
  };
  for (const field of needs[phase] ?? []) {
    if (session[field] === null) bad(`session.${field}`, `phase ${phase} needs it set`);
  }
  return session;
}
