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

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = path.join(ROOT, 'schemas');
const CONTENT_DIR = path.join(ROOT, 'content', 'examples');
const ECONOMY_FILE = process.env.CHECKBREAKER_ECONOMY ?? path.join(ROOT, 'data', 'economy.yaml'); // the env override exists for the validator's own tests

const SCHEMA_IDS = {
  piece: 'https://checkbreaker.dev/schemas/piece.schema.json',
  skill: 'https://checkbreaker.dev/schemas/skill.schema.json',
  template: 'https://checkbreaker.dev/schemas/template.schema.json',
  stage: 'https://checkbreaker.dev/schemas/stage.schema.json',
  run: 'https://checkbreaker.dev/schemas/run.schema.json',
  formation: 'https://checkbreaker.dev/schemas/formation.schema.json',
};

const MANIFEST = [
  { file: 'pieces.yaml', schema: 'piece', collection: 'pieces' },
  { file: 'skills.yaml', schema: 'skill', collection: 'skills' },
  { dir: 'content/templates', schema: 'template' },
  { file: 'run-starter.yaml', schema: 'run' },
  { file: 'run-mid.yaml', schema: 'run' },
  { file: 'run-act3-strong.yaml', schema: 'run' },
  { file: 'stage-state.yaml', schema: 'stage' },
];

const errors = [];
const warnings = [];
const passes = [];
const docs = {};
const templates = [];

const fail = (msg) => errors.push(msg);
const ok = (msg) => passes.push(msg);
const warn = (msg) => warnings.push(msg);

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
    (e) =>
      `${file}${where ? ` → ${where}` : ''}: ${e.instancePath || '/'} ${e.message}` +
      (e.params?.additionalProperty ? ` ("${e.params.additionalProperty}")` : ''),
  );

// ---------------------------------------------------------------------------
// Pass 1 — schema validation
// ---------------------------------------------------------------------------

let itemCount = 0;

