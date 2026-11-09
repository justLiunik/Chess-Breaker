# M2 — Deck, Durability, Deployment & Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the M1 Action-phase engine into a whole stage of a run: the Deployment phase and the deck's life through a stage, the three launch skills on a data-driven modifier stack, and rarity abilities in player moves and the enemy search.

**Architecture:** Four phases on `packages/engine` — 0 (M1 leftovers and a slow reference implementation), A (config, `startStage`, deck lifecycle, `endStage`), B (skills, modifier stack, final R1→R5, `hasLegalQueue` with skills), C (a parallel tier array and a compiled ability table in movegen, legality, `evaluate` and search). Skills and abilities are data from YAML, interpreted by primitive; `engine/rules` never names a skill or a piece ability.

**Tech Stack:** TypeScript 5.9.3 (strict, `noUncheckedIndexedAccess`), Vitest 5.0.5, tsx 4.23.15, yaml, npm workspaces. chess.js 1.4.0 stays a dev-only perft reference.

**Spec:** [docs/superpowers/specs/2026-11-09-m2-deck-skills-design.md](../specs/2026-11-09-m2-deck-skills-design.md) — read it with this plan; section numbers below (§n) are the spec's.

## Global Constraints

- `packages/engine` has zero runtime dependencies; `src/` never uses `Math.random`, `Date.now` or `performance.now`.
- Every public engine function takes `config: EngineConfig` as its last argument; no tuning number lives in engine code.
- Public state is immutable; tests deep-freeze inputs (`deepFreeze` in `test/helpers.ts`).
- Functions return `Result<…, CommitError>` and never throw for a player-legal-shaped input.
- Board index = file + 8 × rank (a1 = 0, h8 = 63); piece codes ±1..6 = P N B R Q K, White positive.
- Tier indices: normal 0, rare 1, unique 2, legendary 3 (the order of `rarity.tiers`).
- No skill or rarity ability is special-cased in `engine/rules` or `engine/queue`; primitives are interpreted in `engine/skills` and `engine/abilities`.
- The full suite is green at the end of every task: `npm test`, `npm run typecheck`, `npm run validate`. `npm run bench` is green at the end of each phase.
- Golden snapshots may be regenerated (`npx vitest run packages/engine/test/golden.test.ts -u`) only after the diff is checked to change exactly the fields the task names.
- Commit after each task on branch `m2-design`, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A skill or move whose target piece was captured earlier in the same queue** — expect `invalid_target { reason: 'no_target' }` or `illegal_move { reason: 'no_piece' }`, never a crash or a stale modifier. Test in Task 8.
2. **A suppressed enemy piece captured by the player later in the same queue** — the Lockdown modifier is dropped; R3 and R5 freeze nothing. Test in Task 9.
3. **Two promotions on one square in one turn (Twin Step)** — two distinct instance ids, both in the deck. Test in Task 6.
4. **A multi-capture `MOVE` to Y when Y is empty, an ally, the enemy king or off-board** — `to: Y` is `unreachable` (king: `king_square`), and the single capture on X stays legal. Test in Task 13.
5. **A lifeline queen captured a second time in a later stage** — destroyed, removed from the deck, no second `lifeline_saved`. Test in Task 7.

---

## Phase 0 — Preparation

### Task 1: Slow reference implementation and differential test

**Files:**
- Create: `packages/engine/test/reference/movegen.ts`, `packages/engine/test/reference/evaluate.ts`
- Create: `packages/engine/test/reference.test.ts`
- Create: `packages/engine/test/fixtures/bench-baseline.json`
- Modify: `packages/engine/test/helpers.ts` (add `randomBoard`)

**Interfaces:**
- Produces: `refLegalMoves(b: Int8Array, color: Color): { from: number; to: number }[]`, `refAttacked(b: Int8Array, sq: number, by: Color): boolean`, `refEvaluate(b: Int8Array, config: EngineConfig): number` (all in `test/reference/`), and `randomBoard(seed: string, i: number): Int8Array` in helpers — one king per side, 2–14 other pieces, no pawn on rank 1 or 8, neither king in check. Task 12 extends all three with a tier array.

- [ ] **Step 1: Write the reference.** Plain nested loops over the 64 squares, written from docs/02 §2 directly: piece rules, no castling, no en passant, pawns double-step only from rank 2 (White) / rank 7 (Black), a White pawn reaching rank 8 vanishes, a Black pawn reaching rank 1 becomes a queen, legality = own king not attacked after the move. `refEvaluate` recomputes every term of docs/02 §8.1 (`kingEscapeSquare`, `kingZoneAttacked`, `kingInCheck`, `materialPerPoint`, `mobilityPerMove`) from scratch. No import from `src/` except types and `config`.
- [ ] **Step 2: Write `reference.test.ts`.**

