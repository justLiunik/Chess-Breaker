# M3 — Stage Generation, Solver & Par Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the turn limit with the par economy in the engine, then generate every stage from a template and a Lichess-derived enemy formation and prove it mateable within its par with the player's real deck, deterministically from the seed and the deck.

**Architecture:** Six phases. 0 adds seed streams and moves templates to one file each. A puts the par economy (`mateIn`, overtime, `out_of_coins`, the enemy clock) into data, schemas, validator and `packages/engine`. B builds an offline formation extractor in `tools/` and commits `content/formations/`. C adds `packages/gen` with the G0–G8 pipeline, using an injected solver. D adds the two-stage beam solver with node budgets and replay, wired into G6. E adds `gen:report`, two templates, tuning and the acceptance run.

**Tech Stack:** TypeScript 5.9.3 (strict, `noUncheckedIndexedAccess`), Vitest 5.0.5, tsx 4.23.15, yaml, npm workspaces, Node ≥ 22.15 for the extractor (built-in zstd; this machine runs 24.21). chess.js 1.4.0 is dev-only (perft reference, extractor).

**Spec:** [docs/superpowers/specs/2026-11-11-m3-generation-solver-design.md](../specs/2026-11-11-m3-generation-solver-design.md). Read it alongside this plan; section numbers (§n) refer to the spec.

## Global Constraints

- `packages/engine` has zero runtime dependencies. Neither `packages/engine/src` nor `packages/gen/src` uses `Math.random`, `Date.now` or `performance.now`; timing lives only in `scripts/gen-report.ts`.
- Every public function takes its config as the **last** argument. This corrects the spec's §5 argument order:
  - `enemyMove(stage, seed, clock, config)`;
  - `generateStage(input, content, config)`.
- No tuning number lives in engine or gen code; every number comes from `data/economy.yaml` or a template.
- Public state is immutable; tests deep-freeze inputs (`deepFreeze` in `packages/engine/test/helpers.ts`).
- Engine functions return `Result<…, CommitError>`. Gen throws only on an engine bug: an act and tier with no template.
- Board index = file + 8 × rank (a1 = 0, h8 = 63). Piece codes ±1..6 = P N B R Q K, with White positive. Tier indices: normal 0, rare 1, unique 2, legendary 3.
- Every random choice in gen reads `draw(stageSeed, stream, …)`. The streams are:
  - the spec's `'template'`, `'formation'`, `'mirror'`, `'par'`, `'spawn'` and `'bonus-pawn'`;
  - `'army'` and `'place'` for the random-placement fallback.

  No stream is shared between two steps.
- Every sort breaks ties by text: square names, queue text such as `b1c3,c3d5`, template id or puzzle id. Deck instances are always visited sorted by (type, tier, instanceId), never in array order.
- Before a phase starts, run the M1/M2 benchmark baseline for comparison.
- At the end of every task, the full suite is green: `npm test`, `npm run typecheck`, `npm run validate`. `npm run bench` is green at the end of each phase.
- Golden snapshots may be regenerated (`npx vitest run packages/engine/test/golden.test.ts -u`) only after checking that the diff changes exactly these fields: `turnLimit` → `mateIn`, `+overtimePaid`, `turnBonus` → `parBonus`, `out_of_turns` → `out_of_coins`, plus any task-named additions.
- Nothing is downloaded without the user's yes in chat. The request states the filename, source and size.
- Work on branch `m3-design`. Commit after each task, with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A win on an overtime turn after the pending reward is spent** (`overtimePaid > baseFull`). Expect `base: 0`, `parBonus: 0`, and coins = salvage only: never negative, with no refund of wallet charges. Test in Task 4.
2. **A past-par clock above the Zobrist range** (wallet 500, cost 2 → 250 turns). Expect `enemyMove` not to throw, and the same pick as with clock 20. Test in Task 5.
3. **Lichess rows whose first move is castling, en passant or a promotion, and malformed rows.** The first three are applied by chess.js, and the defender's side after the move is what counts. A malformed row is skipped and counted, never a crash. Test in Task 7.
4. **A deck with only the King** (everything else spent or captured after the stage-end chooser). Expect `generateStage` to still emit a stage: one deployment candidate (King only), `win: null` without a crash, then the bonus-pawn path. Test in Task 16.
5. **The same deck in a different array order.** Expect a byte-identical `StageState` and `Provenance`, because deck instances are visited in sorted order. Test in Task 16; preconditions in Task 11.

---

## Before Task 1

- [ ] Create branch `m3-design` from `main`. Commit the already-edited design docs (README, docs/00–05, 07–11), the spec and this plan as `docs: M3 design — par economy, generation and solver spec and plan`. Run `npm run validate` first; expected: PASS.

## Phase 0 — Preparation

### Task 1: `mix32` and `draw`

**Files:**
- Modify: `packages/engine/src/rng.ts`
- Test: `packages/engine/test/rng.test.ts`

**Interfaces:**
- Produces:
  - `mix32(h: number): number`, the murmur3 fmix32 finalizer returning an unsigned 32-bit value;
  - `draw(seed: string, ...parts: (string | number)[]): number = mix32(hash(seed, ...parts)) / 2 ** 32`, in [0, 1).

  Both are exported through `index.ts` (already `export *`). `hash` and `rng` are unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it('mix32 matches the murmur3 fmix32 reference', () => {
  expect(mix32(0)).toBe(0);
  expect(mix32(1)).toBe(0x514e28b7);
  expect(mix32(0xffffffff)).toBe(0x81f16f39);
});
it('draw is reproducible and in [0, 1)', () => {
  expect(draw('s', 'par')).toBe(draw('s', 'par'));
  expect(draw('s', 'par')).not.toBe(draw('s', 'spawn'));
});
it('draw passes chi-square over 8 buckets for 10,000 consecutive values', () => {
  const buckets = new Array(8).fill(0);
  for (let i = 0; i < 10_000; i++) buckets[Math.floor(draw('chi', 'formation', i) * 8)]++;
  const chi = buckets.reduce((s, n) => s + (n - 1250) ** 2 / 1250, 0);
  expect(chi).toBeLessThan(24.32); // p = 0.001, 7 degrees of freedom
});
```

- [ ] **Step 2: Run `npx vitest run packages/engine/test/rng.test.ts`.** Expected: FAIL, `mix32` is not exported.
- [ ] **Step 3: Implement `mix32` and `draw` in `rng.ts`.** Use `Math.imul` with the constants `0x85ebca6b` and `0xc2b2ae35`, the shifts 16/13/16, and `>>> 0`.
- [ ] **Step 4: Run the test file and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): mix32 finalizer and draw(seed, ...stream) for independent seed streams`.

### Task 2: One file per template, and `loadTemplates`

**Files:**
- Create: one file per template in `content/templates/`:
  - `tpl-act1-open-field.yaml`
  - `tpl-act1-first-steps.yaml`
  - `tpl-act1-boss-gatehouse.yaml`
  - `tpl-act2-fortress.yaml`
  - `tpl-act3-boss-redoubt.yaml`
- Create: `content/templates/README.md`. It carries the header comment of the old `templates.yaml`, reworded for one file per template.
- Create: `packages/content/src/templates.ts`
- Delete: `content/examples/templates.yaml`
- Modify:
  - `scripts/validate-content.mjs` (MANIFEST);
  - `scripts/play.ts:22-30`;
  - `packages/content/src/index.ts`.
