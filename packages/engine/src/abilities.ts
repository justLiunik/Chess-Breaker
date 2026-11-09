import type { BoardPiece, AbilityFlags, AbilityTable, DeckType, EngineConfig, Rarity } from './types';
import * as movegen from './movegen';
import * as position from './position';

export { TIERS } from './position';

// Imported bindings are copied into module constants once (see movegen.ts): these run in hot loops.
const { KNIGHT, BISHOP, ROOK, QUEEN, KING, TIERS } = position;
const { DIAG_R, ORTHO_R, KNIGHT_T, attackedBy, targetsInto } = movegen;
const DECK_TYPES: DeckType[] = ['knight', 'bishop', 'rook', 'queen'];

type RarityAbilities = Record<
  DeckType,
  Partial<Record<Rarity, { ability: string; params: Record<string, unknown> }[]>>
>;

const emptyFlags = (): AbilityFlags => ({
  leapAllies: 0,
  leapers: [],
  extraRays: [],
  multiCapture: 0,
  bonusSelfMove: false,
  lifeline: false,
});

const cloneFlags = (f: AbilityFlags): AbilityFlags => ({
  ...f,
  leapers: f.leapers.map(([a, b]) => [a, b] as [number, number]),
  extraRays: [...f.extraRays],
});

/** Every sign and axis-swap image of (df, dr), deduplicated. */
function images(df: number, dr: number): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (const [a, b] of [[df, dr], [dr, df]] as const) {
    for (const sa of [1, -1]) {
      for (const sb of [1, -1]) {
        const p: [number, number] = [a * sa + 0, b * sb + 0]; // + 0 normalises -0
        out.set(`${p[0]},${p[1]}`, p);
      }
    }
  }
  return [...out.values()];
}

function applyAbility(flags: AbilityFlags, ability: string, params: Record<string, unknown>): void {
  switch (ability) {
    case 'leap_allies':
      flags.leapAllies = params.captureAfterLeap === true ? 2 : Math.max(flags.leapAllies, 1) as 1 | 2;
      break;
    case 'add_leaper': {
      const offsets = params.offsets as [number, number][];
      for (const [df, dr] of offsets) {
        for (const img of images(df, dr)) {
          if (!flags.leapers.some(([a, b]) => a === img[0] && b === img[1])) flags.leapers.push(img);
        }
      }
      break;
    }
    case 'add_rider': {
      const dir = params.directions as 'orthogonal' | 'diagonal';
      if (!flags.extraRays.includes(dir)) flags.extraRays.push(dir);
      break;
    }
    case 'bonus_self_move':
      flags.bonusSelfMove = true;
      break;
    case 'multi_capture':
      flags.multiCapture = params.afterLeap === true ? 2 : (Math.max(flags.multiCapture, 1) as 1 | 2);
      break;
    case 'lifeline':
      flags.lifeline = true;
      break;
    default:
      throw new Error(`unknown rarity ability: ${ability}`);
  }
}

/** Fold each type's rarityAbilities into cumulative per-tier flags. */
export function compileAbilities(rarityAbilities: RarityAbilities): AbilityTable {
  const table = {} as AbilityTable;
  for (const type of DECK_TYPES) {
    const flags: AbilityFlags[] = [];
    let cur = emptyFlags();
    for (const tier of TIERS) {
      cur = cloneFlags(cur);
      for (const { ability, params } of rarityAbilities[type]?.[tier] ?? []) {
        applyAbility(cur, ability, params ?? {});
      }
      flags.push(cur);
    }
    table[type] = flags as AbilityTable[DeckType];
  }
  return table;
}

export function spawnCostOf(config: EngineConfig, type: 'king' | DeckType, rarity: Rarity): number {
  const p = config.pieces[type];
  return p.spawnCostByRarity[rarity] ?? p.spawnCost;
}

