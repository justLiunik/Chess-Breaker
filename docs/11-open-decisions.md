# 11 — Open Decisions

Decisions deliberately **not** made in M0. Each records the question, the options considered, the
current default, and the trigger that forces a decision. Nothing here blocks implementation of
M1–M5.

---

## A. Skill catalogue (deferred by request)

**Question:** what is the full set of skills?
**Status:** deferred until M6. The framework in [03](03-skill-framework.md) exists precisely so this
can be answered later without engine changes.
**Default:** the 3 launch skills only.
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

**Question:** should the player choose which pieces are in the opening line, instead of the game
drawing randomly?
**Options:** (1) random automatic draw (current, per the requirement that the game provides randomized
pieces); (2) player picks a subset; (3) player picks and the game picks the squares.
**Default:** (1).
**Alternative's appeal:** more agency at stage start; strengthens the "which pieces do I expose for
free" decision.
**Cost:** erodes the "game provides" framing and adds a pre-turn UI step to every stage.
**Trigger:** playtest feedback that openings feel arbitrarily unfair.

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
**Constraint if this ever changes:** any model must not gate durability, repairs, or turn limits.
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

## Deferred-by-design (not open, just later)

- Full art and audio production
- Mobile/touch layout
- Online leaderboards
- Localization
- Level/encounter editor
- Controller support
