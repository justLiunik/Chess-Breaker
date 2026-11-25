import { TIERS, isSquare } from '@checkbreaker/engine';
import type {
  ActiveModifier, BoardPiece, Color, DeckType, EndReason, EnemyPolicy, PieceInstance, PieceType, Rarity, Result,
  RunState, StageState,
} from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content';
import type { ClueSquare, GenRequest, Offer, RunPhase, RunSession, ShopState } from './types';

/**
 * The save file's format version (spec section 8.5); `loadSave` reads this version only. 2 from M5.1: the
 * stage-end deck phase is gone and promoted pieces carry `pricePaid: 0`. A version 1 save is refused with
 * `unknown_version`, never migrated (M5.1 spec decision P8).
 */
export const SAVE_VERSION = 2;

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
 * `deck.capacity` except in action, the shop, or a run that ended (promotions join the deck during a stage,
 * the shop's deck gate trims it before the next stage, and after the run the size no longer matters); the
 * loadout within `run.loadoutSlots`; each phase has its fields.
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

/**
 * The enum lists below are hand-copied from the types. Each is `satisfies` its union (no stray value) and has
 * a compile-time check that it misses none: a union member absent from its list turns the paired constant
 * into `never`, which `true` is not assignable to.
 */
const PHASES = ['awaiting_stage', 'deployment', 'action', 'shop', 'ended'] as const satisfies readonly RunPhase[];
const _phases: Exclude<RunPhase, typeof PHASES[number]> extends never ? true : never = true;
const PIECE_TYPES = ['king', 'pawn', 'knight', 'bishop', 'rook', 'queen'] as const satisfies readonly PieceType[];
const _pieceTypes: Exclude<PieceType, typeof PIECE_TYPES[number]> extends never ? true : never = true;
const INSTANCE_TYPES = ['king', 'knight', 'bishop', 'rook', 'queen'] as const satisfies readonly PieceInstance['pieceType'][];
const _instanceTypes: Exclude<PieceInstance['pieceType'], typeof INSTANCE_TYPES[number]> extends never ? true : never = true;
const DECK_TYPES = ['knight', 'bishop', 'rook', 'queen'] as const satisfies readonly DeckType[];
const _deckTypes: Exclude<DeckType, typeof DECK_TYPES[number]> extends never ? true : never = true;
const COLORS = ['white', 'black'] as const satisfies readonly Color[];
const _colors: Exclude<Color, typeof COLORS[number]> extends never ? true : never = true;
const ORIGINS = ['starter', 'shop', 'promotion', 'merge', 'reward'] as const satisfies readonly PieceInstance['origin'][];
const _origins: Exclude<PieceInstance['origin'], typeof ORIGINS[number]> extends never ? true : never = true;
const PIECE_STATUSES = ['in_deck', 'deployed', 'captured', 'spent'] as const satisfies readonly PieceInstance['status'][];
const _pieceStatuses: Exclude<PieceInstance['status'], typeof PIECE_STATUSES[number]> extends never ? true : never = true;
const RUN_STATUSES = ['in_progress', 'won', 'lost'] as const satisfies readonly RunState['status'][];
const _runStatuses: Exclude<RunState['status'], typeof RUN_STATUSES[number]> extends never ? true : never = true;
const STAGE_STATUSES = ['active', 'won', 'lost'] as const satisfies readonly StageState['status'][];
const _stageStatuses: Exclude<StageState['status'], typeof STAGE_STATUSES[number]> extends never ? true : never = true;
const END_REASONS = ['checkmate', 'enemy_stalemated', 'out_of_coins', 'player_mated', 'player_stalemated'] as const satisfies readonly EndReason[];
const _endReasons: Exclude<EndReason, typeof END_REASONS[number]> extends never ? true : never = true;
const OUTCOME_END_REASONS = [...END_REASONS, 'abandoned'] as const satisfies readonly NonNullable<NonNullable<RunSession['outcome']>['endReason']>[];
const _outcomeEndReasons: Exclude<NonNullable<NonNullable<RunSession['outcome']>['endReason']>, typeof OUTCOME_END_REASONS[number]> extends never ? true : never = true;
const OUTCOME_RESULTS = ['won', 'lost'] as const satisfies readonly NonNullable<RunSession['outcome']>['result'][];
const _outcomeResults: Exclude<NonNullable<RunSession['outcome']>['result'], typeof OUTCOME_RESULTS[number]> extends never ? true : never = true;
const HISTORY_OUTCOMES = ['win', 'loss'] as const satisfies readonly RunState['history'][number]['outcome'][];
const _historyOutcomes: Exclude<RunState['history'][number]['outcome'], typeof HISTORY_OUTCOMES[number]> extends never ? true : never = true;
const POLICY_TYPES = ['best_move', 'scripted'] as const satisfies readonly EnemyPolicy['type'][];
const _policyTypes: Exclude<EnemyPolicy['type'], typeof POLICY_TYPES[number]> extends never ? true : never = true;
const STAGE_PHASES = ['deployment', 'action'] as const satisfies readonly StageState['phase'][];
const _stagePhases: Exclude<StageState['phase'], typeof STAGE_PHASES[number]> extends never ? true : never = true;
const OFFER_KINDS = ['piece', 'skill'] as const satisfies readonly Offer['kind'][];
const _offerKinds: Exclude<Offer['kind'], typeof OFFER_KINDS[number]> extends never ? true : never = true;
const SESSION_VERSIONS = [1] as const satisfies readonly RunSession['version'][];
const _sessionVersions: Exclude<RunSession['version'], typeof SESSION_VERSIONS[number]> extends never ? true : never = true;
/**
 * `RunState['version']` is `number` in the engine's types, not a finite union, so no completeness check can
 * exist: the save accepts the one run-state version this build writes.
 */
const RUN_STATE_VERSIONS = [1] as const satisfies readonly RunState['version'][];
void [
  _phases, _pieceTypes, _instanceTypes, _deckTypes, _colors, _origins, _pieceStatuses, _runStatuses, _stageStatuses, _endReasons,
  _outcomeEndReasons, _outcomeResults, _historyOutcomes, _policyTypes, _stagePhases, _offerKinds, _sessionVersions,
];

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
/** `null` stays `null`; anything else is rebuilt by `check`. */
function nullable<T>(v: unknown, path: string, check: (v: unknown, path: string) => T): T | null {
  return v === null ? null : check(v, path);
}

/** Sets `target[key]` to the checked value of `o[key]` when the key is present; absent keys stay absent. */
function put<T extends object, K extends keyof T>(
  target: T, key: K, o: Obj, path: string, check: (v: unknown, path: string) => T[K],
): void {
  if (Object.hasOwn(o, key as string)) target[key] = check(o[key as string], `${path}.${String(key)}`);
}
function strings<T extends string = string>(v: unknown, path: string): T[] {
  return arr(v, path).map((x, i) => str(x, `${path}[${i}]`) as T);
}
function exactly<T>(value: T): (v: unknown, path: string) => T {
  return (v, path) => oneOf(v, path, [value]);
}
function tier(v: unknown, path: string): Rarity {
  return oneOf(v, path, TIERS);
}

// Each checker returns a fresh object holding only the keys it checks: unknown keys in the file are dropped,
// so nothing player-supplied (however deeply nested) reaches the session beyond the typed shape.

function checkPiece(v: unknown, path: string): PieceInstance {
  const p = obj(v, path);
  const rarity = own(p, 'rarity');
  const durability = own(p, 'durability');
  const durabilityMax = own(p, 'durabilityMax');
  const out: PieceInstance = {
    instanceId: str(own(p, 'instanceId'), `${path}.instanceId`),
    pieceType: oneOf(own(p, 'pieceType'), `${path}.pieceType`, INSTANCE_TYPES),
    rarity: rarity === null ? null : tier(rarity, `${path}.rarity`),
    durability: durability === null ? null : num(durability, `${path}.durability`),
    durabilityMax: durabilityMax === null ? null : num(durabilityMax, `${path}.durabilityMax`),
    origin: oneOf(own(p, 'origin'), `${path}.origin`, ORIGINS),
    acquiredAtStage: int(own(p, 'acquiredAtStage'), `${path}.acquiredAtStage`),
    status: oneOf(own(p, 'status'), `${path}.status`, PIECE_STATUSES),
  };
  put(out, 'pricePaid', p, path, num);
  put(out, 'usedOnce', p, path, (x, at) => strings<'lifeline'>(x, at));
  return out;
}

function checkRun(v: unknown, path: string, c: RunConfig): RunState {
  const r = obj(v, path);
  return {
    version: oneOf(own(r, 'version'), `${path}.version`, RUN_STATE_VERSIONS),
    seed: str(own(r, 'seed'), `${path}.seed`),
    actIndex: int(own(r, 'actIndex'), `${path}.actIndex`, 0, c.run.acts - 1),
    stageIndex: int(own(r, 'stageIndex'), `${path}.stageIndex`, 0, c.run.stagesPerAct - 1),
    coins: num(own(r, 'coins'), `${path}.coins`),
    deckCapacity: int(own(r, 'deckCapacity'), `${path}.deckCapacity`) as 8,
    deck: arr(own(r, 'deck'), `${path}.deck`).map((x, i) => checkPiece(x, `${path}.deck[${i}]`)),
    loadout: arr(own(r, 'loadout'), `${path}.loadout`).map((x, i) => {
      const at = `${path}.loadout[${i}]`;
      return { skillId: str(own(obj(x, at), 'skillId'), `${at}.skillId`) };
    }),
    history: arr(own(r, 'history'), `${path}.history`).map((x, i) => {
      const at = `${path}.history[${i}]`;
      const h = obj(x, at);
      return {
        stageSeed: str(own(h, 'stageSeed'), `${at}.stageSeed`),
        templateId: str(own(h, 'templateId'), `${at}.templateId`),
        outcome: oneOf(own(h, 'outcome'), `${at}.outcome`, HISTORY_OUTCOMES),
        turnsUsed: num(own(h, 'turnsUsed'), `${at}.turnsUsed`),
        coinsEarned: num(own(h, 'coinsEarned'), `${at}.coinsEarned`),
        piecesLost: num(own(h, 'piecesLost'), `${at}.piecesLost`),
      };
    }),
    rngCursor: num(own(r, 'rngCursor'), `${path}.rngCursor`),
    status: oneOf(own(r, 'status'), `${path}.status`, RUN_STATUSES),
  };
}

function checkBoardPiece(v: unknown, path: string): BoardPiece {
  const p = obj(v, path);
  const out: BoardPiece = {
    pieceType: oneOf(own(p, 'pieceType'), `${path}.pieceType`, PIECE_TYPES),
    color: oneOf(own(p, 'color'), `${path}.color`, COLORS),
  };
  put(out, 'instanceId', p, path, str);
  put(out, 'stageId', p, path, str);
  put(out, 'spawned', p, path, exactly(true as const));
  put(out, 'rarity', p, path, tier);
  put(out, 'transformed', p, path, (x, at) => {
    const t = obj(x, at);
    return { pieceType: oneOf(own(t, 'pieceType'), `${at}.pieceType`, PIECE_TYPES), modifierId: str(own(t, 'modifierId'), `${at}.modifierId`) };
  });
  return out;
}

function checkModifier(v: unknown, path: string): ActiveModifier {
  const m = obj(v, path);
  const out = {
    modifierId: str(own(m, 'modifierId'), `${path}.modifierId`),
    primitive: str(own(m, 'primitive'), `${path}.primitive`),
    duration: str(own(m, 'duration'), `${path}.duration`),
  } as ActiveModifier;
  put(out, 'source', m, path, str);
  put(out, 'target', m, path, str);
  put(out, 'appliedOnTurn', m, path, num);
  return out;
}

function checkEnemyPolicy(v: unknown, path: string): EnemyPolicy {
  const p = obj(v, path);
  const out: EnemyPolicy = { type: oneOf(own(p, 'type'), `${path}.type`, POLICY_TYPES) };
  put(out, 'depth', p, path, num);
  put(out, 'seed', p, path, str);
  put(out, 'line', p, path, (x, at) => strings(x, at));
  put(out, 'fallbackDepth', p, path, num);
  put(out, 'cursor', p, path, num);
  put(out, 'fellBack', p, path, bool);
  return out;
}

function checkStage(v: unknown, path: string): StageState {
  const s = obj(v, path);
  const board: Record<string, BoardPiece> = {};
  for (const [sq, piece] of Object.entries(obj(own(s, 'board'), `${path}.board`))) {
    if (!isSquare(sq)) bad(`${path}.board`, `${JSON.stringify(sq.slice(0, 8))} is not a square`);
    board[sq] = checkBoardPiece(piece, `${path}.board.${sq}`);
  }
  const out: StageState = {
    stageSeed: str(own(s, 'stageSeed'), `${path}.stageSeed`),
    templateId: str(own(s, 'templateId'), `${path}.templateId`),
    playerColor: oneOf(own(s, 'playerColor'), `${path}.playerColor`, COLORS),
    phase: oneOf(own(s, 'phase'), `${path}.phase`, STAGE_PHASES),
    board,
    turnsUsed: num(own(s, 'turnsUsed'), `${path}.turnsUsed`),
    mateIn: num(own(s, 'mateIn'), `${path}.mateIn`),
    overtimePaid: num(own(s, 'overtimePaid'), `${path}.overtimePaid`),
    focus: num(own(s, 'focus'), `${path}.focus`),
    focusPool: num(own(s, 'focusPool'), `${path}.focusPool`),
    moveCredits: num(own(s, 'moveCredits'), `${path}.moveCredits`),
    spawnPoints: num(own(s, 'spawnPoints'), `${path}.spawnPoints`),
    modifiers: arr(own(s, 'modifiers'), `${path}.modifiers`).map((x, i) => checkModifier(x, `${path}.modifiers[${i}]`)),
    skillLog: arr(own(s, 'skillLog'), `${path}.skillLog`).map((x, i) => {
      const at = `${path}.skillLog[${i}]`;
      const e = obj(x, at);
      const entry: StageState['skillLog'][number] = { skillId: str(own(e, 'skillId'), `${at}.skillId`), turn: num(own(e, 'turn'), `${at}.turn`) };
      put(entry, 'targetId', e, at, str);
      return entry;
    }),
    enemyPolicy: checkEnemyPolicy(own(s, 'enemyPolicy'), `${path}.enemyPolicy`),
    status: oneOf(own(s, 'status'), `${path}.status`, STAGE_STATUSES),
  };
  put(out, 'endReason', s, path, (x, at) => oneOf(x, at, END_REASONS));
  put(out, 'provenance', s, path, (x, at) => {
    const pv = obj(x, at);
    const prov: NonNullable<StageState['provenance']> = {};
    put(prov, 'templateId', pv, at, str);
    put(prov, 'seed', pv, at, str);
    put(prov, 'attempts', pv, at, num);
    put(prov, 'validationFailed', pv, at, bool);
    return prov;
  });
  return out;
}

function checkOffer(v: unknown, path: string): Offer & { sold: boolean } {
  const o = obj(v, path);
  const kind = oneOf(own(o, 'kind'), `${path}.kind`, OFFER_KINDS);
  const price = num(own(o, 'price'), `${path}.price`);
  const sold = bool(own(o, 'sold'), `${path}.sold`);
  if (kind === 'skill') return { kind, skillId: str(own(o, 'skillId'), `${path}.skillId`), price, sold };
  const piece: Extract<Offer, { kind: 'piece' }> & { sold: boolean } = {
    kind,
    pieceType: oneOf(own(o, 'pieceType'), `${path}.pieceType`, DECK_TYPES),
    rarity: tier(own(o, 'rarity'), `${path}.rarity`),
    price,
    sold,
  };
  put(piece, 'recovery', o, path, exactly(true as const));
  return piece;
}

function checkShop(v: unknown, path: string, c: RunConfig): ShopState {
  const s = obj(v, path);
  return {
    act: int(own(s, 'act'), `${path}.act`, 1, c.run.acts) as ShopState['act'],
    stageNumber: int(own(s, 'stageNumber'), `${path}.stageNumber`, 0, c.run.acts * c.run.stagesPerAct - 1),
    roll: int(own(s, 'roll'), `${path}.roll`),
    rerollsUsed: int(own(s, 'rerollsUsed'), `${path}.rerollsUsed`),
    recovery: bool(own(s, 'recovery'), `${path}.recovery`),
    slots: arr(own(s, 'slots'), `${path}.slots`).map((x, i) => checkOffer(x, `${path}.slots[${i}]`)),
  };
}

/** `session.clue` / `next.clue`: the placements must be distinct pieces on distinct squares of the player's deployment ranks. */
function checkClue(v: unknown, path: string, c: RunConfig): ClueSquare[] {
  const ids = new Set<string>();
  const squares = new Set<string>();
  return arr(v, path).map((x, i) => {
    const at = `${path}[${i}]`;
    const e = obj(x, at);
    const instanceId = str(own(e, 'instanceId'), `${at}.instanceId`);
    const to = str(own(e, 'to'), `${at}.to`);
    if (!isSquare(to) || !c.rules.deploymentRanks.includes(Number(to[1]))) {
      bad(`${at}.to`, `expected a square on ranks ${c.rules.deploymentRanks.join(', ')}`);
    }
    if (ids.has(instanceId)) bad(`${at}.instanceId`, `${instanceId} appears twice`);
    if (squares.has(to)) bad(`${at}.to`, `${to} appears twice`);
    ids.add(instanceId);
    squares.add(to);
    const out: ClueSquare = { instanceId, to, pieceType: oneOf(own(e, 'pieceType'), `${at}.pieceType`, INSTANCE_TYPES) };
    put(out, 'rarity', e, at, tier);
    return out;
  });
}
/** A clue key absent from the file (a version 2 save written before the clue) loads as null. */
const clueOf = (o: Obj, path: string, c: RunConfig): ClueSquare[] | null =>
  Object.hasOwn(o, 'clue') ? nullable(own(o, 'clue'), `${path}.clue`, (x, at) => checkClue(x, at, c)) : null;

function checkSession(v: unknown, c: RunConfig): RunSession {
  const s = obj(v, 'session');
  const session: RunSession = {
    version: oneOf(own(s, 'version'), 'session.version', SESSION_VERSIONS),
    run: checkRun(own(s, 'run'), 'session.run', c),
    phase: oneOf(own(s, 'phase'), 'session.phase', PHASES),
    stage: nullable(own(s, 'stage'), 'session.stage', checkStage),
    entryStage: nullable(own(s, 'entryStage'), 'session.entryStage', checkStage),
    clue: clueOf(s, 'session', c),
    tally: nullable(own(s, 'tally'), 'session.tally', (x, at) => {
      const t = obj(x, at);
      return {
        startCoins: num(own(t, 'startCoins'), `${at}.startCoins`),
        salvage: num(own(t, 'salvage'), `${at}.salvage`),
        piecesLost: num(own(t, 'piecesLost'), `${at}.piecesLost`),
      };
    }),
    shop: nullable(own(s, 'shop'), 'session.shop', (x, at) => checkShop(x, at, c)),
    next: nullable(own(s, 'next'), 'session.next', (x, at) => {
      const n = obj(x, at);
      const rq = obj(own(n, 'request'), `${at}.request`);
      const request: GenRequest = {
        run: checkRun(own(rq, 'run'), `${at}.request.run`, c),
        actIndex: int(own(rq, 'actIndex'), `${at}.request.actIndex`, 0, c.run.acts - 1),
        stageIndex: int(own(rq, 'stageIndex'), `${at}.request.stageIndex`, 0, c.run.stagesPerAct - 1),
      };
      put(request, 'previousTemplateId', rq, `${at}.request`, str);
      return { request, stage: nullable(own(n, 'stage'), `${at}.stage`, checkStage), clue: clueOf(n, at, c) };
    }),
    outcome: nullable(own(s, 'outcome'), 'session.outcome', (x, at) => {
      const o = obj(x, at);
      const out: NonNullable<RunSession['outcome']> = { result: oneOf(own(o, 'result'), `${at}.result`, OUTCOME_RESULTS) };
      put(out, 'endReason', o, at, (y, p) => oneOf(y, p, OUTCOME_END_REASONS));
      return out;
    }),
  };
  put(session, 'debug', s, 'session', exactly(true as const));
  const { run, phase } = session;

  // Invariants (spec section 8.5).
  const deck = run.deck;
  const kings = deck.filter(p => p.pieceType === 'king').length;
  if (kings !== 1) bad('session.run.deck', `expected exactly one King, found ${kings}`);
  const nonKing = deck.length - kings;
  const mayOverflow = phase === 'action' || phase === 'shop' || phase === 'ended';
  if (!mayOverflow && nonKing > c.deck.capacity) {
    bad('session.run.deck', `${nonKing} non-king pieces exceed the capacity of ${c.deck.capacity} in phase ${phase}`);
  }
  const loadout = run.loadout.length;
  if (loadout > c.run.loadoutSlots) bad('session.run.loadout', `${loadout} skills exceed the ${c.run.loadoutSlots} loadout slots`);
  const needs: Partial<Record<RunPhase, (keyof RunSession)[]>> = {
    awaiting_stage: ['next'], deployment: ['stage'], action: ['stage'], shop: ['shop', 'next'], ended: ['outcome'],
  };
  const inStage = phase === 'deployment' || phase === 'action';
  if (inStage !== (session.entryStage !== null)) {
    bad('session.entryStage', inStage ? `phase ${phase} needs it set` : `must be null in phase ${phase}`);
  }
  if (!inStage && session.clue !== null) bad('session.clue', `must be null in phase ${phase}`);
  for (const field of needs[phase] ?? []) {
    if (session[field] === null) bad(`session.${field}`, `phase ${phase} needs it set`);
  }
  return session;
}