export function durabilityMaxOf(
  config: EngineConfig,
  type: 'king' | DeckType,
  rarity: Rarity,
): number | null {
  const p = config.pieces[type];
  return p.durabilityMaxByRarity[rarity] ?? p.durabilityMax;
}

// ---------------------------------------------------------------------------------------------
// Ability-aware generation (docs/02 §2.3, spec §9.2). Reads only the compiled AbilityFlags; the
// piece code only picks the table row and the standard movement the abilities add to.

/** The eight rays from each square: DIAG_R's four (directions 0..3), then ORTHO_R's four (4..7). */
const RAYS8: number[][][] = Array.from({ length: 64 }, (_, i) => [...DIAG_R[i]!, ...ORTHO_R[i]!]);
/** OPPOSITE[d]: the direction pointing back along direction d. */
const OPPOSITE = [3, 2, 1, 0, 5, 4, 7, 6] as const;
const DIAGONAL_BITS = 0x0f;
const ORTHOGONAL_BITS = 0xf0;
const TYPE_OF: (DeckType | null)[] = [null, null, 'knight', 'bishop', 'rook', 'queen'];

/** One (White piece code, tier)'s movement: its standard pattern plus the tier's abilities. */
interface Mover {
  /** Bit d set when it slides along direction d. */
  dirs: number;
  /** Per square: the rays it slides along, outward, diagonals before orthogonals. */
  rays: number[][][];
  /** Per square: its leap targets (a knight's L first, then the extra leapers), deduplicated. */
  leaps: number[][];
  /** extraLeapAdj[from * 64 + to] = 1 when an extra leaper offset takes it from `from` to `to`. */
  extraLeapAdj: Uint8Array | null;
  leapAllies: 0 | 1 | 2;
  multiCapture: 0 | 1 | 2;
}

interface Compiled {
  /** movers[code * 4 + tier] for codes KNIGHT..QUEEN and tiers 1..3. */
  movers: (Mover | undefined)[];
  /** Per square: the squares from which some tier's extra leaper reaches it. */
  extraLeapFrom: number[][];
}

function offsetTargets(from: number, offsets: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [];
  for (const [df, dr] of offsets) {
    const f = (from & 7) + df;
    const r = (from >> 3) + dr;
    if (f >= 0 && f < 8 && r >= 0 && r < 8) out.push(f + 8 * r);
  }
  return out;
}

function compileMover(code: number, flags: AbilityFlags): Mover {
  let dirs = code === BISHOP ? DIAGONAL_BITS : code === ROOK ? ORTHOGONAL_BITS : code === QUEEN ? 0xff : 0;
  if (flags.extraRays.includes('diagonal')) dirs |= DIAGONAL_BITS;
  if (flags.extraRays.includes('orthogonal')) dirs |= ORTHOGONAL_BITS;
  const extra = Array.from({ length: 64 }, (_, sq) => offsetTargets(sq, flags.leapers));
  let extraLeapAdj: Uint8Array | null = null;
  if (flags.leapers.length > 0) {
    const adj = new Uint8Array(64 * 64);
    extra.forEach((ts, sq) => { for (const x of ts) adj[sq * 64 + x] = 1; });
    extraLeapAdj = adj;
  }
  return {
    dirs,
    rays: RAYS8.map((rs) => rs.filter((_, d) => ((dirs >> d) & 1) === 1)),
    leaps: extra.map((ts, sq) => [...new Set([...(code === KNIGHT ? KNIGHT_T[sq]! : []), ...ts])]),
    extraLeapAdj,
    leapAllies: flags.leapAllies,
    multiCapture: flags.multiCapture,
  };
}

function compile(table: AbilityTable): Compiled {
  const movers: (Mover | undefined)[] = [];
  const from = Array.from({ length: 64 }, () => new Set<number>());
  for (let code = KNIGHT; code <= QUEEN; code++) {
    for (let tier = 1; tier < TIERS.length; tier++) {
      const m = compileMover(code, table[TYPE_OF[code]!][tier as 1 | 2 | 3]);
      movers[code * 4 + tier] = m;
      const adj = m.extraLeapAdj;
      if (adj === null) continue;
      for (let p = 0; p < 64; p++) {
        for (let x = 0; x < 64; x++) if (adj[p * 64 + x] === 1) from[x]!.add(p);
      }
    }
  }
  return { movers, extraLeapFrom: from.map((s) => [...s]) };
}

