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
- [x] Checkmate is the only win; stage reward = base reward + unused-turn bonus + salvage; the deck is
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
- `simulate`/`apply` split and the `CommitError` union.
- Invariants I1–I5, I11 enforced and tested.
- `engine/enemy`: the enemy AI of `docs/02 §8.1` — alpha-beta with iterative deepening, transposition
  table, capture quiescence, evaluation weights from `economy.yaml`, seeded tie-break, scripted lines
  with fallback.

**Acceptance criteria**
- [ ] Perft-style move-generation suite passes for standard positions (castling/en-passant excluded).
- [ ] Golden queue tests: 30 recorded queues reproduce exact states and event streams.
- [ ] Fuzz test over 10,000 random legal-shaped queues never violates I1–I5.
- [ ] Preview/execution parity property test passes.
- [ ] Zero runtime dependencies in `packages/engine`.
- [ ] Enemy AI golden-position suite passes (docs/09 §9), and a depth-4 enemy move takes < 50 ms
      in the browser on a mid-range laptop.
- [ ] Deep-frozen state in tests: no mutation anywhere.

**Risks:** deferred check validation is unusual; the temptation to "fix" it by validating mid-queue
must be resisted — that would silently delete the game's core mechanic.

---

## M2 — Deck, Durability, Deployment & Skills

**Delivers:** the three launch skills, the modifier stack, durability, the Deployment phase.

**Scope**
- `PieceInstance` lifecycle (`in_deck` → `deployed` → `captured` | `spent`), including the
  fixed `rarity` field (null for the King).
- Deployment phase: `startStage` with the King, up to `summonLimit` summons, durability spent at
  Start, all-or-nothing validation, and the deck lock (I15).
- `ACTIVATE_SKILL` with `grant_move_credit`, `set_piece_type`, `suppress_piece`.
- Duration semantics: `instant`, `this_turn`, `next_enemy_turn`.
- Final R1→R5 ordering including revert-before-mate.
- Rarity abilities (`leap_allies`, `add_leaper`, `add_rider`, `bonus_self_move`, `multi_capture`, `lifeline`), driven by
  `pieces.yaml`.
- Spawned pawns and promotion: pawn removed on rank 8, `promotesTo` instance added to the deck,
  summonable from the next stage.
- The no-legal-queue check after R5 widened to skills (a skill-enabled escape is a legal queue).

**Acceptance criteria**
- [ ] Twin Step, Ascension and Lockdown behave exactly as specified in `docs/03 §5`, including every
      listed edge case, each covered by a test.
