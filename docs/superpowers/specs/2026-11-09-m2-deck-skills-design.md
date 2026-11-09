# M2 — Deck, Durability, Deployment & Skills: Design

**Status:** approved in chat on 2026-11-09, awaiting written-spec review.
**Milestone:** M2 of [docs/10](../../10-roadmap-and-milestones.md#m2--deck-durability-deployment--skills).
**Authority:** the rules are [docs/02](../../02-rules-framework.md), [docs/03](../../03-skill-framework.md)
and [docs/06](../../06-deck-durability-and-permadeath.md); the architecture is
[docs/09](../../09-technical-architecture.md). The rule changes decided for M2 are already in those
docs (commit `2f0f226`). This spec says *how* M2 builds them; §11 lists the doc and data changes that
land with the code.

---

## 1. Goal and success criteria

Turn the M1 Action-phase engine into the engine of a whole stage of a run: the Deployment phase and
the deck's life across a stage, the three launch skills on a data-driven modifier stack, and the
rarity abilities of Hero Pieces — in the player's moves and in the enemy's search.

M2 is done when every acceptance box of docs/10 M2 is ticked, and in addition:

- The M1 suites stay green throughout: perft, the 30 golden tests (snapshots may change only where
  this spec changes a field), fuzz, preview/execution parity, search parity, boundaries.
- A slow reference implementation of move generation, attack maps and `evaluate` agrees with the fast
  code on thousands of random boards, with and without rarity tiers (§6, §9).
- `npm run bench`: boards without rarity no more than 10% slower than M1; boards with Rare–Legendary
  pieces no more than 2× M1, at depth 4.
- No skill and no rarity ability is implemented as a special case in `engine/rules` (review criterion).

## 2. Out of scope

| Not in M2 | Where |
|---|---|
| The four `future` skills (Gallop, Phase Step, Recall, Bulwark) and their primitives | M6 |
| The stage-end capacity chooser (merge, sell, cut), selling, the shop, run advancement | M4 |
| Stage generation, `stageId` assignment by the generator, the solver | M3 (M2 tests assign ids in fixtures) |
| Any UI, and the browser 50 ms measurement | M5 |
| Enemy skills | M6 |

## 3. Decisions taken in brainstorming

**Rules (already written into docs 01–11, commit `2f0f226`):** flat durability 2 with the Legendary
queen at 1; spawn points 9 / 12 / 15 with bosses +3 and spawn costs N3 B3 R5 Q9 (Legendary bishop 5,
Legendary knight stays 3); deployment always on ranks 1–4; a seven-skill catalogue with coin prices,
of which Twin Step, Ascension and Lockdown are built now; Ascension cannot target a Legendary bishop;
no paid restore for a spent piece; selling at half price (M4).

**Technical:**

| Decision | Choice | Why |
|---|---|---|
| How to split M2 | One spec and one plan in four phases — 0 preparation, A deployment and the deck, B skills, C rarity — with the full suite green at the end of each | One review cycle; each phase is independently testable and lands on the previous one |
| Where skill and ability data come from | `loadEngineConfig()` also reads `content/examples/pieces.yaml` and `skills.yaml`; the engine interprets primitives from data | "Skills are data, not code" (docs/03); no per-skill code to review away |
| How rarity reaches move generation | A second `Int8Array` of tiers beside the piece codes, and a per-(type, tier) ability table compiled from `rarityAbilities` | Enemy pieces are always Normal, so the Black fast paths stay untouched; when no White piece has a tier, the M1 code runs unchanged |

Rejected: three separate M2 specs (three review cycles for one tightly coupled milestone); hard-coded
skills (fails the M2 review criterion); packing the tier into the piece code (every comparison in
movegen and search would change at once); a generic per-move ability interpreter (too slow for the
enemy search).

## 4. Phases

| Phase | Delivers | Gate |
|---|---|---|
| **0** | M1 leftovers and the reference implementation that guards later phases | Reference agrees with the fast code on Normal-only boards |
| **A** | `EngineConfig` growth, `startStage`, captures and lifeline in the deck, promotion into the deck, `endStage` | All docs/10 M2 deck and deployment boxes |
| **B** | `ACTIVATE_SKILL`, the primitive registry and modifier stack, final R1→R5, `hasLegalQueue` with skills | All skill boxes; parity and fuzz extended with skills |
| **C** | Rarity abilities in player moves, legality, attack maps, `evaluate` and the enemy search | All ability boxes; reference agrees on rarity boards; bench targets |

Each phase ends with `npm test`, `npm run typecheck`, `npm run validate` and `npm run bench` green.

## 5. Public API and state

### 5.1 Functions (all take `config: EngineConfig` last)

```ts
startStage(run, stage, placements: { instanceId: string; to: Square }[], config)
  : Result<{ run: RunState; stage: StageState; events: GameEvent[] }, CommitError>

simulate(run, stage, queue, config)      // unchanged shape; queues may now hold ACTIVATE_SKILL
commitQueue(run, stage, queue, config)   // unchanged shape; R5 may now capture Hero Pieces

endStage(run, stage, config)
  : Result<{ run: RunState; events: GameEvent[]; overCapacity: number }, CommitError>

hasLegalQueue(run, stage, config): boolean          // was (stage, config): needs the loadout
legalPlayerMoves(stage, from, config): Square[]     // gains config: needs the ability table
enemyMove(stage, seed, config)                      // unchanged
```

### 5.2 State changes

| Type | Change |
|---|---|
| `BoardPiece` | Gains `stageId?: string` — required on every Stage Piece (enemy pieces, spawned pawns), absent on Hero Pieces (which carry `instanceId`). Stable for the stage; moves with its piece |
| `StageState` | Gains `skillLog: { skillId: string; turn: number; targetId?: string }[]`, empty at Start |
| `ActiveModifier` | `target` holds a piece id (`instanceId` or `stageId`), never a square: pieces move, ids do not |
| `RunState.loadout[].charges` | Decremented by `ACTIVATE_SKILL`; refilled to `chargesMax` by `startStage` |
| `PieceInstance.status` | `deployed` / `spent` while on the board; `captured` only for a lifeline queen awaiting `endStage` |

### 5.3 `CommitError`

| Kind | Change |
|---|---|
| `unsupported_action` | **Removed** |
| `skill_unavailable { atStep, skillId, reason: 'not_in_loadout' \| 'not_implemented' \| 'no_charges' \| 'once_per_turn' }` | New |
| `invalid_target { atStep, skillId, target?, reason: 'no_target' \| 'wrong_target' \| 'excluded' \| 'already_targeted' }` | New |
| `focus_exceeded` | Now produced |
| `king_in_check_at_end` | Gains `afterRevert: boolean` — true when the king is attacked only after R1 reverted a transform |
| `durability_unavailable`, `invalid_deployment { to, reason: 'occupied' \| 'outside_zone' \| 'king_missing' \| 'king_in_check' \| 'not_in_deck' \| 'duplicate' }`, `spawn_points_exceeded` | Now produced, by `startStage` |
| `stage_not_won { status }` | New, by `endStage` |

### 5.4 Events

New: `piece_summoned { instanceId, square }`, `stage_started`, `skill_activated { skillId, target? }`,
`piece_transformed { target, pieceType }`, `transform_reverted { target }`, `piece_suppressed
{ target }`, `modifier_expired { modifierId }`, `lifeline_saved { instanceId }`, and from
`endStage`: `piece_returned { instanceId, durability }`, `piece_removed { instanceId, reason:
'spent' }`. `capture` and `pawn_promoted` gain the ids of the pieces involved (`instanceId` /
`stageId`). `enemy_fell_back` is emitted **before** `enemy_move`.

## 6. Phase 0 — preparation

1. **Reference implementation** (`packages/engine/test/reference/`): a slow, obviously-correct move
   generator, attack map and `evaluate`, written from docs/02 directly with plain loops and no shared
   code with `src/`. A differential test compares legal-move sets, attacked squares and evaluation on
   random Normal-only boards. Phase C extends the reference with rarity (§9).
2. **`MATE_BOUND`** is derived from config, `(terminal.playerMated + terminal.playerOutOfTurns) / 2`,
   and the validator checks it sits above every out-of-turns score and below every mate score for the
   longest possible stage: `playerOutOfTurns + P < MATE_BOUND < playerMated − P`, with `P = 2 × 20`
   plies (the schema's largest `turnLimit`, both sides).
3. **`packages/content`** imports engine types as `@checkbreaker/engine`, not by relative path.
4. **Event order:** `enemy_fell_back` before `enemy_move` (golden snapshots updated for that alone).
5. **docs/09 §6:** the `move | null` table cell escaped.

## 7. Phase A — Deployment and the deck

### 7.1 `EngineConfig`

| Field | Source |
|---|---|
| `rules.deploymentRanks`, `rules.spawnPoints[act][tier]`, `rules.summonCostsDurability` | economy.yaml |
| `pieces[type]`: `spawnCost`, `spawnCostByRarity`, `durabilityMax`, `durabilityMaxByRarity` | economy.yaml (pieces.yaml mirrors it; the validator keeps them equal) |
| `abilities[type][tier]` | compiled from pieces.yaml `rarityAbilities`, cumulative (§9.1) |
| `skills[id]` | skills.yaml, as written |

The result stays deep-frozen. A missing section throws a named error, as in M1.

### 7.2 `startStage`

Checks, all before any change, in this order; the first failure is returned and nothing is spent:

1. `stage_not_active`; `wrong_phase` (expected `deployment`).
2. For each placement: the instance exists in `run.deck` and is `in_deck` (`not_in_deck`); it is not
   placed twice (`duplicate`); a non-King has durability ≥ 1 (`durability_unavailable`); the square
   is valid, on a deployment rank (`outside_zone`) and empty (`occupied`).
3. Exactly one placement is the King (`king_missing`).
4. The summons' spawn cost — per type and the instance's rarity — is within `spawnPoints`
   (`spawn_points_exceeded { budget, cost }`).
5. With every piece placed, the King is not attacked (`king_in_check`).

Then: each piece goes on the board with its `instanceId` and `rarity`; each non-King instance loses
`summonCostsDurability` and becomes `deployed`, or `spent` at 0; the King becomes `deployed`; every
loadout entry refills to `chargesMax`; the stage gets `phase: 'action'`, `moveCredits =
freeMovesPerTurn`, `focus = focusPool`, `skillLog: []`. Events: one `piece_summoned` per placement,
then `stage_started`.

### 7.3 Captures, lifeline and promotion during a stage

- **The enemy captures a Hero Piece (R5).** Its instance leaves `run.deck` at once — unless it is a
  queen whose tier has `lifeline` and whose `usedOnce` lacks it: then it stays, `status: 'captured'`,
  `usedOnce` gains `lifeline`, and `lifeline_saved` is emitted.
- **A spawned pawn promotes.** A new instance joins `run.deck` immediately: `instanceId =
  'p_' + hash(stageSeed, turnsUsed, square).toString(16)`, `pieceType` and `rarity` from
  `promotesTo`, full `durabilityMax` for that type and tier, `origin: 'promotion'`,
  `acquiredAtStage = actIndex * 3 + stageIndex`, `status: 'in_deck'`. It cannot be summoned this
  stage: `startStage` refuses outside the Deployment phase. The deck may exceed capacity until
  `endStage`. No randomness is consumed.

### 7.4 `endStage`

Only for a won stage (`stage_not_won` otherwise; a lost stage ends the run, which is M4's). For each
instance: `deployed` → `in_deck` with its durability (`piece_returned`); `spent` → removed
(`piece_removed`); `captured` (lifeline) → `in_deck` with durability 1 (`piece_returned`). Returns
`overCapacity = max(0, non-King deck size − capacity)`; resolving it is M4's chooser.

## 8. Phase B — Skills and the modifier stack

### 8.1 `ACTIVATE_SKILL { skillId, target? }`

`target` is a square: the piece on it *at that moment of the queue*, like a `MOVE`'s `from`. Checks,
sequential with the rest of the queue:

1. The skill is in the loadout (`not_in_loadout`) and `status: mvp` (`not_implemented`).
2. Charges ≥ 1 (`no_charges`).
3. `once_per_turn`: no `skillLog` entry for this skill with `turn` equal to the current turn
   (`turnsUsed + 1`), counting earlier steps of this queue (`once_per_turn`).
4. Focus ≥ cost at this step (`focus_exceeded`).
5. Target: present unless `kind: none` (`no_target`); the piece matches `kind` (own / enemy),
   `pieceType` (`wrong_target`), and is not in `excludes` or `excludesRarity` (`excluded`);
   `distinct_targets`: no `skillLog` entry this stage for this skill and this piece id
   (`already_targeted`).

Then Focus and one charge are spent, the use is appended to `skillLog`, and the effects run.

### 8.2 Primitive registry (`engine/skills`)

One handler per primitive; `engine/rules` never names a skill.

| Primitive | Handler |
|---|---|
| `grant_move_credit { amount }` | `moveCredits += amount`; no modifier (credits reset each turn) |
| `set_piece_type { pieceType }` | Sets `transformed: { pieceType, modifierId }` on the target and records a `this_turn` modifier. A transformed piece counts as tier 0 in move generation |
| `suppress_piece` | Records a `next_enemy_turn` modifier on the target's id |

Modifier ids are `m{turn}_{step}`: deterministic, unique in a stage.

### 8.3 Resolution order

| Step | Rule |
|---|---|
| Resolve | Actions in order, costs sequential |
| **R1** | `this_turn` modifiers expire: the piece carrying `transformed.modifierId` reverts (found by id; a captured target just drops the modifier) |
| **R2** | I1, I3; then I2 on the reverted board — `king_in_check_at_end { afterRevert }` |
| **R3** | Enemy terminal check with suppression in force: suppressed pieces have no moves. No move + check → won; no move, no check → `enemy_stalemated` |
| **R4** | Turn counted; out of turns → lost |
| **R5** | `enemyMove` with the suppressed pieces frozen **at the root only** (deeper plies are later enemy turns); then `next_enemy_turn` modifiers expire |
| Next turn | Credits, Focus refill; the no-legal-queue check |

A suppress modifier whose target is captured before R5 is dropped. Movegen takes a frozen-square mask
for this; the search passes it at the root and an empty mask below.

### 8.4 `hasLegalQueue` with skills

A player has a legal queue if some sequence *skills first, then moves* ends in a legal state: any
ordered set of usable skills (distinct, within Focus and charges, each with every legal target),
followed by up to the resulting credits in moves (plus Legendary-knight bonus moves), each legal when
made, with I2 holding after R1. Search stops at the first legal queue.

Skills-first is complete for the launch three: a credit must be granted before the move it pays for;
a transform must precede the moves of its piece; Lockdown never changes I2. The claim is checked by a
test that brute-forces every interleaving on small boards and compares.

## 9. Phase C — Rarity abilities

### 9.1 Representation

- **Tier array:** `t: Int8Array(64)`, 0–3, beside the code array, built by `fromBoard` from each
  `BoardPiece.rarity`. Non-zero only for White Hero Pieces (those with an `instanceId`) that are not
  transformed. Spawned pawns are 0 (their rarity only sets `promotesTo`); enemy pieces
  are 0 (I13).
- **Ability table:** `abilities[type][tier]`, compiled once from `rarityAbilities` (each tier
  includes the tiers below). Movegen reads primitives, never piece names:

| Primitive | In move generation |
|---|---|
| `leap_allies { captureAfterLeap }` | A slide may pass own pieces; after passing one it may capture only if `captureAfterLeap` |
| `add_leaper { offsets }` | Extra leap offsets (all symmetric images), capturing normally |
| `add_rider { directions }` | Extra slide directions |
| `multi_capture { maxTargets, afterLeap }` | A straight move that captures on X may continue to capture on Y directly beyond, if Y holds a non-King enemy; after an ally leap only if `afterLeap` |
| `bonus_self_move`, `lifeline` | Not movegen: queue cost accounting (§9.3) and captures (§7.3) |

### 9.2 Moves, attacks, legality

- **Fast path:** if `t` is all zero, the M1 generators run unchanged.
- **Attacks follow moves** (docs/02 §2.3): a Rare slider does not attack through an ally; a Unique or
  Legendary bishop and a Legendary rook or queen do; extra leapers attack; multi-capture adds no
  attacked squares, so a king on Y is never in check through X.
- **`Move`** gains `via` and `viaCaptured` (−1 / 0 when unused) so a multi-capture makes and unmakes
  exactly. In the queue, `MOVE { from, to: Y }` *is* the double capture; `to: X` is the single one.
  Both captures pay salvage; it is one credit.
- `checkPlayerMove`, `legalPlayerMoves` and the I2 check use the ability-aware generator.

### 9.3 Legendary knight bonus move

During a queue, after a Legendary, untransformed knight makes a paid `MOVE`, the next `MOVE` *by the
same instance* this turn costs 0 credits; once per turn per knight. The bonus is tracked by
`instanceId` in the queue's local state and never lands on a king's square (I3, already enforced by
`king_square`).

### 9.4 Enemy search

The imagined player reply is one standard move **including** rarity abilities (docs/02 §8.1); skills
and the bonus move stay unimagined. `makeMove`/`unmakeMove` carry the tier with the piece; Zobrist
keys XOR a per-(tier, square) key for White pieces with a tier; `evaluate`'s `kingZoneAttacked` uses
the ability-aware attack map.

## 10. Testing

| Suite | Covers |
|---|---|
| Reference differential (0, extended in C) | Legal moves, attack maps, `evaluate`: fast == slow on ≥ 5,000 random boards, Normal-only and with random tiers |
| `startStage` (A) | Every refusal in §7.2, each spending nothing; exact durability spend; King free; spawn cost per rarity (Legendary bishop 5); charges refill |
| Deck lifecycle (A) | Captured instance absent from the deck; lifeline once per instance; spent removed only at `endStage`; promotion creates exactly `promotesTo`, deterministically; I15 — nothing enters after Start |
| Skills (B) | Every docs/03 §5 edge case of Twin Step, Ascension, Lockdown; the temporary queen never mates; revert exposing the king refused with `afterRevert`; Lockdown stalemate vs mate at R3; Ascension refuses a Legendary bishop |
| `hasLegalQueue` (B) | Skill-enabled escapes found; skills-first equals brute-force interleaving on small boards |
| Abilities (C) | One table-driven test per row of docs/02 §2.3; every multi-capture rule (adjacency, gap, king exception, rook after a leap, one credit, salvage ×2); Rare vs Unique check through allies; Legendary knight bonus once, itself only, never onto a king; Ascension suspends and restores abilities |
| M1 suites | Perft, golden, fuzz (now with skills and tiers), parity, search parity, boundaries — green in every phase |
| Bench | Normal boards ≤ 1.1× M1; rarity boards ≤ 2× M1 at depth 4 |

## 11. Doc and data changes that land with M2

| Where | Change |
|---|---|
| `schemas/stage.schema.json` | `boardPiece.stageId`; `skillLog`; modifier `target` is a piece id |
| `content/examples/stage-state.yaml` | Stage Pieces carry `stageId`; `skillLog` matches its Lockdown; the modifier targets an id |
| `scripts/validate-content.mjs` | Every Stage Piece has a unique `stageId` and no Hero Piece has one; every modifier has a `skillLog` entry with its `source`, target id and `appliedOnTurn`; `skillLog` turns never exceed the current turn; the derived `MATE_BOUND` sits between the terminal scores (§6) |
| docs/02 §6, §8.1 | Suppression is in force at R3 and at the root of R5 only; modifiers target piece ids |
| docs/03 §3 | Modifier ids and targets; `hasLegalQueue` searches skills first |
| docs/06 §5 | The lifecycle diagram notes Recall's `deployed → in_deck` path (M6) — lands with this spec |
| docs/09 §3, §4, §6, §9 | `startStage`/`endStage`/`hasLegalQueue` signatures, the `CommitError` table of §5.3, new events, `stageId`, `skillLog`, test rows |
| docs/10 M2 | Boxes ticked as their tests land |

## 12. Risks

| Risk | Response |
|---|---|
| Ability-aware attack maps slow the search past the bench targets | Fast path for tier-free boards; measure per phase; stop and discuss before optimising further |
| Fast and reference movegen disagree on an ability edge | The reference follows docs/02 literally; each disagreement is resolved by the doc, then both are fixed — never by loosening the comparison |
| `hasLegalQueue` with skills becomes expensive | Bounded by 3 skills, Focus 3 and two credits; it runs once per turn, not inside the search |
| `stageId` touches every fixture | Test helpers assign ids (`s01`, `s02`, … in square order); golden snapshots change for that field only |
| Skills-first misses an escape for a future skill | The completeness claim is scoped to the launch three; each M6 skill re-checks it with the same brute-force test |
| Scope | Phases land in order with the suite green; any phase may be split into more plan tasks, never merged |
