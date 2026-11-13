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
- [ ] The same depth-4 < 50 ms check in the browser on a mid-range laptop — **open until M5**, the
      first milestone with a UI; M1 measures in Node only.
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
      proven rate and its 150 `validationFailed` stages). Not met, pending the user's decision:
      Last Line's 29 `validationFailed` stages (2 %). In every `validationFailed` stage the last of
      the 20 boards fails `no_first_turn_mate` (the strong deck mates on turn 1); the report
      records only that board. Acts I and II have none. The bonus pawn (§3) keeps every unproven
      stage playable.
- [x] Same seed and deck twice → byte-identical `StageState` (`generate-solved.test.ts`, and the
      1,000-stage `bulk.test.ts`, which generates every stage twice).
- [ ] Generation (solver included) takes a median ≤ 3 s and a p95 ≤ 15 s on a laptop; it runs in the
      background over the results screen and the shop. **Not met for three templates (First Steps and the Gatehouse on median and p95, Open Field on p95), measured with
      one worker** (`gen:report --workers 1 --stages 40`, 2026-11-12/13): First Steps median 12.1 s,
      p95 29.0 s; Gatehouse 9.5 s and 20.1 s; Open Field 1.8 s and 15.4 s; Fortress 1.6 s and 6.6 s;
      Citadel 0.5 s and 4.8 s; Last Line 1.7 s and 7.2 s; Redoubt 0.9 s and 4.5 s. Another process
      was using the machine, so the First Steps and Gatehouse figures (Task 18 measured p95 13.9 s
      and 15.8 s) need re-measuring on an idle machine. The cause is the unproven boards, which run
      the solver three times; it is not a separate gap from the proven rate above. Pending the
      user's decision.
- [x] Every template reports a median solver mating turn within one turn of its par (10,003 stages:
      First Steps 4 vs 4, Open Field 4 vs 5, Gatehouse 3 vs 4, Fortress 3 vs 4, Citadel 3 vs 4, Last
      Line 2 vs 3, Redoubt 2 vs 2).
- [x] A turn past the par charges `overtimeCost` from the pending reward, then the wallet; a turn
      neither can pay ends the run with `out_of_coins`; a mate within the par pays `parBonus`
      (`par-economy.test.ts`).
- [x] Three unproven boards always end in a stage (first board + one spawned pawn); `validationFailed`
      is emitted only when 20 boards fail the preconditions in every template (`generate.test.ts`).
      The 179 `validationFailed` stages above are exactly that path, so the mechanism holds even
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

**Delivers:** coins, salvage, shop stock and purchases, deck capacity, persistence.

**Scope**
- Run advancement across 9 stages, boss flagging, no shop after the final stage.
- Stage reward math (base reward less overtime + par bonus) and salvage on capture.
- Shop stock generation with recovery offer (no pawns are sold).
- Rarity roll on random piece offers from the act-gated pool and rarity pricing (`docs/07 §2.1–2.2`).
- Stage-end over-capacity chooser after a promotion (merge, sell or cut), before the shop opens.
- Purchases: pieces, skills (`status: mvp` only), skill upgrades, repairs, rerolls, bank & skip;
  selling deck pieces at half their current price (`economy.services.sell`). Merging (3 → 1, free). Fixed
  8-piece deck — no capacity purchases.
- `localStorage` save/resume with version gating.

