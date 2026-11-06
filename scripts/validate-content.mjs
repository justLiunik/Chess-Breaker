#!/usr/bin/env node
/**
 * Checkbreaker content validator (M0).
 *
 * Two passes:
 *   1. SCHEMA   — every file in content/examples/ against its JSON Schema.
 *   2. SEMANTIC — cross-file design invariants that a schema cannot express:
 *                 template feasibility, act value bands, deck legality, board sanity.
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

// 2a. Templates: material feasibility and act value band.
const ratio = economy.generation?.thresholdFeasibilityRatio ?? 0.75;
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

  // The enemy king is always present and worth 0, but it counts as a piece.
  if (minValue <= 0) fail(`${t.id}: enemy army has no material value`);

  // Domination is a captured-minus-lost swing, so the enemy must hold more
  // material than the player needs to capture (docs/04 §4).
  if (!(t.materialThreshold <= ratio * minValue)) {
    fail(
      `${t.id}: materialThreshold ${t.materialThreshold} > ${ratio} × minimum enemy value ${minValue} — domination unreachable`,
    );
  } else {
    ok(`${t.id}: threshold ${t.materialThreshold} feasible against ${minValue}–${maxValue} enemy value`);
  }

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

// 2b. Runs: deck legality and economy invariants.
for (const file of ['run-starter.yaml', 'run-mid.yaml']) {
  const run = docs[file];
  if (!run) continue;

  const deck = run.deck ?? [];
  const nonKing = deck.filter((p) => p.pieceType !== 'king');
  const kings = deck.filter((p) => p.pieceType === 'king');

  if (kings.length !== 1) fail(`${file}: expected exactly 1 king, found ${kings.length}`);
  if (nonKing.length > run.deckCapacity) {
    fail(`${file}: deck holds ${nonKing.length} non-king pieces but capacity is ${run.deckCapacity}`);
  } else {
    ok(`${file}: deck ${nonKing.length}/${run.deckCapacity} capacity`);
  }

  for (const p of deck) {
    const label = `${file}:${p.instanceId}`;
    if (p.pieceType === 'king' && p.durability !== null) fail(`${label}: king durability must be null`);
    if (p.pieceType !== 'king' && p.durability === null) fail(`${label}: non-king durability cannot be null`);
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

  for (const h of run.history ?? []) {
    if (!templateIds.has(h.templateId)) {
      fail(`${file}: history references unknown template "${h.templateId}"`);
    }
  }
}

// 2c. Stage: board sanity and referential integrity.
const stage = docs['stage-state.yaml'];
if (stage) {
  const pieces = Object.entries(stage.board ?? {});

  if (!templateIds.has(stage.templateId)) {
    fail(`stage-state.yaml: unknown template "${stage.templateId}"`);
  }

  for (const [square, piece] of pieces) {
    if (piece.color === 'white' && !piece.instanceId && piece.pieceType !== 'king') {
      // Player pieces come from the deck, so they must be identifiable.
      fail(`stage-state.yaml:${square}: white piece missing instanceId`);
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

  const whiteKings = pieces.filter(([, p]) => p.color === 'white' && p.pieceType === 'king');
  const blackKings = pieces.filter(([, p]) => p.color === 'black' && p.pieceType === 'king');
  if (whiteKings.length !== 1) fail(`stage-state.yaml: expected 1 white king, found ${whiteKings.length}`);
  if (blackKings.length !== 1) fail(`stage-state.yaml: expected 1 black king, found ${blackKings.length}`);
  if (whiteKings.length === 1 && blackKings.length === 1) ok('stage-state.yaml: exactly one king per side');

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
  if (template && template.materialThreshold !== stage.materialThreshold) {
    fail(
      `stage-state.yaml: materialThreshold ${stage.materialThreshold} does not match template ${template.id}'s ${template.materialThreshold}`,
    );
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
