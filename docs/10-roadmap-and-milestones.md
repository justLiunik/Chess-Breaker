# 10 — Roadmap & Milestones

Six milestones from design foundation to a playable, tunable vertical slice. Each has binary
acceptance criteria so "done" is not a matter of opinion. The skill catalogue expansion — the phase
deliberately deferred — is **M6**, not earlier.

---

## M0 — Design Foundation ✅ (this repository)

**Delivers:** `docs/00`–`11`, five JSON Schemas, `data/economy.yaml`, validated example content,
repository scaffolding.

**Acceptance criteria**
- [x] An engineer can implement the turn/stage engine from `docs/02` alone.
- [x] All seven skill categories map to primitives or are flagged as needing a new primitive class.
- [x] Every tuning constant exists in `data/economy.yaml` and nowhere else.
- [x] Example content validates against the schemas via `npm run validate`.
- [x] No unresolved `TBD` in the core rules; deferrals logged in `docs/11`.
- [x] Interaction matrix covers every pair of the six systems.
- [x] Rarity tiers, Stage vs Hero piece categories, and act-gated shop rarity are specified
      (`docs/06 §4`, `docs/07 §2.1`), with tuning in `data/economy.yaml → rarity` checked by
      `npm run validate`.
- [x] Rarity rules for pawns (stage-only, promotion), knights, bishops, rooks and queens are specified (`docs/02 §2.1–2.3`),
      with abilities as data in `pieces.yaml` and prices in `economy.yaml`; rook and queen abilities
      follow-up questions are logged as decision O in `docs/11`.
- [x] Checkmate is the only win; stage reward = base reward + unused-turn bonus + salvage (replaced
      in M3 by the par economy: base reward less overtime + par bonus + salvage); the deck is
      fixed at 8; merging (3 → 1, next tier) is specified (`docs/02 §7`, `docs/05 §2`, `docs/06 §4.5`).

**Explicitly not delivered:** engine code, UI code, the full skill list.

---

## M1 — Chess Core & Turn Engine

**Delivers:** `packages/engine` — board, move generation, per-action legality, queue simulation,
sequential cost accounting, end-of-turn resolution R1–R5, stage end evaluation. No skills, no deck,
no Deployment phase: M1 tests start from stages already in `phase: action`.