- Test: `packages/content/test/templates.test.ts` (already covered by vitest's `packages/*/test/**/*.test.ts`).

**Interfaces:**
- Produces:
  - `interface Template`, mirroring `schemas/template.schema.json` field for field: `placement?: 'generated' | 'fixed'`, `enemyArmy?: Partial<Record<PieceType, [number, number]>>`, `enemyZone?: number[]`, `fixedEnemy?: Record<Square, PieceType>`, `spawnedPawns: { count: [number, number]; ranks: number[] }`, `enemyPolicy`, `preconditions: PreconditionId[]`, and the rest. Task 4 replaces `turnLimit` with `mateIn: [number, number]`.
  - `type PreconditionId`, the seven ids of docs/04 §4.
  - `loadTemplates(dir?: string): Template[]`, sorted by `id`.

- [ ] **Step 1: Write the failing test.** `loadTemplates()` returns the five ids in sorted order, and the file name equals the `id` for every file.
- [ ] **Step 2: Run it.** Expected: FAIL (module missing).
- [ ] **Step 3: Split and load.**
  - Each file is one template as a top-level mapping.
  - The validator's MANIFEST gains a `{ dir: 'content/templates', schema: 'template' }` entry. The validator validates each file and fails `"<file>: file name must equal the template id"`. Every existing template check now iterates these documents.
  - `play.ts` uses `loadTemplates()`.
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run validate` and `npm run play -- --help`, or whatever `play` accepts without a TTY.** Expected: all PASS, with the same 42 validator checks plus one per template file.
- [ ] **Step 5: Commit** `refactor(content): one template per file in content/templates, loadTemplates()`.

### Task 3: docs/04 §3–§5 rewritten to the spec

**Files:**
- Modify: `docs/04-stage-generation-and-authoring.md` §3 (pipeline), §4 (preconditions intro), §5 (solver), and §9 (test plan, the bonus-pawn exception to the spawned-pawn count).
- Create: `scripts/check-links.mjs`, a copy of the 46-line link checker used during the M3 design, at `C:\Users\LENOVO\AppData\Local\Temp\claude\cefb64c9588238a6\e3f924eb-0530-4849-a2ef-bde899f48bca\scratchpad\links.mjs`. It takes the repo root as an optional argument (default `.`).
- Modify: `package.json`: add the script `"check:links": "node scripts/check-links.mjs"`.

- [ ] **Step 1: Rewrite §3** as the spec's §8.2 table, G0–G8:
  - generation runs right after the stage is cleared, from the deck after the stage-end chooser;
  - the named seed streams;
  - three boards, the bonus pawn, and the `validationFailed` rule;
  - G1 needs ≥1 template per act and tier.

  In §2 or §3, add a short "Formations" subsection from §8.1: the Lichess source, CC0, the filters, `maxPerTemplate`/`minPerTemplate`, mirroring, and random placement as the fallback.
- [ ] **Step 2: Rewrite §5** from §9:
  - single-move queues plus the Legendary bonus move, no skills;
  - the §9.2 deployment candidates;
  - the two-stage beam with its parameters;
  - nodes = enemy replies needed, `nodeBudget` 40,000;
  - replay;
  - the "sound but incomplete" statement.

  Replace the old budgets table (`solverNodeBudget` 200,000, `solverTimeMs`, the mate-first ordering) with the `generation.solver` keys of Task 7.
- [ ] **Step 3: §9.** In the "Spawned pawns" row, the count is in range, or one above it on a bonus-pawn stage.
- [ ] **Step 4: Verify.**
  - `grep -n "solverTimeMs\|200,000\|after the shop resolves\|turnLimit" docs/04-stage-generation-and-authoring.md` → no output.
  - `npm run check:links` reports 0 broken.
  - `npm run validate` PASS.
- [ ] **Step 5: Commit** `docs(04): generation pipeline, formations and solver per the M3 spec`.

## Phase A — Par economy

### Task 4: Par economy in data, state and rules

**Files:**
- Modify:
  - `data/economy.yaml`:
    - `economy.coinRate` → `economy.parBonus {act1: 6, act2: 9, act3: 12}` and `economy.overtimeCost {act1: 2, act2: 3, act3: 4}`;
    - `stages.turnLimits` deleted.
  - `content/templates/*.yaml`: `turnLimit` → `mateIn`, with these values:
    - open-field [4, 5]
    - first-steps [4, 5]
    - gatehouse [4, 4]
    - fortress [3, 4]
    - redoubt [2, 2]

    Design notes that cite turn limits are reworded.
  - `schemas/template.schema.json`, `schemas/stage.schema.json`, `content/examples/stage-state.yaml`.
  - `scripts/validate-content.mjs`: the `turnLimit` checks, which sat at lines 248–255, 582–583, 794 and 925–934 before Task 2.
  - `packages/engine/src/types.ts`, `packages/engine/src/rules.ts`, `packages/engine/src/enemy/policy.ts:17`.
  - `packages/content/src/loadEngineConfig.ts:145-148`, `packages/content/src/templates.ts`, `scripts/play.ts`.
- Create: `packages/engine/src/economy.ts`
- Test (all under `packages/engine/test/`):
  - new: `par-economy.test.ts`;
  - migrated: `simulate.test.ts`, `commit.test.ts`, `golden/scenarios.ts`, `fuzzgen.ts`, `helpers.ts`, `bench.test.ts`, and the enemy tests that build stages.

**Interfaces:**
- Produces:
  - **`StageState`:** `turnLimit` removed; `mateIn: number` and `overtimePaid: number` added.
  - **`EndReason`:** `'out_of_turns'` → `'out_of_coins'`.
  - **`Award = { coins: number; base: number; parBonus: number }`**.
  - **`GameEvent`** gains `{ type: 'overtime_paid'; turn: number; fromReward: number; fromWallet: number }`.
  - **`EngineConfig.economy`**: `coinRate` removed; `parBonus` and `overtimeCost`, each `Record<'act1' | 'act2' | 'act3', number>`, added.
  - **`stageEconomy(run: RunState, config: EngineConfig): { baseFull: number; parBonusFull: number; overtimeCost: number }`** in `economy.ts`, exported. `baseFull` and `parBonusFull` are `Math.round(x × bossMultiplier)` when `run.stageIndex === 2`; `overtimeCost` is never boss-scaled (docs/05 §2).
  - **`Template.mateIn: [number, number]`**.
- Interim, replaced in Task 5: `policy.ts` passes `Math.min(20, Math.max(1, stage.mateIn - stage.turnsUsed))` where it read `stage.turnLimit - stage.turnsUsed`.

- [ ] **Step 1: Write `par-economy.test.ts`.** Use Act I normal (`runOf()`): baseFull 4, par bonus 6, cost 2. Each mate is a one-move mating queue on a `stageOf` board.

```ts
it('a mate within the par pays base + parBonus', () => {
  // mateIn 3, turnsUsed 1 → mate on turn 2
  expect(award).toEqual({ coins: 10, base: 4, parBonus: 6 });
});
it('a mate on the par turn still pays parBonus', () => { /* mateIn 3, turnsUsed 2 */ expect(award.parBonus).toBe(6); });
it('a mate past the par pays base net of overtime and no parBonus', () => {
  // mateIn 3, turnsUsed 3, overtimePaid 2
  expect(award).toEqual({ coins: 2, base: 2, parBonus: 0 });
});
it('a win after the reward is spent pays 0 base, never negative', () => {
  // overtimePaid 6 > baseFull 4; coins 7 before → 7 after (plus salvage events only)
  expect(award).toEqual({ coins: 0, base: 0, parBonus: 0 });
});
it('boss amounts are rounded: act2 boss 9 + 14, act3 boss 12 + 18', () => { /* stageIndex 2 */ });
it('R4 never ends the stage', () => { /* mateIn 2, turnsUsed 6, non-mating queue → status active */ });
it('the first turn past the par is charged from the reward', () => {
  // commitQueue at turnsUsed 2, mateIn 3 → next turn 4 > 3
  expect(events).toContainEqual({ type: 'overtime_paid', turn: 4, fromReward: 2, fromWallet: 0 });
  expect(stage.overtimePaid).toBe(2); expect(run.coins).toBe(coinsBefore);
});
it('a charge straddling the reward splits reward and wallet', () => {
  // overtimePaid 3 (1 base left), coins 5 → fromReward 1, fromWallet 1, coins 4, overtimePaid 5
});
it('a turn neither can pay ends the stage with out_of_coins', () => {
  // overtimePaid 4, coins 1, cost 2 → status lost, endReason out_of_coins, coins 1, no overtime_paid
});
it('player_mated outranks out_of_coins', () => { /* reply mates White on an unpayable turn → player_mated */ });
```

- [ ] **Step 2: Run it.** Expected: FAIL (`mateIn` is not a StageState field).
- [ ] **Step 3: Implement.**
  - `simulate` R4 only advances `turnsUsed`. On a win: `base = max(0, baseFull − overtimePaid)`, `parBonus = turnsUsed ≤ mateIn ? parBonusFull : 0`.
  - `commitQueue`, after the legal-queue check leaves the stage active and `turnsUsed + 1 > mateIn`:
    - `fromReward = min(cost, max(0, baseFull − overtimePaid))`;
    - `fromWallet = cost − fromReward`.

    If `run.coins < fromWallet`: `lost` with `out_of_coins` and a `stage_lost` event. Otherwise deduct, add `cost` to `overtimePaid`, and emit `overtime_paid` after `turn_started`.
  - Loader: read `economy.parBonus.*` and `economy.overtimeCost.*`.
- [ ] **Step 4: Data, schemas and validator.**
  - **`stage.schema.json`:** `mateIn` is an integer 2–5, required. `overtimePaid` is an integer ≥ 0, required. In the endReason enum, `out_of_turns` → `out_of_coins`.
  - **`template.schema.json`:** `mateIn` is an array of 2 integers in 2..5, required. `turnLimit` is gone. The `spawnedPawns.ranks` description drops "reachable within turnLimit".
  - **Validator, template checks:**
    - `mateIn[0] ≤ mateIn[1]`;
    - spawn ranks ∩ `enemyZone` = ∅;
    - the rank-8 reachability check at line 582 is deleted.
  - **Validator, named failures:**
    - `"<id>: turnLimit was replaced by mateIn (docs/04 §2)"`;
    - `"economy.yaml: economy.coinRate was removed; the par economy uses parBonus and overtimeCost (docs/05 §2)"`;
    - `"economy.yaml: stages.turnLimits was removed; each template sets mateIn"`.
  - **Validator, economy:** `parBonus` and `overtimeCost` are positive integers for all three acts.
  - **`stage-state.yaml`:** `mateIn: 4`, `overtimePaid: 0`.
  - **`play.ts`:** builds its stage with `mateIn` drawn as `tpl.mateIn[0]`, and prints `turn N  MATE IN X` plus `OVERTIME −c ◈ / turn` past the par.
- [ ] **Step 5: Migrate the tests.**
  - `stageOf` default: `mateIn: 4, overtimePaid: 0`.
  - Award expectations: `turnBonus` → `parBonus`.
  - Scenarios that relied on `out_of_turns` now assert the overtime path.
  - Golden: regenerate, then check the diff is only the named fields plus the new `overtime_paid` events in scenarios past the par.
- [ ] **Step 6: Validator negative cases** (scratch script; restore byte-identical): put `turnLimit: 8` back in one template, put `coinRate` back, set `mateIn: [5, 4]`, set `mateIn: [1, 2]`, and give spawn ranks [6, 7] on a zone [6, 8]. Expected: each FAILs with its message.
- [ ] **Step 7: Run** `npm test`, `npm run typecheck`, `npm run validate` and `npm run bench`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(engine): par economy — mateIn, overtime from reward then wallet, out_of_coins, parBonus`.