```ts
it('legal moves match the reference on 5000 random boards', () => {
  for (let i = 0; i < 5000; i++) {
    const b = randomBoard('ref', i);
    for (const color of ['white', 'black'] as const) {
      expect(sortMoves(legalMoves(b, color))).toEqual(sortMoves(refLegalMoves(b, color)));
    }
  }
});
it('attack maps match the reference', () => { /* every square, both colours: isAttacked === refAttacked */ });
it('evaluate matches the reference', () => { /* evaluate(b, config) === refEvaluate(b, config) */ });
```

- [ ] **Step 3: Run** `npx vitest run packages/engine/test/reference.test.ts`. Expected: PASS. A failure is a real M1 bug or a reference bug: resolve it against docs/02, never by loosening the comparison.
- [ ] **Step 4: Record the bench baseline.** Run `npm run bench`; write each GAME_FEN's median into `fixtures/bench-baseline.json` as `{ "<fen>": <ms> }`. Task 14 compares against it.
- [ ] **Step 5: Commit** `test: add a slow reference movegen/evaluate and a differential test`.

### Task 2: M1 leftovers

**Files:**
- Modify: `packages/engine/src/enemy/search.ts:26` (`MATE_BOUND`), `packages/engine/src/rules.ts` (event order)
- Modify: `packages/content/package.json`, `packages/content/src/loadEngineConfig.ts` (import path)
- Modify: `scripts/validate-content.mjs` (mate-bound rule), `docs/09-technical-architecture.md` §6 table
- Test: `packages/engine/test/enemy-search.test.ts`, `packages/engine/test/commit.test.ts`

**Interfaces:**
- Produces: `mateBound(config: EngineConfig): number` exported from `enemy/search.ts` = `(terminal.playerMated + terminal.playerOutOfTurns) / 2`.

- [ ] **Step 1: Failing tests.** `mateBound(config)` equals 75000; with a config whose `playerMated` is 200000 the search's mate scores still ply-adjust (a mate-in-1 root score > a mate-in-2 root score). In `commit.test.ts`: a scripted line that breaks emits `enemy_fell_back` at a lower index than `enemy_move`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Replace the constant with `mateBound(config)` stored on `Ctx`. Move the `enemy_fell_back` push before `enemy_move` in `commitQueue`. Content imports `type { EngineConfig, PieceType } from '@checkbreaker/engine'` and its package.json gains `"dependencies": { "@checkbreaker/engine": "*", "yaml": "^2.6.1" }` (run `npm install`). Validator: fail unless `playerOutOfTurns + 40 < mateBound < playerMated − 40`. docs/09 §6: escape the pipe as `move \| null`.
- [ ] **Step 4: Run** `npm test`; regenerate golden snapshots after checking the diff moves only `enemy_fell_back`. `npm run validate`, `npm run typecheck`. Expected: all green, search-parity baseline unchanged.
- [ ] **Step 5: Commit** `fix: derive MATE_BOUND from config, order enemy_fell_back first, import engine by name`.

---

## Phase A — Deployment and the deck

### Task 3: EngineConfig from three YAML files, and the ability compiler

**Files:**
- Create: `packages/engine/src/abilities.ts`
- Modify: `packages/engine/src/types.ts` (`EngineConfig`, `SkillDef`, `AbilityFlags`)
- Modify: `packages/content/src/loadEngineConfig.ts`
- Test: `packages/content/test/loadEngineConfig.test.ts`, `packages/engine/test/abilities.test.ts`

**Interfaces:**
- Produces (types.ts):