**Scope**
- Move generation for all six piece types, blocking, capture, check, checkmate, stalemate detection.
- `Action` type `MOVE` only (skills stubbed behind the same interface); `empty_queue` refused.
- Terminal outcomes of [02 §7](02-rules-framework.md#7-stage-end-evaluation): checkmate wins;
  enemy stalemate, out of turns, and no legal queue after the enemy's move (mate or stalemate) lose.
- `simulate`/`commitQueue` split and the `CommitError` union.
- Invariants I1–I5, I11 enforced and tested.
- `engine/enemy`: the enemy AI of `docs/02 §8.1` — alpha-beta with iterative deepening, transposition
  table, capture quiescence, evaluation weights from `economy.yaml`, seeded tie-break, scripted lines
  with fallback.

**Acceptance criteria**
- [x] Perft-style move-generation suite passes for standard positions (castling/en-passant excluded).
- [x] Golden queue tests: 30 recorded queues reproduce exact states and event streams.
- [x] Fuzz test over 10,000 random legal-shaped queues never violates I1–I5.
- [x] Preview/execution parity property test passes.
- [x] Zero runtime dependencies in `packages/engine`.
- [x] Enemy AI golden-position suite passes (docs/09 §9), and a depth-4 enemy move takes < 50 ms
      in Node (`npm run bench`, sparse stage-like positions).
- [x] The same depth-4 < 50 ms check in the browser on a mid-range laptop — measured in M5 on the dev
      bench page (`/#bench`, main thread, 3 warm-ups and 20 runs per position, the user's laptop,
      2026-11-17; [M5 spec](superpowers/specs/2026-11-16-m5-web-ui-design.md) §9.3). The five
      normal boards at depth 4: medians 5.0–31.0 ms, max 33 ms — **met**. The rarity boards (depth
      capped to 3 by `enemyAI.search.maxDepthWithRarity`): medians 2.0–31.5 ms, except the Legendary
      variant of `2r3k1/pp1b1ppp/2n5/8/4P3/2P2N2/1B6/R3K3` at median 50.0 ms, max 53 ms — **a gap of
      a few ms on one board**, recorded and not blocking (the cap's Node figure was ≤ 40 ms).
- [x] Deep-frozen state in tests: no mutation anywhere.

**Risks:** deferred check validation is unusual; the temptation to "fix" it by validating mid-queue
must be resisted — that would silently delete the game's core mechanic.

---

## M2 — Deck, Durability, Deployment & Skills

**Delivers:** the three launch skills, the modifier stack, durability, the Deployment phase.

**Scope**
- `PieceInstance` lifecycle (`in_deck` → `deployed` → `captured` | `spent`), including the
  fixed `rarity` field (null for the King).
- Deployment phase: `startStage` with the King and summons whose total spawn cost fits
  `spawnPoints`, all on ranks 1–4, durability spent at Start, all-or-nothing validation, and the deck
  lock (I15).
- Flat durability from `pieces.yaml` (2 for every deck piece, Legendary queen 1) and spawn costs
  per type and rarity (Legendary bishop 5); the loader exposes `rules.deploymentRanks`,
  `rules.spawnPoints` and `pieces.<type>.spawnCost`.
- `ACTIVATE_SKILL` with `grant_move_credit`, `set_piece_type`, `suppress_piece`.
- Duration semantics: `instant`, `this_turn`, `next_enemy_turn`.
- Final R1→R5 ordering including revert-before-mate.
- Rarity abilities (`leap_allies`, `add_leaper`, `add_rider`, `bonus_self_move`, `multi_capture`, `lifeline`), driven by
  `pieces.yaml`.
- Spawned pawns and promotion: pawn removed on rank 8, `promotesTo` instance added to the deck,
  summonable from the next stage.
- The no-legal-queue check after R5 widened to skills (a skill-enabled escape is a legal queue).

**Acceptance criteria**
- [x] Twin Step, Ascension and Lockdown behave exactly as specified in `docs/03 §5`, including every
      listed edge case, each covered by a test.
- [x] A temporary queen never delivers checkmate (asserted by test).
- [x] A revert that exposes the player's king is refused at commit with a named cause.
- [x] Durability 0 → `spent` → removed at stage end, never earlier (test).
- [x] `startStage` spends exactly 1 durability per summon, nothing for the King or for pieces left
      in the deck, and refuses every case in [09 §9](09-technical-architecture.md#9-testing-strategy)
      without spending anything (test).
- [x] No action or skill can bring a deck piece onto the board after Start (I15, test).
- [x] A Lockdown that leaves the enemy without a legal move is scored at R3: checkmate if in check,
      stalemate (a loss) otherwise (test).
- [x] Captured instance is permanently absent from `RunState.deck` (test).
- [x] No skill is implemented with a special case in `engine/rules` (code review criterion; verified by the final M2 review).
- [x] Ascension never changes a piece's rarity; the King's rarity is always `null` (I12; `skills.test.ts`).
- [x] Every ability row of `docs/02 §2.3` has a test: Rare bishop cannot capture on a leap and does
      not give check through an ally; Unique can; Legendary bishop moves like a queen and costs 5
      spawn points; Rare/Unique knight leap sets; Legendary knight bonus move once per turn, itself only.
- [x] Ascension suspends rarity abilities and they return after the revert, and it refuses a
      Legendary bishop as a target (`excludesRarity`, test).
- [x] Rook and queen rows of `docs/02 §2.3` each have a test, including every multi-capture rule
      (adjacency, gap, king exception, rook-after-leap single capture, one credit, salvage for both).
- [x] A Legendary knight that gives check with its first move can never capture or land on the king
      with its bonus move (test).
- [x] Lifeline fires once per queen instance and returns it at stage end with 1 durability (test).
- [x] Promotion never consumes randomness: the created piece always equals the pawn's `promotesTo` (test).

**Risks:** duration semantics creep. Any new duration requires a `docs/03` update first.

---

## M3 — Stage Generation & Solver

**Delivers:** `packages/gen` — templates, formations from Lichess puzzle data, the generation
pipeline, a two-stage beam solver, and the template health report; the par economy in the engine.
Design: [the M3 spec](superpowers/specs/2026-11-11-m3-generation-solver-design.md).

**Scope**
- 6+ templates (≥2 per act, ≥1 boss per act); each takes a `mateIn` range instead of `turnLimit`.
- Formations: Black's side of Lichess puzzle positions (CC0), filtered per template offline, 50 per
  template to start; random placement as the fallback.
- The next stage is generated as soon as a stage is cleared, from the deck after the stage-end
  chooser; up to three boards are tried, and an unproven stage gets one extra spawned pawn (the
  documented exception of [05 §5](05-run-structure-and-economy.md#5-failure-spiral-guardrails)).
- Precondition suite + regeneration with a fail-loud path for content errors only.
- Solver: two-stage beam search (deployment screening, then deep search) with **node** budgets, no
  wall-clock budget, so generation depends only on the seed and the deck.
- `npm run gen:report` producing solvability rate (mate within the par) and median mating turn.
- **Par economy** (decided 2026-11-11, docs/02 §7, docs/05 §2): `mateIn` and `overtimePaid` on
  `StageState` replace `turnLimit`; overtime is charged after R5 from the pending base reward, then
  the wallet; `out_of_coins` replaces `out_of_turns`; `Award.parBonus` replaces `turnBonus`; the
  enemy's clock is the turns left to the par, then the overtime turns the player can afford.
  `economy.yaml` gains `parBonus` and `overtimeCost` and drops `coinRate`; schemas and the
  validator follow. Data, schemas and engine change together in M3, because the current engine and
  its tests read `turnLimit` and `coinRate`.

**Acceptance criteria**
- [ ] 10,000 generated stages (`gen:report`): ≥95% proven mateable within the par, 100% pass the
      enemy-king, safe-King-square, enemy-has-moves, enemy-value and deployment preconditions
      ([04 §9](04-stage-generation-and-authoring.md#9-test-plan-for-generation-m3-acceptance)).
      **Not met.** 10,003 stages: 86.6 % proven overall. Per template: First Steps 64.8 %, Open
      Field 92.0 %, Gatehouse 74.9 %, Fortress 95.5 %, Citadel 96.7 %, Last Line 97.1 %, Redoubt
      85.1 %. Accepted gaps (user decision 2026-11-12): the Act I proven rates and the Redoubt (its
      proven rate and its 150 `validationFailed` stages). Accepted gap (user decision 2026-11-13):
      Last Line's 29 `validationFailed` stages (2 %). In every `validationFailed` stage the last of
      the 20 boards fails `no_first_turn_mate` (the strong deck mates on turn 1); the report
      records only that board. Acts I and II have none. The bonus pawn (§3) keeps every unproven
      stage playable.
- [x] Same seed and deck twice → byte-identical `StageState` (`generate-solved.test.ts`, and the
      1,000-stage `bulk.test.ts`, which generates every stage twice).
- [ ] Generation (solver included) takes a median ≤ 3 s and a p95 ≤ 15 s on a laptop; it runs in the
      background over the results screen and the shop. **Not met for three templates (First Steps
      and the Gatehouse on median and p95, Open Field on p95), measured with one worker**
      (`gen:report --workers 1 --stages 40`, 2026-11-12/13): First Steps median 12.1 s,
      p95 29.0 s; Gatehouse 9.5 s and 20.1 s; Open Field 1.8 s and 15.4 s; Fortress 1.6 s and 6.6 s;
      Citadel 0.5 s and 4.8 s; Last Line 1.7 s and 7.2 s; Redoubt 0.9 s and 4.5 s. Another process
      was using the machine, so the First Steps and Gatehouse figures (Task 18 measured p95 13.9 s
      and 15.8 s) need re-measuring on an idle machine. The cause is the unproven boards, which run
      the solver three times; it is not a separate gap from the proven rate above. **Accepted gap
      (user decision 2026-11-13)**; re-measured in the browser's generation Web Worker in M5
      (dev bench, 10 stages per template, the user's laptop, 2026-11-17), median / p95: Gatehouse
      11.0 s / 20.6 s (**misses both**); Open Field 3.8 s / 7.8 s (**misses the median**); First
      Steps 2.0 s / 5.9 s; Fortress 2.7 s / 9.9 s; Citadel 0.6 s / 6.2 s; Redoubt 2.1 s / 7.1 s;
      Last Line 0.6 s / 3.3 s (met). No stage failed. The gap stays accepted.
- [x] Every template reports a median solver mating turn within one turn of its par (10,003 stages:
      First Steps 4 vs 4, Open Field 4 vs 5, Gatehouse 3 vs 4, Fortress 3 vs 4, Citadel 3 vs 4, Last
      Line 2 vs 3, Redoubt 2 vs 2).
- [x] A turn past the par charges `overtimeCost` from the pending reward, then the wallet; a turn
      neither can pay ends the run with `out_of_coins`; a mate within the par pays `parBonus`
      (`par-economy.test.ts`).
- [x] Three unproven boards always end in a stage (first board + one spawned pawn); `validationFailed`
      is emitted only when 20 boards fail the preconditions in every template (`generate.test.ts`).
      The 179 (150 + 29) `validationFailed` stages above are exactly that path, so the mechanism holds even
      though the rate does not meet the first box.
- [x] 100% of generated enemy pieces are Normal rarity (I13); spawned pawns and their promotion
      results never exceed the act ceiling (I14) (`bulk.test.ts`, 1,000 stages).
- [x] Solver models rarity abilities and promotion; measured node counts reported per tier mix
      (`gen:report` prints them; Act II decks mix normal, rare and unique, Act III adds legendary).
- [x] Solver searches the deployment ply (bounded candidates, sound but incomplete) and prunes
      stalemate leaves; node counts reported separately for the deployment ply (`gen:report`:
      screen nodes and deep nodes).
- [x] Every solver line is replayed through `startStage` and `commitQueue` before a stage counts as
      proven (0 replay failures in 10,003 stages).

**Risks:** solver cost, above all the deployment ply (the 2026-11-10 spike solved Act II–III in
0.2–7 s but needed 200 deployment candidates and 13 s for a hard Act I board), and a thin formation
pool for narrow enemy zones. Mitigations: tune the candidate and beam parameters with
`gen:report`; widen `enemyZone` or the par range; if CI time exceeds 10 minutes, cut the CI sample.

---

## M4 — Run Loop, Economy & Shop

**Delivers:** coins, interest, salvage, shop stock and purchases, deck capacity, persistence, the
run layer `@checkbreaker/run`, and a headless bot. Design:
[M4 spec](superpowers/specs/2026-11-13-m4-run-loop-design.md) (approved 2026-11-13).

**Scope**
- Run advancement across 9 stages, boss flagging, no shop after the final stage; the run layer asks
  for each stage and is handed it (it never imports `gen`).
- Stage reward math (base reward less overtime + par bonus + **interest**) and salvage on capture.
- **Single-use skills** (2026-11-13): no charges, no upgrades, duplicates in separate slots, strictly 3
  slots, new prices; the engine's charge code goes.
- Shop stock generation (20 % skill chance in slots 3–4, piece weights N35 B35 R20 Q10) with recovery
  offer (no pawns are sold).
- Rarity roll on random piece offers from the act-gated pool and rarity pricing (`docs/07 §2.1–2.2`).
- Stage-end over-capacity chooser after a promotion (merge, sell or cut), before the shop opens.
- Purchases: pieces, skills (`status: mvp` only), repeatable repairs, rerolls (≤ 3 per visit),
  bank & skip; selling deck pieces at half their current price, never above `pricePaid`
  (`economy.services.sell`). Merging (3 → 1, free). Fixed 8-piece deck — no capacity purchases.
- The free onboarding Twin Step at stage I-3.
- Save/resume with version gating: pure serialization and a storage interface (the `localStorage`
  adapter is M5).
- `generateStage` returns the solver's solution beside the stage; the headless bot (`npm run bot`)
  plays it.

**Acceptance criteria** (the full list, with the interest, skill and save details, is the
[M4 spec §10](superpowers/specs/2026-11-13-m4-run-loop-design.md#10-acceptance-criteria-replaces-the-docs10-m4-list));
each box carries the test file or measured number that backs it (acceptance run 2026-11-16). This list
carries every §10 criterion, with the §10 sub-criteria as their own boxes below
- [x] Stage reward matches the [05 §2](05-run-structure-and-economy.md#2-income-stage-reward--turns--coins) table for
      every turn/act/tier combination, including the base-only final turn, with interest for wallets
      0–30 (table-driven test). *Evidence:* `packages/engine/test/interest.test.ts` (table-driven: every
      act, boss flag and mate turn, interest included) and `par-economy.test.ts`.
- [x] Merge: 3 identical pieces → 1 piece one tier up at full durability; refused above the act
      ceiling and for Legendary inputs; the deck never exceeds 8 outside a stage (tests). *Evidence:*
      `packages/run/test/deck.test.ts` (`mergePieces`, ceiling, Legendary inputs); the 8-piece cap
      outside a stage: `session.test.ts` (chooser) and `save.test.ts` (over-capacity decks are invalid
      outside action, the chooser and a lost run).
- [x] Recovery offer never fires because of a merge or a sale, only after pieces are lost (test).
      *Evidence:* `packages/run/test/shop.test.ts` (recovery fires only with a piece lost; selling back
      below 4 does not restore it) and `session.test.ts` (a shop after a clean win has `recovery: false`).
- [x] A sale pays `min(floor(0.5 × current price), pricePaid)` for every type × tier × act, at any
      durability; it is refused for the King and for `spent` pieces; the sold instance leaves
      `RunState.deck` (tests). *Evidence:* `packages/run/test/prices.test.ts` (`sellPrice`) and
      `deck.test.ts` (`sellPiece`: King and `spent` refused, instance leaves the deck).
- [x] Buying any offer, recovery included, and selling it back in any later act never gains coins
      (property test). *Evidence:* `packages/run/test/shop.test.ts`, "sale cap property": 1,000 seeded
      purchases, sold in the same or any later act, never pay more than `pricePaid`.
- [x] Invariant I10 holds: preview equals payout, interest included, for 1,000 random plans.
      *Evidence:* `packages/engine/test/parity.test.ts`: 1,000 random accepted queues (skills, rarity,
      R5 deck changes), `simulate` awards equal `commitQueue` awards.
- [x] `npm run bot -- --runs 20` completes with 0 crashes, 0 invariant breaches and 0 bot failures;
      losses on unproven stages and abandons at the 60-turn cap are valid outcomes. *Evidence:*
      `npm run bot -- --runs 20 --seed 7F3A-2210`: exit 0, 0 crashes, 0 invariant breaches, 0 bot
      failures, 0 abandons. 0 won, 20 lost (all `out_of_coins`, each on an unproven stage played by
      the fallback); furthest stage reached: I-1 ×2, I-2 ×4, I-3 ×6, II-1 ×7, II-2 ×1; 41 stages won
      from the solver's line. The same seed twice gives byte-identical JSON. Stages 6–9 and the win
      are covered by the stub-stage tests in `session-flow.test.ts` (9 stages, stage 9 → `won`). No
      minimum win count is required (spec §10): the bot is not tuned.
- [x] The shop never offers a pawn (test). *Evidence:* `packages/run/test/shop-stats.test.ts`
      (10,000 visits per act: every piece offer is a deck type, never a pawn).
- [x] Recovery offer fires exactly when non-king deck < 4 and disappears at 4 (test). *Evidence:*
      `packages/run/test/shop.test.ts` ("recovery fires with a piece lost and fewer than 4 non-king
      pieces, and only then"; "recovery withdrawal").
- [x] Repairs never change a piece's rarity (I12, test). *Evidence:* `packages/run/test/deck.test.ts`
      (`repairPiece`: a Rare knight stays Rare, repeatable; King and `spent` refused).
- [x] 10,000 seeded shop visits per act, rerolls included, never offer a tier above that act's
      ceiling; no Act I visit offers Unique or higher; recovery offers are always Normal (I14); skill
      share of slots 3–4 is 20 % ± 1 %. *Evidence:* `packages/run/test/shop-stats.test.ts`.
- [x] Prices match `docs/07 §2.2` for every type × tier × act, and skill prices `docs/07 §2.3`
      (table-driven test). *Evidence:* `packages/run/test/prices.test.ts` (`piecePrice`, `skillPrice`).
- [x] Legendary queen retention: over 100,000 seeded rolls the Legendary-queen rate is 20% ± 1% of the
      un-retained rate, in shop offers and promotion results (test). *Evidence:*
      shop offers: `packages/run/test/shop-stats.test.ts` (retention); promotion results:
      `packages/gen/test/spawn.test.ts`, "promotion retention statistic" (100,000 `rollPromotion` rolls,
      |observed/unretained − 0.2| < 0.01); the rule itself: `packages/engine/test/rarity-roll.test.ts`.
- [x] Skills are consumed on commit only, never by a preview; the loadout never exceeds 3 (tests).
      *Evidence:* `packages/engine/test/skills.test.ts` ("single use": `simulate` keeps the skill, commit
      consumes it, duplicates are separate, `once_per_turn`); loadout cap: `shop.test.ts`
      (`loadout_full`) and `save.test.ts` (a loadout over the slots is invalid).
- [x] Save → reload → resume in every phase preserves the whole session exactly (coins, deck
      durability, loadout, shop stock and rerolls); unknown versions are refused. *Evidence:*
      `packages/run/test/save.test.ts` (every phase, a shop after a purchase and two rerolls,
      deep-equal and the same end; unknown versions refused); the bot round-trips after every action
      (0 breaches).
- [x] Piece types within ±1 % of 35/35/20/10 (slots 2–4) and slot 1 drawing from its three types, over
      10,000 seeded visits per act. *Evidence:* `packages/run/test/shop-stats.test.ts` (`pieceTypeWeights`
      and `slot1Types` shares, each within 0.01).
- [x] Skills are never consumed by a refused commit. *Evidence:* `packages/engine/test/skills.test.ts`,
      "a refused commit consumes nothing".
- [x] A full loadout forces a swap. *Evidence:* `packages/run/test/shop.test.ts`, "a skill needs a free
      loadout slot, or replaces the chosen entry" (`loadout_full` without a replace target).
- [x] `once_per_turn` blocks two copies in one turn; duplicates occupy separate slots. *Evidence:*
      `packages/engine/test/skills.test.ts` ("two copies cannot be used in one turn", "duplicates are
      separate") and `shop.test.ts` ("a duplicate skill becomes a second entry").
- [x] The free Twin Step arrives at I-3 only, and only with a free slot. *Evidence:*
      `packages/run/test/session.test.ts`, "the free Twin Step" (granted on entering stage 2 with a free
      slot, skipped with a full loadout, never granted twice across a reload).
- [x] Determinism: the same seed played twice by the bot gives byte-identical run logs. *Evidence:*
      two `npm run bot -- --runs 20 --seed 7F3A-2210` runs, `cmp` identical (sha256 dc38aec7…6e46f5).
- [x] Every phase of a late run (Act II–III shops, the chooser, stage 9 → `won`) is covered by run-layer
      tests fed from stub stages. *Evidence:* `packages/run/test/session-flow.test.ts` (nine stages, acts
      1,1,1,2,2,2,3,3 shops, stage 9 → `won`, chooser after stage 9) and `session.test.ts`.
- [x] `packages/run` never imports `@checkbreaker/gen`. *Evidence:* `packages/run/test/boundaries.test.ts`,
      "never imports gen, and imports content as types only".
- [x] `npm run validate`, `npm run check:links`, `npm run typecheck` and `npm test` pass. *Evidence
      (2026-11-16):* validate 30 documents, 71 checks, 6 schemas; check:links 186 links, 0 broken;
      typecheck exit 0; npm test 64 files, 760 tests.

**Risks:** economy is untunable without telemetry, and there is no telemetry by design. Mitigation:
the headless bot in M4 can serve as a tuning harness in M6; whether M6 tunes with the bot, with
estimates or with human playtests is decided in M6 (user decision 2026-11-13).
M3 carry-over (resolved in M4): `generateWith` passes `run` to the solver, and `solveStage` picks the
`byAct` layer from `run.actIndex`, not from `GenInput.actIndex`; M4 passes `{ ...run, actIndex, stageIndex }`
(`requestFor` in `packages/run/src/session.ts`, asserted in `packages/run/test/session.test.ts`; inert
until a `byAct` layer ships).

---

## M5 — Web UI Vertical Slice

**Delivers:** `apps/web` — Title, Run Map, Stage (Deployment and Action), Action Queue builder,
Chooser, Shop, Deck, Results, Codex. One complete run playable start to finish in a browser.
Design: [M5 spec](superpowers/specs/2026-11-16-m5-web-ui-design.md) (approved 2026-11-16). The user is the first playtester and plays one full
run to feel it; hints, onboarding highlights, full keyboard parity and art are M6.

**Scope**
- Board rendering (a DOM grid with an SVG overlay) with ghost preview and step-through, from the new
  engine view helpers (`threatMap`, `deploymentStatus`, `previewSteps`, `hudEconomy`): the UI computes
  no rule.
- Queue builder with click-to-append, drag-to-reorder, inline affordability, named commit errors.
- HUD: the par (`MATE IN X`) and the overtime bill, live coin preview (base + par bonus + interest),
  focus, credits, salvage.
- Deployment-phase screen: deck tray with durability pips, summon counter, capture telegraphing,
  START with its durability summary.
- `STALEMATE — YOU LOSE` preview warning with confirm.
- Shop screen per the wireframe in [07 §6](07-shop-phase.md#6-screen-layout); the recovery offer reads
  as live only while `recovery && !slots[0].sold`.
- Restart stage before the first COMMIT ([08 §6](08-progression-and-ux.md#6-commit-undo-and-honesty)).
- Planning arrows and square marks with the right mouse button ([08 §3.3](08-progression-and-ux.md#33-the-action-queue-builder)).
- Mouse-first input with shortcuts (`Space`, `Z`, `←`/`→`, `C`, `D`, `Esc`), reduced motion,
  colorblind-safe threat icons.
- A dev toggle with **skip stage** (base reward only; the run is marked DEBUG RUN), so a stage the
  solver could not prove does not end the playtest.
- Generation in one Web Worker; save/resume through `localStorage` behind `RunStorage`.
- Carry-overs: a Node-free `content` entry (M3); browser wall times for generation (M3) and the enemy
  search (M1) on the dev bench page; the M4 "before M5" items (enum exhaustiveness in `save.ts`,
  `loadSave` rebuilding from checked fields, boundary import allowlists, `replace_not_needed`).

**Acceptance criteria**
- [x] A full run can be played in the browser from the title screen to the run Results (automated
      full-run test, dev skip allowed): `apps/web/test/full-run.test.tsx`, "plays 9 stages from the
      title screen to a won run, by clicking only".
- [ ] The user completes one full run in the browser (dev skip allowed). **Not met.** The user's
      playtest (2026-11-17) found every stage very hard and did not finish a run. Findings, all
      open for design work: a promoted pawn leaves the board with no explanation in the UI; a summon
      may give check to the enemy king at START; shop prices feel too high; stages feel too hard.
      The first two are the M5.1 rule change below; prices and difficulty wait for the replay on it.
- [x] The coin preview in the HUD always equals the payout actually awarded:
      `packages/engine/test/view-preview.test.ts` (I10 property cases) and
      `apps/web/test/action.test.tsx` ("… COMMIT pays it (I10)").
- [x] Every `CommitError`, `RunError` and `SaveError` variant surfaces a distinct, cause-naming message:
      `apps/web/test/messages.test.ts`.
- [x] No rules logic exists in `apps/web` (import allowlist test + code review):
      `apps/web/test/boundaries.test.ts` and the M5 whole-branch review; its one finding (skill
      availability computed in the UI) was fixed with the engine's `skillUnavailable`.
- [x] 60 fps during queue preview on a mid-range laptop; no animation blocks input (manual check,
      recorded): the user's check on their laptop, 2026-11-17 — smooth, no stutter (subjective; no
      DevTools trace was taken).
- [x] Generation runs only in the Web Worker (`apps/web/test/boundaries.test.ts` fences `gen` to
      `state/generation.worker.ts`); its browser wall times (median, p95 per template) are recorded
      under M3 above. The Gatehouse misses both targets and Open Field the median (accepted gap).
- [x] The browser enemy-search timing (M1's open box) is measured and recorded under M1 above:
      depth 4 met on every normal board; one Legendary board at median 50.0 ms is a recorded gap.
- [x] Every M4 "before M5" item is done and tested: enum exhaustiveness in `save.ts`
      (`packages/run/test/save-enums.test.ts` plus compile-time checks), `loadSave` rebuilding from
      checked fields (`save.test.ts`, "drops unknown keys at every level"), boundary import
      allowlists (`boundaries.test.ts`), `replace_not_needed` (`shop.test.ts`, "replace with room is
      refused"), the recovery offer live only while `recovery && !slots[0].sold` (`shop.test.ts`),
      `localStorage` only behind `RunStorage` (`apps/web/test/storage.test.ts`), and the Node-free
      content entry (`packages/content/test/parse.test.ts`). Main chunk (engine + app) 124.35 kB
      gzipped, under the 250 KB target (docs/09 §10).
- [x] `npm test`, `npm run typecheck`, `npm run validate` and `npm run check:links` pass: 85 test
      files / 1,054 tests, validate 71 checks, check:links 0 broken (2026-11-17). Under parallel load
      `packages/gen/test/bulk.test.ts` can exceed its 125 s timeout (it passes alone in ~81 s).

Moved to M6 (user decisions 2026-11-16): "a full run can be completed without touching a mouse" and
"a third-party playtester completes Act I of a first run without verbal instruction".

**Risks:** the queue builder is the whole game's usability. If the preview is not instantly readable,
sacrifice features before fidelity — reduce animation, not information.
M3 carry-over: `@checkbreaker/gen` imports `solverSettingsFor`, `valueBandFor` and `enemyArmyValue`
from `@checkbreaker/content`, whose module chain imports `node:fs`/`node:url` at top level; the
generation Web Worker needs a Node-free entry for these pure helpers (addressed by the content parsers,
[M5 spec](superpowers/specs/2026-11-16-m5-web-ui-design.md) §7.2).
M3 carry-over: measure generation wall time (median and p95 per template) inside the generation Web
Worker in a browser. M3's one-worker Node figures missed the median ≤ 3 s / p95 ≤ 15 s target for
First Steps, the Gatehouse and Open Field (accepted gap, user decision 2026-11-13; see M3 above). A
browser miss is recorded as a gap and does not block M5.
About a third of the stages the M4 bot reached were unproven; a human may also meet one, which is
why the dev skip exists. It changes no rule and never appears unless the dev toggle is on.

---

## M5.1 — Chess promotion and no check at START

**Delivers:** the two rule changes from the first M5 playtest (2026-11-17), on their own branch
(`M5.1`, after M5 merges) and their own review. Design:
[M5.1 spec](superpowers/specs/2026-11-17-promotion-and-start-check-design.md) (approved 2026-11-17);
decisions in [11 S](11-open-decisions.md#s-chess-promotion-and-no-check-at-start-m51).

**Scope**
- Promotion works like chess ([02 §2.2](02-rules-framework.md#22-promotion)): on rank 8 the player
  chooses a knight, bishop, rook or queen at the pawn's rarity; the piece stays on the board and joins
  the deck at once (`pricePaid: 0`). `promotesTo` and the generation-time promotion roll are removed.
- The stage-end chooser is removed: a won stage goes straight to the shop, which refuses the next
  stage while the deck holds more than 8 pieces (`deck_over_capacity`).
- No check at START (I16, `gives_check`) and at most one summoned queen per stage
  (`deployment.maxQueenSummons`, `queen_limit`); new generation precondition `no_start_check`.
- The solver and the enemy search branch on all four promotion types; the solver's deployment
  candidates skip checks and respect the queen limit.
- Web: promotion picker (Q/R/B/N) while building the queue, `gives_check` and `queen_limit` marks in
  Deployment, the shop's deck gate, no Chooser screen. Save version bumped; older saves are refused.
- **Not in scope:** economy prices, par values, enemy strength (decision P7: tuned after the replay).

**Acceptance criteria**
- [x] Engine tests:
  - promotion to each of the four types stays on the board with the pawn's rarity and joins the deck;
  - `promotion_required` and `promotion_not_allowed`;
  - a promoted piece captured later in the stage is lost;
  - I10 holds over promotions;
  - I16 is refused at START, and `deploymentStatus` reports `gives_check`;
  - a second summoned queen is refused (`queen_limit`), and a promotion to a queen in the same stage
    is allowed.

  Evidence: `packages/engine/test/promotion.test.ts` and `packages/engine/test/deployment.test.ts`,
  which also covers a Unique bishop checking through its own pawn, and a summoned queen plus a queen
  promotion. The enemy-search bench now has a promotion position: depth-4 median about 6 ms, against
  the 50 ms bound.
- [x] Generation: 100% of stages satisfy `no_start_check`. `bulk.test.ts` asserts this for all
      1,000 stages, including `validationFailed` ones, and the 1,000-stage run passes. Spawned pawns
      are capped at rank 6 (schema plus validator), so G5 cannot miss a turn-1 promotion mate.
      `gen:report --workers 1 --stages 40` (2026-11-25) gives proven within par, median mating turn
      against par, and wall-time median / p95:

      | Template | Proven within par | Mating turn vs par | Wall median / p95 |
      |---|---|---|---|
      | Gatehouse | 40/40 | 3.0 vs 4 | 1.1 s / 8.9 s |
      | First Steps | 40/40 | 3.5 vs 4 | 0.9 s / 6.9 s |
      | Open Field | 40/40 | 4.0 vs 5 | 0.2 s / 1.0 s |
      | Citadel | 40/40 | 3.0 vs 4 | 0.8 s / 5.9 s |
      | Fortress | 39/40 | 3.0 vs 4 | 2.5 s / 9.0 s |
      | Redoubt | 33/40 | 2.0 vs 2 | 1.1 s / 7.1 s |
      | Last Line | 39/40 | 2.0 vs 3 | 1.8 s / 6.5 s |

      Overall 271/280 = 96.8%, against the 95% target. Redoubt's 5 and Last Line's 1 validation
      failures are all `no_first_turn_mate`. Every template now meets the M3 time target (median
      ≤ 3 s, p95 ≤ 15 s) in this Node run. Nothing was re-tuned (P7).
- [x] Run: no chooser phase; `deck_over_capacity` refuses the next stage at 9 and allows it at 8; a
      pre-M5.1 save is refused with the version message (`packages/run/test/session.test.ts`,
      `save.test.ts`). A 20-run bot (2026-11-25) gave 1 win and 19 losses, against M4's 0/20.
      Every loss was `out_of_coins` on a fallback stage, mostly at stage 7. The bot had 0 crashes
      and 0 invariant breaches.
- [x] Web:
  - the promotion picker appears for a move to rank 8, and the preview shows the promoted piece;
  - `gives_check` squares are marked;
  - the shop gate reads and works as described;
  - the full-run test is updated and passes.

  Evidence: `apps/web/test/action.test.tsx` (the picker, including a pawn advanced earlier in the
  queue, and the picker being modal), `deployment.test.tsx`, `screens.test.tsx` (the gate, and a real
  version-1 save under `checkbreaker.save.1`) and `full-run.test.tsx`.
- [x] Data, schemas and the validator agree. `npm test`, `typecheck`, `validate`, `check:links` and
      `build` pass: 86 files / 1,108 tests, 74 validator checks, 0 broken links, main chunk 125.37 kB
      gzip (2026-11-25).
- [ ] The user plays again and says whether the stages and the economy now feel right (the input for a
      later tuning pass).

**Risks:** queen promotions mid-stage may make stages much easier; that is the point of the replay,
not a reason to re-tune blind (P7). The no-check filter may lower the proven rate of some templates;
an unproven stage still has the bonus pawn and the dev skip.

---

## M6 — Playtest, Balance & Skill Catalogue

**Delivers:** tuned numbers, the expanded skill catalogue, boss enemy skills.

**Scope**
- The four catalogued skills of [03 §5](03-skill-framework.md) — Gallop, Phase Step, Recall,
  Bulwark — and their primitives: `override_moveset`, `ignore_blockers`, `return_to_deck`,
  `shield_piece`; each listed edge case covered by a test, and the shop stocking them once built.
- Further catalogue expansion only after those land, including the planning-effect primitive class
  flagged in [03 §4](03-skill-framework.md#4-the-seven-categories); candidates are in
  [11 A](11-open-decisions.md#a-skill-catalogue-deferred-by-request).
- Enemy skills on bosses (`enemyLoadout`).
- Balance pass driven by the headless bot plus human playtests.
- Art/audio first pass.
- From M5: full keyboard play (board focus grid, `Enter` select, `Q`/`E` reorder), hints
  ([08 §7](08-progression-and-ux.md#7-hints-and-chess-literacy)) and the one-time onboarding highlights
  ([08 §5](08-progression-and-ux.md#5-onboarding-ramp)).

**Acceptance criteria**
- [ ] At least one skill from each of categories 1–5 shipped and tested (Twin Step, Ascension,
      Lockdown and Bulwark, Gallop and Phase Step, Recall).
- [ ] Recall never refunds durability and its piece never re-enters the stage (I15); Bulwark's shield
      is respected by R3's stalemate count and by `enemyMove` alike (tests).
- [ ] Gallop and Phase Step revert at R1: neither ever mates through its override (test).
- [ ] Bosses use at least one enemy skill each, and each boss is still provably solvable (M3 suite).
- [ ] A full run can be completed without touching a mouse (moved from M5).
- [ ] A third-party playtester completes Act I of a first run without verbal instruction (moved from M5).
- [ ] Balance targets: first-run Act I clear rate ≥ 70%; Act II clear rate 30–50%; median run 25–35 min.
- [ ] No skill violates the §7 guardrail checklist (audit documented).
- [ ] Every new skill's `ruleBroken` is a single sentence naming a specific chess rule.

**Risks:** skill count inflation destroying legibility. Cap the launch catalogue at ~15 skills and
enforce "one rule at a time"; a skill that needs two sentences to explain is two skills.

---

## Cross-cutting risk register

| Risk | Likelihood | Impact | Mitigation | Milestone |
|---|---|---|---|---|
| Skills trivialize stages | High | High | Single use (2026-11-13), 3 slots, low shop rate, spawn-point budget, solver validation, boss skills | M2, M4, M6 |
| Bulwark makes a checking piece uncapturable and mates too easily | Medium | Medium | Intended edge, but bounded: single use, once per turn, solver measures it; raise its price before touching its Focus cost | M6 |
| Recall removes the sting of a bad deployment | Medium | Medium | Single use, no durability refund, no re-entry (I15) | M6 |
| Death spiral unfun | Medium | High | Spawned pawns, promotion, recovery offer, salvage, bank & skip | M4 |
| Solver too slow | Medium | Medium | Single-agent search (enemy is deterministic), memoized enemy replies, template narrowing, caching, offline archetypes | M3 |
| Enemy blind to multi-action turns looks dumb | Medium | Low | Intended (skills stay surprising); if playtests object, add a threat-awareness term for held skills | M6 |
| Queue builder unusable | Medium | High | Preview-first design, keyboard parity, early playtests | M5 |
| Economy untunable without telemetry | High | Medium | Headless bot as tuning harness | M4, M6 |
| Deferred-validation rule "fixed" by a contributor | Medium | Critical | Documented in `docs/02` as core, covered by tests | M1 |
| Content volume assumptions wrong | Low | Medium | Templates, not levels, scale content | M3 |
| Chess library temptation | Medium | Medium | Explicit no-external-engine decision in `docs/09`; Stockfish allowed only as an offline, unshipped design tool | M1 |
| Rarity power creep breaks the spawn-point trade | Medium | High | Price multipliers; Legendary bishop spawn cost 5; Legendary queen durability 1 and retention 0.2; act-gated ceilings; decision O constraints. The Legendary bishop (queen moves, durability 2, 5 points) is the likeliest outlier: measure its solver win rate first | M2, M4, M6 |
| Flat durability makes the queen the obvious buy | Medium | Medium | Spawn cost 9 (a whole Act I budget); re-check the 16-coin price now that a queen summons twice | M4, M6 |
| Legendary knight is the strongest piece per spawn point (two moves a turn for 3 points) | Medium | Medium | Kept at 3 by decision; measure its solver win rate next to the Legendary bishop's (5) and raise it only on evidence | M3, M6 |
| Legendary-heavy boards slow the enemy search: up to ~160 ms at depth 4 in Node, over the 50 ms target (tree growth up to ~4.6× nodes; per-node cost 1.3–1.9×) | Medium | Medium | Decided (2026-11-10): the search depth is capped at 3 while any player piece is Rare or higher (`enemyAI.search.maxDepthWithRarity`, docs/02 §8.1); measured ≤ 40 ms on every rarity bench board. The enemy plays a little weaker against rarity decks. Optimising the tiered search (incremental ability-aware check for Black's line moves, no full ability check in move ordering, the ability table cached in the search context) can lift the cap later | M3, M5 |
| Legendary knight / Rare+ leaps blow the solver budget | Medium | Medium | Measure in M3; cap Legendary knights per deck or tighten ability scope if needed | M3 |
| Checkmate-only stages too hard without a fallback win | Medium | High | Solver proves a mate exists; tune par ranges and enemy bands first in M6 | M3, M6 |
| Base reward + no capacity sink inflates coins | Medium | Medium | Headless-bot tuning of `baseReward` before prices; merges as the main deck-growth path | M4, M6 |
| Promotion becomes a stall strategy that out-earns mating | Medium | Medium | Spawn ranks per template; coin preview decay; a promoted piece sells for 0 (M5.1), so promotion is never a coin source; re-measure stage ease after the M5.1 replay | M4, M5.1, M6 |
| Deployment ply blows up the solver | Medium | High | Bounded candidate subsets and squares, sound-but-incomplete search, regeneration on miss; measure first | M3 |
| A multi-piece deployment mates on turn 1 | Medium | Medium | Rank-4 summons sit close to the enemy zone: `no_first_turn_mate` checks single pieces and budget-fitting pairs; widen to triples if playtests find turn-1 mates | M3, M6 |
| Flat durability 2 drains the deck too fast | Medium | High | Deliberate (unforgiving by design), but bounded: spawn points cap the drain per stage, "bring less" is a real choice, repairs, promotion; tune repair price and income, not durability, with the headless bot | M4, M6 |
| Stalemate-as-loss feels like a trap | Medium | Medium | Preview always names it before commit; tutorial stage shows it once; enemy-has-moves precondition | M5, M6 |

## Dependencies

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► M6
                 └────► M4 (economy can start once durability exists)
                              └────► M5 (UI needs a playable loop)
```

M3 and M4 may proceed in parallel once M2 lands, since generation depends on the engine and shop
logic depends on durability — not on each other.