### Task 5: The enemy clock and `applyEnemyTurn`

**Files:**
- Modify:
  - `packages/engine/src/economy.ts`, `rules.ts`, `enemy/policy.ts`, `enemy/search.ts`, `enemy/zobrist.ts`, `types.ts`;
  - `packages/content/src/loadEngineConfig.ts:164`;
  - `data/economy.yaml` (`enemyAI.terminal.playerOutOfTurns` → `playerOutOfClock`);
  - `scripts/validate-content.mjs:491-499`.
- Test: `packages/engine/test/enemy-clock.test.ts`. Migrate `enemy-search.test.ts`, `legality.test.ts`, `enemy-policy.test.ts`, `enemy-abilities.test.ts`.

**Interfaces:**
- Consumes: `stageEconomy` (Task 4).
- Produces:
  - `enemyClock(run: RunState, stage: StageState, config: EngineConfig): number`, in `economy.ts` and exported:
    - when `turnsUsed < mateIn`: `mateIn − turnsUsed`;
    - otherwise: `max(1, floor((max(0, baseFull − overtimePaid) + run.coins) / overtimeCost))`.
  - `enemyMove(stage: StageState, seed: number, clock: number, config: EngineConfig): EnemyPick`. `type EnemyPick` is exported (the current `Pick`). The clock is clamped to `MAX_CLOCK = 20`, exported from `zobrist.ts`, before `scoreRootMoves`.
  - `applyEnemyTurn(run, stage, pick: EnemyPick, config): Result<{ run; stage; events: GameEvent[] }, CommitError>`, exported from `rules.ts`. It runs R5, the modifier expiry, `turn_started`, the White check event, the legal-queue loss and the overtime charge. `commitQueue = simulate → enemyMove(next, hash(stageSeed, turnsUsed), enemyClock(run, next), config) → applyEnemyTurn`. The solver (Task 15) calls the same three pieces.
  - `EngineConfig.enemyAI.terminal.playerOutOfClock`, which replaces `playerOutOfTurns`; `mateBound` uses it.

- [ ] **Step 1: Write `enemy-clock.test.ts`.**

```ts
it('within the par the clock is turns to the par, whatever the wallet', () => {
  expect(enemyClock(runOf({ coins: 0 }), stageOf(b, { mateIn: 4, turnsUsed: 1 }), config)).toBe(3);
  expect(enemyClock(runOf({ coins: 999 }), stageOf(b, { mateIn: 4, turnsUsed: 1 }), config)).toBe(3);
});
it('past the par the clock is the affordable overtime turns', () => {
  // act1: baseFull 4, overtimePaid 2, coins 5, cost 2 → floor(7 / 2) = 3
});
it('past the par with nothing left the clock is 1', () => {});
it('enemyMove within the par does not depend on run.coins', () => {
  // 200 fuzzgen stages with mateIn > turnsUsed: same pick for coins 0 and coins 500
});
it('a clock above the Zobrist range neither throws nor changes the pick', () => {
  expect(enemyMove(s, 7, 250, config)).toEqual(enemyMove(s, 7, 20, config));
});
```

- [ ] **Step 2: Run it.** Expected: FAIL (`enemyClock` is not exported).
- [ ] **Step 3: Implement.**
  - The `clock`, `applyEnemyTurn` and `EnemyPick` exports.
  - The rename `playerOutOfTurns` → `playerOutOfClock` in the config type, the loader, the search `Ctx` and `mateBound`.
  - `economy.yaml`, and the validator's mate-bound rule message (same inequality, new name).
  - The `policy.ts` interim of Task 4 is deleted.
- [ ] **Step 4: Run the whole suite.** Golden must not change: the clock within the par equals Task 4's interim value, and the golden scenarios past the par had a clock of 1 under the interim. If a golden scenario past the par changes, check that its new clock is the affordable-turns value before regenerating.
- [ ] **Step 5: Run `npm run bench`.** Expected: within 10 % of the Phase A start.
- [ ] **Step 6: Commit** `feat(engine): enemy clock — turns to the par, then affordable overtime; applyEnemyTurn split from commitQueue`.

## Phase B — Formations

### Task 6: Generation config and `loadGenConfig`

**Files:**
- Modify: `data/economy.yaml` `generation:` section:

```yaml
generation:
  maxRegenerations: 20
  maxPlacementTries: 50
  maxBoards: 3                     # boards that passed G5 sent to the solver per stage
  formations: { maxPerTemplate: 50, minPerTemplate: 20 }
  solver:
    nodeBudget: 40000              # enemy replies needed (computed or memoized), per board
    minSolveTurns: 2               # a mate on turn 1 is never a proof
    memoizeEnemyReplies: true
    deployment: { maxSubsets: 6, kingSquares: 4, squaresPerPiece: 6, maxCandidates: 200 }
    screen: { width: 4, turns: 3 }
    deep: { candidates: 8, width: 32 }
    expansion: 3
  acceptance:
    minSolvableRate: 0.95
    medianMateTurnTolerance: 1     # turns, docs/10 M3
```

  (`timeMs`, `orderHeuristic`, `memoizeEnemyReplies` at the top level, and `medianWinTurnTolerance` are removed.)
- Create: `packages/content/src/loadGenConfig.ts`
- Modify: `packages/content/src/index.ts`, `scripts/validate-content.mjs` (the generation keys)
- Test: `packages/content/test/gen-config.test.ts`

**Interfaces:**
- Produces:
  - `type ActKey = 'act1' | 'act2' | 'act3'`.
  - `interface GenSettings { valueBands: Record<ActKey, [number, number]>; bossValueMultiplier: number; rarityPool: Record<ActKey, { ceiling: Rarity; weights: Record<Rarity, number> }>; retention: Partial<Record<DeckType, Partial<Record<Rarity, number>>>>; promotion: { resultTypeWeights: Record<DeckType, number>; tierUpChance: number }; maxRegenerations: number; maxPlacementTries: number; maxBoards: number; formations: { maxPerTemplate: number; minPerTemplate: number }; solver: { nodeBudget: number; minSolveTurns: number; memoizeEnemyReplies: boolean; deployment: { maxSubsets: number; kingSquares: number; squaresPerPiece: number; maxCandidates: number }; screen: { width: number; turns: number }; deep: { candidates: number; width: number }; expansion: number }; acceptance: { minSolvableRate: number; medianMateTurnTolerance: number } }`.
  - `type GenConfig = EngineConfig & { gen: GenSettings }`.
  - `loadGenConfig(path?: string): GenConfig`, deep-frozen. Missing keys throw with the same `need()` messages as `loadEngineConfig`.
  - `enemyArmyValue(pieces: PieceType[], config: EngineConfig): number`, in content. It is the same sum as `validate-content.mjs:231`: `pieceValues`, king excluded. `valueBandFor(act: 1 | 2 | 3, tier: 'normal' | 'boss', config: GenConfig): [number, number]` applies `bossValueMultiplier` exactly as the validator does.

- [ ] **Step 1: Write the test.** It checks `loadGenConfig().gen.solver.deep.width === 32`, `valueBandFor(2, 'boss', c)` equal to the validator's boss band for Act II, and a missing `generation.solver.nodeBudget` throwing `economy.yaml is missing required field: generation.solver.nodeBudget`.
- [ ] **Step 2: Run it.** Expected: FAIL. **Step 3: Implement.** Validator: every key is present and positive; `screen.turns ≤ 5`; `deep.candidates ≤ deployment.maxCandidates`; `minPerTemplate ≤ maxPerTemplate`; `timeMs` and `orderHeuristic` are rejected by name.
- [ ] **Step 4: Run the suite.** Expected: PASS. **Step 5: Commit** `feat(content): generation config — formations and two-stage solver keys, loadGenConfig()`.

### Task 7: Formation extractor and fixture test

**Files:**
- Create:
  - `tools/formations/extract.ts` (the pure functions plus the CLI `main`);
  - `tools/formations/fixture.csv` (about 30 hand-picked rows, header included);
  - `tools/formations/extract.test.ts`.
- Modify:
  - `tsconfig.json`: include `tools/**/*.ts`;
  - `vitest.config.ts`: include `tools/**/*.test.ts`;
  - `.gitignore`: add `.cache/`;
  - `package.json`: script `"formations:extract": "tsx tools/formations/extract.ts"`.

**Interfaces:**
- Consumes: `loadTemplates`, `loadGenConfig`, `valueBandFor`, `enemyArmyValue`, `mix32`, `hash`.
- Produces:
  - `type PuzzleRow = { id: string; fen: string; moves: string; rating: number }`.
  - `parseRow(line: string): PuzzleRow | null`, using the CSV columns `PuzzleId,FEN,Moves,Rating,…`.
  - `defenderPlacement(row: PuzzleRow): string | null`. It applies `moves.split(' ')[0]` with chess.js. The defender is the side that just moved. If the defender is White, it flips ranks and swaps case. It returns a FEN placement field with Black pieces only, or null when chess.js rejects the FEN or the move.
  - `mirrorPlacement(black: string): string`, a left–right mirror.
  - `rejectReason(black: string, tpl: Template, config: GenConfig): null | 'zone' | 'army' | 'value' | 'pawn_rank8'`. The army check requires exactly one king, each type within `enemyArmy`, and no other type.
  - `extractFormations(rows: Iterable<PuzzleRow>, templates: Template[], config: GenConfig): { byTemplate: Record<string, Formation[]>; stats: { rows: number; malformed: number; rejected: Record<string, Record<string, number>> } }`:
    - templates with `placement: fixed` are skipped;
    - survivors are sorted by `(mix32(hash(id)), id)`;
    - a placement whose mirror was already kept is dropped;
    - the first `maxPerTemplate` are kept.
  - CLI: `--source <path>` (default `.cache/lichess/lichess_db_puzzle.csv.zst`), `--out content/formations`. The source is streamed through `zlib.createZstdDecompress()` and `readline`, or read as plain CSV when the name ends in `.csv`.

  Output per template is `content/formations/<templateId>.json`, with keys in this order and 2-space JSON:

```json
{ "templateId": "…", "source": { "url": "https://database.lichess.org/#puzzles", "licence": "CC0", "date": "YYYY-MM-DD", "sha256": "…" },
  "filters": { "enemyZone": [7, 8], "enemyArmy": { … }, "valueBand": [7, 9], "noPawnOnRank8": true },
  "formations": [ { "id": "00sHx", "rating": 1760, "black": "6k1/5ppp/8/8/8/8/8/8" } ] }
```

  `date` is the source file's mtime as `YYYY-MM-DD`; `sha256` is the hash of the compressed file.

- [ ] **Step 1: Write the failing tests** against `fixture.csv`:
  - a White-defender row comes out flipped with its colours swapped;
  - each of `zone`, `army`, `value` and `pawn_rank8` rejects one fixture row;
  - two rows that are mirrors of each other keep only the one first in `mix32` order;
  - a first move that castles, one that captures en passant and one that promotes each give the defender placement chess.js produces;
  - a row with a broken FEN and a row with too few columns count in `stats.malformed` and do not throw;
  - running `main` twice on the fixture into two temp dirs gives byte-identical files.
- [ ] **Step 2: Run `npx vitest run tools/formations`.** Expected: FAIL. **Step 3: Implement.** If `zlib.createZstdDecompress` is missing, the CLI exits with code 1 and `the extractor needs Node ≥ 22.15 (zlib zstd)`.
- [ ] **Step 4: Run the suite.** Expected: PASS. **Step 5: Commit** `feat(tools): Lichess puzzle formation extractor (Black's side, filtered per template, mirror-deduplicated)`.

### Task 8: Download, formation files, loader and validator

**Files:**
- Create:
  - `content/formations/<templateId>.json`, one per non-fixed template;
  - `schemas/formation.schema.json`;
  - `packages/content/src/formations.ts`;
  - `packages/content/test/formations.test.ts`.
- Modify:
  - `scripts/validate-content.mjs`: formation checks;
  - `packages/content/src/index.ts`;
  - `README.md`: a Credits line, "Enemy formations derived from the Lichess puzzle database (database.lichess.org), CC0".

**Interfaces:**
- Produces:
  - `type Formation = { id: string; rating: number; black: string }`;
  - `loadFormations(dir?: string): Record<string, Formation[]>`, keyed by template id. A template with no file maps to `[]`.