let lastTable: AbilityTable | null = null;
let lastCompiled: Compiled | null = null;
const COMPILED = new WeakMap<AbilityTable, Compiled>();

function compiledOf(table: AbilityTable): Compiled {
  if (table === lastTable) return lastCompiled!;
  let c = COMPILED.get(table);
  if (c === undefined) {
    c = compile(table);
    COMPILED.set(table, c);
  }
  lastTable = table;
  lastCompiled = c;
  return c;
}

/** The mover of the piece on `sq` if it is a White knight, bishop, rook or queen with a tier. */
function moverAt(c: Compiled, b: Int8Array, t: Int8Array, sq: number): Mover | undefined {
  const code = b[sq]!;
  const tier = t[sq]!;
  return tier > 0 && code >= KNIGHT && code <= QUEEN ? c.movers[code * 4 + tier] : undefined;
}

/** Whether any square has a tier: when not, callers keep using the M1 generators. */
export function hasTiers(t: Int8Array): boolean {
  for (let i = 0; i < 64; i++) if (t[i] !== 0) return true;
  return false;
}

/**
 * Writes the moves of the piece on `from` into `outTo` / `outVia` (80 entries suffice) and returns
 * how many. `outVia[i]` is the first captured square of a multi-capture ending on `outTo[i]`, else
 * -1. A piece without a tier (every Black piece, every tier-0 White piece) gets exactly
 * `targetsInto`. A tiered White piece slides ray by ray, diagonals before orthogonals, outward, a
 * multi-capture right after its single capture; then leaps. Never a king's square or an own piece.
 */
export function abilityTargetsInto(
  b: Int8Array, t: Int8Array, from: number, table: AbilityTable, outTo: Int8Array, outVia: Int8Array,
): number {
  const m = moverAt(compiledOf(table), b, t, from);
  if (m === undefined) {
    const n = targetsInto(b, from, outTo);
    for (let i = 0; i < n; i++) outVia[i] = -1;
    return n;
  }
  let n = 0;
  const rays = m.rays[from]!;
  for (let r = 0; r < rays.length; r++) {
    const ray = rays[r]!;
    let passed = false;
    for (let i = 0; i < ray.length; i++) {
      const x = ray[i]!;
      const c = b[x]!;
      if (c === 0) {
        outTo[n] = x;
        outVia[n++] = -1;
        continue;
      }
      if (c > 0) {
        if (m.leapAllies === 0) break;
        passed = true;
        continue;
      }
      // An enemy ends the line; it is captured unless it is the king or the leap forbids it.
      if (c !== -KING && (!passed || m.leapAllies === 2)) {
        outTo[n] = x;
        outVia[n++] = -1;
        if (m.multiCapture === 2 || (m.multiCapture === 1 && !passed)) {
          const y = ray[i + 1];
          if (y !== undefined) {
            const cy = b[y]!;
            if (cy < 0 && cy !== -KING) {
              outTo[n] = y;
              outVia[n++] = x;
            }
          }
        }
      }
      break;
    }
  }
  const slid = n;
  const leaps = m.leaps[from]!;
  for (let i = 0; i < leaps.length; i++) {
    const x = leaps[i]!;
    const c = b[x]!;
    if (c > 0 || c === -KING || slidTo(outTo, outVia, slid, x)) continue;
    outTo[n] = x;
    outVia[n++] = -1;
  }
  return n;
}

function slidTo(outTo: Int8Array, outVia: Int8Array, n: number, x: number): boolean {
  for (let i = 0; i < n; i++) if (outTo[i] === x && outVia[i] === -1) return true;
  return false;
}

