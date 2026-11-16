# M4 — Run Loop, Economy & Shop: Design

Status: **approved by the user 2026-11-13** (brainstorm 2026-11-13).
Context: [docs/10 M4](../../10-roadmap-and-milestones.md#m4--run-loop-economy--shop), the economy in
[docs/05](../../05-run-structure-and-economy.md), the deck in [docs/06](../../06-deck-durability-and-permadeath.md),
the shop in [docs/07](../../07-shop-phase.md), the architecture in [docs/09](../../09-technical-architecture.md),
skills in [docs/03](../../03-skill-framework.md). M3 (generation + solver) is merged at 9d353a0.

---

## 1. Intent

M4 turns the per-stage engine (M1–M2) and the stage generator (M3) into a **whole run**: nine stages
with bosses, rewards, the shop, the deck-management actions (merge, sell, cut, repair), the
stage-end over-capacity chooser and save/resume. Everything is headless: there is no UI until M5.

Two reasons drive it:

1. **M5 needs a finished rules layer to sit on.** The UI must contain no rules (docs/09 §6), so the
   run flow itself (what happens after a mate, when the shop opens, what a reload restores) has to be
   pure, tested code before any screen exists.
2. **The run must be provably playable end to end.** With no UI, a scripted **bot** is the only way
   to drive a full run from a seed and show it never crashes or breaks an invariant.

The bot is a **test driver, not a player model** (user decision U1). The human plays the game; the
solver (M3) proves each stage. Whether the M6 balance pass tunes the economy with this bot, with
estimates or with human playtests is decided in M6, not here.

## 2. Goals, non-goals, anti-goals

**Goals**
- A pure run layer that plays a run from `newRun(seed)` to `won`/`lost`, through every stage, chooser
  and shop, with every economic rule of docs/05–07 and the rule changes of §4.
- Shop stock, prices, purchases, merge, sell, cut, repair, reroll, recovery offer, bank & skip.
- Save/resume at every point of a run, byte-exact, deterministic, version-gated.
- A headless bot (`npm run bot`) that plays whole runs from seeds without crashing.
- Docs, `data/economy.yaml`, schemas, content examples and the validator updated with every rule
  change (the project's design workflow).

**Non-goals**
- Any UI, the generation Web Worker, `localStorage` itself (M5).
- A realistic player model or economy tuning (M6). The bot plays the solver's line and a fixed,
  simple shop policy.
- The M6 skills (Gallop, Phase Step, Recall, Bulwark): only `status: mvp` skills are stocked.
- Re-measuring generation wall time (moved to M5 in M3).

**Anti-goals** (would make M4 a failure even if it "works")
- Any rule in the bot or in a future UI: the bot only chooses among actions the run layer offers and
  validates.
- Any non-determinism: the same seed and the same action sequence must give the same run, byte for
  byte, before and after a save/reload.
- A reload that changes an outcome (save-scumming a reroll, a shop roll or an enemy move).
- `packages/run` importing `@checkbreaker/gen` (the main thread never imports gen, docs/09 §2).

## 3. Constraints

- Engine purity and totality (docs/09 §4): no I/O, no `Math.random`, no `Date.now`; typed errors, never
  throws on player-shaped input. `packages/run` follows the same contract.
- Every tuning number lives in `data/economy.yaml` (single source of truth); new rules get a
  validator check proven to fail on broken data.
- Zero runtime dependencies in `engine` and `run`.
- Generation is expensive (seconds to tens of seconds per stage, M3) and runs off the main thread in
  M5, so the run layer never generates: it asks for a stage and is handed one.
- M3 carry-over: when the run wires generation, the solver's `byAct` layer is read from
  `run.actIndex`, so the generation request carries `{ ...run, actIndex, stageIndex }` of the stage
  being generated.

## 4. Decisions

### 4.1 User decisions (this brainstorm)

| # | Decision |
|---|---|
| U1 | The M4 bot is a test driver for the run loop (follows the solver's line, simple shop rules). A player model, and whether the bot is used for tuning at all, is decided in M6. |
| U2 | **Repair is a repeatable service.** Reroll is always a button, never a slot. Slot 5 is always Repair: each purchase is +1 durability on one chosen piece for 4 coins, repeatable while a piece is damaged and coins suffice; with no damaged piece the card is shown disabled. |
| U3 | **Interest (savings).** On a won stage the player earns `min(5, floor(wallet / 5))` extra coins (1 coin per 5 in the wallet, at most 5, reached at 25). |
| U4 | Interest reads the wallet **at the mate, before the stage's reward is added**: after the overtime taken from the wallet and after the salvage earned during the stage. It is shown in the coin preview (I10). |
| U5 | Shop odds: **slots 3–4 are a skill 20 % of the time each** (pieces much commoner than skills); piece types weighted **Knight 35 · Bishop 35 · Rook 20 · Queen 10** (the promotion weights); slot 1 draws Knight/Bishop/Rook only with the same weights. |
| U6 | **Strict 3 skill slots.** The "one additional slot may be purchasable later" line in docs/03 §8 is removed. |
| U7 | **Skills are single-use consumables.** Every skill bought occupies exactly one of the 3 slots; a duplicate is a separate item in another slot (no stacking, no charges, no upgrades — the upgrade concept and any upgrade limit are removed); a skill is consumed when it is used. |
| U8 | A skill is consumed when the turn that uses it is **committed**; a preview (`simulate`) or a refused commit consumes nothing. |
| U9 | `once_per_turn` still holds per skill id: two copies of the same skill cannot be used in one turn. Focus (3 per turn, skill costs unchanged) stays. |
| U10 | New Act I skill prices: **Lockdown, Gallop, Bulwark 3 · Twin Step, Ascension, Recall 4 · Phase Step 5** (act inflation on top, as before). |
| U11 | The onboarding Twin Step (docs/08 §5) is **one free Twin Step** granted when stage I-3 starts, only if a slot is free; otherwise it is skipped. |
| U12 | Reroll: at most **3 per visit** (first free, then 2 coins); it redraws slots 1–4 **including sold slots**, keeps an unsold recovery offer, never touches slot 5. |
| U13 | Save/resume as in §8: the save holds the phase, the stage, the shop and the generated next stage; autosave after every state change; no reload can change an outcome; unknown versions refused. M4 ships pure serialize/load functions and a storage interface; the `localStorage` adapter is M5. |
| U14 | **Approach A** (§5): a new package `@checkbreaker/run`. |
| U15 | **A sale never pays more than the piece cost.** Shop-bought pieces store `pricePaid`; sell price = `min(floor(0.5 × current price), pricePaid)`. Starter, promotion and merge pieces have no `pricePaid` and are not capped. Closes the gap where a recovery piece bought at 4 in Act I sold for 5 (Act II or III). |

### 4.2 Decisions already in the docs that M4 implements unchanged

Run shape (3 acts × 3 stages, boss = stage 3, no shop after stage 9, any loss ends the run); the par
economy and overtime (docs/05 §2); salvage; price formula with rarity multiplier and 20 %/act
inflation; act-gated rarity pools, hard ceilings, Legendary-queen retention 0.2; recovery offer
(pieces lost in the stage just cleared and non-king deck < 4 → slot 1 is a Normal knight or bishop at
50 %); selling at `floor(0.5 × current price)`, never the King or a `spent` piece; merging 3 → 1
(same type and tier, all `in_deck` with durability ≥ 1, result one tier up at full durability,
capped at the act ceiling, no Legendary inputs, free); fixed 8-piece capacity; no pawns sold;
loadout full + new skill → forced swap, the displaced skill is lost; the next stage is generated
from the deck after the chooser and shown in the shop without its par; nothing is re-checked after
the shop.

## 5. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| **A** | New package `@checkbreaker/run` (imports `engine` + `content`, never `gen`) for the run state machine, shop, deck management and save. Engine gets only stage-rule changes. Bot in `scripts/`. | One more package; clean boundaries, M5 consumes it as-is, bot and UI share one flow. | **Chosen (U14)** |
| B | Shop/merge/sell as engine functions; run orchestration written in M5's web app. | No new package, but the engine grows non-board rules and the run flow would live in the UI (violates "no rule in the UI"); the bot would duplicate a flow M5 writes again. | Rejected |
| C | Run layer inside `gen`. | The main thread may never import `gen`. | Ruled out |

## 6. Rule changes (docs, data, schemas, validator)

### 6.1 Interest (U3, U4)

```
interest = min(interest.max, floor(walletAtMate / interest.per) × interest.coins)
stage pays = max(0, baseReward − overtimePaid) + (turnsUsed ≤ mateIn ? parBonus : 0) + interest + salvage
```

`walletAtMate` is `run.coins` at R3 of the mating turn, before the award is added: it already
contains this stage's salvage and is already reduced by any overtime paid from the wallet. Interest
is the same in every act and on bosses (not boss-scaled), and is paid on stage 9 too.

`data/economy.yaml → economy.interest: { per: 5, coins: 1, max: 5 }`. Validator: all positive
integers.

### 6.2 Skills become consumables (U6–U10)

- A loadout entry is `{ skillId }` only; `charges` and `chargesMax` disappear from `RunState`,
  `run.schema.json`, `skills.yaml` and `SkillDef`. The loadout holds at most `skills.loadoutSlots`
  (3) entries and may hold duplicates.
- Using a skill removes **one** entry with that `skillId` from the loadout (the first in loadout
  order). In the engine this happens where `applySkill` spends a charge today, inside the queue's
  resolved `run`, so it lands only when `commitQueue`'s result is kept; `simulate`'s result is a
  preview and is discarded (U8).
- `skill_unavailable.reason: 'no_charges'` is removed; a skill not in the loadout is
  `not_in_loadout`.
- `once_per_turn` and `distinct_targets` keep reading `skillLog` by `skillId` (so two Lockdowns
  in one stage still need distinct targets).
- `startStage` no longer refills charges.
- `hasLegalQueue` enumerates distinct skill ids in the loadout (duplicates add nothing within one
  turn because of `once_per_turn`).
- The solver uses no skills, so M3 proofs are unaffected.
- `data/economy.yaml → skills`: remove `chargesRefreshPerStage` and `duplicatePurchase`; keep
  `loadoutSlots: 3`; add `consumable: true` (documentary). Prices in `skills.yaml` per U10.
- Validator: no `charges` key on any skill; `loadoutSlots` = 3; run examples have ≤ 3 loadout
  entries and no charge fields.
- docs/03: §2 field table, §6 balance frame (charges and price rationale rewritten for single use),
  §8 acquisition (consumable, strict 3 slots, no upgrades); docs/07 §2/§2.3/§4/§7 (no "Skill upgrade",
  duplicate = separate item); docs/08 HUD and onboarding (no charge pips; one free Twin Step at I-3).

### 6.3 Shop stock and services (U2, U5, U12)

New `data/economy.yaml → economy.shop` keys: `skillChance: 0.2`,
`pieceTypeWeights: { knight: 35, bishop: 35, rook: 20, queen: 10 }`,
`slot1Types: [knight, bishop, rook]`. `services.maxRerollsPerVisit: 3` (already present) is
written into docs/07. docs/07 §2 slot 5 becomes "Repair (service, repeatable)"; §4 "Reroll slots 1–5"
becomes "slots 1–4".

### 6.3b Sale cap (U15)

`PieceInstance` gains optional `pricePaid: number` (set on every shop purchase, recovery included,
to the coins actually paid; absent on starter, promotion and merge pieces). `run.schema.json` adds it
(integer ≥ 0, optional). docs/05 §3 services table and docs/07 §4 state the cap. Validator: the
existing `sell.priceFactor ≤ recoveryDiscount` check stays; a run example carries one `pricePaid`.

### 6.4 Free onboarding skill (U11)

`data/economy.yaml → onboarding.freeSkill: { stageNumber: 2, skillId: twin_step }` (stage number
0–8 = `actIndex × 3 + stageIndex`; 2 = stage I-3). Granted when that stage's Deployment phase begins,
if the loadout has a free slot.

### 6.5 Docs touched

docs/02 §7 (reward formula), docs/03 (§6.2 above), docs/05 §2 (formula, interest table, a line in
§5 guardrails on banking), §4 illustrative run re-computed with interest and new skill prices, §7
knobs; docs/06 §3 (`pricePaid` on `PieceInstance`), §10 (sale cap); docs/07 (§2, §2.3, §4, §5 banking now earns interest, §6
wireframe charges → none, §7 edge cases); docs/08 §3.1 (coin preview shows interest), §5;
docs/09 §2 (new package and boundary), §3 (types), §4 (`Award.interest`, `no_charges` gone),
§5 (shop seed streams), §6 (module table), §8 (save format), §11 (`npm run bot`); docs/10 M4 scope and
acceptance (§10 below); docs/11 E (tuning harness wording).

## 7. Engine changes (`packages/engine`)

- `Award = { coins; base; parBonus; interest }` — `coins = base + parBonus + interest`. Computed in
  `simulate` from the run after the queue (salvage included), so preview equals payout (I10).
- Consumable skills (§6.2).
- `EngineConfig.economy` gains `interest`. Shop, services, rarity pools and onboarding are **not**
  engine config: they go to a `RunConfig` loaded by `content` (`loadRunConfig() = EngineConfig &
  { run: … }`), so the engine stays board-only.
- `rollRarity` and the retention step move here from `gen` (§8.4); `gen` re-imports them.
- No other engine API changes. `endStage` keeps returning `overCapacity`; the chooser is the run
  layer's.

## 8. The run layer (`packages/run`, `@checkbreaker/run`)

Imports `@checkbreaker/engine` at runtime and **only types** from `@checkbreaker/content`
(`content` reads files with `node:fs` and the `yaml` package, which the browser cannot load; the
M3 carry-over for M5 already notes this for gen). Every run-layer function takes its config as a
parameter (`RunConfig`); `loadRunConfig()` lives in `content` and is called by the bot, the tests and,
in M5, whatever Node-free config path M5 builds. Zero runtime dependencies. A boundary test (like
`engine/test/boundaries.test.ts`) fails if `run` imports `gen`, or imports `content` other than as
`import type`. *(Builder-check call.)*

### 8.1 Session and phases

```ts
type RunPhase = 'awaiting_stage' | 'deployment' | 'action' | 'chooser' | 'shop' | 'ended';

interface RunSession {
  version: 1;
  run: RunState;                    // actIndex/stageIndex = the stage being played or just cleared
  phase: RunPhase;
  stage: StageState | null;         // the stage being played (deployment/action), else null
  stageStartCoins: number | null;   // wallet at Deployment, for the history record
  chooser: { overCapacity: number } | null;
  shop: ShopState | null;
  next: { request: GenRequest; stage: StageState | null } | null;   // the stage being generated
  outcome: { result: 'won' | 'lost'; endReason?: EndReason | 'abandoned' } | null;
}

type GenRequest = { run: RunState; actIndex: number; stageIndex: number; previousTemplateId?: string };
```

`GenRequest` has the same shape as gen's `GenInput`, and `request.run` is
`{ ...run, actIndex, stageIndex }` of the stage to generate (M3 carry-over). The caller (bot now,
Web Worker in M5) runs `generateStage(request, …)` and hands the stage back with `provideStage`.

### 8.2 Flow

```
newRun(seed) ─► awaiting_stage ─provideStage─► deployment ─start─► action ─commit…─┐
                                                                                   │
       ┌──────── lost (any endReason) ◄────────────────────────────────────────────┤
       ▼                                                                           │ won
     ended ◄── stage 9 won ◄── chooser (only if overCapacity > 0) ◄── endStage ◄───┘
                                     │ resolved (stages 1–8)
                                     ▼
              next = request for the next stage; phase = shop (shop opens at once)
                                     │ leave
                                     ▼
          next.stage ready ? deployment (run advanced to the next stage) : awaiting_stage
```

- `newRun(seed, config)`: starter deck from `deck.starterDeck` (deterministic ids `p_king_01`,
  `p_knight_02` … as in `run-starter.yaml`), `coins = starterCoins`, empty loadout, and
  `next.request` for stage 0.
- `provideStage(session, stage)`: accepted only if `stage.stageSeed` matches the request's seed
  (`hash(runSeed, act, stage)`), else a typed error. In the shop it fills `next.stage` without
  changing phase.
- Entering a stage's Deployment: `run.actIndex/stageIndex` advance to it, `stageStartCoins` is set,
  and the free skill of §6.4 is granted if due.
- After a commit that ends the stage: a loss ends the run (`outcome.result = 'lost'`, history
  record, phase `ended`). A win runs `endStage`, writes the history record, then opens the chooser
  if `overCapacity > 0`, otherwise goes straight on (stage 9 → `ended`, `won`; else the shop).
- The history record: `coinsEarned` = coins at the win − `stageStartCoins` + coins paid from the
  wallet for overtime (i.e. everything the stage paid, salvage and interest included); `piecesLost` =
  instances captured (not lifeline-saved) plus instances removed as `spent` by `endStage`.
- `abandon(session)`: allowed in any non-ended phase; `lost` with `endReason: 'abandoned'`.

### 8.3 Actions (all return `Result<{ session; events }, RunError>`)

| Phase | Action | Rules |
|---|---|---|
| deployment | `start(placements)` | Delegates to `startStage`. |
| action | `commit(queue)` | Delegates to `commitQueue`; on a finished stage, runs §8.2. |
| chooser, shop | `merge(instanceIds[3])` | docs/06 §4.5; ceiling = the act of the stage just cleared; new instance `origin: 'merge'`. |
| chooser, shop | `sell(instanceId)` | `min(floor(priceFactor × price(type, rarity, act)), pricePaid ?? ∞)`, act = stage just cleared (U15); refused for the King and `spent`. |
| chooser, shop | `cut(instanceId)` | Removes the piece for nothing; refused for the King. |
| chooser | (automatic) | When the non-king deck fits, the chooser closes and the flow continues. |
| shop | `buy(slot, opts?)` | Piece: needs a free deck slot (else `deck_full`; the caller sells, cuts or merges first). Skill: needs a free loadout slot, or `opts.replace` naming a loadout index to discard. |
| shop | `repair(instanceId)` | 4 coins; `in_deck`, `1 ≤ durability < durabilityMax`; repeatable (U2). |
| shop | `reroll()` | U12. |
| shop | `leave()` | Bank & skip is simply leaving with coins unspent. |
| any non-ended | `abandon()` | §8.2. |

Every refusal is a typed `RunError` (`wrong_phase`, `insufficient_coins`, `deck_full`,
`loadout_full`, `slot_sold`, `not_damaged`, `cannot_sell`, `merge_invalid { reason }`,
`rerolls_exhausted`, `stage_mismatch`, plus wrapped engine `CommitError`s). Nothing is partially
applied.

### 8.4 Shop

```ts
interface ShopState {
  act: 1 | 2 | 3;                 // the act of the stage just cleared: prices and pool
  rerollsUsed: number;
  recovery: boolean;              // decided on entry, never re-evaluated
  slots: (Offer & { sold: boolean })[];   // slots 1–4; slot 5 (repair) is implicit
}
type Offer =
  | { kind: 'piece'; pieceType: DeckType; rarity: Rarity; price: number; recovery?: true }
  | { kind: 'skill'; skillId: string; price: number };
```

Stock generation, per roll `r` (0 on entry, +1 per reroll), all draws from named streams so that
adding a draw never shifts another (as gen does, docs/09 §5):
`u = draw(runSeed, 'shop', stageNumber, r, slot, field)`.

1. **Slot 1:** the recovery offer if `recovery` (and on a reroll, if it is still unsold): a Normal
   knight or bishop (weights 35:35) at `round(price × recoveryDiscount)`. Otherwise a piece from
   `slot1Types` with `pieceTypeWeights`.
2. **Slot 2:** a piece from all four types.
3. **Slots 3–4:** a skill with probability `skillChance`, chosen uniformly among `status: mvp` skills
   not already in this roll's stock; if none is left, a piece.
4. **Rarity** of every random piece: rolled after its type from `rarity.pool[act]`, then retention
   (Legendary queen kept with p = 0.2, else Unique). Never above the ceiling (I14).
5. **Prices:** `round(basePrice × rarityMultiplier × (1 + 0.20 × (act − 1)))`; skills
   `round(price × inflation)`.

The rarity roll and retention are the same functions gen uses (`rollRarity` and the retention step
of `rollPromotion`); they **move to `engine`** (pure, data-driven, taking the pool and retention as
arguments) so both `gen` and `run` import them. *(Builder-check call.)*

**Recovery** is decided on entry: the last history record's `piecesLost ≥ 1` and the non-king deck
after the chooser `< recoveryDeckThreshold`. Merges and sales never create it. Within the visit an
unsold recovery offer **disappears as soon as the non-king deck reaches the threshold** (docs/07 §3:
"the offer disappears as soon as the deck is back to 4 pieces"), e.g. after buying slot 2; its slot is
then empty (treated as sold) and a later reroll draws slot 1 normally. Selling back below 4 does not
bring it back. `ShopState.recovery` therefore means "fired on entry and still live". *(Builder-check
call, reading docs/07 §3.)*

**Instance ids** are deterministic: shop purchases `p_` + hex of
`hash(runSeed, 'buy', stageNumber, r, slot)`, merges `p_` + hex of `hash(runSeed, 'merge', ...sortedInputIds)` (input ids sorted first),
matching the promotion scheme already in `queue.ts` and the schema pattern `^p_[a-z0-9_]+$`.

### 8.5 Save and resume

- `serializeSave(session): string` (JSON `{ version, savedAt?, session }`) and
  `loadSave(text, config): Result<RunSession, SaveError>`. `savedAt` is supplied by the caller (the
  run layer never reads a clock). `loadSave` refuses an unknown or future `version` with a clear
  message, and validates the session shape and invariants (one King, deck ≤ 8 outside a stage
  or chooser, loadout ≤ 3, phase/fields consistent).
- `RunStorage` interface (`read(): string | null; write(text): void; clear(): void`) with an in-memory
  implementation for tests and the bot; the `localStorage` adapter is M5.
- Autosave points (the caller saves after each): every run-layer action, `provideStage`, and
  `start`/`commit`. Everything random derives from the seed and the session (including `rerollsUsed`),
  so reload-and-retry gives the same result.
- A generated stage is stored in `next.stage`, so resume never waits for the solver. If the save
  happened before generation finished, the caller regenerates from `next.request` (deterministic).
- `RunState.rngCursor` is unused since M3's named streams; it stays in the type and schema (always
  0) to avoid churn. `RunState.version` stays 1: no save has ever been written.

## 9. Generation hook and the bot

### 9.1 `gen` returns the solution

`generateStage` / `generateWith` return `{ stage, provenance, solution }` where `solution` is the
solver's win (`{ placements, line, mateTurn }`) or `null` (bonus-pawn and `validationFailed`
stages). It never goes into `StageState`, the player never sees it, and the bot uses it so it does
not solve twice.

### 9.2 The bot (`scripts/run-bot.ts`, `npm run bot -- --runs N [--seed S] [--json out.json]`)

- **Stage with a solution:** `start(solution.placements)`, then commits `solution.line` turn by turn.
  The enemy is deterministic and the line was replayed through the engine at generation, so it must
  reproduce exactly; any mismatch is reported as a bot failure.
- **Stage without a solution, or a solution broken by the shop:** a fallback that cannot loop
  forever: deploy the King plus the cheapest affordable summons; each turn commit a mating move if one
  exists, else the first legal single move in a fixed order (pieces by square index, targets by square
  index). Overtime drains coins, so the stage ends (`out_of_coins` at worst); a hard cap of 60 turns
  abandons the run and is reported.
- **Chooser:** merge if possible, else sell the lowest-priced sellable piece.
- **Shop** (fixed order, repeat until nothing applies, then `leave`): merge any triple; repair the
  most damaged piece while coins ≥ 4; buy the cheapest affordable piece if the deck has room; buy
  the cheapest affordable skill if a loadout slot is free. The bot never sells, cuts or merges a piece
  named in the pending solution's placements, so its own shopping does not break its next stage.
  One free reroll per visit when nothing is affordable.
- Output per run: seed, outcome, stage reached, endReason, coins and deck size after every stage, bot
  failures. Exit code non-zero on any crash, invariant breach or bot failure.

## 10. Acceptance criteria (replaces the docs/10 M4 list)

- [ ] Stage reward matches the docs/05 §2 table for every turn × act × tier, including the base-only
      final turn, **with interest** for wallets 0–30 (table-driven test).
- [ ] Interest = `min(5, floor(walletAtMate / 5))`, wallet measured after salvage and wallet overtime,
      before the award; I10 (preview equals payout) holds for 1,000 random plans.
- [ ] Merge: 3 identical pieces → 1 one tier up at full durability; refused above the act ceiling and
      for Legendary inputs; the deck never exceeds 8 outside a stage and the chooser (tests).
- [ ] Recovery offer fires exactly when pieces were lost in the stage and the non-king deck < 4, and
      disappears at 4; never because of a merge or a sale; always Normal (tests).
- [ ] A sale pays `min(floor(0.5 × current price), pricePaid)` for every type × tier × act, at any
      durability; refused for the King and `spent` pieces; the instance leaves `RunState.deck` (tests).
- [ ] Buying any piece offer, recovery included, and selling it back **in any later act** never gains
      coins (property test).
- [ ] Repair: +1, never above max, never on `spent`, never changes rarity (I12), repeatable (tests).
- [ ] Prices match docs/07 §2.2 for every type × tier × act, and the new skill prices × act
      (table-driven).
- [ ] 10,000 seeded shop visits per act, rerolls included: never a pawn; never above the act ceiling;
      no Act I offer Unique or higher; skill share of slots 3–4 within 20 % ± 1 %; piece types within
      ±1 % of 35/35/20/10 (slot 1: 3 types).
- [ ] Legendary-queen retention: over 100,000 seeded rolls the Legendary-queen rate is 20 % ± 1 % of
      the un-retained rate, in shop offers and promotion results.
- [ ] Skills: consumed on commit, never by `simulate` or a refused commit; duplicates occupy separate
      slots; the loadout never exceeds 3; a full loadout forces a swap; `once_per_turn` blocks two
      copies in one turn; the free Twin Step arrives at I-3 only with a free slot (tests).
- [ ] Save → reload → resume in every phase (deployment, action, chooser, shop mid-visit after
      purchases and rerolls, awaiting_stage) gives a session deep-equal to the uninterrupted one, and
      the rest of the run identical; an unknown version is refused.
- [ ] Determinism: the same seed played twice by the bot gives byte-identical run logs.
- [ ] `npm run bot -- --runs 20` completes with 0 crashes, 0 invariant breaches and 0 bot failures
      (the docs/10 criterion: "without crashing"). Runs that lose on an unproven stage, or are
      abandoned at the 60-turn cap, are valid outcomes, not failures; the report counts how far each
      run got. No minimum win count is required, because the bot is not tuned (U1) and Act I proven
      rates are an accepted M3 gap. *(Builder-check call.)*
- [ ] Every phase of a late run (Act II–III shops, the chooser, stage 9 → `won`) is covered by run-layer
      tests that feed stages from a stub generator or recorded fixtures, so coverage does not depend
      on the bot winning. *(Builder-check call.)*
- [ ] `packages/run` never imports `@checkbreaker/gen` (boundary test).
- [ ] `npm run validate`, `npm run check:links`, `npm run typecheck` and `npm test` pass.

## 11. Left to the builder

- Module split inside `packages/run`; names of internal helpers; event names for run-level events
  (e.g. `shop_opened`, `item_bought`, `piece_sold`, `pieces_merged`, `skill_granted`, `run_ended`).
- Where `rollRarity` / retention move (engine or content), as long as `run` does not import `gen`.
- How unit tests get stages without paying for the solver (stub generator, recorded fixtures), and
  whether the 20-run bot acceptance runs in `npm test` or only as `npm run bot` (generation takes
  seconds per stage).
- Exact wording of the docs edits listed in §6.5.
