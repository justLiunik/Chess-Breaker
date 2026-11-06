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

**Question:** premium, free-with-cosmetics, or ad-supported web?
**Default:** undefined. No monetization hooks are built into the architecture — no currency other
than coins, no timers, no ad slots.
**Constraint:** any future model must not gate durability, repairs, or turn limits. Selling
durability would directly contradict pillar 2.
**Trigger:** before any public build.

---

## I. Working title & branding

**Question:** is "Checkbreaker" usable?
**Default:** provisional working title used throughout the docs.
**Trigger:** before storefront or domain registration; requires a trademark search.

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

**Question:** is 8→14 deck capacity and 3 loadout slots the right ceiling?
**Default:** 8 start, 14 max, 3 skills.
**Note:** capacity is the highest-leverage purchase in the game; raising the ceiling flattens the
economy by making late acts trivial.
**Trigger:** after the M6 balance pass.

---

## N. Difficulty modes

**Question:** offer an easier mode with extra turns or free repairs?
**Default:** no. The game's fairness comes from the solver guarantee, not from adjustable difficulty.
**Alternative:** a "practice" mode with hints forced on and no run death — teaches without diluting.
**Trigger:** if onboarding data shows a hard wall at Act II for new players.

---

## Deferred-by-design (not open, just later)

- Full art and audio production
- Mobile/touch layout
- Online leaderboards
- Localization
- Level/encounter editor
- Controller support