```ts
type DeckType = 'knight' | 'bishop' | 'rook' | 'queen';
interface AbilityFlags {
  leapAllies: 0 | 1 | 2;            // 0 none · 1 may pass allies, no capture after · 2 may capture after
  leapers: [number, number][];      // extra (df, dr) offsets, every symmetric image listed
  extraRays: ('orthogonal' | 'diagonal')[];
  multiCapture: 0 | 1 | 2;          // 0 none · 1 only on a move that passed no ally · 2 any move
  bonusSelfMove: boolean;
  lifeline: boolean;
}
type AbilityTable = Record<DeckType, [AbilityFlags, AbilityFlags, AbilityFlags, AbilityFlags]>; // by tier index
interface SkillDef {
  id: string; status: 'mvp' | 'future'; cost: number; charges: number; price: number;
  target: { kind: 'none' | 'own_piece' | 'enemy_piece' | 'board_square'; pieceType?: PieceType;
            excludes?: PieceType[]; excludesRarity?: Rarity[]; must_be_on_board?: boolean };
  effects: { primitive: ActiveModifier['primitive']; params?: Record<string, unknown>; duration: ActiveModifier['duration'] }[];
  restrictions: ('once_per_turn' | 'distinct_targets' | 'requires_bishop_on_board')[];
}
interface EngineConfig {
  rules: { freeMovesPerTurn: number; focusPool: number; minMovesPerQueue: number;
           deploymentRanks: number[]; summonCostsDurability: number;
           spawnPoints: Record<'act1' | 'act2' | 'act3', { normal: number; boss: number }> };
  pieces: Record<'king' | DeckType, { spawnCost: number; spawnCostByRarity: Partial<Record<Rarity, number>>;
           durabilityMax: number | null; durabilityMaxByRarity: Partial<Record<Rarity, number>> }>;
  abilities: AbilityTable;
  skills: Record<string, SkillDef>;
  deck: { capacity: number };
  // pieceValues, economy, enemyAI unchanged
}
```

- `compileAbilities(rarityAbilities: Record<DeckType, Partial<Record<Rarity, { ability: string; params: Record<string, unknown> }[]>>>): AbilityTable` in `abilities.ts` — cumulative by tier; a later `leap_allies` with `captureAfterLeap: true` raises 1 → 2; `add_leaper` offsets expand to all sign and swap images, deduplicated; unknown ability names throw (the validator already rejects them, so this is a programmer error).
- `spawnCostOf(config, type, rarity): number` and `durabilityMaxOf(config, type, rarity): number | null` in `abilities.ts`.
- `loadEngineConfig(economyPath?, piecesPath?, skillsPath?)` — defaults `data/economy.yaml`, `content/examples/pieces.yaml`, `content/examples/skills.yaml`.