- [ ] **Step 1: Ask the user.**
  1. Run `curl -sI https://database.lichess.org/lichess_db_puzzle.csv.zst` to read `Content-Length` and `Last-Modified`.
  2. Ask in chat: "Download `lichess_db_puzzle.csv.zst` from database.lichess.org (CC0, <size> MB, dated <date>) to `.cache/lichess/`?"
  3. Wait for a yes. Without one, stop the task here and report.
- [ ] **Step 2: Download** to `.cache/lichess/` and run `npm run formations:extract`. Record the rows, the malformed count and the per-template reject histogram from its stdout in the commit message body.
- [ ] **Step 3: Write the failing test.**
  - `loadFormations()` has an entry for each non-fixed template.
  - Every `black` field parses to 8 ranks with Black pieces only.
  - Each file's `formations.length ≤ 50`.
- [ ] **Step 4: Schema, loader and validator.**
  - The schema covers the JSON shape of Task 7, with `licence: "CC0"` as a const.
  - The validator re-checks every stored formation with the same rules as `rejectReason`, reimplemented in the validator, and fails with `"<file>: formation <id> has a Black piece outside enemyZone"` and similar messages. It fails when a file's `templateId` has no template or names a fixed one.
  - It **warns, without failing**, when a template has fewer than `minPerTemplate` formations: `"<id>: only N formations (min 20); random placement covers the rest"`.
- [ ] **Step 5: Validator negative cases** (scratch, byte-identical restore): move a pawn to rank 8, add a White piece, set `templateId` to `tpl-act1-first-steps`. Expected: each FAILs.
- [ ] **Step 6: Run** `npm test`, `npm run validate` and `npm run check:links`. Expected: PASS, with any thin-pool warnings listed in the commit body.
- [ ] **Step 7: Commit** `feat(content): Lichess-derived enemy formations per template, schema, loader and validator checks`.

## Phase C — Generation pipeline

### Task 9: `packages/gen` scaffold, engine internals, template choice and the enemy board (G1–G2)

**Files:**
- Create:
  - `packages/gen/package.json` (`@checkbreaker/gen`, depending on `@checkbreaker/engine` and `@checkbreaker/content`, `exports: { ".": "./src/index.ts" }`);
  - `packages/gen/src/index.ts`, `src/types.ts`, `src/select.ts`, `src/board.ts`;
  - `packages/engine/src/internal.ts`, with `"./internal": "./src/internal.ts"` added to the engine's `exports`;
  - `packages/gen/test/select.test.ts`, `packages/gen/test/board.test.ts`, `packages/gen/test/helpers.ts`.
- Run `npm install` to link the workspace.

**Interfaces:**
- Consumes: `draw`, `Template`, `Formation`, `GenConfig`.
- Produces:
  - **`@checkbreaker/engine/internal`** re-exports `fromBoard`, `tiersOf`, `TIERS`, `legalMoves`, `inCheck`, `evaluate`, `makeMoveTiered`, `unmakeMoveTiered`, `abilityAttacked`, `isAttacked` and `frozenMask`. Only `packages/gen` may import it.
  - **`types.ts`:** `GenInput = { run: RunState; actIndex: number; stageIndex: number; previousTemplateId?: string }`; `GenContent = { templates: Template[]; formations: Record<string, Formation[]> }`; `Provenance` exactly as spec §5.3; `Placement = { instanceId: string; to: Square }`.
  - **`selectTemplates(templates: Template[], act: 1 | 2 | 3, tier: 'normal' | 'boss', stageSeed: string, previousTemplateId?: string): Template[]`.** It returns the try order:
    - first `pool[⌊draw(stageSeed, 'template') × pool.length⌋]`, where `pool` is the act-and-tier templates sorted by id, without `previousTemplateId` when at least one other remains;
    - then the rest of the act and tier, by id.

    It throws `Error('no template for act <n> <tier>')` when the act and tier have none. All weights are equal: the schema has no weight field.
  - **`parsePlacement(black: string): Record<Square, PieceType>`**.
  - **`enemyBoard(tpl: Template, formations: Formation[], stageSeed: string, attempt: number, config: GenConfig): { board: Record<Square, BoardPiece>; formationId: string | null; mirrored: boolean } | null`.**
    - `fixed` uses `fixedEnemy`.
    - Otherwise:
      1. Pick formation `⌊draw(stageSeed, 'formation', attempt) × n⌋`.
      2. Mirror it when `draw(stageSeed, 'mirror', attempt) < 0.5`.
      3. With an empty pool, use random placement:
         - counts come from `draw(stageSeed, 'army', attempt, type)`;
         - squares come from `draw(stageSeed, 'place', attempt, try, i)` over empty `enemyZone` squares in index order;
         - the king goes first, then pieces by type order, with no pawn on rank 8;
         - up to `maxPlacementTries`; returns `null` when exhausted.
    - Enemy pieces get `stageId` `s01…` in board-index order, `color: 'black'`, and no rarity (Normal, I13).

- [ ] **Step 1: Write the failing tests.**
  - `selectTemplates` never puts `previousTemplateId` first when another template exists, and throws on an empty act and tier.
  - Fixed templates give `fixedEnemy` exactly.
  - A formation board equals `parsePlacement` or its mirror, with `formationId` set.
  - Changing the `'mirror'` stream (e.g. a stub formation list of one) never changes `formationId`.
  - The random fallback (`formations: []`) stays inside `enemyZone` with counts in range.
  - The same inputs give a deep-equal board.
- [ ] **Step 2: Run `npx vitest run packages/gen`.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run the suite and typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(gen): package scaffold, template choice and enemy board from formations (G1-G2)`.

### Task 10: Deployment phase and spawned pawns (G3–G4)

**Files:**
- Create: `packages/gen/src/spawn.ts`, `packages/gen/src/stage.ts`, `packages/gen/test/spawn.test.ts`

**Interfaces:**
- Produces:
  - **`drawPar(tpl: Template, stageSeed: string): number`** = `lo + ⌊draw(stageSeed, 'par') × (hi − lo + 1)⌋`.
  - **`rollRarity(act: ActKey, u: number, config: GenConfig): Rarity`.** A cumulative pick over `rarityPool[act].weights` in TIERS order.
  - **`rollPromotion(act: ActKey, tier: Rarity, stream: (field: string) => number, config: GenConfig): { pieceType: DeckType; rarity: Rarity }`:**
    1. The type comes from `resultTypeWeights` in the order knight, bishop, rook, queen, via `stream('type')`.
    2. One tier up when `stream('tierUp') < tierUpChance`, clamped to the act ceiling.
    3. Then retention: when `retention[type][tier]` exists and `stream('retention') ≥ it`, drop one tier.
  - **`placeSpawnedPawns(board, tpl, stageSeed: string, attempt: number, config: GenConfig): Record<Square, BoardPiece> | null`.**
    - The count is `lo + ⌊draw(stageSeed, 'spawn', attempt, 'count') × (hi − lo + 1)⌋`.
    - Pawn *i* takes the square `draw(…, 'spawn', attempt, i, 'square')` among the empty squares of `spawnedPawns.ranks` in index order. Squares from which a White pawn would attack the Black king are excluded.
    - Rarity uses `draw(…, i, 'rarity')`; promotion uses the stream `f => draw(stageSeed, 'spawn', attempt, i, f)`.
    - Each pawn gets `spawned: true` and a `stageId` that continues the enemy numbering.
    - Returns `null` when a pawn has no square.
  - **`bonusPawnSquares(board, tpl, stageSeed: string): Square[]`.** The empty spawn-rank squares, minus king-attacking ones, sorted by `draw(stageSeed, 'bonus-pawn', square)`, ties by name.
  - **`makeBonusPawn(square: Square, act: ActKey, stageSeed: string, config: GenConfig): BoardPiece`.** Its streams are `draw(stageSeed, 'bonus-pawn', field)`.
  - **`buildStage(tpl, board, act: ActKey, tier, stageSeed: string, mateIn: number, config: GenConfig): StageState`.** It sets:
    - `phase: 'deployment'`, `playerColor: 'white'`, `turnsUsed: 0`, `overtimePaid: 0`;
    - `focus = focusPool = tpl.focusPool ?? config.rules.focusPool`;
    - `moveCredits = config.rules.freeMovesPerTurn`;
    - `spawnPoints = min(tpl.spawnPoints ?? budget, budget)`, where budget = `config.rules.spawnPoints[act][tier]`;
    - `modifiers: []`, `skillLog: []`, `status: 'active'`;
    - `enemyPolicy` from the template, with `cursor: 0` for scripted policies.

- [ ] **Step 1: Write the failing tests.**
  - `drawPar` stays inside the range for 1,000 seeds and hits both ends.
  - Over 10,000 rolls, Act I pawn rarities are only normal or rare, and the frequencies are within ±2 % of 75/25.
  - No promotion result exceeds the act ceiling (I14) over 10,000 rolls in each act.
  - The Act III queen's `legendary` result appears at about 0.2 × its unretained rate (±30 % relative).
  - Pawns sit only on spawn ranks and never attack the Black king.
  - `placeSpawnedPawns` leaves every enemy piece of its input board where it was.
  - `buildStage` emits `stage.schema.json`-valid state: validate with ajv in the test, loading the schema from `schemas/`.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run the suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(gen): par draw, deployment phase and spawned pawns with rolled rarity and promotion (G3-G4)`.

