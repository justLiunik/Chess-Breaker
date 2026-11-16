# 03 — Skill Framework

Skills are the only mechanic that breaks chess, and they are **data, not code**. A skill is a record
that the engine interprets; adding a skill must never require touching the rules engine. This
document defines the grammar, the categories, the balance frame, the three launch skills, and the
next four skills of the catalogue.

---

## 1. Why a framework instead of a list

The full skill catalogue is deliberately deferred ([11](11-open-decisions.md)). For that deferral to
be safe, the framework must guarantee that a skill designer who has never seen the engine can author
a skill that is:

1. **Expressible** — every skill maps onto existing effect primitives, or explicitly declares a new one.
2. **Legible** — the player learns exactly one rule change per skill.
3. **Terminating** — every duration ends, and no skill can fund itself.
4. **Safe** — no skill can violate the legality invariants of
   [02 §9](02-rules-framework.md#9-legality-invariants).

Everything below exists to enforce those four properties.

## 2. Skill anatomy

| Field | Purpose |
|---|---|
| `id` | Stable machine key (`twin_step`) |
| `name` | Display name (`Twin Step`) |
| `category` | One of the seven (§4) |
| `ruleBroken` | **One** short sentence naming the chess rule this violates |
| `text` | Player-facing card text |
| `trigger` | `activate` (player-initiated), `passive`, `reaction` |
| `cost` | Focus cost (integer ≥ 0) |
| `price` | Act I shop price in coins; later acts add the same inflation as pieces (§8) |
| `target` | `none`, `own_piece`, `enemy_piece`, `own_piece_bishop`… (filtered selector) |
| `effects[]` | Ordered list of `{ primitive, params, duration }` |
| `restrictions[]` | Machine-checkable clauses (`once_per_turn`, `not_adjacent_to_king`…) |
| `status` | `mvp` or `future` |

Skills are **single-use consumables** (decided 2026-11-13, M4). Each skill bought occupies one of the
**3** loadout slots; using it once consumes it and frees the slot. A second copy of a skill is a
separate item in its own slot — skills never stack, carry charges or upgrade. A skill is a card you
spend at the right moment, not a permanent part of the deck.

> **Slots and coins are the scarcity. Focus is the throttle.** Focus limits how much you can do *in
> one turn*; three slots and the price limit how many skills a run can hold at once. A skill is
> consumed when the turn that uses it is **committed** — a preview or a refused commit consumes
> nothing.

## 3. Effect primitives

A skill's `effects` is an ordered list. Each entry is one primitive plus params plus a duration.
Primitives are the entire vocabulary — if a design needs a new one, that is a deliberate framework
change, not a skill authoring detail.

| Primitive | Params | Does |
|---|---|---|
| `grant_move_credit` | `amount` | Adds move credits this turn (the only way to exceed one action) |
| `grant_focus` | `amount` | Adds Focus this turn |
| `set_piece_type` | `pieceType` | Changes a piece's movement *and* capture behavior; used by transforms |
| `override_moveset` | `pieceType` | Changes movement only, keeps identity/value (M6: Gallop) |
| `ignore_blockers` | — | Piece's move path ignores pieces (M6: Phase Step) |
| `suppress_piece` | `target` | Targeted piece may not be moved by its owner |
| `shield_piece` | `target` | Targeted piece may not be captured; it still blocks, attacks and gives check (M6: Bulwark) |
| `return_to_deck` | `target` | Takes one of the player's Hero Pieces off the board and back into the deck, `in_deck`, with the durability it has; it cannot return this stage (I15) (M6: Recall) |
| `shield_king` | — | King ignores check for the duration (**rejected** — breaks I2) |
| `remove_piece` | `square` | Deletes a piece (future; board manipulation) |
| `place_piece` | `square, pieceType` | Creates a Stage Piece — never a deck piece, which would break the deck lock (I15) (future; board manipulation) |
| `displace_piece` | `from, to` | Forces a piece to another square (future) |
| `reveal_intent` | — | Shows the enemy's next move (future; planning effect) |
| `add_plan_undo` | — | Grants one post-commit undo (**rejected** — there is no undo after commit, [08](08-progression-and-ux.md)) |

The validator enforces the split: an `mvp` skill may use only `grant_move_credit`, `set_piece_type`
and `suppress_piece` (the M2 engine); a `future` skill may use any declared primitive except the two
rejected ones.

**Rarity abilities share this layer.** A piece's rarity abilities (`leap_allies`, `add_leaper`,
`add_rider`, `bonus_self_move`, `multi_capture`, `lifeline` — [02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) are
interpreted by the same `engine/skills` machinery as permanent, piece-bound modifiers. They are not
skills: they cost no Focus, have no charges, and occupy no loadout slot. But they follow the same
rule — no special cases in `engine/rules` — and a skill that touches movement must state how it
composes with them (default: a transform suspends rarity abilities until it reverts).

### Modifiers

An activation that has a lasting effect records a **modifier**: `{ modifierId, primitive, source,
target?, duration, appliedOnTurn }`. Modifier ids are `m{turn}_{step}` (the turn number and the
queue step that activated it): deterministic and unique within a stage. A modifier's `target` is a
**piece id** (`instanceId` for Hero Pieces, `stageId` for Stage Pieces), never a square, so it follows
its piece. `grant_move_credit` records no modifier (credits reset every turn). A transformed piece
carries `transformed: { pieceType, modifierId }`; R1 finds it by that id, and a modifier whose target
was captured is dropped (with a `modifier_expired` event). Movement generation counts a transformed
piece as tier 0 (rarity abilities suspended); suppression is applied through a frozen-square mask
(R3 and the root of R5 only, [02 §6](02-rules-framework.md#6-end-of-turn-resolution-order)).

`hasLegalQueue(run, stage, config)` searches **skills first, then moves**: any ordered set of usable
skills (distinct skill ids in the loadout, within Focus, each with every legal target), followed by up to the
resulting credits in moves, each legal when made, with I2 holding after R1. It is complete for the
launch three because a credit must be granted before the move it pays for, a transform must precede
the moves of its piece, and Lockdown never changes I2; a test brute-forces every interleaving on
small boards to confirm. A future skill that breaks one of these needs the search revisited. Because no
launch primitive moves a piece, grants Focus or changes a piece's own type or rarity, each set of
skills is tried once, in loadout order; a skill made only of queue-neutral primitives (today
`suppress_piece`, which never changes Resolve or R2) is not tried at all.

### Duration semantics

| Duration | Expires | Typical use |
|---|---|---|
| `instant` | Immediately after the action | Resource grants, captures, suppression of an action |
| `this_turn` | **R1**, end of the current player turn | Ascension (bishop becomes a queen) |
| `next_enemy_turn` | End of the enemy's next turn | Lockdown |
| `permanent` | Never (stage end) | Design reserved; no MVP skill uses it |

`this_turn` expiry happening at R1 — *before* checkmate evaluation at R3 — is what stops burst
transforms from winning stages directly (see [02 §6](02-rules-framework.md#6-end-of-turn-resolution-order)).

## 4. The seven categories

Every skill must belong to exactly one. The category exists so coverage can be audited and so future
designers know what "kind" of rule-breaking is missing.

| # | Category | The rule it tends to break | MVP |
|---|---|---|---|
| 1 | **Action economy** | "You get one move per turn" | ✅ |
| 2 | **Transformation** | "A piece is what it is" | ✅ |
| 3 | **Status / debuff** | "A piece may always move" | ✅ |
| 4 | **Movement override** | "Pieces are blocked by other pieces" | — |
| 5 | **Board manipulation** | "The board only changes by moving" | — |
| 6 | **Information / planning** | "You must commit blind to the reply" | — |
| 7 | **Resource** | "Focus is fixed per turn" | — |

### Coverage table

| Category | Covered by | Status |
|---|---|---|
| 1 Action economy | `grant_move_credit` | ✅ MVP (Twin Step) |
| 2 Transformation | `set_piece_type` + `this_turn` duration | ✅ MVP (Ascension) |
| 3 Status | `suppress_piece` + `next_enemy_turn` | ✅ MVP (Lockdown); `shield_piece` for Bulwark in M6 |
| 4 Movement override | `override_moveset`, `ignore_blockers` | Catalogued: Gallop, Phase Step (M6) |
| 5 Board manipulation | `return_to_deck`; `remove_piece`, `place_piece`, `displace_piece` | Catalogued: Recall (M6); the rest declared, unused |
| 6 Information / planning | `reveal_intent`, `add_plan_undo` | **Requires a new primitive class** — planning effects mutate the plan UI, not the board. Framework change scheduled for M6. |
| 7 Resource | `grant_focus` | Primitive available, no MVP skill uses it (see §7 anti-patterns) |

**Audit result:** all seven categories are accounted for; five are expressible with existing
primitives and one (planning) is explicitly flagged as needing a new primitive class. Category 7 is
expressible but deliberately unused at launch to protect the Focus throttle. After M6, five
categories have at least one skill; information/planning and resource have candidates only
([11 A](11-open-decisions.md#a-skill-catalogue-deferred-by-request)).

## 5. The three launch skills

### Twin Step — *Action economy*

```yaml
id: twin_step
name: Twin Step
category: action_economy
ruleBroken: "You get one move per turn."
text: "Gain one extra move this turn."
trigger: activate
cost: 1
price: 4
target: { kind: none }
effects:
  - { primitive: grant_move_credit, params: { amount: 1 }, duration: this_turn }
restrictions: [once_per_turn]
status: mvp
```

- Grants one move credit, usable for a `MOVE` (credits pay for nothing else; pieces enter the board only in the Deployment phase).
- Because costs are sequential, Twin Step must be activated *before* the action it pays for.
- `once_per_turn` prevents stacking copies: a player holding three Twin Steps gets three extra
  actions across three turns, never three inside one turn.
- **Edge cases:** activating it with no action following is legal but wasted (the skill is consumed
  and not refunded). Two Twin Steps in one turn are illegal (`once_per_turn`), even as two copies.

### Ascension — *Transformation*

```yaml
id: ascension
name: Ascension
category: transformation
ruleBroken: "A bishop is a bishop, forever."
text: "One of your bishops becomes a queen until the end of this turn."
trigger: activate
cost: 2
price: 4
target: { kind: own_piece, pieceType: bishop, must_be_on_board: true, excludesRarity: [legendary] }
effects:
  - { primitive: set_piece_type, params: { pieceType: queen }, duration: this_turn }
restrictions: [once_per_turn]
status: mvp
```

- The bishop moves, captures, and gives check as a queen for the rest of the queue's resolution, then
  reverts at **R1**.
- It **cannot** win by checkmate: R1 reverts before R3 evaluates. Since checkmate is the only win
  ([02 §7](02-rules-framework.md#7-stage-end-evaluation)), Ascension never clears a stage by itself; it
  clears *defenders* — capturing pieces out of the mating net (and earning salvage) so a permanent
  piece can mate later. That is the intended use.
- It **can** be captured while transformed (defenders capture it as a queen, with queen value).
- **Rarity.** The transform suspends the bishop's rarity abilities until it reverts (§3): a Rare or
  Unique bishop gains straight lines but loses its leap for the turn. A **Legendary bishop cannot be
  targeted** (`excludesRarity: [legendary]`): it already moves like a queen, so Ascension would add
  no move and only take its leaps away — a wasted skill, not a choice.
- **Edge cases:** the engine checks I2 again after R1 (`king_in_check_at_end { afterRevert: true }`),
  but with this skill the case cannot occur: the bishop's square and what it blocks never change at
  the revert, so the King is no more exposed after it than before. The check is a guard for future
  transform skills. Transforming a bishop that is later captured simply removes it; no reversion
  occurs, and R1 drops the modifier (emitting `modifier_expired`).

### Lockdown — *Status*

```yaml
id: lockdown
name: Lockdown
category: status
ruleBroken: "A piece can always move."
text: "Choose an enemy piece. It cannot move on the enemy's next turn."
trigger: activate
cost: 1
price: 3
target: { kind: enemy_piece, must_be_on_board: true, excludes: [king] }
effects:
  - { primitive: suppress_piece, params: {}, duration: next_enemy_turn }
restrictions: [once_per_turn, distinct_targets]
status: mvp
```

- The suppressed piece **still attacks, still blocks, still defends, and can still be captured** — it
  simply cannot be *moved* by its owner.
- R3 counts legal moves with the suppression in force. If the only enemy pieces that could move are
  suppressed and the king has no move, the enemy is **stalemated and the player loses**
  ([02 §7](02-rules-framework.md#7-stage-end-evaluation)) — unless the king is in check, which is
  checkmate. The preview shows which, so Lockdown is a mating tool with a visible edge.
- `distinct_targets` means one Lockdown per enemy piece per stage, across copies — preventing "lock
  the whole army" degenerate play.
- The king is excluded: freezing the king would make checkmate trivially deterministic.

### The next four (M6)

These are catalogued now — data, numbers and rules are fixed in
[`skills.yaml`](../content/examples/skills.yaml) with `status: future` — and built in M6 with the
primitives they need ([10](10-roadmap-and-milestones.md)). Two widen how pieces move; two protect the
deck, which is what an unforgiving durability economy most needs
([06 §1](06-deck-durability-and-permadeath.md#1-the-piece-table)).

| Skill | Category | Rule broken | Focus | Price |
|---|---|---|---|---|
| **Gallop** | Movement override | "A piece moves only the way its type moves." | 1 | 3 |
| **Phase Step** | Movement override | "Pieces are blocked by other pieces." | 2 | 5 |
| **Recall** | Board manipulation | "A piece on the board can only leave it by being captured." | 1 | 4 |
| **Bulwark** | Status | "Any piece can be captured." | 1 | 3 |

#### Gallop — *Movement override*

*One of your pieces moves like a knight until the end of this turn.* `override_moveset { pieceType:
knight }`, `this_turn`, `once_per_turn`; targets an own piece, never the King or a pawn.

- The piece keeps its identity: type, value, salvage and rarity are unchanged; only its moves are
  a knight's. Its rarity abilities are suspended while the override holds (the §3 default).
- It moves, captures and gives check as a knight during the queue. The override reverts at **R1**,
  so R3 judges mate with the piece's own moves on its new square — Gallop repositions, it does not
  mate by itself.
- Pawns are excluded so promotion is never two ranks per move.
- **Edge cases:** a piece that ends the turn somewhere its own moves would expose the player's king
  is refused at commit (I2), as with Ascension. Combined with Twin Step, both moves of the turn are
  knight moves if the same piece makes them.

#### Phase Step — *Movement override*

*One of your rooks, bishops or queens moves through every piece until the end of this turn.*
`ignore_blockers`, `this_turn`, `once_per_turn`; never the King, a pawn, or a knight (it already
leaps).

- The path ignores allies **and** enemies. The move ends on an empty square or captures the piece on
  its destination, never the King (I3). Only the destination is captured; nothing it passes over is.
- It is a superset of Rare+ `leap_allies` for the turn: a Rare bishop under Phase Step may also
  capture after passing allies.
- Attacks follow moves (02 §2.3): while it holds, the piece attacks through pieces, which matters for
  the player's own king safety at R2. It reverts at **R1**, so an x-ray "check" through a blocker
  never counts for mate at R3.
- **Edge cases:** with Twin Step, a second move by the same piece also ignores blockers; a move by
  any other piece does not.

#### Recall — *Board manipulation*

*Return one of your pieces to your deck. It cannot come back this stage.* `return_to_deck`,
`instant`, `once_per_turn`; an own Hero Piece, never the King or a spawned pawn (Stage Pieces have no
deck to return to).

- The instance leaves the board and is `in_deck` again with the durability it has: the durability
  paid at Start is **not** refunded. What Recall saves is the piece, not the summon.
- It cannot re-enter the board this stage — the deck is locked (I15). Leaving is allowed; entering
  is not.
- The queue still needs a `MOVE` (I5), and the end state is judged as usual: recalling a piece that
  was blocking a check is refused at commit (I2).
- **Edge cases:** recalling a transformed bishop (Ascension) returns it as a bishop; the modifier
  ends with its target. Being single-use keeps it a rescue, not a shuttle.

#### Bulwark — *Status*

*Choose one of your pieces. It cannot be captured on the enemy's next turn.* `shield_piece`,
`next_enemy_turn`, `once_per_turn`; an own piece, never the King (the King cannot be captured
anyway, I3).

- The shielded piece still blocks, attacks and gives check, and can still be moved by the player
  next turn; it simply cannot be captured by the enemy until the end of the enemy's next turn.
- The enemy's legal moves exclude capturing it — in R3's stalemate count and in `enemyMove`'s
  search alike. If capturing it was the enemy's only legal move and the enemy is not in check, the
  enemy is **stalemated and the player loses** ([02 §7](02-rules-framework.md#7-stage-end-evaluation));
  the preview names it, as for Lockdown.
- **Edge cases:** a shielded piece giving check cannot be captured to escape the check; the enemy
  must block or move the king, and if it cannot, it is mated. This is the skill's intended edge.

## 6. Balance frame

A skill is one use. A full loadout is therefore at most **three uses**, spread over however many
stages the player chooses to keep them, and each use is roughly **one extra action** (Twin Step), one
turn of a stronger piece (Ascension) or one turn of a frozen defender (Lockdown).

| Quantity | Value | Notes |
|---|---|---|
| Skills held at once | ≤ 3 | Strict: no extra slot is ever sold |
| Uses per skill | 1 | Consumed on commit |
| Focus per turn | 3 | Any two of the launch three fit in one turn (costs 1, 2, 1) |
| Same skill twice in one turn | Never | `once_per_turn` applies across copies |

Focus costs stay at 1–2 for every catalogued skill, so any two of the launch three (costs 1, 2, 1) fit in one turn's
3 Focus; Ascension and Phase Step (2 each) do not pair, and no skill forces an all-in turn. A 3-cost skill is reserved for an effect that deserves a whole turn.

**Prices.** One use is worth about one extra action, less than a piece that summons twice, so skills
are priced below a knight's 8: light skills (Lockdown, Gallop, Bulwark) 3, line-changing skills
(Twin Step, Ascension, Recall) 4, Phase Step 5, with act inflation on top. Skills are also rare in the
shop (20 % of slots 3–4, [07 §2](07-shop-phase.md#2-stock-generation)), so the price is not what
limits them — availability and the three slots are. Prices are provisional until the M6 balance
pass.

**Why single use (2026-11-13).** Permanent skills with per-stage charges made a skill a standing
engine: once bought, it shaped every later stage. Single use makes each skill a decision twice —
when to buy it and which turn deserves it — and keeps the solver's proof (which uses no skills,
[04 §5](04-stage-generation-and-authoring.md#5-the-solver)) the floor of what a player can do.

### Tuning levers, in order of preference

1. **Price and shop rate** — cheapest to change, no rules interactions.
2. **Cost** — changes the turn structure; a 3-cost skill forces an all-in turn.
3. **Duration** — `this_turn` → `next_enemy_turn` is a large power increase; use sparingly.
4. **Targeting restriction** — narrowing the target set reduces power without changing feel.
5. **New primitive** — the last resort; treat as a framework change requiring a design review.

## 7. Guardrail checklist for any new skill

A skill cannot ship unless it passes all of these.

**Identity**
- [ ] Belongs to exactly one category.
- [ ] `ruleBroken` is one sentence and names a *specific* chess rule.
- [ ] A player who has read the card can predict its effect without a tooltip.

**Expressibility**
- [ ] Composes entirely from §3 primitives, **or** the new primitive is added to the table in the
      same change with a coverage-table update.
- [ ] Every effect has an explicit duration, and every duration terminates.

**Safety (must not violate [02 §9](02-rules-framework.md#9-legality-invariants))**
- [ ] Cannot capture, remove, or otherwise eliminate a king (I1, I3).
- [ ] Cannot produce an end state with the player's king in check (I2).
- [ ] Cannot grant a move credit except through `grant_move_credit` (I5).
- [ ] Cannot grant unbounded Focus (I6).
- [ ] Cannot move a piece without a move credit or a documented exception (I5).
- [ ] Cannot bring a deck piece onto the board after Start, or summon without spending durability (I7, I15).
- [ ] Cannot let the player skip a turn: a queue still needs at least one `MOVE` (I5).

**Loop safety**
- [ ] Cannot fund its own cost (no `grant_focus` + cost-0 activations that net positive).
- [ ] Cannot grant an extra turn, reset the turn counter, or return a used skill to the loadout.
- [ ] Cannot create an infinite action chain (any credit grant must cost more than it produces; every
      skill is single-use).

**Anti-patterns — reject on sight**
- ❌ "Gain 2 Focus" on a 1-cost skill (it funds the next skill's cost).
- ❌ Any `permanent` duration on a movement or type change (it silently rewrites deck value).
- ❌ King suppression, king removal, king transformation.
- ❌ Extra turns, turn-counter manipulation, skill refunds.
- ❌ Skills that hide information the player needs to plan (inverse of category 6).
- ❌ Skills whose power depends on the *number of pieces* in an unbounded way (e.g. "one move per
      piece you control").

## 8. Acquisition and loadout

- Skills are bought in the **shop** ([07](07-shop-phase.md)); the one exception is the free Twin Step
  granted when stage I-3 starts, if a slot is free ([08 §5](08-progression-and-ux.md#5-onboarding-ramp)).
- **3 loadout slots, strictly.** No slot is ever sold. Buying a skill with a full loadout forces a
  swap: the displaced skill is lost.
- Every skill occupies one slot. A **duplicate is a separate item** in another slot: no stacking,
  no charges, no upgrades.
- A skill is **consumed** when the turn that uses it is committed, and its slot frees at once.
- Unused skills carry over between stages. Skills are **not** lost on capture (they are not pieces)
  and cannot be sold.

## 9. What the MVP must prove about this framework

The three launch skills exist to prove, in order:

1. **Twin Step** proves the action economy can be violated through a general credit primitive rather
   than special-cased multi-move code.
2. **Ascension** proves temporary state changes are a first-class duration, correctly ordered against
   mate evaluation.
3. **Lockdown** proves the enemy can be constrained without the enemy needing its own AI complexity.

If a fourth skill category is later requested and cannot be expressed as `{primitive, params,
duration}`, that is a signal the framework failed — not a signal to special-case the engine.