**Acceptance criteria**
- [ ] Stage reward matches the [05 §2](05-run-structure-and-economy.md#2-income-stage-reward--turns--coins) table for
      every turn/act/tier combination, including the base-only final turn (table-driven test).
- [ ] Merge: 3 identical pieces → 1 piece one tier up at full durability; refused above the act
      ceiling and for Legendary inputs; the deck never exceeds 8 outside a stage (tests).
- [ ] Recovery offer never fires because of a merge or a sale, only after pieces are lost (test).
- [ ] A sale pays `floor(0.5 × current price)` for every type × tier × act, at any durability; it is
      refused for the King and for `spent` pieces; the sold instance leaves `RunState.deck` (tests).
- [ ] Buying any offer, recovery included, and selling it back never gains coins (property test).
- [ ] Invariant I10 holds: preview equals payout for 1,000 random plans.
- [ ] A full 9-stage run can be simulated headlessly from a seed by a scripted bot without crashing.
- [ ] The shop never offers a pawn (test).
- [ ] Recovery offer fires exactly when non-king deck < 4 and disappears at 4 (test).
- [ ] Repairs never change a piece's rarity (I12, test).
- [ ] 10,000 seeded shop visits per act, rerolls included, never offer a tier above that act's
      ceiling; no Act I visit offers Unique or higher; recovery offers are always Normal (I14).
- [ ] Prices match `docs/07 §2.2` for every type × tier × act (table-driven test).
- [ ] Legendary queen retention: over 100,000 seeded rolls the Legendary-queen rate is 20% ± 1% of the
      un-retained rate, in shop offers and promotion results (test).
- [ ] Save → reload → resume mid-run preserves coins, deck durability, and loadout charges exactly.

**Risks:** economy is untunable without telemetry, and there is no telemetry by design. Mitigation:
the headless bot in M4 doubles as the tuning harness (see M6).

---

## M5 — Web UI Vertical Slice

**Delivers:** `apps/web` — Run Map, Stage screen, Action Queue builder, Shop, Deck, Results, Codex.
One complete run playable start to finish in a browser.

**Scope**
- Board rendering with ghost preview and step-through.
- Queue builder with reorder, inline affordability, named commit errors.
- HUD: the par (`MATE IN X`) and the overtime bill, live coin preview (base + par bonus), focus, credits, salvage.
- Deployment-phase screen: deck tray with durability pips, summon counter, capture telegraphing,
  START with its durability summary.
- `STALEMATE — YOU LOSE` preview warning with confirm.
- Shop screen per the wireframe in [07 §6](07-shop-phase.md#6-screen-layout).
- Keyboard play, reduced motion, colorblind-safe threat icons.

**Acceptance criteria**
- [ ] A full run can be completed without touching a mouse.
- [ ] The coin preview in the HUD always equals the payout actually awarded.
- [ ] Every `CommitError` variant surfaces a distinct, cause-naming message.
- [ ] No rules logic exists in `apps/web` (code review criterion; grep for legality helpers).
- [ ] 60 fps during queue preview on a mid-range laptop; no animation blocks input.
- [ ] Third-party playtester completes Act I of a first run without verbal instruction.

**Risks:** the queue builder is the whole game's usability. If the preview is not instantly readable,
sacrifice features before fidelity — reduce animation, not information.

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

**Acceptance criteria**
- [ ] At least one skill from each of categories 1–5 shipped and tested (Twin Step, Ascension,
      Lockdown and Bulwark, Gallop and Phase Step, Recall).
- [ ] Recall never refunds durability and its piece never re-enters the stage (I15); Bulwark's shield
      is respected by R3's stalemate count and by `enemyMove` alike (tests).
- [ ] Gallop and Phase Step revert at R1: neither ever mates through its override (test).
- [ ] Bosses use at least one enemy skill each, and each boss is still provably solvable (M3 suite).
- [ ] Balance targets: first-run Act I clear rate ≥ 70%; Act II clear rate 30–50%; median run 25–35 min.
- [ ] No skill violates the §7 guardrail checklist (audit documented).
- [ ] Every new skill's `ruleBroken` is a single sentence naming a specific chess rule.

**Risks:** skill count inflation destroying legibility. Cap the launch catalogue at ~15 skills and
enforce "one rule at a time"; a skill that needs two sentences to explain is two skills.

---

## Cross-cutting risk register

| Risk | Likelihood | Impact | Mitigation | Milestone |
|---|---|---|---|---|
| Skills trivialize stages | High | High | Charge scarcity, spawn-point budget, solver validation, boss skills | M2, M6 |
| Bulwark makes a checking piece uncapturable and mates too easily | Medium | Medium | Intended edge, but bounded: 2 charges, once per turn, solver measures it; cut to 1 charge before touching cost | M6 |
| Recall removes the sting of a bad deployment | Medium | Medium | 1 charge per stage, no durability refund, no re-entry (I15) | M6 |
| Death spiral unfun | Medium | High | Spawned pawns, promotion, recovery offer, salvage, bank & skip | M4 |
| Solver too slow | Medium | Medium | Single-agent search (enemy is deterministic), memoized enemy replies, template narrowing, caching, offline archetypes | M3 |
| Enemy blind to multi-action turns looks dumb | Medium | Low | Intended (skills stay surprising); if playtests object, add a threat-awareness term for charged skills | M6 |
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
| Promotion becomes a stall strategy that out-earns mating | Medium | Medium | Spawn ranks per template; coin preview decay; headless-bot tuning of `tierUpChance` | M4, M6 |
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
