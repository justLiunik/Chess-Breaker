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
      `npm run validate`; rarity *effects* are logged as decision O in `docs/11`.

**Explicitly not delivered:** engine code, UI code, the full skill list.

---

## M1 — Chess Core & Turn Engine

**Delivers:** `packages/engine` — board, move generation, per-action legality, queue simulation,
sequential cost accounting, end-of-turn resolution R1–R5, stage end evaluation. No skills, no deck.

**Scope**
- Move generation for all six piece types, blocking, capture, check, checkmate, stalemate detection.
- `Action` types `MOVE` only (deploy and skills stubbed behind the same interface).
- `simulate`/`apply` split and the `CommitError` union.
- Invariants I1–I5, I11 enforced and tested.

**Acceptance criteria**
- [ ] Perft-style move-generation suite passes for standard positions (castling/en-passant excluded).
- [ ] Golden queue tests: 30 recorded queues reproduce exact states and event streams.
- [ ] Fuzz test over 10,000 random legal-shaped queues never violates I1–I5.
- [ ] Preview/execution parity property test passes.
- [ ] Zero runtime dependencies in `packages/engine`.
- [ ] Deep-frozen state in tests: no mutation anywhere.

**Risks:** deferred check validation is unusual; the temptation to "fix" it by validating mid-queue
must be resisted — that would silently delete the game's core mechanic.

---

## M2 — Deck, Durability, Deployment & Skills

**Delivers:** the three launch skills, the modifier stack, durability, deployment, the opening line.

**Scope**
- `PieceInstance` lifecycle (`in_deck` → `deployed` → `captured` | `spent`), including the
  fixed `rarity` field (null for the King).
- `DEPLOY` action with durability spend and non-destructive failure.
- Opening-line draw.
- `ACTIVATE_SKILL` with `grant_move_credit`, `set_piece_type`, `suppress_piece`.
- Duration semantics: `instant`, `this_turn`, `next_enemy_turn`.
- Final R1→R5 ordering including revert-before-mate.

**Acceptance criteria**
- [ ] Twin Step, Ascension and Lockdown behave exactly as specified in `docs/03 §5`, including every
      listed edge case, each covered by a test.
- [ ] A temporary queen never delivers checkmate (asserted by test).
- [ ] A revert that exposes the player's king is refused at commit with a named cause.
- [ ] Durability 0 → `spent` → removed at stage end, never earlier (test).
- [ ] Captured instance is permanently absent from `RunState.deck` (test).
- [ ] No skill is implemented with a special case in `engine/rules` (code review criterion).
- [ ] Ascension and repairs never change a piece's rarity; the King's rarity is always `null` (I12).

**Risks:** duration semantics creep. Any new duration requires a `docs/03` update first.

---

## M3 — Stage Generation & Solver

**Delivers:** `packages/gen` — templates, generation pipeline G0–G8, bounded solver, template health
report.

**Scope**
- 6+ templates (≥2 per act, ≥1 boss per act).
- Precondition suite + regeneration with fail-loud path.
- Solver with node/time budgets and mate-first ordering.
- `npm run gen:report` producing solvability rate, median win turn, checkmate share.

**Acceptance criteria**
- [ ] 10,000 generated stages: ≥95% solvable, 100% pass king/pre-check/material/deployment
      preconditions ([04 §9](04-stage-generation-and-authoring.md#9-test-plan-for-generation-m3-acceptance)).
- [ ] Same seed twice → byte-identical `StageState`.
- [ ] Median accepted stage generated in < 250 ms on a laptop.
- [ ] Every template reports checkmate share ≥ 20% and median win turn within ±20% of band.
- [ ] Exhausted-regeneration path terminates and falls through to another template.
- [ ] 100% of generated Stage Pieces are Normal rarity (I13).

**Risks:** solver cost. Mitigations staged in
[04 §5](04-stage-generation-and-authoring.md#5-the-solver) (cache → offline archetypes → tighter
limits). If CI generation time exceeds 10 minutes, cut to 2,000 stages and add the cached table.

---

## M4 — Run Loop, Economy & Shop

**Delivers:** coins, salvage, shop stock and purchases, deck capacity, persistence.

**Scope**
- Run advancement across 9 stages, boss flagging, no shop after the final stage.
- Payout math (checkmate full rate, domination half rate) and salvage on capture.
- Shop stock generation with pawn floor and recovery offer.
- Rarity roll on random piece offers from the act-gated pool (`docs/07 §2.1`); rarity pricing and
  effects only once decision O is made.
- Purchases: pieces, skills, skill upgrades, repairs, deck slots, rerolls, bank & skip.
- `localStorage` save/resume with version gating.

**Acceptance criteria**
- [ ] Payout matches the [05 §2](05-run-structure-and-economy.md#2-income-turns--coins) table for
      every turn/act combination (table-driven test).
- [ ] Invariant I10 holds: preview equals payout for 1,000 random plans.
- [ ] A full 9-stage run can be simulated headlessly from a seed by a scripted bot without crashing.
- [ ] Pawn floor is affordable whenever the player has ≥1 coin (test).
- [ ] Recovery offer fires exactly when non-king deck < 4 and disappears at 4 (test).
- [ ] 10,000 seeded shop visits per act, rerolls included, never offer a tier above that act's
      ceiling; no Act I visit offers Epic or higher; pawn floor and recovery offer are always Normal (I14).
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
- HUD: turns, live coin preview, focus, credits, deployments, material/threshold.
- Deployment tray with durability pips and capture telegraphing.
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
| Skills trivialize stages | High | High | Charge scarcity, action-priced deployment, solver validation, boss skills | M2, M6 |
| Death spiral unfun | Medium | High | Pawn floor, recovery offer, salvage, bank & skip | M4 |
| Solver too slow | Medium | Medium | Template narrowing, caching, offline archetypes | M3 |
| Queue builder unusable | Medium | High | Preview-first design, keyboard parity, early playtests | M5 |
| Economy untunable without telemetry | High | Medium | Headless bot as tuning harness | M4, M6 |
| Deferred-validation rule "fixed" by a contributor | Medium | Critical | Documented in `docs/02` as core, covered by tests | M1 |
| Content volume assumptions wrong | Low | Medium | Templates, not levels, scale content | M3 |
| Chess library temptation | Medium | Medium | Explicit no-external-engine decision in `docs/09` | M1 |
| Rarity power creep breaks the durability trade | Medium | High | Decision O's constraints (`docs/11`); act-gated ceilings; solver models any effect | M4, M6 |

## Dependencies

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► M6
                 └────► M4 (economy can start once durability exists)
                              └────► M5 (UI needs a playable loop)
```

M3 and M4 may proceed in parallel once M2 lands, since generation depends on the engine and shop
logic depends on durability — not on each other.