const TO = new Int8Array(80);
const VIA = new Int8Array(80);

/** `abilityTargetsInto` as an array of `{ to, via }`. */
export function abilityTargets(
  b: Int8Array, t: Int8Array, from: number, table: AbilityTable,
): { to: number; via: number }[] {
  const n = abilityTargetsInto(b, t, from, table, TO, VIA);
  const out: { to: number; via: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ to: TO[i]!, via: VIA[i]! });
  return out;
}

/**
 * Whether `sq` is attacked by White with rarity abilities: some White piece has a single-capture
 * move that could land on `sq` were a (non-king) enemy standing there (docs/02 §2.3 "attacks follow
 * moves"). A Rare slider does not attack beyond an ally; one that may capture after a leap does;
 * extra leapers attack; a multi-capture's second square is never attacked through the first.
 */
export function abilityAttacked(b: Int8Array, t: Int8Array, sq: number, table: AbilityTable): boolean {
  if (attackedBy(b, sq, 1)) return true;
  const c = compiledOf(table);
  // Walk outward from sq: a tiered slider attacks it along a direction it slides in when only
  // allies stand between, and past an ally only if it may capture after a leap.
  const rays = RAYS8[sq]!;
  for (let d = 0; d < 8; d++) {
    const ray = rays[d]!;
    const back = OPPOSITE[d]!;
    let allies = false;
    for (let i = 0; i < ray.length; i++) {
      const p = ray[i]!;
      const code = b[p]!;
      if (code === 0) continue;
      if (code < 0) break;
      const m = moverAt(c, b, t, p);
      if (m !== undefined && ((m.dirs >> back) & 1) === 1 && (!allies || m.leapAllies === 2)) return true;
      allies = true;
    }
  }
  const from = c.extraLeapFrom[sq]!;
  for (let i = 0; i < from.length; i++) {
    const p = from[i]!;
    if (b[p]! <= 0) continue;
    const m = moverAt(c, b, t, p);
    if (m !== undefined && m.extraLeapAdj !== null && m.extraLeapAdj[p * 64 + sq] === 1) return true;
  }
  return false;
}

/**
 * Sets `out[sq] = 1` on every square the piece on `from` attacks by `abilityAttacked`'s rule, and
 * returns true, when it is a White knight, bishop, rook or queen with a tier; else returns false and
 * marks nothing (its attacks are the M1 ones). Along a ray: each square up to and including the
 * first Black piece, passing White pieces only when it leaps allies, and marking beyond the first
 * ally only when it may capture after the leap; then every leap target, whatever stands there.
 */
export function markAbilityAttacks(
  b: Int8Array, t: Int8Array, from: number, table: AbilityTable, out: Uint8Array,
): boolean {
  const m = moverAt(compiledOf(table), b, t, from);
  if (m === undefined) return false;
  const rays = m.rays[from]!;
  for (let r = 0; r < rays.length; r++) {
    const ray = rays[r]!;
    let passed = false;
    for (let i = 0; i < ray.length; i++) {
      const x = ray[i]!;
      if (!passed || m.leapAllies === 2) out[x] = 1;
      else break;
      const c = b[x]!;
      if (c === 0) continue;
      if (c < 0 || m.leapAllies === 0) break;
      passed = true;
    }
  }
  const leaps = m.leaps[from]!;
  for (let i = 0; i < leaps.length; i++) out[leaps[i]!] = 1;
  return true;
}

/** Whether `piece` has a bonus move (the Legendary knight): a Hero Piece of a tier whose flags say so. */
export function hasBonusMove(piece: BoardPiece, config: EngineConfig): boolean {
  const tier = position.tierOfPiece(piece);
  if (tier === 0 || piece.pieceType === 'pawn' || piece.pieceType === 'king') return false;
  return config.abilities[piece.pieceType][tier as 1 | 2 | 3].bonusSelfMove;
}