### Task 11: Preconditions (G5)

**Files:**
- Create: `packages/gen/src/preconditions.ts`, `packages/gen/test/preconditions.test.ts`

**Interfaces:**
- Produces: `checkPreconditions(run: RunState, stage: StageState, tpl: Template, opts: { extraPawns: number }, config: GenConfig): PreconditionId | null`. It returns the first failing id in the template's `preconditions` order, or `null` when all pass. The rules are those of docs/04 §4:
  - `spawned_pawns_placed` accepts a count up to `hi + opts.extraPawns`;
  - `deployment_squares_available` uses `floor(spawnPoints / cheapest spawnCost) + 1`;
  - `enemy_value_in_band` uses `valueBandFor`.
- `no_first_turn_mate`:
  - **Which pieces:** each deck piece alone, then each pair whose spawn costs fit `spawnPoints`. Instances are deduplicated by (type, tier) and visited in (type, tier, instanceId) order, each on every empty deployment square.
  - **Check first:** a placement's piece moves are tried on an `Int8Array` with `makeMoveTiered`. Only a move after which `inCheck(black)` holds goes on to the mate test: `legalMoves(black)` is empty. Rarity abilities come from `abilityAttacked`.
  - **No King:** the King is omitted, as in docs/04's approximation.
  - **Cost target:** ≤ 20 ms per board for the mid deck.

- [ ] **Step 1: Write the failing tests**, one fixture board per precondition: a passing board, then a board that fails exactly that id. Two of them:
  - a back-rank board (Black `Kg8`, pawns f7 g7 h7, the deck holding a rook) fails `no_first_turn_mate` through `Ra1-a8`;
  - a board that mates only with a bishop and knight pair fails it too.

  Two more tests:
  - the deck given in reversed array order returns the same result on 50 generated boards;
  - a bench-style timing assertion `< 20 ms` mean over 50 boards is excluded from CI. It goes in `packages/gen/test/bench.test.ts` and is added to `vitest.bench.config.ts`.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run the suite and the bench.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(gen): the seven generation preconditions with a check-first turn-1 mate test (G5)`.

### Task 12: The pipeline with an injected solver (G0–G8), and the 1,000-stage CI run

**Files:**
- Create: `packages/gen/src/generate.ts`, `packages/gen/test/generate.test.ts`, `packages/gen/test/bulk.test.ts`
- Modify: `packages/gen/src/index.ts`, `packages/gen/test/helpers.ts`

**Interfaces:**
- Consumes: everything from Tasks 9–11.
- Produces:
  - `type SolveFn = (run: RunState, stage: StageState, config: GenConfig) => SolveResult`, where `SolveResult` is the spec's §5.3 `solveStage` return type (`win`, `stats`), defined in `types.ts`.
  - `generateWith(input: GenInput, content: GenContent, config: GenConfig, solve: SolveFn): { stage: StageState; provenance: Provenance }`.
  - `generateStage(input, content, config)` = `generateWith(…, solveStage)`. Until Task 16, `solveStage` is a stub returning `{ win: null, stats: zeros }`.
  - The test helper `deckRun(name: 'starter' | 'mid' | 'strong', actIndex: number, stageIndex: number): RunState`, which loads `content/examples/run-*.yaml`.

  The algorithm, as one code block because the step order is the spec's contract:

```ts
const stageSeed = String(hash(run.seed, actIndex, stageIndex));          // G0
const tier = stageIndex === 2 ? 'boss' : 'normal';
let attempts = 0; let last: { stage; tpl; board } | null = null;
for (const tpl of selectTemplates(templates, act, tier, stageSeed, previousTemplateId)) {   // G1
  const mateIn = drawPar(tpl, stageSeed);                                // G3, once per stage
  const passed: StageState[] = [];
  for (let a = 0; a < maxRegenerations && passed.length < maxBoards; a++) {
    attempts++;
    const enemy = enemyBoard(tpl, formations[tpl.id] ?? [], stageSeed, a, config);   // G2
    const board = enemy && placeSpawnedPawns(enemy.board, tpl, stageSeed, a, config); // G4
    if (!board) continue;
    const stage = buildStage(tpl, board, …, mateIn, config); last = { stage, … };
    if (checkPreconditions(run, stage, tpl, { extraPawns: 0 }, config) === null) passed.push(stage); // G5
  }
  if (passed.length === 0) continue;                                     // next template
  for (const s of passed) { const r = solve(run, s, config); if (r.win) return emit(s, proven); } // G6
  return emit(withBonusPawn(passed[0]) ?? passed[0], notProven);         // G7
}
return emit(last.stage, { validationFailed: true });                     // all templates failed G5
```

  - `last` also records an attempt that failed at G4: the stage built from the enemy board without spawned pawns. If `enemyBoard` returned `null` in every attempt of every template, nothing exists to emit. In that case, throw `Error('no enemy board for act <n> <tier>')`; it is a broken template.
  - `withBonusPawn` tries `bonusPawnSquares` in order. It keeps the first square for which `checkPreconditions(…, { extraPawns: 1 })` passes; with none it returns `null`, and `bonusPawn` stays `false`.
  - G8 sets `stage.provenance = { templateId, seed: stageSeed, attempts, validationFailed? }`. The returned `Provenance` adds `formationId`, `mirrored`, `proven`, `bonusPawn` and `solverNodes`; `solverNodes` is the sum of `screenNodes + deepNodes` over the boards solved.

- [ ] **Step 1: Write the failing tests** (`generate.test.ts`, with fake solvers):
  - a solver that proves the first board → `proven: true`, `bonusPawn: false`, and the stage has no extra pawn;
  - a solver that proves only the second board → the second board is emitted;
  - a solver that never proves → three solver calls, and the first board plus exactly one extra spawned pawn;
  - a synthetic template that cannot pass G5 (a value band no army reaches) as the only template → `validationFailed: true`, and `attempts === 20`;
  - the same template plus a valid one → falls through to the valid one;
  - `previousTemplateId` is avoided;
  - stream independence (spec §11): a copy of `tpl-act2-fortress` with a different `spawnedPawns.count` gives the same seed the same Black pieces, `formationId`, `mirrored` and `mateIn`;
  - the same input twice gives `JSON.stringify` equality.
- [ ] **Step 2: Write `bulk.test.ts`.** It generates 1,000 stages with a fake solver that proves the first board. The (act, stageIndex) pairs are derived from the templates present: boss → 2, normal → `i % 2`. Decks: starter for Act I, mid for Act II, strong for Act III. The strong deck is created in Task 17; until then mid stands in. Assert per stage:
  - `phase === 'deployment'`, with no White Hero Piece on the board;
  - `checkPreconditions(…) === null`;
  - every Black piece has no rarity (I13);
  - spawned pawns and `promotesTo` stay at or under the act ceiling (I14);
  - `stage.schema.json` validity;
  - a second generation is byte-identical.

  Timeout 120 s. If it takes over 60 s, profile `no_first_turn_mate` before reducing the count.
- [ ] **Step 3: Run them.** Expected: FAIL. **Step 4: Implement.** **Step 5: Run the suite.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(gen): generateStage pipeline G0-G8 with three boards, bonus pawn and fail-loud path; 1,000-stage CI run`.