- [ ] **Step 1: Failing tests.** abilities.test.ts: knight tier 1 `leapers` ⊇ (2,0),(−2,0),(0,2),(0,−2); knight tier 2 adds (2,2) images and keeps tier 1's; bishop tier 1 `leapAllies` 1, tier 2 → 2, tier 3 `extraRays` = ['orthogonal']; rook tier 3 `leapAllies` 2 and `multiCapture` 1; queen tier 2 `lifeline` true, tier 3 `multiCapture` 2; knight tier 3 `bonusSelfMove`. `spawnCostOf(config,'bishop','legendary')` 5, `('bishop','unique')` 3, `('knight','legendary')` 3; `durabilityMaxOf(config,'queen','legendary')` 1, `('queen','rare')` 2. Loader test: `config.rules.deploymentRanks` = [1,2,3,4], `config.rules.spawnPoints.act3.boss` 18, `config.skills.ascension.target.excludesRarity` = ['legendary'], `config.deck.capacity` 8, still deep-frozen, a missing `skills.yaml` throws an error naming it.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the types, `compileAbilities`, the two lookups, and the loader (reads the three files; `pieces` from economy.yaml; `abilities` from pieces.yaml `rarityAbilities` via `compileAbilities` imported from `@checkbreaker/engine`; `skills` keyed by id).
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): load pieces and skills into EngineConfig; compile rarity abilities`.

### Task 4: State shape — `stageId`, `skillLog`, modifier targets by id

**Files:**
- Modify: `packages/engine/src/types.ts` (`BoardPiece.stageId?: string`, `StageState.skillLog`, `ActiveModifier.target` doc comment)
- Modify: `schemas/stage.schema.json`, `content/examples/stage-state.yaml`, `scripts/validate-content.mjs`
- Modify: `packages/engine/test/helpers.ts`, `packages/engine/test/fuzzgen.ts`, `packages/engine/test/golden/scenarios.ts`, `scripts/play.ts`
- Test: validator negative cases (scratch script), `packages/engine/test/golden.test.ts`

**Interfaces:**
- Produces: every Stage Piece made by `stageOf` / `fenToStage` carries `stageId` `s01`, `s02`, … assigned in square-index order (a1 first); every `StageState` from helpers has `skillLog: []`. `StageState.skillLog: { skillId: string; turn: number; targetId?: string }[]`.

- [ ] **Step 1: Schema and example.** stage.schema.json: `boardPiece.stageId` string `^s[0-9]{2,}$`; `skillLog` required array of `{ skillId, turn ≥ 1, targetId? }`; modifier `target` described as a piece id. stage-state.yaml: give each Stage Piece a `stageId`, set the Lockdown modifier's `target` to b7's `stageId`, add the matching `skillLog` entry `{ skillId: lockdown, turn: 2, targetId: <b7 id> }`.
- [ ] **Step 2: Validator rules** (fail messages name the square): every piece without `instanceId` has a `stageId`; no piece has both; `stageId`s unique; every modifier has a `skillLog` entry with `skillId === source`, `targetId === target`, `turn === appliedOnTurn`; no `skillLog.turn` exceeds `turnsUsed + 1`. Negative cases: drop a `stageId`, duplicate one, give a Hero Piece a `stageId`, orphan the modifier, set `skillLog.turn` to 9 — each must FAIL with its message; then restore (retry-on-lock restore, files byte-identical).
- [ ] **Step 3: Engine types and helpers** as in Interfaces; `play.ts` and fuzzgen assign ids the same way.
- [ ] **Step 4: Run** `npm run validate && npm test`. Regenerate golden snapshots after checking the diff adds only `stageId` and `skillLog`. `npm run typecheck`. Expected: green.
- [ ] **Step 5: Commit** `feat: give Stage Pieces a stageId and stages a skillLog`.

### Task 5: `startStage`

**Files:**
- Create: `packages/engine/src/deployment.ts`
- Modify: `packages/engine/src/types.ts` (`CommitError` per spec §5.3: `invalid_deployment` reasons, `spawn_points_exceeded { budget, cost }`, `durability_unavailable { instanceId }`; events `piece_summoned`, `stage_started`), `packages/engine/src/index.ts`
- Test: `packages/engine/test/deployment.test.ts`

**Interfaces:**
- Consumes: `spawnCostOf`, `durabilityMaxOf` (Task 3); `inCheck`, `fromBoard`.
- Produces: `startStage(run: RunState, stage: StageState, placements: { instanceId: string; to: Square }[], config: EngineConfig): Result<{ run: RunState; stage: StageState; events: GameEvent[] }, CommitError>`; test helper `deploymentStageOf(pieces, overrides)` = `stageOf` with `phase: 'deployment'`, no White Hero Pieces, `spawnPoints: 9`.

- [ ] **Step 1: Failing tests** — one per refusal in spec §7.2, each asserting the error *and* that the returned run/stage are absent (inputs are frozen, so nothing was spent):
  `refuses an active-phase stage` → `wrong_phase { expected: 'deployment' }`; `refuses an unknown instance` → `invalid_deployment { reason: 'not_in_deck' }`; `refuses an instance placed twice` → `duplicate`; `refuses durability 0` → `durability_unavailable`; `refuses rank 5` → `outside_zone`; `refuses an occupied square, including one taken by an earlier placement` → `occupied`; `refuses no King` → `king_missing`; `refuses knight+bishop+rook (11) over 9` → `spawn_points_exceeded { budget: 9, cost: 11 }`; `counts a Legendary bishop as 5` (bishop L + knight + knight = 11 > 9); `refuses a King left in check` → `king_in_check`.
  Success: King e1 + two knights: each knight 2 → 1 and `deployed`; a knight at 1 → 0 becomes `spent`; King `deployed` with durability null; loadout `{ charges: 0, chargesMax: 3 }` → 3; stage `phase: 'action'`, `moveCredits: 1`, `focus: 3`, `skillLog: []`; events `piece_summoned` ×3 in placement order then `stage_started`; placing nothing but the King is legal.
- [ ] **Step 2: Run** `npx vitest run packages/engine/test/deployment.test.ts`, expect FAIL.
- [ ] **Step 3: Implement** in `deployment.ts`, checks in spec order; board pieces get `{ pieceType, color: 'white', instanceId, rarity }` (rarity omitted for the King).
- [ ] **Step 4: Run** the file, then `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): startStage — the Deployment phase`.

### Task 6: Captures, lifeline and promotion during a stage

**Files:**
- Modify: `packages/engine/src/rules.ts` (R5 capture), `packages/engine/src/queue.ts` (promotion), `packages/engine/src/types.ts` (event fields: `capture.instanceId?`, `capture.stageId?`, `pawn_promoted.instanceId`, `lifeline_saved { instanceId }`)
- Test: `packages/engine/test/deck-lifecycle.test.ts`

**Interfaces:**
- Consumes: `durabilityMaxOf`, `config.abilities` (`lifeline` flag), `hash`.
- Produces: `commitQueue` returns a `run` whose deck reflects R5 captures; `resolveQueue` returns a `run` whose deck holds promoted instances. Promoted instance id = `'p_' + hash(stageSeed, turnsUsed, atStep, square).toString(16)`.

- [ ] **Step 1: Failing tests.** `enemy capture removes the instance from run.deck` (fixture: a knight en prise to a pawn, enemy policy depth 1); `a Unique queen with lifeline stays, status captured, usedOnce ['lifeline'], event lifeline_saved`; `a Unique queen whose usedOnce has lifeline is removed`; `a Rare queen has no lifeline`; `a promotion adds exactly promotesTo at full durability (Rare queen → durability 2; Legendary queen → 1), origin promotion, status in_deck, acquiredAtStage actIndex*3+stageIndex`; `the promoted id is deterministic across two runs of the same queue`; **Review Focus 3:** `two pawns promoting on e8 in one turn with two credits get two distinct ids`; `capture events carry instanceId / stageId`; `when the enemy captures nothing, simulate's run.deck equals commitQueue's` (parity).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `applyPlayerMove` reports `{ promoted?: { square, promotesTo } }`; `resolveQueue` builds the instance (it knows `run`, `stage`, `atStep`). R5 in `commitQueue` updates `run.deck` when the captured piece has an `instanceId`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`; regenerate golden snapshots only for the new event fields. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): captures, lifeline and promotion update the deck`.

### Task 7: `endStage`

**Files:**
- Create: `packages/engine/src/stage-end.ts`
- Modify: `packages/engine/src/types.ts` (`stage_not_won { status }`, events `piece_returned { instanceId, durability }`, `piece_removed { instanceId, reason: 'spent' }`), `packages/engine/src/index.ts`
- Test: `packages/engine/test/stage-end.test.ts`

**Interfaces:**
- Produces: `endStage(run: RunState, stage: StageState, config: EngineConfig): Result<{ run: RunState; events: GameEvent[]; overCapacity: number }, CommitError>`.

- [ ] **Step 1: Failing tests.** `refuses an active stage` and `refuses a lost stage` → `stage_not_won { status }`; `deployed returns to in_deck with its durability`; `spent is removed, never earlier` (a spent piece still in `run.deck` after `commitQueue`, gone after `endStage`); `a lifeline queen returns in_deck with durability 1`; **Review Focus 5:** `a lifeline queen captured again next stage is removed with no lifeline_saved`; `overCapacity counts non-King pieces over 8` (8 + one promotion → 1); `the King returns to in_deck`; `I15: after startStage no queue can add a Hero Piece to the board` (fuzz the queue with 500 random legal queues; the set of instanceIds on the board only shrinks).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per spec §7.4.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run bench`. Expected: PASS (phase A gate).
- [ ] **Step 5: Commit** `feat(engine): endStage returns, removes and saves deck pieces`.

