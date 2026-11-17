# 11 — Open Decisions

Decisions deliberately **not** made in M0. Each records the question, the options considered, the
current default, and the trigger that forces a decision. Nothing here blocks implementation of
M1–M5.

---

## A. Skill catalogue (deferred by request)

**Question:** what is the full set of skills?
**Partly decided (M2 design):** seven skills are catalogued with their numbers — the launch three
(Twin Step, Ascension, Lockdown; built in M2) and Gallop, Phase Step, Recall and Bulwark (`future`,
built in M6) — single-use since 2026-11-13, with Act I prices of 3–5 coins ([03 §5](03-skill-framework.md),
[07 §2.3](07-shop-phase.md#23-skill-prices)).
**Candidates, not catalogued:** *Shove* (push an adjacent enemy one square; `displace_piece`),
*Foresight* (preview the enemy's reply; needs the planning primitive class), *Surge* (+2 Focus,
0 cost; the first use of `grant_focus`). Rejected: any post-commit undo, any king freeze.
**Still open:** whether the catalogue grows past seven, and which candidate fills categories 6–7.
**Trigger:** M6 start. **Blocker for:** nothing.
**Constraint when it happens:** every skill passes the [03 §7](03-skill-framework.md#7-guardrail-checklist-for-any-new-skill)
guardrail checklist; category coverage must not regress.

---

## B. Boss enemy skills

**Question:** should bosses use the same skill system the player uses?
**Options:** (1) bosses get a 1–2 skill loadout; (2) bosses get bespoke scripted behaviors; (3) no
enemy skills, bosses are just bigger armies.
**Default:** (3) for MVP; (1) designed for M6 — the schema field `enemyPolicy.loadout` is already
reserved.
**Risk of (1):** the solver must then model enemy skills, multiplying its branching factor. If M3's
budgets are already tight, bosses should stay scripted.
**Trigger:** M6, after the M3 solver cost is measured.

---

## C. Enemy skill parity and fairness

**Question:** if enemies break rules, does "fair and provable" survive?
**Note:** this is the biggest philosophical risk in the game. A player must never lose to an enemy
skill they could not have anticipated. Any enemy skill must be **announced on the stage intro screen
and visible in the HUD at all times**, and the solver must prove the stage solvable against it.
**Decision is subordinate to pillar 4.** If parity cannot be made legible, do not ship it.

---

## D. Meta-progression / roguelite unlocks

**Question:** should anything persist across runs?
**Options:** none (pure roguelike); cosmetic/statistics only; permanent unlocks; difficulty tiers.
**Default:** none for MVP — a run is the unit of meaning. The chosen run structure is roguelike, not
roguelite.
**Trigger:** post-M6 if first-run Act I clear rate is below the 70% target and onboarding alone
cannot fix it.

---

## E. Player-selected opening line

**Decided:** the player chooses everything. The random opening line is gone; in the Deployment
phase the player places the King and summons pieces within the stage's spawn points onto squares of
their choice on ranks 1–4, before the first move, and the deck locks at Start
([02 §5](02-rules-framework.md#5-deployment)).
**Why:** choosing the army against a fully visible board makes the analysis itself the first move
of the puzzle, and removes the mid-stage "add pieces as needed" plan that made deployment reactive.
**Later decided:** the summon limit is replaced by a **spawn-point budget** (Act I 9 · Act II 12 ·
Act III 15, bosses +3; knight/bishop 3, Legendary bishop 5, rook 5, queen 9), the deployment ranks
are always ranks 1–4, and durability is flat at 2 (Legendary queen 1)
([06 §1](06-deck-durability-and-permadeath.md#1-the-piece-table)).
**Still open:** the budgets and the flat durability are provisional, to be tuned in the M6 balance pass
(bot, estimates or playtests: method decided then); `no_first_turn_mate` checks single pieces and pairs only
([04 §4](04-stage-generation-and-authoring.md#4-preconditions)).

---

## F. Playing as Black

**Question:** should some stages or acts have the player playing Black?
**Default:** player is always White ([02 §1](02-rules-framework.md#1-definitions)).
**Note:** the reserved field `StageState.playerColor` exists; the real cost is mirrored generation,
deployment ranks, and UI. No design benefit identified for MVP.
**Trigger:** after the skill catalogue exists and content variety is the bottleneck.

---

## G. Branching run map

**Question:** should the run offer a choice of next stage (elite / shop-heavy / boss-lite routes)?
**Default:** linear 3×3.
**Trade-off:** branching adds replayability and run-to-run variety but weakens "a stage is the puzzle"
by making stage selection a meta-strategy, and multiplies template validation surface.
**Trigger:** M6, if runs feel same-y after 5+ completions.

---

## H. Monetization

**Status:** **decided — none.** Checkbreaker is a personal, non-commercial project. There is no
monetization, and no monetization hooks are built into the architecture — no currency other than
coins, no timers, no ad slots.
**Constraint if this ever changes:** any model must not gate durability, repairs, or the par and overtime.
Selling durability would directly contradict pillar 2. A public or commercial release would also
reopen the Stockfish licence question ([09 §1](09-technical-architecture.md#stockfish-as-a-design-tool-offline-only))
and decision I.
**Trigger:** only if the project is ever made public or commercial.

---

## I. Working title & branding

**Question:** is "Checkbreaker" usable?
**Default:** provisional working title used throughout the docs. For a personal, non-commercial
project the name needs no clearance.
**Trigger:** only before a public release, storefront, or domain registration; then it requires a
trademark search.

---

## J. Hint economy

**Question:** are hints free, limited, or paid in coins?
**Default:** 2 free hints per stage ([08 §7](08-progression-and-ux.md#7-hints-and-chess-literacy)).
**Alternative:** hints cost coins, tying information to the economy. Rejected for MVP because it
punishes new players with the currency they most need for pieces.
**Trigger:** if playtests show hints trivialize stages.
**Schedule:** hints are built in M6, not M5 ([M5 spec](superpowers/specs/2026-11-16-m5-web-ui-design.md) U3).

---

## K. Seed sharing and daily runs

**Question:** expose the run seed for sharing and add a daily seeded run?
**Default:** seed is visible and copyable ([08 §4](08-progression-and-ux.md#4-the-run-map)) but no
sharing infrastructure.
**Note:** determinism is already a hard requirement, so this is nearly free feature-wise; it is a
retention decision, not a technical one.
**Trigger:** post-launch.

---

## L. Obstacles and terrain

**Question:** non-piece board features (walls, blocked squares, special tiles)?
**Default:** none. `StageState.board` reserves a `terrain` variant.
**Cost:** every terrain type multiplies generator preconditions and solver branching, and interacts
with deployment ranks and transform durations.
**Trigger:** M6+ only, and only if the stage templates are exhausted of variety.

---

## M. Squad-size and capacity ceiling

**Status:** deck capacity is **decided**: a fixed 8 pieces, never raised, no deck-slot purchase
([06 §2](06-deck-durability-and-permadeath.md#2-deck-capacity)). Deck growth comes from tiers and
merging instead.
**Still open:** are 3 loadout slots the right ceiling for skills?
**Default:** 3 skills.
**Trigger:** after the M6 balance pass.

---

## N. Difficulty modes

**Question:** offer an easier mode with extra turns or free repairs?
**Default:** no. The game's fairness comes from the solver guarantee, not from adjustable difficulty.
**Alternative:** a "practice" mode with hints forced on and no run death — teaches without diluting.
**Trigger:** if onboarding data shows a hard wall at Act II for new players.

---

## O. Rarity follow-ups

**Status:** the rarity system itself is decided — tiers, gating, prices, and every piece's abilities
([02 §2.1–2.3](02-rules-framework.md#23-rarity-movement-abilities),
[06 §4](06-deck-durability-and-permadeath.md#4-piece-categories-and-rarity),
[07 §2](07-shop-phase.md#2-stock-generation)). Rook and queen abilities, the former subject of this
entry, were settled as: Rare leaps allies; Unique rook steps diagonally, Unique queen gains a lifeline;
Legendary rook and queen multi-capture two connected enemies (the queen even after a leap); the
Legendary queen is 5× rarer than other Legendary pieces.

**Still open:**
1. ~~Rarity upgrades~~ — **decided:** merging 3 identical pieces creates one piece of the next tier
   ([06 §4.5](06-deck-durability-and-permadeath.md#45-merging)); an existing instance's tier never
   changes (I12).
2. **Pool cadence.** Should the rarity pool shift per shop visit rather than per act? Default: per act.
3. **Legendary knight count.** Should a deck hold at most one Legendary knight, if two make the solver
   or the double-move tempo too strong? Default: no cap; revisit after M3 measures solver cost.

**Constraints any answer must meet:**
- **Pillar 2:** a tier that adds power adds cost (coins, permanence, or both).
- **Durability stays inversely correlated with power** ([06 §1](06-deck-durability-and-permadeath.md#1-the-piece-table)).
- **Pillar 3:** each tier's effect fits in one short sentence on the piece card.
- **Pillar 4:** the solver models every effect ([04 §5](04-stage-generation-and-authoring.md#5-the-solver)).
- **Chess values stay standard** for salvage and enemy value bands.
- **No rules in the UI** ([09 §6](09-technical-architecture.md#6-module-responsibilities)): abilities
  are `pieces.yaml → rarityAbilities` entries interpreted by the engine.

**Trigger:** M6 balance pass. **Blocker for:** nothing.

---

## P. Neutral Stage Pieces

**Question:** should stages place pieces that belong to neither side (blockers, capturable targets)?
**Default:** none in MVP. The **Stage Piece** category already covers them: if added, they are
Normal rarity, carry no `instanceId`, and never join the deck. (Spawned pawns are already a
player-side kind of Stage Piece; neutral pieces would be a third side.)
**Cost:** a third side means new rules for who may capture them, whether capturing them pays salvage,
and how the enemy policy treats them. They also overlap with terrain (L).
**Trigger:** M6+, together with L.

---

## Q. Dev skip stage

**Question:** what happens when the player meets a stage the solver could not prove winnable?
**Decided (2026-11-16, M5):** a development tool, not a rule: with the app's dev toggle on, **skip
stage** counts the stage as won with its pending base reward only, and the run is marked DEBUG RUN for
good ([M5 spec](superpowers/specs/2026-11-16-m5-web-ui-design.md) U2, [09 §2](09-technical-architecture.md#2-repository-layout)).
**Alternatives:** regenerate until proven (changes gen, adds wall time over its target, reopens the
accepted M3 gap); nothing (honest, but a full run may be unreachable).
**Trigger:** revisit when the proven rate makes unwinnable stages rare, or before any public build.

---

## R. Restart stage scope

**Question:** when may a stage be restarted, and what does a restart keep?
**Decided (2026-11-16, M5):** only in the Action phase before the first COMMIT; durability paid at
START stays paid and a piece START took to 0 stays `spent`
([08 §6](08-progression-and-ux.md#6-commit-undo-and-honesty), [M5 spec](superpowers/specs/2026-11-16-m5-web-ui-design.md) U6, U10).
**Alternative:** restart at any time with every loss kept. Rejected: it allows scouting the enemy's
replies and needs a rule for each kind of loss (overtime, captures, salvage, promotions, skills).
**Trigger:** if playtests show players want to retry a stage they have started playing.

---

## S. Chess promotion and no check at START (M5.1)

**Question:** what happens when a spawned pawn reaches rank 8? In the first M5 playtest
(2026-11-17) the promoted pawn left the board with no explanation, felt like a bug, and paid nothing
during the stage.
**Decided (2026-11-17, M5.1, decisions P1–P4):** promotion works like chess
([02 §2.2](02-rules-framework.md#22-promotion)). The pawn **stays on the board** as the promoted piece,
on its square, for the rest of the stage (P1); the player **chooses** knight, bishop, rook or queen,
with no exception — a Legendary pawn may become a Legendary queen (P2); the piece has the **pawn's
rarity**, with no tier-up and no roll (P3); and it **joins the deck at once** as a Hero Piece at full
durability, `origin: promotion`, `pricePaid: 0` (P4). The choice is made while building the queue and
stored in the `MOVE`, so the preview equals the outcome (I10)
([M5.1 spec](superpowers/specs/2026-11-17-promotion-and-start-check-design.md)).
**Alternatives:** the pre-M5.1 rule (pawn leaves the board, a result rolled at generation and shown
on the pawn); a chooser during resolution (breaks I10, because the queue resolves at once on COMMIT).
**Trigger:** the replay on the new rules (P7) — if mid-stage queens make stages too easy, tune spawn
ranks and pars, not this rule.

---

## T. Deck over capacity after a promotion (M5.1)

**Question:** where does the player trim a deck that a promotion pushed above 8?
**Decided (2026-11-17, M5.1, decision P5):** the stage-end chooser is removed. A won stage goes
straight to the shop; while the deck holds more than 8 pieces the shop **cannot start the next stage**
(`deck_over_capacity`), and the player sells, merges or cuts there until it fits (I9,
[07 §1](07-shop-phase.md#1-entry-exit-and-flow)). Selling and merging happen only in the shop. A
promoted piece sells for 0 (its `pricePaid`), so promotion is never a coin source.
**Alternatives:** the M4 stage-end chooser (merge, sell or cut before the shop opens) — an extra
screen and phase for a rare event, and coins from a sale there were the same as in the shop anyway.
**Trigger:** revisit sell values in the tuning pass after the replay (P7).

---

## U. No check at START (M5.1)

**Question:** may the player's deployment give check to the enemy king at START?
**Decided (2026-11-17, M5.1, decision P6):** no. New invariant **I16**: at Start, the black king is
not in check. `startStage` refuses it (`gives_check`), the Deployment screen marks such squares, and
generation guarantees the stage's own spawned pawns never give check (`no_start_check`)
([02 §5](02-rules-framework.md#5-deployment)). User rationale: the player moves first, so a check that
already stands at START is a free attack the enemy never got to answer.
**Alternatives:** allow it (the pre-M5.1 rule; felt illegal in the playtest); let the enemy move
first when a check stands (contradicts "the player always moves first").
**Trigger:** only if Playing as Black (F) lands, where the side to move changes.

---

## V. One queen summon per stage (M5.1)

**Question:** how many queens may a deployment summon?
**Decided (2026-11-17, M5.1, decision P10):** **at most one** per stage, of any rarity
(`deployment.maxQueenSummons: 1`, `queen_limit`, [02 §5](02-rules-framework.md#5-deployment)). The
limit counts summons only: a pawn may still promote to a queen in that stage; in the next stage that
queen is a deck piece and counts like any other.
**Alternatives:** no limit (the spawn-point budget alone; the Act III boss budget of 18 fits two queens);
counting promoted queens too (would make the promotion picker refuse a type, against P2).
**Trigger:** the M6 balance pass, if queen-heavy decks still dominate Act III.

---

## Deferred-by-design (not open, just later)

- Full art and audio production
- Mobile/touch layout
- Online leaderboards
- Localization
- Level/encounter editor
- Controller support