## Phase D — Solver

### Task 13: Deployment candidates (§9.2)

**Files:**
- Create: `packages/gen/src/solver/deployment.ts`, `packages/gen/test/solver-deployment.test.ts`

**Interfaces:**
- Produces: `deploymentCandidates(run: RunState, stage: StageState, config: GenConfig): Placement[][]`. Every candidate includes the King.
  - **Pool:** the deck pieces with `status: 'in_deck'` and durability ≥ 1, plus the King, sorted by (type, tier, instanceId).
  - **Subsets:** type-and-tier multisets that fit `spawnPoints` (King cost included). Only maximal subsets count: no further piece fits. They are ordered by total `pieceValues` descending, then text, and capped at `maxSubsets`. Identical instances count once, and the lowest instanceIds are used.
  - **King squares:** up to `kingSquares` squares on `deploymentRanks` that are not attacked (`isAttacked`) and not on an open line to a Black rook, bishop or queen. They are spread by taking the files in the order e, d, f, c, g, b, h, a, then the lowest rank.
  - **Piece squares:** each piece's top `squaresPerPiece` empty squares. The score is `3 × (attacks on the squares around the Black king) + (legal moves into ranks 5–8) − 5 × (attacked by Black)`, computed with internals, with ties broken by square name.
  - **Combining:** for each (subset, King square) pair, interleaved round-robin, one greedy assignment first (best free square per piece in subset order), then the single-piece variants (one piece moved to its next square), up to `maxCandidates`.
  - **Filtering:** only candidates that `startStage` accepts are kept.

- [ ] **Step 1: Write the failing tests.**
  - The starter deck (2N 2B) on Act I gives ≤ 200 candidates, every one accepted by `startStage`.
  - Two identical Normal knights never yield two candidates differing only in which knight is used.
  - No King square is attacked or on an open line to a Black slider.
  - The first candidate's subset is maximal.
  - A King-only deck gives candidates with only the King (Review Focus 4).
  - The reversed deck array gives the same list.
  - The same input twice gives deep equality.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS. **Step 5: Commit** `feat(gen): solver deployment candidates — maximal subsets, safe King squares, scored piece squares`.

### Task 14: Brute-force oracle and frozen solver fixtures

**Files:**
- Create:
  - `packages/gen/test/solver/brute.ts`;
  - `packages/gen/test/solver/freeze-fixtures.ts` (a tsx script, run by hand);
  - `packages/gen/test/fixtures/solver-known.json`;
  - `packages/gen/test/solver-oracle.test.ts`.

**Interfaces:**
- Produces:
  - **`bruteMate(run: RunState, stage: StageState, placements: Placement[], maxTurns: number, opts: { bonus: boolean; pawnToRank8: boolean }, config: GenConfig): number | null`.** An exhaustive depth-first search over single-`MOVE` queues, plus Legendary-knight two-move queues when `opts.bonus`, through `startStage` and `commitQueue`. With `pawnToRank8: false`, every queue moving a pawn to rank 8 is skipped. It returns the shortest mating turn that is ≥ `minSolveTurns`.
  - **`solver-known.json`**, an array of `{ name: 'mate2' | 'mate3' | 'bonus' | 'promotion'; run: RunState; stage: StageState; placements: Placement[]; mateTurn: number; deploymentRanks: number[] }`, where `stage.mateIn = mateTurn`. `deploymentRanks` is the test-config override the fixture was frozen with; Tasks 15 and 16 solve each fixture with the same override. The fixture conditions:
    - `mate2` and `mate3`: `bruteMate` shortest = 2 or 3;
    - `bonus`: a mate ≤ `mateIn` with `bonus: true` and none with `bonus: false`;
    - `promotion`: a mate with `pawnToRank8: true` and none without.

- [ ] **Step 1: Write `freeze-fixtures.ts`.**
  - It scans stages from `generateWith` with a never-proving solver, using Act II–III templates, decks of King + 1–2 pieces (a Legendary knight deck for `bonus`), and a test config with `rules.deploymentRanks: [1, 2]`.
  - For each stage it runs `bruteMate` from the first 10 `deploymentCandidates`.
  - It writes the first stage that satisfies each fixture's condition.
  - If 2,000 stages give no `bonus` or `promotion` fixture, hand-build that position and verify it with `bruteMate`. A promotion mate needs the vanishing pawn to open a line or remove a blocker.
- [ ] **Step 2: Run it** (`npx tsx packages/gen/test/solver/freeze-fixtures.ts`). Commit the JSON.
- [ ] **Step 3: Write `solver-oracle.test.ts`.** For each fixture, `bruteMate` still returns `mateTurn` under the conditions above. This guards against fixture rot when the engine changes. Expected: PASS.
- [ ] **Step 4: Commit** `test(gen): brute-force mate oracle and four frozen solver fixtures (mate in 2/3, Legendary bonus, promotion)`.

### Task 15: Two-stage beam search with node budget (§9.3–9.4)

**Files:**
- Create: `packages/gen/src/solver/beam.ts`, `packages/gen/src/solver/index.ts`, `packages/gen/test/solver-beam.test.ts`

**Interfaces:**
- Consumes:
  - `deploymentCandidates` (Task 13);
  - `simulate`, `startStage`, `enemyMove`, `enemyClock`, `applyEnemyTurn` and `legalPlayerMoves` from the engine;
  - `evaluate`, `fromBoard` and `tiersOf` from `@checkbreaker/engine/internal`.
- Produces: `solveStage(run: RunState, stage: StageState, config: GenConfig): SolveResult`, where `SolveResult = { win: { placements: Placement[]; line: Action[][]; mateTurn: number } | null; stats: { screenNodes: number; deepNodes: number; deployments: number; enemyCalls: number; memoHits: number } }`. Replay is added in Task 16.
  - **Queues per state:**
    - for each White piece in square order, `[MOVE]` to each `legalPlayerMoves` target;
    - for a Legendary knight, also `[MOVE a→b, MOVE b→c]`, with c from `legalPlayerMoves` on the board after the first move.

    A queue that `simulate` refuses is dropped. A queue's text is `from+to` joined by `,`.
  - **Beam step:** steps 1–7 of §9.3.
    - Score = `−evaluate(fromBoard(board), config, tiersOf(board))`.
    - Position key = the sorted board text with rarity, plus `turnsUsed`, `cursor` and `fellBack`.
    - Enemy reply memo: a `Map` keyed by the position key, valid within one `solveStage` call, holding the `EnemyPick`.
    - The reply is `enemyMove(s, hash(stageSeed, turnsUsed), enemyClock(run, s, config), config)`, then `applyEnemyTurn`.
  - **Node:** each reply needed, whether computed or a memo hit, counts 1 against `nodeBudget`. Screening and deep search share the budget. When it runs out, the solve stops and returns `win: null`.
  - **Screening:** each candidate, in order, runs `min(screen.turns, mateIn)` turns at width `screen.width`; its rank is the best score reached. A win ends the solve.
  - **Deep:** the top `deep.candidates` by (score descending, candidate text) run to `mateIn` turns at width `deep.width`.
  - **Wins:** a win on a turn < `minSolveTurns` is ignored, but the state is kept.