---

## Phase B — Skills and the modifier stack

### Task 8: `ACTIVATE_SKILL` — checks, costs and the primitive registry

**Files:**
- Create: `packages/engine/src/skills/check.ts`, `packages/engine/src/skills/registry.ts`
- Modify: `packages/engine/src/queue.ts` (remove the `unsupported_action` branch), `packages/engine/src/types.ts` (remove `unsupported_action`; add `skill_unavailable`, `invalid_target` per spec §5.3; events `skill_activated`, `piece_transformed`, `piece_suppressed`)
- Test: `packages/engine/test/skills.test.ts`

**Interfaces:**
- Produces: `checkSkill(ctx: QueueCtx, action: { skillId: string; target?: Square }, atStep: number, config): CommitError | null` and `applySkill(ctx: QueueCtx, …): GameEvent[]` where `QueueCtx` is the queue's local state `{ run, board, focus, moveCredits, modifiers, skillLog, turn }` (exported from `queue.ts`). Registry: `PRIMITIVES: Record<ActiveModifier['primitive'], Handler | undefined>` with handlers for `grant_move_credit`, `set_piece_type`, `suppress_piece` only. Modifier id `m{turn}_{atStep}`; modifier `target` = the piece's `instanceId ?? stageId`.

- [ ] **Step 1: Failing tests**, one per check of spec §8.1 in order: `not_in_loadout`; `not_implemented` (a loadout holding `gallop`); `no_charges`; `once_per_turn` (two Twin Steps in one queue); `focus_exceeded { needed: 2, available: 1 }` (stage `focus: 2`; Lockdown (1) then Ascension (2)); `no_target` (Lockdown without target); `wrong_target` (Ascension on a knight; Lockdown on an own piece); `excluded` (Lockdown on the king; Ascension on a Legendary bishop); `already_targeted` (Lockdown the same `stageId` on turn 2 after turn 1, even though it moved squares). Effects: Twin Step then two moves is legal and `moveCredits` ends 0; Twin Step after the move it would pay for → `credits_exceeded`; charges decrement in the returned run and Focus in the returned stage; `skillLog` gains `{ skillId, turn, targetId }`. **Review Focus 1:** `a Lockdown targeting a square emptied earlier in the queue → invalid_target no_target`. `simulate` and `commitQueue` agree on all of the above.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the checks and the three handlers. `set_piece_type` writes `transformed: { pieceType, modifierId }`; `fromBoard` already reads `transformed`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): ACTIVATE_SKILL with data-driven primitives`.

### Task 9: Modifier stack and the final R1→R5

**Files:**
- Modify: `packages/engine/src/queue.ts` (R1, R2 `afterRevert`), `packages/engine/src/rules.ts` (R3, R5, expiry), `packages/engine/src/legality.ts` (`legalMoves(b, color, frozen?)`), `packages/engine/src/enemy/policy.ts`, `packages/engine/src/enemy/search.ts` (`scoreRootMoves(…, frozen?)`)
- Modify: `packages/engine/src/types.ts` (`king_in_check_at_end.afterRevert`; events `transform_reverted`, `modifier_expired`)
- Test: `packages/engine/test/modifiers.test.ts`

**Interfaces:**
- Produces: `legalMoves(b: Int8Array, color: Color, frozen?: Uint8Array): Move[]` (frozen[i] = 1 → no moves from i); `scoreRootMoves(board, playerTurnsLeft, depth, config, frozen?: Uint8Array)` — mask applied at the root only; `frozenMask(stage: StageState): Uint8Array` in `skills/registry.ts` from live `suppress_piece` modifiers.

- [ ] **Step 1: Failing tests.** `Ascension's queen captures, then reverts at R1: the board shows a bishop`; `a temporary queen never mates` (a position where Q-move mates but B-move does not: stage stays active, no `stage_won`); `a revert that exposes the king → king_in_check_at_end { afterRevert: true }` and a plain check → `afterRevert: false`; `Lockdown leaving the enemy no move, enemy in check → won (checkmate)`; `… not in check → lost (enemy_stalemated)`; `the suppressed piece does not move in R5, but may move the enemy turn after` (two consecutive commits); `R5's search never freezes below the root` (depth-2 search score equals the unfrozen search's score for the same child positions); `next_enemy_turn modifiers expire after R5 with modifier_expired`; **Review Focus 2:** `Lockdown on b7, then the player captures b7 in the same queue: no modifier survives R1, R3 freezes nothing`; `Ascension on a bishop later captured in the queue: the modifier drops, no revert event`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per spec §8.3. R1 finds the transformed piece by `transformed.modifierId`; suppress modifiers resolve their square by searching the board for the target id each time they are read.
- [ ] **Step 4: Run** `npm test && npm run typecheck`; the search-parity baseline must be unchanged (no frozen mask in those cases). Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): modifier stack, revert-before-mate and suppression in R3/R5`.