- [ ] A temporary queen never delivers checkmate (asserted by test).
- [ ] A revert that exposes the player's king is refused at commit with a named cause.
- [ ] Durability 0 → `spent` → removed at stage end, never earlier (test).
- [ ] `startStage` spends exactly 1 durability per summon, nothing for the King or for pieces left
      in the deck, and refuses every case in [09 §9](09-technical-architecture.md#9-testing-strategy)
      without spending anything (test).
- [ ] No action or skill can bring a deck piece onto the board after Start (I15, test).
- [ ] A Lockdown that leaves the enemy without a legal move is scored at R3: checkmate if in check,
      stalemate (a loss) otherwise (test).
- [ ] Captured instance is permanently absent from `RunState.deck` (test).
- [ ] No skill is implemented with a special case in `engine/rules` (code review criterion).
- [ ] Ascension and repairs never change a piece's rarity; the King's rarity is always `null` (I12).
- [ ] Every ability row of `docs/02 §2.3` has a test: Rare bishop cannot capture on a leap and does
      not give check through an ally; Unique can; Legendary bishop moves like a queen with
      durability 1; Rare/Unique knight leap sets; Legendary knight bonus move once per turn, itself only.
- [ ] Ascension suspends rarity abilities and they return after the revert (test).
- [ ] Rook and queen rows of `docs/02 §2.3` each have a test, including every multi-capture rule
      (adjacency, gap, king exception, rook-after-leap single capture, one credit, salvage for both).
- [ ] A Legendary knight that gives check with its first move can never capture or land on the king
      with its bonus move (test).
- [ ] Lifeline fires once per queen instance and returns it at stage end with 1 durability (test).
- [ ] Promotion never consumes randomness: the created piece always equals the pawn's `promotesTo` (test).

**Risks:** duration semantics creep. Any new duration requires a `docs/03` update first.

---

## M3 — Stage Generation & Solver

**Delivers:** `packages/gen` — templates, generation pipeline G0–G8, bounded solver, template health
report.

**Scope**
- 6+ templates (≥2 per act, ≥1 boss per act).
- Precondition suite + regeneration with fail-loud path.
- Solver with node/time budgets and mate-first ordering.
- `npm run gen:report` producing solvability rate (mate within the limit) and median mating turn.

**Acceptance criteria**
- [ ] 10,000 generated stages: ≥95% solvable, 100% pass the enemy-king, safe-King-square,
      enemy-has-moves, enemy-value and deployment preconditions ([04 §9](04-stage-generation-and-authoring.md#9-test-plan-for-generation-m3-acceptance)).
- [ ] Same seed twice → byte-identical `StageState`.
- [ ] Median accepted stage generated in < 250 ms on a laptop.
- [ ] Every template reports a median mating turn within ±20% of its band.
- [ ] Exhausted-regeneration path terminates and falls through to another template.
- [ ] 100% of generated enemy pieces are Normal rarity (I13); spawned pawns and their promotion
      results never exceed the act ceiling (I14).
- [ ] Solver models rarity abilities and promotion; measured node counts reported per tier mix.
- [ ] Solver searches the deployment ply (bounded candidates, sound but incomplete) and prunes
      stalemate leaves; node counts reported separately for the deployment ply.

**Risks:** solver cost. Mitigations staged in
[04 §5](04-stage-generation-and-authoring.md#5-the-solver) (cache → offline archetypes → tighter
limits). If CI generation time exceeds 10 minutes, cut to 2,000 stages and add the cached table.

---

## M4 — Run Loop, Economy & Shop

**Delivers:** coins, salvage, shop stock and purchases, deck capacity, persistence.

**Scope**
- Run advancement across 9 stages, boss flagging, no shop after the final stage.
- Stage reward math (base reward + unused-turn bonus) and salvage on capture.
- Shop stock generation with recovery offer (no pawns are sold).
- Rarity roll on random piece offers from the act-gated pool and rarity pricing (`docs/07 §2.1–2.2`).
- Stage-end over-capacity cut after a promotion, before the shop opens.
- Purchases: pieces, skills, skill upgrades, repairs, rerolls, bank & skip. Merging (3 → 1, free). Fixed
  8-piece deck — no capacity purchases.
- `localStorage` save/resume with version gating.

**Acceptance criteria**
- [ ] Stage reward matches the [05 §2](05-run-structure-and-economy.md#2-income-stage-reward--turns--coins) table for
      every turn/act/tier combination, including the base-only final turn (table-driven test).
- [ ] Merge: 3 identical pieces → 1 piece one tier up at full durability; refused above the act
      ceiling and for Legendary inputs; the deck never exceeds 8 outside a stage (tests).
- [ ] Recovery offer never fires because of a merge, only after pieces are lost (test).
- [ ] Invariant I10 holds: preview equals payout for 1,000 random plans.
- [ ] A full 9-stage run can be simulated headlessly from a seed by a scripted bot without crashing.
- [ ] The shop never offers a pawn (test).
- [ ] Recovery offer fires exactly when non-king deck < 4 and disappears at 4 (test).
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
- HUD: turns, live coin preview (base + turn bonus), focus, credits, salvage.
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
- Skill catalogue expansion across all seven categories, including the planning-effect primitive
  class flagged in [03 §4](03-skill-framework.md#4-the-seven-categories).
- Enemy skills on bosses (`enemyLoadout`).
- Balance pass driven by the headless bot plus human playtests.
- Art/audio first pass.

**Acceptance criteria**
- [ ] At least one skill from each of categories 1–4 and 7 shipped and tested.
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
| Skills trivialize stages | High | High | Charge scarcity, summon limit, solver validation, boss skills | M2, M6 |
| Death spiral unfun | Medium | High | Spawned pawns, promotion, recovery offer, salvage, bank & skip | M4 |
| Solver too slow | Medium | Medium | Single-agent search (enemy is deterministic), memoized enemy replies, template narrowing, caching, offline archetypes | M3 |
| Enemy blind to multi-action turns looks dumb | Medium | Low | Intended (skills stay surprising); if playtests object, add a threat-awareness term for charged skills | M6 |
| Queue builder unusable | Medium | High | Preview-first design, keyboard parity, early playtests | M5 |
| Economy untunable without telemetry | High | Medium | Headless bot as tuning harness | M4, M6 |
| Deferred-validation rule "fixed" by a contributor | Medium | Critical | Documented in `docs/02` as core, covered by tests | M1 |
| Content volume assumptions wrong | Low | Medium | Templates, not levels, scale content | M3 |
| Chess library temptation | Medium | Medium | Explicit no-external-engine decision in `docs/09`; Stockfish allowed only as an offline, unshipped design tool | M1 |
| Rarity power creep breaks the durability trade | Medium | High | Price multipliers; Legendary bishop durability 1; Legendary queen retention 0.2; act-gated ceilings; decision O constraints | M2, M4, M6 |
| Legendary knight / Rare+ leaps blow the solver budget | Medium | Medium | Measure in M3; cap Legendary knights per deck or tighten ability scope if needed | M3 |
| Checkmate-only stages too hard without a fallback win | Medium | High | Solver proves a mate exists; tune turn limits and enemy bands first in M6 | M3, M6 |
| Base reward + no capacity sink inflates coins | Medium | Medium | Headless-bot tuning of `baseReward` before prices; merges as the main deck-growth path | M4, M6 |
| Promotion becomes a stall strategy that out-earns mating | Medium | Medium | Spawn ranks per template; coin preview decay; headless-bot tuning of `tierUpChance` | M4, M6 |
| Deployment ply blows up the solver | Medium | High | Bounded candidate subsets and squares, sound-but-incomplete search, regeneration on miss; measure first | M3 |
| A multi-piece deployment mates on turn 1 | Low | Medium | `no_first_turn_mate` checks single pieces; widen to pairs if playtests find turn-1 mates | M3, M6 |
| Durability drains too fast without a free opening line | Medium | Medium | Summon limit, "bring less" as a real choice, repair price and durability tuning by the headless bot | M4, M6 |
| Stalemate-as-loss feels like a trap | Medium | Medium | Preview always names it before commit; tutorial stage shows it once; enemy-has-moves precondition | M5, M6 |

## Dependencies

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► M6
                 └────► M4 (economy can start once durability exists)
                              └────► M5 (UI needs a playable loop)
```

M3 and M4 may proceed in parallel once M2 lands, since generation depends on the engine and shop
logic depends on durability — not on each other.