- [ ] **Step 1: Write the failing tests.**
  - For each fixture of `solver-known.json`: `solveStage` finds a win with `mateTurn ≤ stage.mateIn`, and `mateTurn ≥ 2`.
  - The `bonus` line contains a two-action queue.
  - Replaying the `promotion` line through `commitQueue` emits `pawn_promoted`.
  - The back-rank board of Task 11 with `mateIn: 2` never returns `mateTurn: 1`.
  - `nodeBudget: 50` → `win: null`, `screenNodes + deepNodes === 50`, and identical `stats` on a second run.
  - The same input twice gives deep equality.
  - `memoHits > 0` on the `mate3` fixture.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(gen): two-stage beam solver with memoized enemy replies and deterministic node budget`.

### Task 16: Replay, wiring into G6, and the shop-proof property

**Files:**
- Create: `packages/gen/src/solver/replay.ts`, `packages/gen/test/solver-replay.test.ts`, `packages/gen/test/generate-solved.test.ts`
- Modify: `packages/gen/src/solver/index.ts` (replay before returning a win), `packages/gen/src/generate.ts` (real `solveStage`)

**Interfaces:**
- Produces: `replayLine(run: RunState, stage: StageState, win: NonNullable<SolveResult['win']>, config: GenConfig): boolean`. It runs `startStage(win.placements)`, then `commitQueue` for each queue. It is true only when the last queue ends in `status: 'won'`, `endReason: 'checkmate'`, on turn `win.mateTurn ≤ stage.mateIn`, with no earlier end. `solveStage` returns `win: null` when replay fails, and `stats` gains `replayFailures: number`, which `gen:report` counts as a solver bug.

- [ ] **Step 1: Write the failing tests.**
  - `replayLine` accepts each fixture's found line.
  - It rejects the same line with the last move's `to` changed to another legal square.
  - It rejects a line one turn longer than `mateIn`.
  - A line found with `run.coins = 0` replays as a win with `run.coins = 999` and with `run.coins = 0` (spec §1: the shop cannot spoil the proof).
  - `generate-solved.test.ts`:
    - three seeds on `tpl-act2-fortress` with the mid deck: each is proven and replays, or has `bonusPawn`; at least one is proven;
    - the same input twice gives byte-identical `StageState` and `Provenance`;
    - the mid deck in reversed array order gives a byte-identical result (Review Focus 5);
    - a King-only run on Act I gives a stage with `proven: false` and `bonusPawn: true`, or with no free square, and no throw (Review Focus 4).

  Per-test timeout: 120 s.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run the suite.** Expected: PASS. Also run `npm run bench`.
- [ ] **Step 5: Commit** `feat(gen): replay every solver line through startStage and commitQueue; generateStage uses the real solver`.

## Phase E — Report, templates, acceptance

### Task 17: `gen:report`

**Files:**
- Create:
  - `scripts/gen-report.ts`;
  - `content/examples/run-act3-strong.yaml`:
    - `actIndex: 2`;
    - King; a Legendary knight; a Unique bishop; a Rare rook; a Normal queen; a Rare knight; a Normal bishop;
    - durability at each piece's `durabilityMax`.
- Modify:
  - `package.json`: `"gen:report": "tsx scripts/gen-report.ts"`;
  - `scripts/validate-content.mjs`: add the new run fixture to the MANIFEST.

**Interfaces:**
- Consumes: `generateStage`, `loadTemplates`, `loadFormations`, `loadGenConfig`.
- Produces: the CLI `npm run gen:report -- [--stages N] [--template id] [--workers W] [--json out.json]`.
  - **Defaults:** N = 200 per template; W = `os.availableParallelism() − 1` (`worker_threads`). Results are deterministic whatever W is.
  - **Decks by act:** starter (I), `run-mid.yaml` (II), `run-act3-strong.yaml` (III). Run seed `report-<templateId>-<i>`. The (actIndex, stageIndex) pair is pinned so that template is drawn: the report passes `content.templates` filtered to that one template.
  - **Per template, it prints:**
    - the proven rate within the par;
    - the solver's median mating turn against the median par, with a `!` when they differ by more than `medianMateTurnTolerance`;
    - the bonus-pawn rate;
    - median and p95 screen nodes, deep nodes and wall time (`performance.now`, script only);
    - nodes by tier mix of the deck;
    - the precondition failure histogram;
    - replay failures;
    - the formation pool size;
    - the `validationFailed` count.
  - **Overall:** the proven rate, and PASS/FAIL against `minSolvableRate`.

- [ ] **Step 1: Run `npm run gen:report -- --stages 5 --workers 1`, then the same with `--workers 3`.** Expected: identical numbers apart from wall times.
- [ ] **Step 2: Run `npm run validate`.** Expected: PASS, with the new run fixture valid.
- [ ] **Step 3: Commit** `feat(scripts): gen:report — solvability, mating turn vs par, nodes, wall time per template`.

### Task 18: Two new templates and First Steps tuning

**Files:**
- Create:
  - `content/templates/tpl-act2-boss-citadel.yaml`: Act II boss, `mateIn: [3, 3]`, `enemyZone: [6, 7, 8]`, depth 4, army inside the Act II boss band;
  - `content/templates/tpl-act3-last-line.yaml`: Act III normal, `mateIn: [2, 3]`, `enemyZone: [6, 7, 8]`, depth 3, army inside the Act III band;
  - their `content/formations/*.json`, by re-running `npm run formations:extract` on the cached source; no download.
- Modify: `content/templates/tpl-act1-first-steps.yaml` (re-tuned), plus any template the report flags.

- [ ] **Step 1: Write both templates.** Set their armies from the compositions the Lichess pool supplies most often. Run `formations:extract` with a temporary `--report-compositions` flag that prints the top Black compositions per zone and band; remove the flag afterwards. Then run `npm run validate`.
- [ ] **Step 2: Run `npm run gen:report -- --stages 200`.**
- [ ] **Step 3: Tune First Steps,** and any template below 95 % proven or outside the median tolerance. Change only `mateIn`, `enemyArmy`, `enemyZone`, `spawnPoints` or `spawnedPawns`; widening Act I's zone to [6, 8] is allowed (spec §13). Record each change and the before/after numbers in that template's `designNote`. Repeat Step 2 until every template passes.
- [ ] **Step 4: Run the suite.** The bulk test now covers all nine (act, stage) pairs. Expected: PASS.
- [ ] **Step 5: Commit** `content: Act II boss and Act III normal templates; First Steps tuned on gen:report evidence`.

### Task 19: Acceptance run and docs

**Files:**
- Modify:
  - `docs/09-technical-architecture.md`:
    - the `gen` package and the engine `internal` entry;
    - `mix32`/`draw` and the stream list;
    - `enemyMove(stage, seed, clock, config)`, `enemyClock`, `applyEnemyTurn`;
    - the `overtime_paid` event and `Provenance`;
    - `generateStage(input, content, config)` and `solveStage`.
  - `docs/10-roadmap-and-milestones.md`: tick the M3 boxes that the evidence supports.
  - `docs/04-stage-generation-and-authoring.md`: the measured numbers.
  - `README.md`: the `gen:report` and `formations:extract` commands.

- [ ] **Step 1: Run `npm run gen:report -- --stages 1429 --json .cache/report-10k.json`** (about 10,000 stages over 7 templates) in the background. Expected:
  - overall proven ≥ 95 %;
  - every template's median mating turn within 1 of its par;
  - 0 replay failures, 0 `validationFailed`;
  - median wall time ≤ 3 s, p95 ≤ 15 s.
- [ ] **Step 2: Check the report.** If a criterion fails, do not tick its box. Record the numbers in docs/10 and stop for the user's decision.
- [ ] **Step 3: Update the docs.** Then run `npm run check:links`, `npm test`, `npm run typecheck`, `npm run validate` and `npm run bench`. Expected: all green, 0 broken links.
- [ ] **Step 4: Commit** `docs: M3 acceptance numbers, gen API in docs/09, M3 boxes ticked`.