### Task 10: `hasLegalQueue` with skills

**Files:**
- Modify: `packages/engine/src/legality.ts` (signature), `packages/engine/src/rules.ts` and `scripts/play.ts` (callers), `packages/engine/src/index.ts`
- Test: `packages/engine/test/legal-queue.test.ts`

**Interfaces:**
- Produces: `hasLegalQueue(run: RunState, stage: StageState, config: EngineConfig): boolean` — skills-first search per spec §8.4, judging each candidate with `resolveQueue` (Resolve, R1, R2) so "legal" means exactly what commit means.

- [ ] **Step 1: Failing tests.** `true with a single legal move` (M1 behaviour kept); `true when only Twin Step + two king moves escape` (king must walk through an attacked square); `true when only Ascension lets the bishop block`; `false when skills have no charges`; `false when Focus is short`; `brute force agrees`: on 300 random small boards (King + ≤ 3 pieces each side, loadout of the three skills with random charges), `hasLegalQueue` equals an exhaustive search over every interleaving of ≤ 2 skills and ≤ 3 moves.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**; update callers (R5's no-legal-queue check passes `run`).
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): hasLegalQueue considers skills`.

### Task 11: Fuzz and parity with skills; phase-B docs

**Files:**
- Modify: `packages/engine/test/fuzzgen.ts`, `packages/engine/test/fuzz.test.ts`, `packages/engine/test/parity.test.ts`
- Modify: `docs/02-rules-framework.md` §6 and §8.1, `docs/03-skill-framework.md` §3, `docs/09-technical-architecture.md` §4 and §9

- [ ] **Step 1: Extend the generators**: random loadouts of the three skills with random charges, queues mixing `ACTIVATE_SKILL` (valid and invalid targets) and moves.
- [ ] **Step 2: Assertions**: fuzz (10,000 cases) never violates I1–I6 and never throws; every accepted queue's Focus spent ≤ pool and paid moves ≤ credits; parity holds (simulate's events a prefix of commit's, awards and runs equal).
- [ ] **Step 3: Docs**: docs/02 §6 — suppression in force at R3 and at the root of R5 only; modifiers target piece ids. docs/02 §8.1 — the root-only freeze. docs/03 §3 — modifier ids `m{turn}_{step}`, targets by id, `hasLegalQueue` skills-first and its scope. docs/09 §4 — `hasLegalQueue(run, stage, config)`, the `CommitError` table of spec §5.3, the events of §5.4.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run bench`, and the link check. Expected: green (phase B gate).
- [ ] **Step 5: Commit** `test: fuzz and parity with skills; document the modifier stack`.

