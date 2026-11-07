#!/usr/bin/env node
/**
 * Checkbreaker content validator (M0).
 *
 * Two passes:
 *   1. SCHEMA   — every file in content/examples/ against its JSON Schema.
 *   2. SEMANTIC — cross-file design invariants that a schema cannot express:
 *                 template feasibility, act value bands, deck legality, board sanity,
 *                 rarity tiers and act-gated pools, piece abilities, spawned
 *                 pawns and promotion.
 *
 * Pass 2 is the point. A JSON Schema can prove a template is well-formed; only
 * this pass can prove it is *a legal, reachable encounter* under data/economy.yaml.
 *
 * Usage: npm run validate
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = path.join(ROOT, 'schemas');
const CONTENT_DIR = path.join(ROOT, 'content', 'examples');
const ECONOMY_FILE = path.join(ROOT, 'data', 'economy.yaml');

const SCHEMA_IDS = {
  piece: 'https://checkbreaker.dev/schemas/piece.schema.json',
  skill: 'https://checkbreaker.dev/schemas/skill.schema.json',
  template: 'https://checkbreaker.dev/schemas/template.schema.json',
  stage: 'https://checkbreaker.dev/schemas/stage.schema.json',
  run: 'https://checkbreaker.dev/schemas/run.schema.json',
};

const MANIFEST = [
  { file: 'pieces.yaml', schema: 'piece', collection: 'pieces' },
  { file: 'skills.yaml', schema: 'skill', collection: 'skills' },
  { file: 'templates.yaml', schema: 'template', collection: 'templates' },
  { file: 'run-starter.yaml', schema: 'run' },
  { file: 'run-mid.yaml', schema: 'run' },
  { file: 'stage-state.yaml', schema: 'stage' },
];

const errors = [];
const passes = [];
const docs = {};

const fail = (msg) => errors.push(msg);
const ok = (msg) => passes.push(msg);

// ---------------------------------------------------------------------------
// Load schemas
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const [name, id] of Object.entries(SCHEMA_IDS)) {
  const file = path.join(SCHEMA_DIR, `${name}.schema.json`);
  let schema;
  try {
    schema = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`FATAL: cannot load schema ${file}: ${err.message}`);
    process.exit(2);
  }
  if (schema.$id !== id) {
    console.error(`FATAL: ${file} has $id "${schema.$id}", expected "${id}"`);
    process.exit(2);
  }
  ajv.addSchema(schema);
}

const formatAjvErrors = (file, where, errs) =>
  (errs ?? []).map(
    (e) => `${file}${where ? ` → ${where}` : ''}: ${e.instancePath || '/'} ${e.message}`,
  );

// ---------------------------------------------------------------------------
// Pass 1 — schema validation
// ---------------------------------------------------------------------------

let itemCount = 0;

for (const entry of MANIFEST) {
  const filePath = path.join(CONTENT_DIR, entry.file);
  let doc;
  try {
    doc = parseYaml(readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`${entry.file}: cannot parse YAML — ${err.message}`);
    continue;
  }
  docs[entry.file] = doc;

  const schemaId = SCHEMA_IDS[entry.schema];

  if (entry.collection) {
    const list = doc?.[entry.collection];
    if (!Array.isArray(list)) {
      fail(`${entry.file}: expected a top-level array "${entry.collection}"`);
      continue;
    }
    list.forEach((item, i) => {
      itemCount += 1;
      if (!ajv.validate(schemaId, item)) {
        fail(...formatAjvErrors(entry.file, `${entry.collection}[${i}]`, ajv.errors));
      }
    });
    ok(`${entry.file}: ${list.length} ${entry.collection} valid`);
  } else {
    itemCount += 1;
    if (!ajv.validate(schemaId, doc)) {
      fail(...formatAjvErrors(entry.file, '', ajv.errors));
    } else {
      ok(`${entry.file}: valid`);
    }
  }
}

// ---------------------------------------------------------------------------
// Load tuning data for the semantic pass
// ---------------------------------------------------------------------------

let economy;
try {
  economy = parseYaml(readFileSync(ECONOMY_FILE, 'utf8'));
} catch (err) {
  console.error(`FATAL: cannot load ${ECONOMY_FILE}: ${err.message}`);
  process.exit(2);
}

const valueOf = (pieceType) => economy.pieces?.[pieceType]?.value;
const templateIds = new Set();
const skillIds = new Set();

for (const t of docs['templates.yaml']?.templates ?? []) templateIds.add(t.id);
for (const s of docs['skills.yaml']?.skills ?? []) skillIds.add(s.id);

// ---------------------------------------------------------------------------
// Pass 2 — semantic invariants
// ---------------------------------------------------------------------------

// 2a. Templates: act value band and turn-limit shape. (Checkmate is the only
// win, so there is no material threshold to check — docs/02 §7.)
const bossMultiplier = economy.stages?.enemyArmyValueBand?.bossMultiplier ?? 1.25;

for (const t of docs['templates.yaml']?.templates ?? []) {
  let minValue = 0;
  let maxValue = 0;
  for (const [pieceType, range] of Object.entries(t.enemyArmy ?? {})) {
    const [lo, hi] = range;
    const v = valueOf(pieceType);
    if (v === undefined) {
      fail(`${t.id}: unknown piece type "${pieceType}" in enemyArmy`);
      continue;
    }
    minValue += lo * v;
    maxValue += hi * v;
  }

  // Fixed templates hand-place the enemy: the value is exact, and the board
  // must be a legal set piece (one king, clear of the player's ranks).
  if (t.placement === 'fixed') {
    const entries = Object.entries(t.fixedEnemy ?? {});
    const kings = entries.filter(([, type]) => type === 'king');
    if (kings.length !== 1) fail(`${t.id}: fixedEnemy must contain exactly one king, found ${kings.length}`);
    const playerRanks = new Set([...(t.deploymentRanks ?? []), ...(t.spawnedPawns?.ranks ?? [])]);
    for (const [square, type] of entries) {
      if (playerRanks.has(Number(square[1]))) fail(`${t.id}: fixed enemy ${type} on ${square} sits on a player deployment/spawn rank`);
      if (type !== 'king') {
        minValue += valueOf(type) ?? 0;
        maxValue += valueOf(type) ?? 0;
      }
    }
    if (t.enemyPolicy?.type === 'scripted') {
      const first = t.enemyPolicy.line?.[0];
      if (first && !t.fixedEnemy?.[first.slice(0, 2)]) {
        fail(`${t.id}: scripted line starts with ${first}, but no enemy piece stands on ${first.slice(0, 2)}`);
      }
    }
  }

  // The enemy king is always present and worth 0, but it counts as a piece.
  if (minValue <= 0) fail(`${t.id}: enemy army has no material value`);

  const band = economy.stages?.enemyArmyValueBand?.[`act${t.act}`];
  if (!Array.isArray(band)) {
    fail(`${t.id}: no enemyArmyValueBand for act ${t.act} in data/economy.yaml`);
  } else {
    const factor = t.tier === 'boss' ? bossMultiplier : 1;
    const bandLo = band[0] * factor;
    const bandHi = band[1] * factor;
    if (minValue < bandLo || maxValue > bandHi) {
      fail(
        `${t.id}: enemy value ${minValue}–${maxValue} outside act ${t.act} band ${bandLo}–${bandHi}`,
      );
    } else {
      ok(`${t.id}: enemy value inside act ${t.act} band ${bandLo}–${bandHi}`);
    }
  }

  // Turn limit shape: bosses must be tighter than their act's normal limit.
  const actLimit = economy.stages?.turnLimits?.[`act${t.act}`];
  if (t.tier === 'boss' && actLimit !== undefined) {
    const expected = actLimit - (economy.stages.turnLimits.bossPenalty ?? 1);
    if (t.turnLimit !== expected) {
      fail(`${t.id}: boss turnLimit ${t.turnLimit} should be ${expected} for act ${t.act}`);
    }
  } else if (t.tier === 'normal' && actLimit !== undefined && t.turnLimit !== actLimit) {
    fail(`${t.id}: normal turnLimit ${t.turnLimit} should be ${actLimit} for act ${t.act}`);
  }
}

// 2a'. Rarity: tier list matches the schema, prices scale with tier, and the
// rarity pool is act-gated (docs/06 §4, docs/07 §2.1, invariant I14).
const RARITY_TIERS = ['normal', 'rare', 'unique', 'legendary'];
const rarity = economy.rarity ?? {};
const tiers = rarity.tiers ?? [];
const tierRank = (t) => tiers.indexOf(t);

if (JSON.stringify(tiers) !== JSON.stringify(RARITY_TIERS)) {
  fail(`economy.yaml: rarity.tiers ${JSON.stringify(tiers)} must be ${JSON.stringify(RARITY_TIERS)} (matches run.schema.json)`);
} else {
  ok(`economy.yaml: ${tiers.length} rarity tiers in order`);
}
for (const key of ['enemyPieceRarity', 'starterRarity', 'recoveryOfferRarity']) {
  if (rarity[key] !== tiers[0]) fail(`economy.yaml: rarity.${key} must be "${tiers[0]}", got "${rarity[key]}"`);
}
if (rarity.kingHasRarity !== false) fail('economy.yaml: rarity.kingHasRarity must be false (invariant I12)');

const actCount = economy.stages?.acts ?? 3;
let prevCeiling = -1;
for (let act = 1; act <= actCount; act += 1) {
  const pool = rarity.pool?.[`act${act}`];
  const where = `economy.yaml: rarity.pool.act${act}`;
  if (!pool) {
    fail(`${where} is missing`);
    continue;
  }
  const ceiling = tierRank(pool.ceiling);
  if (ceiling < 0) {
    fail(`${where}: unknown ceiling "${pool.ceiling}"`);
    continue;
  }
  const weights = pool.weights ?? {};
  let total = 0;
  let problems = 0;
  for (const [tier, w] of Object.entries(weights)) {
    if (tierRank(tier) < 0) {
      fail(`${where}: unknown tier "${tier}" in weights`);
      problems += 1;
      continue;
    }
    if (typeof w !== 'number' || w < 0) {
      fail(`${where}: weight for ${tier} must be a non-negative number`);
      problems += 1;
      continue;
    }
    if (tierRank(tier) > ceiling && w > 0) {
      fail(`${where}: ${tier} has weight ${w} but is above the ceiling "${pool.ceiling}"`);
      problems += 1;
    }
    total += w;
  }
  if (!(weights[pool.ceiling] > 0)) {
    fail(`${where}: ceiling "${pool.ceiling}" has no weight, so it can never be rolled`);
    problems += 1;
  }
  if (total <= 0) {
    fail(`${where}: weights sum to 0`);
    problems += 1;
  }
  if (ceiling < prevCeiling) {
    fail(`${where}: ceiling "${pool.ceiling}" is lower than the previous act's — ceilings never go down`);
    problems += 1;
  }
  if (act === 1 && ceiling > tierRank('rare')) {
    fail(`${where}: Act I ceiling must be at most "rare", got "${pool.ceiling}"`);
    problems += 1;
  }
  if (problems === 0) ok(`${where}: capped at ${pool.ceiling}`);
  prevCeiling = Math.max(prevCeiling, ceiling);
}
const ceilingOf = (act) => tierRank(rarity.pool?.[`act${act}`]?.ceiling);

// Price multipliers: one per tier, Normal = 1, never cheaper at a higher tier
// (a tier that adds power must add cost — pillar 2).
{
  const mult = rarity.priceMultiplier ?? {};
  let prev = 0;
  let problems = 0;
  for (const tier of tiers) {
    const m = mult[tier];
    if (typeof m !== 'number') {
      fail(`economy.yaml: rarity.priceMultiplier.${tier} is missing`);
      problems += 1;
      continue;
    }
    if (m < prev) {
      fail(`economy.yaml: rarity.priceMultiplier.${tier} (${m}) is lower than the tier below (${prev})`);
      problems += 1;
    }
    prev = m;
  }
  if (mult.normal !== 1) {
    fail('economy.yaml: rarity.priceMultiplier.normal must be 1');
    problems += 1;
  }
  if (problems === 0) ok('economy.yaml: rarity price multipliers rise with tier');
}

// 2a''. Pieces: definitions mirror data/economy.yaml, rarity abilities and
// durability overrides respect the durability-vs-power rule (docs/06 §1).
const pieceDefs = new Map((docs['pieces.yaml']?.pieces ?? []).map((p) => [p.pieceType, p]));
for (const [type, def] of pieceDefs) {
  const eco = economy.pieces?.[type];
  if (!eco) {
    fail(`pieces.yaml:${type}: missing from data/economy.yaml → pieces`);
    continue;
  }
  for (const key of ['value', 'cost', 'durabilityMax', 'purchasable']) {
    if (eco[key] !== def[key]) fail(`pieces.yaml:${type}: ${key} ${def[key]} does not match economy.yaml (${eco[key]})`);
  }
  if (JSON.stringify(eco.durabilityMaxByRarity ?? {}) !== JSON.stringify(def.durabilityMaxByRarity ?? {})) {
    fail(`pieces.yaml:${type}: durabilityMaxByRarity does not match economy.yaml`);
  }
  for (const [tier, d] of Object.entries(def.durabilityMaxByRarity ?? {})) {
    if (typeof def.durabilityMax === 'number' && d > def.durabilityMax) {
      fail(`pieces.yaml:${type}: ${tier} durability ${d} exceeds Normal ${def.durabilityMax} — higher tiers must never be more durable`);
    }
  }
}
const durabilityMaxFor = (type, tier) =>
  pieceDefs.get(type)?.durabilityMaxByRarity?.[tier] ?? pieceDefs.get(type)?.durabilityMax;
ok(`pieces.yaml: ${pieceDefs.size} piece types mirror data/economy.yaml`);

// Abilities are cumulative: a tier has its own entries plus every lower tier's.
const abilitiesFor = (type, tier) => {
  const out = new Set();
  const table = pieceDefs.get(type)?.rarityAbilities ?? {};
  for (const t of tiers.slice(0, tierRank(tier) + 1)) for (const a of table[t] ?? []) out.add(a.ability);
  return out;
};

// Retention (e.g. the Legendary queen's rarity): a probability for a real
// purchasable type at a tier above Normal.
{
  let problems = 0;
  for (const [type, perTier] of Object.entries(rarity.retention ?? {})) {
    if (!pieceDefs.get(type)?.purchasable) {
      fail(`economy.yaml: rarity.retention.${type} — not a purchasable piece type`);
      problems += 1;
    }
    for (const [tier, r] of Object.entries(perTier ?? {})) {
      if (tierRank(tier) < 1) {
        fail(`economy.yaml: rarity.retention.${type}.${tier} — must be a tier above ${tiers[0]}`);
        problems += 1;
      }
      if (!(r > 0 && r <= 1)) {
        fail(`economy.yaml: rarity.retention.${type}.${tier} = ${r} must be in (0, 1]`);
        problems += 1;
      }
    }
  }
  if (problems === 0) ok('economy.yaml: rarity retention values valid');
}

// 2a'''. Promotion (docs/02 §2.2).
{
  const promo = economy.promotion ?? {};
  let problems = 0;
  for (const [type, w] of Object.entries(promo.resultTypeWeights ?? {})) {
    if (!pieceDefs.get(type)?.purchasable) {
      fail(`economy.yaml: promotion.resultTypeWeights.${type} — promotion may only produce deck piece types`);
      problems += 1;
    }
    if (typeof w !== 'number' || w < 0) {
      fail(`economy.yaml: promotion.resultTypeWeights.${type} must be a non-negative number`);
      problems += 1;
    }
  }
  if (!(promo.tierUpChance >= 0 && promo.tierUpChance <= 1)) {
    fail('economy.yaml: promotion.tierUpChance must be between 0 and 1');
    problems += 1;
  }
  if (promo.clampToActCeiling !== true) {
    fail('economy.yaml: promotion.clampToActCeiling must be true — promotion must not bypass the act ceiling (I14)');
    problems += 1;
  }
  if (problems === 0) ok('economy.yaml: promotion results are deck pieces, clamped to the act ceiling');
}
const promotionWeights = economy.promotion?.resultTypeWeights ?? {};

// Enemy AI (docs/02 §8.1): terminal scores must dwarf any positional score,
// so the enemy never trades a forced outcome for a slightly better position.
{
  const ai = economy.enemyAI ?? {};
  const w = ai.weights ?? {};
  const term = ai.terminal ?? {};
  let problems = 0;
  for (const key of ['kingEscapeSquare', 'kingZoneAttacked', 'kingInCheck', 'materialPerPoint', 'mobilityPerMove']) {
    if (typeof w[key] !== 'number') {
      fail(`economy.yaml: enemyAI.weights.${key} is missing`);
      problems += 1;
    }
  }
  // Generous bound on |positional score|: 8 escape squares, 8 attacked zone
  // squares, check, 39 points of material each way, ~120 legal moves.
  const bound =
    8 * Math.abs(w.kingEscapeSquare ?? 0) + 8 * Math.abs(w.kingZoneAttacked ?? 0) +
    Math.abs(w.kingInCheck ?? 0) + 2 * 39 * Math.abs(w.materialPerPoint ?? 0) + 120 * Math.abs(w.mobilityPerMove ?? 0);
  if (!(term.playerMated > term.playerOutOfTurns && term.playerOutOfTurns > 10 * bound)) {
    fail(`economy.yaml: enemyAI.terminal must satisfy playerMated > playerOutOfTurns > 10 × positional bound (${bound})`);
    problems += 1;
  }
  if (term.enemyMated !== -term.playerMated) {
    fail('economy.yaml: enemyAI.terminal.enemyMated must be the negative of playerMated');
    problems += 1;
  }
  if (!(w.kingEscapeSquare > 0 && w.kingZoneAttacked < 0 && w.kingInCheck < 0 && w.materialPerPoint > 0)) {
    fail('economy.yaml: enemyAI.weights signs are wrong (escape squares and material good; attacked zone and check bad)');
    problems += 1;
  }
  if (!(Number.isInteger(ai.search?.quiescence?.maxDepth) && ai.search.quiescence.maxDepth >= 0)) {
    fail('economy.yaml: enemyAI.search.quiescence.maxDepth must be a non-negative integer');
    problems += 1;
  }
  if (problems === 0) ok(`economy.yaml: enemy AI terminal scores outrank positional bound ${bound}`);
}

// Base reward and merge configuration (docs/05 §2, docs/06 §5).
{
  let problems = 0;
  const base = economy.economy?.baseReward ?? {};
  let prev = 0;
  for (let act = 1; act <= actCount; act += 1) {
    const b = base[`act${act}`];
    if (!(Number.isInteger(b) && b >= 0)) {
      fail(`economy.yaml: economy.baseReward.act${act} must be a non-negative integer`);
      problems += 1;
    } else if (b < prev) {
      fail(`economy.yaml: economy.baseReward.act${act} (${b}) is lower than the previous act (${prev})`);
      problems += 1;
    } else prev = b;
  }
  if (!(base.bossMultiplier >= 1)) {
    fail('economy.yaml: economy.baseReward.bossMultiplier must be >= 1');
    problems += 1;
  }
  if (economy.economy?.dominationPayoutMultiplier !== undefined || economy.stages?.materialThreshold !== undefined) {
    fail('economy.yaml: domination settings must not exist — checkmate is the only win');
    problems += 1;
  }
  const merge = economy.deck?.merge ?? {};
  if (!(Number.isInteger(merge.inputs) && merge.inputs >= 2)) {
    fail('economy.yaml: deck.merge.inputs must be an integer >= 2');
    problems += 1;
  }
  if (tierRank(merge.maxInputTier) < 0 || tierRank(merge.maxInputTier) >= tiers.length - 1) {
    fail('economy.yaml: deck.merge.maxInputTier must be a tier below the highest');
    problems += 1;
  }
  if (merge.clampToActCeiling !== true) {
    fail('economy.yaml: deck.merge.clampToActCeiling must be true — merging must not bypass the act ceiling (I14)');
    problems += 1;
  }
  if (!(Number.isInteger(economy.deck?.capacity) && economy.deck.capacity >= 1)) {
    fail('economy.yaml: deck.capacity must be a positive integer');
    problems += 1;
  }
  if (problems === 0) ok(`economy.yaml: base rewards rise by act; merge takes ${merge.inputs}, capped at the act ceiling; capacity ${economy.deck.capacity}`);
}

// 2a''''. Templates: spawned pawns must be able to promote within the turn limit.
for (const t of docs['templates.yaml']?.templates ?? []) {
  const sp = t.spawnedPawns;
  if (!sp) continue;
  const [lo, hi] = sp.count;
  let problems = 0;
  if (lo < 1 || hi < lo) {
    fail(`${t.id}: spawnedPawns.count ${JSON.stringify(sp.count)} must be [min>=1, max>=min]`);
    problems += 1;
  }
  const overlap = sp.ranks.filter((r) => (t.enemyZone ?? []).includes(r));
  if (overlap.length > 0) {
    fail(`${t.id}: spawnedPawns.ranks overlap enemyZone on rank(s) ${overlap.join(', ')}`);
    problems += 1;
  }
  const distance = 8 - Math.min(...sp.ranks);
  if (distance > t.turnLimit) {
    fail(`${t.id}: a pawn spawned on rank ${Math.min(...sp.ranks)} needs ${distance} moves to promote, but turnLimit is ${t.turnLimit}`);
    problems += 1;
  }
  if (problems === 0) ok(`${t.id}: ${lo}–${hi} spawned pawn(s) on ranks ${sp.ranks.join('/')}, promotion reachable`);
}

// 2a'''''. Deployment phase, summoning and stalemate (docs/02 §3, §5, §7).
// The player places the King and summons up to summonLimit deck pieces before
// turn 1; the deck is locked after the first move; there is no pass; either
// side's stalemate is a loss for the player.
{
  const r = economy.rules ?? {};
  let problems = 0;
  for (const stale of ['deploymentsPerTurn', 'openingPlacements', 'stalemateBehavior']) {
    if (stale in r) {
      fail(`economy.yaml: rules.${stale} was removed (Deployment phase replaces it, docs/02 §5)`);
      problems += 1;
    }
  }
  let previous = -1;
  for (let act = 1; act <= actCount; act++) {
    const limit = r.summonLimit?.[`act${act}`];
    if (!Number.isInteger(limit) || limit < 0 || limit > (economy.deck?.capacity ?? 8)) {
      fail(`economy.yaml: rules.summonLimit.act${act} must be an integer in 0..deck capacity`);
      problems += 1;
    } else if (limit < previous) {
      fail(`economy.yaml: rules.summonLimit.act${act} (${limit}) is below act ${act - 1} (${previous})`);
      problems += 1;
    } else previous = limit;
  }
  if (r.summonCostsDurability !== 1) {
    fail('economy.yaml: rules.summonCostsDurability must be 1 (durability = stages a piece can be brought, I7)');
    problems += 1;
  }
  if (r.deckLockedAfterStart !== true) {
    fail('economy.yaml: rules.deckLockedAfterStart must be true (no summoning after the first move, I15)');
    problems += 1;
  }
  if (!(Number.isInteger(r.minMovesPerQueue) && r.minMovesPerQueue >= 1)) {
    fail('economy.yaml: rules.minMovesPerQueue must be >= 1 (there is no pass)');
    problems += 1;
  }
  if (r.stalemate !== 'player_loses') {
    fail('economy.yaml: rules.stalemate must be player_loses (docs/02 §7)');
    problems += 1;
  }
  if (problems === 0) ok(`economy.yaml: summon limits ${[1, 2, 3].map((a) => r.summonLimit[`act${a}`]).join('/')}, deck locked after Start, no pass, stalemate loses`);

  for (const t of docs['templates.yaml']?.templates ?? []) {
    const actLimit = r.summonLimit?.[`act${t.act}`];
    const limit = t.summonLimit ?? actLimit;
    if (t.summonLimit !== undefined && actLimit !== undefined && t.summonLimit > actLimit) {
      fail(`${t.id}: summonLimit ${t.summonLimit} raises act ${t.act}'s limit ${actLimit}; a template may only lower it`);
      continue;
    }
    // King + every summon need a square in the deployment ranks.
    const squares = 8 * (t.deploymentRanks ?? []).length;
    if (limit !== undefined && squares < limit + 1) {
      fail(`${t.id}: ${squares} deployment squares cannot hold the King plus ${limit} summons`);
      continue;
    }
    const clash = (t.spawnedPawns?.ranks ?? []).filter((rank) => (t.deploymentRanks ?? []).includes(rank));
    if (clash.length > 0) {
      fail(`${t.id}: spawnedPawns.ranks overlap deploymentRanks on rank(s) ${clash.join(', ')}`);
      continue;
    }
    ok(`${t.id}: King + ${limit} summon(s) fit the deployment ranks`);
  }
}

// 2b. Runs: deck legality and economy invariants.
for (const file of ['run-starter.yaml', 'run-mid.yaml']) {
  const run = docs[file];
  if (!run) continue;

  const deck = run.deck ?? [];
  const nonKing = deck.filter((p) => p.pieceType !== 'king');
  const kings = deck.filter((p) => p.pieceType === 'king');

  if (kings.length !== 1) fail(`${file}: expected exactly 1 king, found ${kings.length}`);
  if (run.deckCapacity !== economy.deck?.capacity) {
    fail(`${file}: deckCapacity ${run.deckCapacity} must equal data/economy.yaml deck.capacity (${economy.deck?.capacity})`);
  }
  if (nonKing.length > run.deckCapacity) {
    fail(`${file}: deck holds ${nonKing.length} non-king pieces but capacity is ${run.deckCapacity}`);
  } else {
    ok(`${file}: deck ${nonKing.length}/${run.deckCapacity} capacity`);
  }

  for (const p of deck) {
    const label = `${file}:${p.instanceId}`;
    if (p.pieceType === 'king' && p.durability !== null) fail(`${label}: king durability must be null`);
    if (p.pieceType !== 'king' && p.durability === null) fail(`${label}: non-king durability cannot be null`);
    if (p.pieceType !== 'king' && p.origin === 'starter' && p.rarity !== rarity.starterRarity) {
      fail(`${label}: starter pieces must be "${rarity.starterRarity}" rarity, got "${p.rarity}"`);
    }
    for (const used of p.usedOnce ?? []) {
      if (!abilitiesFor(p.pieceType, p.rarity).has(used)) {
        fail(`${label}: usedOnce lists "${used}", which a ${p.rarity} ${p.pieceType} does not have`);
      }
    }
    if (p.pieceType !== 'king' && p.durabilityMax !== durabilityMaxFor(p.pieceType, p.rarity)) {
      fail(`${label}: durabilityMax ${p.durabilityMax} should be ${durabilityMaxFor(p.pieceType, p.rarity)} for a ${p.rarity} ${p.pieceType}`);
    }
    if (p.status === 'captured') fail(`${label}: captured pieces are removed from the run, not kept in the deck`);
    if (p.status === 'spent') fail(`${label}: spent pieces are removed at stage end, not kept in the deck`);
    if (typeof p.durability === 'number' && p.durability < 1 && p.pieceType !== 'king') {
      fail(`${label}: piece with 0 durability must be 'spent', never 'in_deck'`);
    }
    if (typeof p.durability === 'number' && typeof p.durabilityMax === 'number' && p.durability > p.durabilityMax) {
      fail(`${label}: durability ${p.durability} exceeds max ${p.durabilityMax}`);
    }
  }

  const slots = economy.skills?.loadoutSlots ?? 3;
  if ((run.loadout ?? []).length > slots) {
    fail(`${file}: loadout has ${run.loadout.length} skills, max ${slots}`);
  }
  for (const s of run.loadout ?? []) {
    if (!skillIds.has(s.skillId)) fail(`${file}: loadout references unknown skill "${s.skillId}"`);
    if (s.charges > s.chargesMax) fail(`${file}: ${s.skillId} charges ${s.charges} exceed max ${s.chargesMax}`);
  }

  // History must follow the run shape: entry i is act floor(i / stagesPerAct) + 1,
  // and the last stage of each act is a boss (docs/05 §1).
  const perAct = economy.stages?.stagesPerAct ?? 3;
  const bossIndex = (economy.stages?.bossStageIndex ?? 3) - 1;
  (run.history ?? []).forEach((h, i) => {
    const where = `${file}: history[${i}]`;
    const tpl = (docs['templates.yaml']?.templates ?? []).find((t) => t.id === h.templateId);
    if (!tpl) {
      fail(`${where} references unknown template "${h.templateId}"`);
      return;
    }
    const act = Math.floor(i / perAct) + 1;
    const tier = i % perAct === bossIndex ? 'boss' : 'normal';
    if (tpl.act !== act || tpl.tier !== tier) {
      fail(`${where} is act ${act} ${tier} but uses ${tpl.id} (act ${tpl.act} ${tpl.tier})`);
    }
    if (h.turnsUsed > tpl.turnLimit) {
      fail(`${where}: turnsUsed ${h.turnsUsed} exceeds ${tpl.id}'s turnLimit ${tpl.turnLimit}`);
    }
  });
  if ((run.history ?? []).length > 0) ok(`${file}: ${run.history.length} history entries follow the act/boss shape`);
}

// 2c. Stage: board sanity and referential integrity.
const stage = docs['stage-state.yaml'];
if (stage) {
  const pieces = Object.entries(stage.board ?? {});

  if (!templateIds.has(stage.templateId)) {
    fail(`stage-state.yaml: unknown template "${stage.templateId}"`);
  }

  const stageTemplate = (docs['templates.yaml']?.templates ?? []).find((t) => t.id === stage.templateId);
  const stageCeiling = stageTemplate ? ceilingOf(stageTemplate.act) : -1;
  let spawnedCount = 0;

  for (const [square, piece] of pieces) {
    if (piece.color === 'white' && !piece.instanceId && piece.pieceType !== 'king' && !piece.spawned) {
      // Player pieces come from the deck (or are spawned pawns), so they must be identifiable.
      fail(`stage-state.yaml:${square}: white piece missing instanceId`);
    }
    if (piece.spawned) {
      spawnedCount += 1;
      const pawnTier = tierRank(piece.rarity);
      const resultTier = tierRank(piece.promotesTo?.rarity);
      if (stageCeiling >= 0 && pawnTier > stageCeiling) {
        fail(`stage-state.yaml:${square}: spawned pawn rarity "${piece.rarity}" is above the act ceiling`);
      }
      const expectedHigh = Math.min(pawnTier + 1, stageCeiling >= 0 ? stageCeiling : pawnTier + 1);
      if (resultTier < Math.min(pawnTier, expectedHigh) || resultTier > expectedHigh) {
        fail(`stage-state.yaml:${square}: promotesTo rarity "${piece.promotesTo?.rarity}" must be the pawn's tier or one higher, within the act ceiling`);
      }
      if (!(promotionWeights[piece.promotesTo?.pieceType] > 0)) {
        fail(`stage-state.yaml:${square}: promotesTo type "${piece.promotesTo?.pieceType}" has no promotion weight`);
      }
    }
    if (piece.color === 'black' && piece.instanceId) {
      fail(`stage-state.yaml:${square}: black piece must not carry an instanceId (no enemy deck)`);
    }
  }
  for (const [square, piece] of pieces) {
    if (piece.color === 'white' && piece.pieceType === 'king' && !piece.instanceId) {
      fail(`stage-state.yaml:${square}: the player king must be a deck instance`);
    }
  }

  // Deployment phase: only Stage Pieces stand on the board. Action phase: the
  // King is present and at most summonLimit other Hero Pieces were summoned.
  const heroes = pieces.filter(([, p]) => p.color === 'white' && p.instanceId && p.pieceType !== 'king');
  if (stage.phase === 'deployment') {
    const placed = pieces.filter(([, p]) => p.color === 'white' && p.instanceId);
    if (placed.length > 0) fail(`stage-state.yaml: deployment phase, but Hero Pieces are already on ${placed.map(([sq]) => sq).join(', ')}`);
  } else if (heroes.length > (stage.summonLimit ?? 0)) {
    fail(`stage-state.yaml: ${heroes.length} summoned Hero Pieces exceed summonLimit ${stage.summonLimit} (I15)`);
  } else {
    ok(`stage-state.yaml: ${heroes.length} of ${stage.summonLimit} summons on the board`);
  }
  {
    const tpl = (docs['templates.yaml']?.templates ?? []).find((t) => t.id === stage.templateId);
    const expected = tpl ? (tpl.summonLimit ?? economy.rules?.summonLimit?.[`act${tpl.act}`]) : undefined;
    if (expected !== undefined && stage.summonLimit !== expected) {
      fail(`stage-state.yaml: summonLimit ${stage.summonLimit} does not match template ${tpl.id}'s ${expected}`);
    }
    if ((stage.status === 'active') !== (stage.endReason === undefined)) {
      fail('stage-state.yaml: endReason must be present exactly when status is not active');
    } else if (stage.status === 'won' && stage.endReason !== 'checkmate') {
      fail(`stage-state.yaml: a won stage must end by checkmate, not ${stage.endReason}`);
    } else if (stage.status === 'lost' && stage.endReason === 'checkmate') {
      fail('stage-state.yaml: checkmate is a win, never a loss reason');
    }
  }

  if (stageTemplate?.spawnedPawns && spawnedCount > stageTemplate.spawnedPawns.count[1]) {
    fail(`stage-state.yaml: ${spawnedCount} spawned pawns exceed template max ${stageTemplate.spawnedPawns.count[1]}`);
  } else if (spawnedCount > 0) {
    ok(`stage-state.yaml: ${spawnedCount} spawned pawn(s) with valid rarity and promotion result`);
  }

  const whiteKings = pieces.filter(([, p]) => p.color === 'white' && p.pieceType === 'king');
  const blackKings = pieces.filter(([, p]) => p.color === 'black' && p.pieceType === 'king');
  const expectedWhiteKings = stage.phase === 'deployment' ? 0 : 1; // the King is placed at Start
  if (whiteKings.length !== expectedWhiteKings) fail(`stage-state.yaml: expected ${expectedWhiteKings} white king(s) in the ${stage.phase} phase, found ${whiteKings.length}`);
  if (blackKings.length !== 1) fail(`stage-state.yaml: expected 1 black king, found ${blackKings.length}`);
  if (whiteKings.length === expectedWhiteKings && blackKings.length === 1) ok(`stage-state.yaml: king count correct for the ${stage.phase} phase`);

  if (stage.playerColor === 'white' && whiteKings.length === 1) {
    const [kingSquare] = whiteKings[0];
    const rank = Number(kingSquare[1]);
    if (!(stage.deploymentRanks ?? []).includes(rank)) {
      fail(`stage-state.yaml: player king on ${kingSquare} is outside deployment ranks ${stage.deploymentRanks}`);
    }
  }

  if (stage.turnLimit < stage.turnsUsed) {
    fail(`stage-state.yaml: turnsUsed ${stage.turnsUsed} exceeds turnLimit ${stage.turnLimit}`);
  }
  if (stage.focus > stage.focusPool) {
    fail(`stage-state.yaml: focus ${stage.focus} exceeds focusPool ${stage.focusPool}`);
  }

  const template = (docs['templates.yaml']?.templates ?? []).find((t) => t.id === stage.templateId);
  if (template && template.turnLimit !== stage.turnLimit) {
    fail(`stage-state.yaml: turnLimit ${stage.turnLimit} does not match template ${template.id}'s ${template.turnLimit}`);
  }

  // Enemy board material must sit inside the template's own range.
  if (template) {
    let enemyValue = 0;
    for (const [, p] of pieces) if (p.color === 'black' && p.pieceType !== 'king') enemyValue += valueOf(p.pieceType) ?? 0;
    let minValue = 0;
    let maxValue = 0;
    for (const [pieceType, [lo, hi]] of Object.entries(template.enemyArmy ?? {})) {
      minValue += lo * (valueOf(pieceType) ?? 0);
      maxValue += hi * (valueOf(pieceType) ?? 0);
    }
    if (enemyValue < minValue || enemyValue > maxValue) {
      fail(
        `stage-state.yaml: enemy board value ${enemyValue} outside template ${template.id} range ${minValue}–${maxValue}`,
      );
    } else {
      ok(`stage-state.yaml: enemy value ${enemyValue} within ${minValue}–${maxValue}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

for (const p of passes) console.log(`  ok  ${p}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) found:\n`);
  for (const e of errors) console.error(`  FAIL ${e}`);
  console.error(`\nValidation failed: ${errors.length} of ${passes.length + errors.length} checks.`);
  process.exit(1);
}

console.log(
  `\nValidation passed: ${itemCount} documents, ${passes.length} checks, against ${Object.keys(SCHEMA_IDS).length} schemas.`,
);