for (const entry of MANIFEST) {
  if (entry.dir) {
    const dirPath = path.join(ROOT, entry.dir);
    const names = readdirSync(dirPath).filter((n) => n.endsWith('.yaml')).sort();
    for (const name of names) {
      const label = `${entry.dir}/${name}`;
      let doc;
      try {
        doc = parseYaml(readFileSync(path.join(dirPath, name), 'utf8'));
      } catch (err) {
        fail(`${label}: cannot parse YAML — ${err.message}`);
        continue;
      }
      itemCount += 1;
      if (entry.schema === 'template' && doc?.turnLimit !== undefined) {
        fail(`${doc.id}: turnLimit was replaced by mateIn (docs/04 §2)`);
        continue;
      }
      if (!ajv.validate(SCHEMA_IDS[entry.schema], doc)) {
        fail(...formatAjvErrors(label, '', ajv.errors));
        continue;
      }
      if (name !== `${doc.id}.yaml`) {
        fail(`${label}: file name must equal the template id`);
        continue;
      }
      templates.push(doc);
      ok(`${label}: valid`);
    }
    continue;
  }
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

for (const t of templates) templateIds.add(t.id);
for (const s of docs['skills.yaml']?.skills ?? []) skillIds.add(s.id);

// ---------------------------------------------------------------------------
// Pass 2 — semantic invariants
// ---------------------------------------------------------------------------

// 2-skills. Skill catalogue (docs/03 §5–§7). An mvp skill may use only the
// primitives the engine implements now; a future skill may use any declared
// primitive. No skill may use a primitive the framework rejects outright.
{
  const MVP_PRIMITIVES = new Set(['grant_move_credit', 'set_piece_type', 'suppress_piece']);
  const REJECTED_PRIMITIVES = new Set(['add_plan_undo', 'shield_king']); // no undo after commit; no king immunity
  const skills = docs['skills.yaml']?.skills ?? [];
  const seen = new Set();
  let problems = 0;
  for (const s of skills) {
    if (seen.has(s.id)) {
      fail(`skills.yaml:${s.id}: duplicate skill id`);
      problems += 1;
    }
    seen.add(s.id);
    for (const e of s.effects ?? []) {
      if (s.status === 'mvp' && !MVP_PRIMITIVES.has(e.primitive)) {
        fail(`skills.yaml:${s.id}: mvp skill uses ${e.primitive}, which the engine does not implement yet (mark it future)`);
        problems += 1;
      }
      if (REJECTED_PRIMITIVES.has(e.primitive)) {
        fail(`skills.yaml:${s.id}: ${e.primitive} is rejected by the guardrails (docs/03 §7)`);
        problems += 1;
      }
      if (e.duration === 'permanent' && ['set_piece_type', 'override_moveset', 'ignore_blockers'].includes(e.primitive)) {
        fail(`skills.yaml:${s.id}: a permanent ${e.primitive} silently rewrites deck value (docs/03 §7)`);
        problems += 1;
      }
    }
    if (s.target?.pieceType === 'king') {
      fail(`skills.yaml:${s.id}: a skill may never target a king (docs/03 §7)`);
      problems += 1;
    }
    if (s.target?.kind === 'enemy_piece' && !(s.target?.excludes ?? []).includes('king')) {
      fail(`skills.yaml:${s.id}: an enemy-targeting skill must exclude the king (docs/03 §7)`);
      problems += 1;
    }
  }
  const mvp = skills.filter((s) => s.status === 'mvp').length;
  if (problems === 0) ok(`skills.yaml: ${skills.length} skills (${mvp} mvp, ${skills.length - mvp} future) use allowed primitives`);
}

// 2a. Templates: act value band and par (mateIn) shape. (Checkmate is the only
// win, so there is no material threshold to check — docs/02 §7.)
const bossMultiplier = economy.stages?.enemyArmyValueBand?.bossMultiplier ?? 1.25;

for (const t of templates) {
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
    const playerRanks = new Set([...(economy.rules?.deploymentRanks ?? []), ...(t.spawnedPawns?.ranks ?? [])]);
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

  // The par: mateIn replaced the turn limit (docs/04 §2).
  if (!(Array.isArray(t.mateIn) && t.mateIn.length === 2 && t.mateIn[0] <= t.mateIn[1])) {
    fail(`${t.id}: mateIn ${JSON.stringify(t.mateIn)} must be [min, max] with min <= max`);
  } else {
    ok(`${t.id}: par mate in ${t.mateIn[0]}–${t.mateIn[1]}`);
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

// 2a''. Pieces: definitions mirror data/economy.yaml. Durability is flat
// across deck pieces (one durabilityMax for all, overrides may only lower it);
// power is gated by spawnCost instead, whose overrides may only raise it
// (docs/06 §1).
const pieceDefs = new Map((docs['pieces.yaml']?.pieces ?? []).map((p) => [p.pieceType, p]));
for (const [type, def] of pieceDefs) {
  const eco = economy.pieces?.[type];
  if (!eco) {
    fail(`pieces.yaml:${type}: missing from data/economy.yaml → pieces`);
    continue;
  }
  for (const key of ['value', 'spawnCost', 'cost', 'durabilityMax', 'purchasable']) {
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
  if (JSON.stringify(eco.spawnCostByRarity ?? {}) !== JSON.stringify(def.spawnCostByRarity ?? {})) {
    fail(`pieces.yaml:${type}: spawnCostByRarity does not match economy.yaml`);
  }
  for (const [tier, c] of Object.entries(def.spawnCostByRarity ?? {})) {
    if (typeof def.spawnCost === 'number' && c < def.spawnCost) {
      fail(`pieces.yaml:${type}: ${tier} spawnCost ${c} is below Normal ${def.spawnCost} — a tier never makes a piece cheaper to summon`);
    }
  }
}
{
  // Flat durability (docs/06 §1): every deck piece shares one durabilityMax.
  const deckPieces = [...pieceDefs.values()].filter((d) => d.purchasable);
  const maxes = new Set(deckPieces.map((d) => d.durabilityMax));
  if (maxes.size !== 1) {
    fail(`pieces.yaml: durability must be flat — deck pieces have durabilityMax ${[...maxes].join(', ')}; use durabilityMaxByRarity for exceptions`);
  } else {
    const exceptions = deckPieces.flatMap((d) =>
      Object.entries(d.durabilityMaxByRarity ?? {}).map(([tier, v]) => `${tier} ${d.pieceType} ${v}`),
    );
    ok(`pieces.yaml: flat durability ${[...maxes][0]}${exceptions.length ? ` (exceptions: ${exceptions.join(', ')})` : ''}`);
  }
  if (pieceDefs.get('king') && pieceDefs.get('king').spawnCost !== 0) {
    fail('pieces.yaml:king: spawnCost must be 0 (the King is always free)');
  }
}
const durabilityMaxFor = (type, tier) =>
  pieceDefs.get(type)?.durabilityMaxByRarity?.[tier] ?? pieceDefs.get(type)?.durabilityMax;
const spawnCostFor = (type, tier) =>
  pieceDefs.get(type)?.spawnCostByRarity?.[tier] ?? pieceDefs.get(type)?.spawnCost;
// The cheapest summon bounds how many pieces a budget can bring.
const minSummonCost = Math.min(
  ...[...pieceDefs.values()]
    .filter((d) => d.purchasable)
    .flatMap((d) => [d.spawnCost, ...Object.values(d.spawnCostByRarity ?? {})]),
);
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
  if (!(term.playerMated > term.playerOutOfClock && term.playerOutOfClock > 10 * bound)) {
    fail(`economy.yaml: enemyAI.terminal must satisfy playerMated > playerOutOfClock > 10 × positional bound (${bound})`);
    problems += 1;
  }
  // The search stores scores beyond this bound node-relative (ply-adjusted); mates must clear it and
  // out-of-clock scores must not (src/enemy/search.ts mateBound).
  const mateBound = (term.playerMated + term.playerOutOfClock) / 2;
  if (!(term.playerOutOfClock + 40 < mateBound && mateBound < term.playerMated - 40)) {
    fail(`economy.yaml: enemyAI.terminal mate bound ${mateBound} must lie within (playerOutOfClock + 40, playerMated - 40)`);
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
  // docs/02 §8.1: rarity abilities enlarge the tree, so the depth is capped while any player piece
  // has a tier. The cap must be a real search depth (the schema's policy depths are 1..6).
  if (!(Number.isInteger(ai.search?.maxDepthWithRarity) && ai.search.maxDepthWithRarity >= 1 && ai.search.maxDepthWithRarity <= 6)) {
    fail('economy.yaml: enemyAI.search.maxDepthWithRarity must be an integer in 1..6');
    problems += 1;
  }
  if (problems === 0) ok(`economy.yaml: enemy AI terminal scores outrank positional bound ${bound}`);
}

// Generation and solver keys (docs/04 §5).
{
  let problems = 0;
  const bad = (msg) => { fail(`economy.yaml: ${msg}`); problems += 1; };
  const g = economy.generation ?? {};
  const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const positive = (obj, keys, where) => {
    for (const k of keys) if (!pos(obj?.[k])) bad(`${where}.${k} must be a positive number`);
  };
  for (const k of ['timeMs', 'orderHeuristic', 'memoizeEnemyReplies']) {
    if (g[k] !== undefined) bad(`generation.${k} was removed (docs/04 §5)`);
  }
  if (g.solver?.timeMs !== undefined) bad('generation.solver.timeMs was removed; the solver budget is nodeBudget only');
  if (g.solver?.orderHeuristic !== undefined) bad('generation.solver.orderHeuristic was removed (docs/04 §5)');
  if (g.acceptance?.medianWinTurnTolerance !== undefined) bad('generation.acceptance.medianWinTurnTolerance was renamed medianMateTurnTolerance');
  positive(g, ['maxRegenerations', 'maxPlacementTries', 'maxBoards'], 'generation');
  positive(g.formations, ['maxPerTemplate', 'minPerTemplate'], 'generation.formations');
  positive(g.solver, ['nodeBudget', 'minSolveTurns', 'expansion'], 'generation.solver');
  positive(g.solver?.deployment, ['maxSubsets', 'kingSquares', 'squaresPerPiece', 'maxCandidates'], 'generation.solver.deployment');
  for (const k of ['kingZone', 'advance', 'attacked']) {
    const w = g.solver?.deployment?.score?.[k];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) bad(`generation.solver.deployment.score.${k} must be a number >= 0`);
  }
  const ar = g.solver?.deployment?.advanceRanks;
  if (!Array.isArray(ar) || !ar.every((r) => Number.isInteger(r) && r >= 1 && r <= 8) || new Set(ar).size !== ar.length) {
    bad('generation.solver.deployment.advanceRanks must be distinct integers in 1..8');
  }
  positive(g.solver?.screen, ['width', 'turns'], 'generation.solver.screen');
  positive(g.solver?.deep, ['candidates', 'width'], 'generation.solver.deep');
  positive(g.acceptance, ['minSolvableRate', 'medianMateTurnTolerance'], 'generation.acceptance');
  if (typeof g.solver?.memoizeEnemyReplies !== 'boolean') bad('generation.solver.memoizeEnemyReplies must be a boolean');
  // The global block and every act's merged block obey the same cross-key rules.
  const crossKeys = (s, where) => {
    if (pos(s?.screen?.turns) && s.screen.turns > 5) bad(`${where}.screen.turns must be <= 5`);
    if (pos(s?.deep?.candidates) && pos(s?.deployment?.maxCandidates) && s.deep.candidates > s.deployment.maxCandidates) {
      bad(`${where}.deep.candidates must be <= ${where}.deployment.maxCandidates`);
    }
  };
  crossKeys(g.solver, 'generation.solver');
  // byAct / byTemplate: a partial of the tuning keys per act or template (docs/04 §5); semantics keys are rejected.
  // A template's block is global -> byAct[its act] -> byTemplate[its id], and each merged block obeys crossKeys.
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const allowed = {
    nodeBudget: null,
    deployment: ['maxSubsets', 'kingSquares', 'squaresPerPiece', 'maxCandidates'],
    screen: ['width', 'turns'],
    deep: ['candidates', 'width'],
    expansion: null,
  };
  const overrideOf = (map, key, label) => {
    const where = `generation.solver.${label}.${key}`;
    const o = map[key];
    if (!isObj(o)) { bad(`${where} must be a mapping`); return false; }
    for (const [k, v] of Object.entries(o)) {
      if (!(k in allowed)) { bad(`${where}.${k} is not an overridable tuning key`); continue; }
      if (allowed[k] === null) { if (!pos(v)) bad(`${where}.${k} must be a positive number`); continue; }
      if (!isObj(v)) { bad(`${where}.${k} must be a mapping`); continue; }
      for (const [k2, v2] of Object.entries(v)) {
        if (!allowed[k].includes(k2)) bad(`${where}.${k}.${k2} is not an overridable tuning key`);
        else if (!pos(v2)) bad(`${where}.${k}.${k2} must be a positive number`);
      }
    }
    return true;
  };
  const mergeOver = (base, o) => ({
    screen: { ...base.screen, ...(isObj(o?.screen) ? o.screen : {}) },
    deep: { ...base.deep, ...(isObj(o?.deep) ? o.deep : {}) },
    deployment: { ...base.deployment, ...(isObj(o?.deployment) ? o.deployment : {}) },
  });
  const byAct = g.solver?.byAct;
  const byTemplate = g.solver?.byTemplate;
  const actBlocks = {};
  if (byAct !== undefined) {
    if (!isObj(byAct)) bad('generation.solver.byAct must be a mapping');
    else {
      for (const act of Object.keys(byAct)) {
        if (!/^act[1-9]\d*$/.test(act) || Number(act.slice(3)) > actCount) { bad(`generation.solver.byAct.${act} is not an act key (act1..act${actCount})`); continue; }
        if (!overrideOf(byAct, act, 'byAct')) continue;
        actBlocks[act] = mergeOver(g.solver, byAct[act]);
        crossKeys(actBlocks[act], `generation.solver.byAct.${act} (merged)`);
      }
    }
  }
  if (byTemplate !== undefined) {
    if (!isObj(byTemplate)) bad('generation.solver.byTemplate must be a mapping');
    else {
      for (const id of Object.keys(byTemplate)) {
        const tpl = templates.find((t) => t.id === id);
        if (!tpl) { bad(`generation.solver.byTemplate.${id} is not the id of a template in content/templates`); continue; }
        if (!overrideOf(byTemplate, id, 'byTemplate')) continue;
        crossKeys(mergeOver(actBlocks[`act${tpl.act}`] ?? g.solver, byTemplate[id]), `generation.solver.byTemplate.${id} (merged with its act)`);
      }
    }
  }
  if (pos(g.formations?.minPerTemplate) && pos(g.formations?.maxPerTemplate)
    && g.formations.minPerTemplate > g.formations.maxPerTemplate) {
    bad('generation.formations.minPerTemplate must be <= generation.formations.maxPerTemplate');
  }
  if (pos(g.acceptance?.minSolvableRate) && g.acceptance.minSolvableRate > 1) {
    bad('generation.acceptance.minSolvableRate must be <= 1');
  }
  if (problems === 0) ok('economy.yaml: generation and solver keys present and consistent');
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
  if (economy.economy?.coinRate !== undefined) {
    fail('economy.yaml: economy.coinRate was removed; the par economy uses parBonus and overtimeCost (docs/05 §2)');
    problems += 1;
  }
  if (economy.stages?.turnLimits !== undefined) {
    fail('economy.yaml: stages.turnLimits was removed; each template sets mateIn');
    problems += 1;
  }
  for (const key of ['parBonus', 'overtimeCost']) {
    for (let act = 1; act <= actCount; act += 1) {
      const v = economy.economy?.[key]?.[`act${act}`];
      if (!(Number.isInteger(v) && v > 0)) {
        fail(`economy.yaml: economy.${key}.act${act} must be a positive integer`);
        problems += 1;
      }
    }
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

// 2a''''. Templates: spawned pawns stay out of the enemy zone.
for (const t of templates) {
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
  if (problems === 0) ok(`${t.id}: ${lo}–${hi} spawned pawn(s) on ranks ${sp.ranks.join('/')}, clear of the enemy zone`);
}

// 2a-sell. Selling deck pieces (docs/07 §4). The sell factor must stay at or
// below the recovery discount, or buying the discounted recovery piece and
// selling it back would print coins.
{
  const sell = economy.economy?.services?.sell;
  const recovery = economy.economy?.shop?.recoveryDiscount;
  let problems = 0;
  if (!sell) {
    fail('economy.yaml: economy.services.sell is missing (docs/07 §4)');
    problems += 1;
  } else {
    if (!(typeof sell.priceFactor === 'number' && sell.priceFactor > 0 && sell.priceFactor < 1)) {
      fail(`economy.yaml: economy.services.sell.priceFactor must be in (0, 1), got ${sell.priceFactor}`);
      problems += 1;
    } else if (typeof recovery === 'number' && sell.priceFactor > recovery) {
      fail(`economy.yaml: economy.services.sell.priceFactor ${sell.priceFactor} exceeds recoveryDiscount ${recovery} — buy-and-sell would profit`);
      problems += 1;
    }
    if (sell.rounding !== 'floor') {
      fail('economy.yaml: economy.services.sell.rounding must be floor (a sale never rounds in the player\'s favour)');
      problems += 1;
    }
    const allowedWhen = new Set(['shop', 'capacity_cut']);
    const badWhen = (sell.when ?? []).filter((w) => !allowedWhen.has(w));
    if (!Array.isArray(sell.when) || sell.when.length === 0 || badWhen.length > 0) {
      fail(`economy.yaml: economy.services.sell.when must list only shop / capacity_cut${badWhen.length ? `, got ${badWhen.join(', ')}` : ''}`);
      problems += 1;
    }
    for (const must of ['king', 'spent']) {
      if (!(sell.excludes ?? []).includes(must)) {
        fail(`economy.yaml: economy.services.sell.excludes must include ${must}`);
        problems += 1;
      }
    }
  }
  if (problems === 0) ok(`economy.yaml: pieces sell for ${sell.priceFactor} of their current price (≤ recovery ${recovery}), in ${sell.when.join(' and ')}`);
}

// 2a'''''. Deployment phase, spawn points and stalemate (docs/02 §3, §5, §7).
// The player places the King (free) and summons deck pieces whose total
// spawnCost fits the stage's spawn points, on ranks 1-4 only; the deck is
// locked after the first move; there is no pass; either side's stalemate is a
// loss for the player.
{
  const r = economy.rules ?? {};
  let problems = 0;
  const stale = {
    deploymentsPerTurn: 'the Deployment phase replaces it, docs/02 §5',
    openingPlacements: 'the Deployment phase replaces it, docs/02 §5',
    stalemateBehavior: 'rules.stalemate replaces it, docs/02 §7',
    summonLimit: 'rules.spawnPoints replaces it, docs/02 §5',
  };
  for (const [key, why] of Object.entries(stale)) {
    if (key in r) {
      fail(`economy.yaml: rules.${key} was removed (${why})`);
      problems += 1;
    }
  }
  // The deployment ranks are exactly the player's half of the board.
  const half = Array.from({ length: (r.boardSize ?? 8) / 2 }, (_, i) => i + 1);
  if (JSON.stringify(r.deploymentRanks) !== JSON.stringify(half)) {
    fail(`economy.yaml: rules.deploymentRanks must be the player's half [${half.join(', ')}], got ${JSON.stringify(r.deploymentRanks)}`);
    problems += 1;
  }
  const previous = { normal: -1, boss: -1 };
  for (let act = 1; act <= actCount; act++) {
    const sp = r.spawnPoints?.[`act${act}`] ?? {};
    for (const tier of ['normal', 'boss']) {
      const v = sp[tier];
      if (!Number.isInteger(v) || v < minSummonCost) {
        fail(`economy.yaml: rules.spawnPoints.act${act}.${tier} must be an integer >= the cheapest summon (${minSummonCost})`);
        problems += 1;
      } else if (v < previous[tier]) {
        fail(`economy.yaml: rules.spawnPoints.act${act}.${tier} (${v}) is below act ${act - 1} (${previous[tier]})`);
        problems += 1;
      } else previous[tier] = v;
    }
    if (Number.isInteger(sp.normal) && Number.isInteger(sp.boss) && sp.boss < sp.normal) {
      fail(`economy.yaml: rules.spawnPoints.act${act}.boss (${sp.boss}) is below its normal stages (${sp.normal})`);
      problems += 1;
    }
  }
  if (r.spawnPointsCarryOver !== false) {
    fail('economy.yaml: rules.spawnPointsCarryOver must be false (unspent points are lost at Start)');
    problems += 1;
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
  if (problems === 0) {
    const budgets = [1, 2, 3].map((a) => `${r.spawnPoints[`act${a}`].normal}/${r.spawnPoints[`act${a}`].boss}`).join(' · ');
    ok(`economy.yaml: spawn points ${budgets} on ranks ${r.deploymentRanks[0]}–${r.deploymentRanks.at(-1)}, deck locked after Start, no pass, stalemate loses`);
  }

  const deployRanks = r.deploymentRanks ?? [];
  for (const t of templates) {
    const actBudget = r.spawnPoints?.[`act${t.act}`]?.[t.tier];
    const budget = t.spawnPoints ?? actBudget;
    if (t.spawnPoints !== undefined && actBudget !== undefined && t.spawnPoints > actBudget) {
      fail(`${t.id}: spawnPoints ${t.spawnPoints} raises act ${t.act} ${t.tier}'s budget ${actBudget}; a template may only lower it`);
      continue;
    }
    // The player's half belongs to the player: no enemy may start there.
    const enemyClash = (t.enemyZone ?? []).filter((rank) => deployRanks.includes(rank));
    if (enemyClash.length > 0) {
      fail(`${t.id}: enemyZone includes deployment rank(s) ${enemyClash.join(', ')}; the enemy starts on ranks 5-8 only`);
      continue;
    }
    // King + the most summons the budget allows need free squares; spawned
    // pawns on a deployment rank take squares away.
    const pawnsInZone = (t.spawnedPawns?.ranks ?? []).some((rank) => deployRanks.includes(rank))
      ? (t.spawnedPawns?.count?.[1] ?? 0)
      : 0;
    const squares = 8 * deployRanks.length - pawnsInZone;
    const maxSummons = Math.floor((budget ?? 0) / minSummonCost);
    if (budget !== undefined && squares < maxSummons + 1) {
      fail(`${t.id}: ${squares} free deployment squares cannot hold the King plus ${maxSummons} summons`);
      continue;
    }
    ok(`${t.id}: ${budget} spawn points (up to ${maxSummons} summons) fit ranks ${deployRanks[0]}–${deployRanks.at(-1)}`);
  }
}

// 2b. Runs: deck legality and economy invariants.
for (const file of ['run-starter.yaml', 'run-mid.yaml', 'run-act3-strong.yaml']) {
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
    const tpl = templates.find((t) => t.id === h.templateId);
    if (!tpl) {
      fail(`${where} references unknown template "${h.templateId}"`);
      return;
    }
    const act = Math.floor(i / perAct) + 1;
    const tier = i % perAct === bossIndex ? 'boss' : 'normal';
    if (tpl.act !== act || tpl.tier !== tier) {
      fail(`${where} is act ${act} ${tier} but uses ${tpl.id} (act ${tpl.act} ${tpl.tier})`);
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

  const stageTemplate = templates.find((t) => t.id === stage.templateId);
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

  // Stage Pieces (no instanceId) carry a unique stageId; Hero Pieces never do.
  // Modifiers and the skill log identify pieces by instanceId ?? stageId.
  const stageIdSquares = new Map();
  for (const [square, piece] of pieces) {
    if (piece.instanceId && piece.stageId) {
      fail(`stage-state.yaml:${square}: a Hero Piece (instanceId) must not carry a stageId`);
    } else if (!piece.instanceId && !piece.stageId) {
      fail(`stage-state.yaml:${square}: Stage Piece missing stageId`);
    }
    if (piece.stageId) {
      if (stageIdSquares.has(piece.stageId)) {
        fail(`stage-state.yaml:${square}: stageId "${piece.stageId}" is already used on ${stageIdSquares.get(piece.stageId)}`);
      } else {
        stageIdSquares.set(piece.stageId, square);
      }
    }
  }
  const skillLog = stage.skillLog ?? [];
  for (const mod of stage.modifiers ?? []) {
    const logged = skillLog.some((e) => e.skillId === mod.source && e.targetId === mod.target && e.turn === mod.appliedOnTurn);
    if (!logged) {
      fail(`stage-state.yaml: modifier ${mod.modifierId} (${mod.source} on ${mod.target}, turn ${mod.appliedOnTurn}) has no matching skillLog entry`);
    }
  }
  for (const entry of skillLog) {
    if (entry.turn > (stage.turnsUsed ?? 0) + 1) {
      fail(`stage-state.yaml: skillLog entry ${entry.skillId} is on turn ${entry.turn}, past turn ${(stage.turnsUsed ?? 0) + 1}`);
    }
  }

  // Deployment phase: only Stage Pieces stand on the board. Action phase: the
  // Hero Pieces still on the board cost no more than the stage's spawn points
  // (captured summons only lower the sum).
  const heroes = pieces.filter(([, p]) => p.color === 'white' && p.instanceId && p.pieceType !== 'king');
  if (stage.phase === 'deployment') {
    const placed = pieces.filter(([, p]) => p.color === 'white' && p.instanceId);
    if (placed.length > 0) fail(`stage-state.yaml: deployment phase, but Hero Pieces are already on ${placed.map(([sq]) => sq).join(', ')}`);
  } else {
    const spent = heroes.reduce((sum, [, p]) => sum + (spawnCostFor(p.pieceType, p.rarity ?? 'normal') ?? 0), 0);
    if (spent > (stage.spawnPoints ?? 0)) {
      fail(`stage-state.yaml: summoned Hero Pieces cost ${spent} spawn points, over the stage's ${stage.spawnPoints} (I15)`);
    } else {
      ok(`stage-state.yaml: summons on the board cost ${spent} of ${stage.spawnPoints} spawn points`);
    }
  }
  {
    const tpl = templates.find((t) => t.id === stage.templateId);
    const expected = tpl ? (tpl.spawnPoints ?? economy.rules?.spawnPoints?.[`act${tpl.act}`]?.[tpl.tier]) : undefined;
    if (expected !== undefined && stage.spawnPoints !== expected) {
      fail(`stage-state.yaml: spawnPoints ${stage.spawnPoints} does not match template ${tpl.id}'s ${expected}`);
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
    if (stage.turnsUsed === 0 && !(economy.rules?.deploymentRanks ?? []).includes(rank)) {
      fail(`stage-state.yaml: player king on ${kingSquare} is outside deployment ranks ${economy.rules?.deploymentRanks}`);
    }
  }

  if (stage.focus > stage.focusPool) {
    fail(`stage-state.yaml: focus ${stage.focus} exceeds focusPool ${stage.focusPool}`);
  }

  const template = templates.find((t) => t.id === stage.templateId);
  if (template && Array.isArray(template.mateIn) && !(stage.mateIn >= template.mateIn[0] && stage.mateIn <= template.mateIn[1])) {
    fail(`stage-state.yaml: mateIn ${stage.mateIn} is outside template ${template.id}'s range ${JSON.stringify(template.mateIn)}`);
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
// Formations (content/formations/<templateId>.json)
//
// Re-implements tools/formations/extract.ts `rejectReason` in plain JS (this file imports no TS):
// zone, army, value band (unrounded, x bossMultiplier for bosses), no pawn on rank 8, Black pieces only.
// ---------------------------------------------------------------------------

{
  const FORMATIONS_DIR = path.join(ROOT, 'content', 'formations');
  const TYPE_OF = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const minPerTemplate = economy.generation?.formations?.minPerTemplate ?? 20;
  const templateById = new Map(templates.map((t) => [t.id, t]));
  let names = [];
  try {
    names = readdirSync(FORMATIONS_DIR).filter((n) => n.endsWith('.json')).sort();
  } catch {
    names = [];
  }
  const seenTemplates = new Set();

  for (const name of names) {
    const label = `content/formations/${name}`;
    let doc;
    try {
      doc = JSON.parse(readFileSync(path.join(FORMATIONS_DIR, name), 'utf8'));
    } catch (err) {
      fail(`${label}: cannot parse JSON — ${err.message}`);
      continue;
    }
    itemCount += 1;
    if (!ajv.validate(SCHEMA_IDS.formation, doc)) {
      fail(...formatAjvErrors(label, '', ajv.errors));
      continue;
    }
    const t = templateById.get(doc.templateId);
    if (!t) {
      fail(`${label}: templateId ${doc.templateId} has no template`);
      continue;
    }
    if (t.placement === 'fixed') {
      fail(`${label}: templateId ${doc.templateId} is a fixed-placement template and takes no formations`);
      continue;
    }
    if (name !== `${doc.templateId}.json`) {
      fail(`${label}: file name must equal the templateId`);
      continue;
    }
    seenTemplates.add(t.id);

    // The stored filters must still describe the template.
    const band = economy.stages?.enemyArmyValueBand?.[`act${t.act}`];
    const factor = t.tier === 'boss' ? bossMultiplier : 1;
    const [bandLo, bandHi] = Array.isArray(band) ? [band[0] * factor, band[1] * factor] : [NaN, NaN];
    const stale = [];
    if (JSON.stringify(doc.filters.enemyZone) !== JSON.stringify(t.enemyZone)) stale.push('enemyZone');
    if (JSON.stringify(doc.filters.enemyArmy) !== JSON.stringify(t.enemyArmy)) stale.push('enemyArmy');
    if (doc.filters.valueBand[0] !== bandLo || doc.filters.valueBand[1] !== bandHi) stale.push('valueBand');
    if (stale.length > 0) fail(`${label}: filters.${stale.join(', filters.')} differ from template ${t.id}; re-run npm run formations:extract`);

    const maxPer = economy.generation?.formations?.maxPerTemplate;
    if (maxPer !== undefined && doc.formations.length > maxPer) {
      fail(`${label}: ${doc.formations.length} formations exceeds maxPerTemplate ${maxPer}`);
    }

    const ids = new Set();
    let bad = 0;
    for (const f of doc.formations) {
      const problems = [];
      if (ids.has(f.id)) problems.push('has a duplicate id');
      ids.add(f.id);
      const ranks = f.black.split('/');
      const counts = {};
      let total = 0;
      let zoneBad = false;
      let pawnOn8 = false;
      let widthBad = false;
      let whitePiece = false;
      ranks.forEach((r, i) => {
        const rank = 8 - i;
        let width = 0;
        for (const c of r) {
          if (/[1-8]/.test(c)) {
            width += Number(c);
            continue;
          }
          width += 1;
          const type = TYPE_OF[c];
          if (!type) {
            whitePiece = true;
            continue;
          }
          counts[type] = (counts[type] ?? 0) + 1;
          total += valueOf(type) ?? 0;
          if (t.enemyZone && !t.enemyZone.includes(rank)) zoneBad = true;
          if (type === 'pawn' && rank === 8) pawnOn8 = true;
        }
        if (width !== 8) widthBad = true;
      });
      if (ranks.length !== 8 || widthBad) problems.push('is not an 8x8 placement');
      if (whitePiece) problems.push('has a piece that is not a Black piece');
      if (zoneBad) problems.push('has a Black piece outside enemyZone');
      if ((counts.king ?? 0) !== 1) problems.push(`has ${counts.king ?? 0} kings, expected exactly 1`);
      if (t.enemyArmy) {
        for (const type of Object.keys(counts)) {
          if (type !== 'king' && !(type in t.enemyArmy)) problems.push(`has a ${type}, which enemyArmy does not list`);
        }
        for (const [type, [lo, hi]] of Object.entries(t.enemyArmy)) {
          const n = counts[type] ?? 0;
          if (n < lo || n > hi) problems.push(`has ${n} ${type} outside enemyArmy ${lo}-${hi}`);
        }
      }
      if (Number.isFinite(bandLo) && (total < bandLo || total > bandHi)) problems.push(`has enemy value ${total} outside band ${bandLo}-${bandHi}`);
      if (pawnOn8) problems.push('has a Black pawn on rank 8');
      for (const p of problems) fail(`${label}: formation ${f.id} ${p}`);
      if (problems.length > 0) bad += 1;
    }
    if (bad === 0) ok(`${label}: ${doc.formations.length} formations satisfy ${t.id} filters`);
    if (doc.formations.length < minPerTemplate) {
      warn(`${t.id}: only ${doc.formations.length} formations (min ${minPerTemplate}); random placement covers the rest`);
    }
  }

  for (const t of templates) {
    if (t.placement !== 'fixed' && !seenTemplates.has(t.id) && !names.includes(`${t.id}.json`)) {
      warn(`${t.id}: only 0 formations (min ${minPerTemplate}); random placement covers the rest`);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

for (const p of passes) console.log(`  ok  ${p}`);
for (const w of warnings) console.warn(`  WARN ${w}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) found:\n`);
  for (const e of errors) console.error(`  FAIL ${e}`);
  console.error(`\nValidation failed: ${errors.length} of ${passes.length + errors.length} checks.`);
  process.exit(1);
}

console.log(
  `\nValidation passed: ${itemCount} documents, ${passes.length} checks, against ${Object.keys(SCHEMA_IDS).length} schemas.`,
);