---

## Phase C — Rarity abilities

### Task 12: Tier array, ability-aware generation, reference with rarity

**Files:**
- Modify: `packages/engine/src/position.ts` (`tiersOf`), `packages/engine/src/movegen.ts` (`Move.via`, `Move.viaCaptured`), `packages/engine/src/abilities.ts` (generators)
- Modify: `packages/engine/test/reference/movegen.ts`, `packages/engine/test/reference/evaluate.ts`, `packages/engine/test/reference.test.ts`, `packages/engine/test/helpers.ts` (`randomBoard` gains tiers)
- Test: `packages/engine/test/abilities-moves.test.ts`

**Interfaces:**
- Produces: `tiersOf(board: StageState['board']): Int8Array` (tier of each White Hero Piece without `transformed`, else 0); `abilityTargets(b, t, from, table: AbilityTable): { to: number; via: number }[]` (via = −1 unless a multi-capture); `abilityAttacked(b, t, sq, table): boolean` (attacked by White); `hasTiers(t): boolean`. `Move` gains `via: number` and `viaCaptured: number` (−1 / 0 when unused); `makeMove`/`unmakeMove` handle them. The reference gains the same tier argument.

- [ ] **Step 1: Reference with rarity**, from docs/02 §2.3 literally (including "attacks follow moves", the king exception, "multi-capture adds no attacked squares").
- [ ] **Step 2: Failing tests** — table-driven, one row per ability of docs/02 §2.3: `Rare bishop leaps an ally but cannot capture after`; `Rare bishop gives no check through an ally`; `Unique bishop captures after a leap and checks through an ally`; `Legendary bishop moves orthogonally, leaps, captures after`; `Rare knight (2,0) leaps; Unique adds (2,2)`; `Rare rook leaps without capture; Unique rook steps diagonally and captures; Legendary rook captures once after a leap`; `Legendary rook multi-captures only without a leap`; `Legendary queen multi-captures with or without a leap`; multi-capture rules: `Y must be directly beyond X`, `no capture across a gap`, `Y holding the enemy king stops on X`, `never a third`. Differential: fast == reference on 5,000 random boards with random tiers for moves and White attack maps.
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement** `abilities.ts` generators reading only `AbilityFlags` (no piece names). With `hasTiers(t)` false, callers keep using the M1 functions.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: PASS; perft and the Normal-only differential unchanged.
- [ ] **Step 6: Commit** `feat(engine): rarity abilities in move generation, checked against a reference`.

### Task 13: Abilities in the queue — legality, multi-capture, the bonus move

**Files:**
- Modify: `packages/engine/src/legality.ts` (`checkPlayerMove(board, from, to, config)`, `legalPlayerMoves(stage, from, config)`), `packages/engine/src/queue.ts` (multi-capture apply, bonus accounting, I2 with abilities), `packages/engine/src/index.ts`
- Test: `packages/engine/test/abilities-queue.test.ts`

**Interfaces:**
- Consumes: `tiersOf`, `abilityTargets` (Task 12).
- Produces: `legalPlayerMoves(stage, from, config): Square[]` (a multi-capture's Y listed as its own destination); a `MOVE { to: Y }` through enemy X captures both, emits two `capture` events, pays both salvages, costs one credit.

- [ ] **Step 1: Failing tests.** `MOVE to Y captures X and Y, two capture events, salvage summed, one credit`; `MOVE to X captures X only`; **Review Focus 4:** `MOVE to Y when Y is empty / an ally / off the line → unreachable; Y the enemy king → king_square`; `Legendary knight: second MOVE by the same knight costs 0`; `bonus once per turn` (third knight move → `credits_exceeded`); `bonus never pays another piece's move`; `bonus does not carry to the next turn`; `a Legendary knight that gives check cannot land on the king with its bonus move` (`king_square`); `two Legendary knights each have their own bonus`; `Ascension suspends a Unique bishop's leap and it returns after the revert` (same turn: no leap as a queen; next turn: leap legal); `hasLegalQueue counts the bonus move`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**; callers of `checkPlayerMove` / `legalPlayerMoves` pass `config`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): multi-capture and the Legendary knight bonus in the queue`.

### Task 14: Abilities in the enemy search

**Files:**
- Modify: `packages/engine/src/enemy/search.ts`, `packages/engine/src/enemy/evaluate.ts`, `packages/engine/src/enemy/zobrist.ts`, `packages/engine/src/enemy/policy.ts`, `packages/engine/src/legality.ts` (White-attack call sites)
- Modify: `packages/engine/test/bench.test.ts`, `packages/engine/test/helpers.ts` (`RARITY_FENS` with tier overrides)
- Test: `packages/engine/test/enemy-abilities.test.ts`, `packages/engine/test/reference.test.ts`

**Interfaces:**
- Produces: `scoreRootMoves(board, playerTurnsLeft, depth, config, frozen?, tiers?: Int8Array)`; `enemyMove` passes `tiersOf(stage.board)`. Zobrist: tier keys `TIER_KEYS[tier 1..3][square]` drawn **after** every existing key so M1 keys are unchanged; XORed for White pieces with a tier.

- [ ] **Step 1: Failing tests.** `the enemy does not leave a piece en prise to a Rare knight's (2,0) leap` (Normal-only search would); `the enemy sees a Legendary queen's double capture`; `the enemy does not imagine the Legendary knight's bonus move or skills`; `evaluate's kingZoneAttacked counts ability attacks` (fast == `refEvaluate` with tiers on 5,000 random boards); `tier-free boards: scores identical to the search-parity baseline`; `make/unmake restores b and t exactly over a full search` (compare copies before and after).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Every White move and White attack in search, quiescence, `safeMove` for Black, `countLegalInPlace` and `evaluate` goes through the ability-aware functions when `hasTiers(t)`; `makeMove`/`unmakeMove` move the tier with the piece.
- [ ] **Step 4: Bench.** Add `RARITY_FENS` (the five GAME_FENS with their White pieces at Rare, Unique and Legendary). Assert: each GAME_FEN median ≤ 1.1 × `bench-baseline.json`; each RARITY_FEN median ≤ 2 × its GAME_FEN baseline; the 50 ms check stays. If a target fails, stop and report the numbers — do not optimise without a decision.
- [ ] **Step 5: Run** `npm test && npm run typecheck && npm run bench`. Expected: green (phase C gate).
- [ ] **Step 6: Commit** `feat(engine): the enemy search models rarity abilities`.

### Task 15: Close M2 — playground, docs, acceptance

**Files:**
- Modify: `scripts/play.ts` (start in the Deployment phase: place the King and two minors via `startStage`, then play; `endStage` on a win)
- Modify: `docs/09-technical-architecture.md` §3, §4, §6, §9; `docs/10-roadmap-and-milestones.md` M2 boxes; `README.md` if commands changed

- [ ] **Step 1: Playground**: `npm run play` asks for placements (`e1 king, b1 knight, f1 bishop` by default on Enter), calls `startStage`, prints refusals by their error, and on a win prints `endStage`'s events. Smoke-test with piped input as in M1.
- [ ] **Step 2: docs/09**: `StageState` (`skillLog`, `spawnPoints`), `BoardPiece.stageId`, `startStage`/`endStage` signatures, test-strategy rows for deployment, skills, abilities and the reference differential. docs/10: tick every M2 box whose test exists, naming the test file in the commit message.
- [ ] **Step 3: Full verification**: `npm test`, `npm run typecheck`, `npm run validate`, `npm run bench`, link check, validator negative scripts (all caught, files byte-identical). Expected: all green.
- [ ] **Step 4: Commit** `docs: close M2 — playground uses startStage, docs/09 and docs/10 updated`.
