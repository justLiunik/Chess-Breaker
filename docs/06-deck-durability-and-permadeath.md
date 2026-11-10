# 06 — Deck, Durability & Permadeath

This is the game's long-run resource and its emotional core. Turns are the clock the player watches;
**durability is the clock that kills them.**

---

## 1. The piece table

| Piece | Value | Spawn cost | Price (Act I, Normal) | Durability max | Notes |
|---|---|---|---|---|---|
| King | — | 0 | not sold | ∞ | Run identity; never destroyed; always placed, always free |
| Pawn | 1 | — | **not sold** | — | Never in the deck: spawned free by each stage; promotes into a deck piece ([02 §2.1](02-rules-framework.md#21-pawns-come-from-the-stage-never-the-deck)) |
| Knight | 3 | 3 | 8 | 2 | Standard mid-piece; widening jumps by rarity |
| Bishop | 3 | 3 (Legendary: **5**) | 8 | 2 | Standard mid-piece; Ascension target; leaps allies by rarity |
| Rook | 5 | 5 | 10 | 2 | Reach; leaps allies, then a two-piece battering ram by rarity |
| Queen | 9 | 9 | 16 | 2 (Legendary: **1**) | A whole Act I budget; lifeline, then full sweep by rarity; Legendary is the rarest piece |

Rarity multiplies the price (×1 / ×1.5 / ×2 / ×3) and adds abilities to knights, bishops, rooks and
queens ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)).

### The single most important design decision in this table

**Durability is flat and low; power is paid for in spawn points.** Every deck piece can be summoned
**twice** — knight, bishop, rook or queen, at every tier — with one exception, the Legendary queen,
which can be summoned **once**. Two summons is the whole life of a piece: the game is meant to feel
unforgiving, and a deck runs down unless the player rations it.

What stops the queen from dominating every slot is the stage's **spawn-point budget**
([02 §5](02-rules-framework.md#5-deployment)): a queen costs 9, a whole Act I budget, while three
minors cost the same 9. That turns every deployment into a real trade:

- **A few strong pieces** spend little durability per point of power (a queen: 1 durability for 9
  points), but one capture loses the whole investment.
- **Many minors** spend durability fast (three minors: 3 durability for 9 points), but the risk of
  capture is spread across them.
- The correct answer changes per template, which is what makes deckbuilding a skill.

**Rarity follows the budget, not durability.** No tier ever raises durability or lowers spawn cost.
A tier that makes a piece move like a queen makes it cost more to bring: a Legendary bishop costs 5
spawn points instead of 3. The Legendary queen is the one piece whose durability drops — a glass
cannon for the last stages of a run, with lifeline as its second life.

**Why 2.** Act I income buys roughly one minor (two summons) per stage, while a full Act I budget
spends three. At durability 1 a deck runs out by about the third stage; at 3 it rarely runs out at
all. At 2 it runs down slowly unless the player brings less than the budget allows, repairs, or
promotes — which is the pressure the game is built on. The numbers are provisional until the M6
balance pass ([10](10-roadmap-and-milestones.md)).

## 2. Deck capacity

| Property | Value |
|---|---|
| Capacity | **8 slots, fixed** — it never rises, and there is no deck-slot purchase |
| King occupies a slot | **No** — capacity counts non-king pieces |
| Starter deck | King + 2 Knights + 2 Bishops, all Normal (4 of 8 slots) |
| Pawns | Never in the deck — they come from the stage |

The starter deck leaves **four free slots**. That is deliberate: the first shop should be able to sell
you something, and the first promotion should land in the deck, without forcing a cut — the
deckbuilding lesson lands before the deckbuilding pressure. The board still feels full early on
because every stage spawns its own pawns.

Capacity is the run's power ceiling, and it is a hard one. With only eight slots, deck growth means
**better pieces, not more pieces**: buying higher tiers, promoting pawns, and merging three pieces into
one (§4.5). A full deck forces a choice on every purchase — sell, cut, merge, or pass. Selling pays
half the piece's current price ([07 §4](07-shop-phase.md#4-purchases)); cutting pays nothing.

## 3. Piece instances

A piece in the deck is an **instance**, not a type. Two knights are distinct objects with separate
durability, rarity and fates.

```ts
interface PieceInstance {
  instanceId: string;        // stable for the run, e.g. "p_a1f3_07"
  pieceType: 'king' | 'knight' | 'bishop' | 'rook' | 'queen';   // never 'pawn'
  rarity: Rarity | null;     // fixed at creation; null for the King only (§4)
  durability: number;        // remaining deployments
  durabilityMax: number;     // from the piece definition, for this rarity
  origin: 'starter' | 'shop' | 'promotion' | 'reward';
  acquiredAtStage: number;
  status: 'in_deck' | 'deployed' | 'captured' | 'spent';
}
```

Durability is **instance state persisted in `RunState`**. It is the reason a run cannot be
reconstructed from its piece list alone, and the reason save files must version the deck.

Rarity is instance state too: two knights in the same deck may hold different tiers.

## 4. Piece categories and rarity

### 4.1 Two categories of piece

Every piece on a board belongs to exactly one category, and the category decides where it comes
from and what rarity it may hold.

| Category | What it is | Owned by | Comes from | Rarity |
|---|---|---|---|---|
| **Stage Piece — enemy** | The enemy army (and any future neutral pieces — [11 P](11-open-decisions.md#p-neutral-stage-pieces)) | The stage | Rolled from the template at generation ([04 §3](04-stage-generation-and-authoring.md#3-generation-pipeline)) | **Always Normal** |
| **Stage Piece — spawned pawn** | Free pawns the stage places for the player | The player, for this stage only | Count and ranks from the template; rarity rolled from the act pool | **Rolled** (up to the act ceiling) |
| **Hero Piece** | A piece the player owns: every instance in the deck | The player, for the run | Starter deck, shop, promotion, rewards | **Any tier** |

How to tell them apart on a board: a Hero Piece carries an `instanceId` that points into
`RunState.deck`; a Stage Piece has none. A spawned pawn is marked `spawned` and carries its own
`rarity` and `promotesTo`. Stage Pieces are ephemeral — they exist only inside one `StageState` and
are never added to the deck. The one bridge between the two is **promotion**: a spawned pawn that
reaches rank 8 is replaced by a brand-new Hero Piece ([02 §2.2](02-rules-framework.md#22-promotion)).

**Summoned pieces are Hero Pieces.** They come from the deck in the Deployment phase
([02 §5](02-rules-framework.md#5-deployment)) and keep their own rarity; "placed before turn 1" does
not make a piece a Stage Piece. Spawned pawns are the reverse: also on the board before turn 1, but
placed by the stage, so they are Stage Pieces.

### 4.2 Rarity tiers

| Order | Tier | First available | Who can hold it |
|---|---|---|---|
| 1 | **Normal** | Act I | Every piece type; all enemy pieces |
| 2 | **Rare** | Act I | Hero Pieces and spawned pawns |
| 3 | **Unique** | Act II | Hero Pieces and spawned pawns |
| 4 | **Legendary** | Act III | Hero Pieces and spawned pawns |

The order is load-bearing: "above the ceiling" and "one tier higher" always mean a later row in this
table. The tier list lives in [`data/economy.yaml`](../data/economy.yaml) → `rarity.tiers`.

### 4.3 Rules

1. **The King has no rarity.** Its `rarity` is `null`, always. It is not Normal — it is outside the
   system, like its durability.
2. **Every other piece has exactly one rarity tier.**
3. **Enemy pieces are locked to Normal.** Templates cannot specify enemy rarity, and generation never
   rolls it.
4. **Hero Pieces may hold any tier.** Starter-deck pieces are all Normal; higher tiers enter the deck
   through the shop, promotion, and merging.
5. **Rarity is fixed at creation.** An instance keeps its tier for its whole life. Transforms
   (e.g. Ascension) change the piece type temporarily, never the rarity. Repairs do not change
   rarity. The only way up is merging (§4.5), which creates a new instance.
6. **Rarity availability is gated by progression.** Shop offers, spawned pawns and promotion results
   all respect the act's rarity ceiling; in Act I that ceiling is **Rare**, so Unique and Legendary
   pieces cannot be acquired until later acts. Full rules: [07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating).
7. **Skills have no rarity.** Rarity is a property of pieces only.

### 4.4 What rarity does

| Piece | What its tier changes |
|---|---|
| Pawn | Only its promotion result: usually one tier above the pawn ([02 §2.2](02-rules-framework.md#22-promotion)) |
| Bishop | Rare leaps allies (no capture on a leap) · Unique captures after a leap · Legendary moves like a queen and costs 5 spawn points ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) |
| Knight | Rare adds a 2-square straight leap · Unique adds a 2-square diagonal leap · Legendary gets a free second move each turn ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) |
| Rook | Rare leaps allies (no capture on a leap) · Unique adds a 1-square diagonal step · Legendary captures one piece after a leap and multi-captures two connected enemies on a non-leap move ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) |
| Queen | Rare leaps allies (no capture on a leap) · Unique gains a once-per-run lifeline · Legendary captures after a leap and multi-captures on any move, durability 1 ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) |
| Every type | Shop price ×1 / ×1.5 / ×2 / ×3 ([05 §3](05-run-structure-and-economy.md#3-expenditure-coins--power)) |

What rarity never changes: chess material value (salvage), the durability a summon spends (1), or
repairs. It changes durability and spawn cost in exactly two places: the Legendary queen's
durability is 1, and the Legendary bishop's spawn cost is 5 (§1). Permadeath has exactly one exception: the Unique+ queen's once-per-run
lifeline (§6).

### 4.5 Merging

Three identical pieces can be merged into one piece of the next tier. Merging is the only way a deck
piece's rarity can rise, and it always creates a **new** instance — the inputs are consumed, never
upgraded in place, so I12 still holds.

| Rule | Value |
|---|---|
| Inputs | **3** deck pieces of the **same type and the same tier** (e.g. three Normal Knights) |
| Input state | All `in_deck` with durability ≥ 1; spent or captured pieces cannot be used |
| Result | **1** piece of the same type, **one tier higher** (Normal → Rare → Unique → Legendary) |
| Result durability | **Full** for the new type and tier (2; a Legendary queen: 1) |
| Result state | Fresh instance, `origin: merge`, nothing in `usedOnce` (a merged queen has its lifeline) |
| Ceiling | Never above the act's rarity ceiling: Normal → Rare only in Act I, Rare → Unique from Act II, Unique → Legendary in Act III |
| Excluded | The King (no rarity), pawns (never in the deck), and Legendary pieces (no higher tier) |
| Cost | **Free** — the price is giving up three pieces for one |
| When | In the shop, any number of times per visit; and in the stage-end chooser (merge, sell or cut) after a promotion overflows the deck |

**Why three.** Two-for-one would make tiers cheap: a single shop purchase plus an owned piece would
reach the next tier. Three-for-one means committing three of the eight deck slots to one piece type,
which is a real deckbuilding decision. It also keeps the Legendary queen rare without a dice roll: it
needs three Unique queens, only possible in Act III.

**Merging never saves coins.** Rarity prices rise ×1 → ×1.5 → ×2 → ×3, so three pieces of a tier
always cost more to buy than one piece of the next. Merging is for turning pieces you already have —
starters, promotion results, worn-out pieces — into one stronger piece, and for reaching a tier the
shop has not offered.

## 5. Durability lifecycle

```
                    ┌──────────────────────────────────────────┐
                    │              in_deck                     │
                    │   durability: n  (n ≥ 1)                 │
                    └───────────────┬──────────────────────────┘
                                    │ SUMMON at Start  (Deployment phase;
                                    │   cost: 1 durability)
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │              deployed                    │
                    │   durability: n−1                        │
                    └───────┬──────────────────────┬───────────┘
                            │ enemy captures       │ stage ends
                            ▼                      ▼
              ┌──────────────────────┐   ┌─────────────────────────────┐
              │      captured        │   │  n−1 ≥ 1 → back to in_deck  │
              │  DESTROYED FOREVER   │   │  n−1 = 0 → status: spent    │
              └──────────────────────┘   │             ↓                │
                                         │  removed at stage end        │
                                         └─────────────────────────────┘
```

Two paths are not drawn:

- **Lifeline** (Unique and Legendary queen, once per instance): `captured` → `in_deck` at stage end
  with 1 durability, instead of destroyed (rule 4).
- **Recall** (skill, M6 — [03 §5](03-skill-framework.md)): `deployed` → `in_deck` during the stage,
  keeping its durability (nothing is refunded) and unable to return to the board until the next
  stage (I15).

**Rules**

1. Summoning decrements durability by exactly 1 and requires durability ≥ 1. It is paid when Start
   commits the deployment, never earlier; a piece left in the deck pays nothing.
2. A summoned piece that survives returns to the deck with its reduced durability.
3. **A piece whose durability reaches 0 is marked `spent`.** It remains on the board for the rest of
   the stage (it is still a piece!) but is **removed from the deck at stage end**. It cannot be
   summoned again, repaired, or used next stage.
4. **A captured piece is destroyed immediately and permanently.** It leaves the run. No repair
   effect, shop, or skill can recover it. Only a *new instance* of the same type can be bought. The
   single exception is a Unique or Legendary queen's **lifeline**: once per run, the captured queen
   returns to the deck at stage end with 1 durability instead ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)).
5. A piece with 0 durability can still be **repaired** during the same stage it went spent? **No.**
   `spent` is final — this closes a repair-dodge loophole and keeps the 0-durability threshold
   meaningful. Repairs only apply to `in_deck` or `deployed` pieces with durability ≥ 1.
   A consequence worth stating: a **Legendary queen can never be repaired**. Its durability is only
   ever 1 (full) or 0 (spent), so it is a one-summon piece whose only second life is lifeline. There
   is no paid restore for a spent piece, at any price.

**Why "spent" rather than instant destruction:** a piece that vanishes the moment it is summoned is
absurd to watch and removes the tension of playing out a stage with a doomed army. Marking it spent
lets the player spend it *now* and feel the cost *after* — which is the same shape as the coin
economy and teaches the same lesson.

## 6. Capture and permadeath

| Event | Effect on the run |
|---|---|
| Player piece captured on the board | Instance destroyed; removed from deck permanently (except a Unique+ queen with its lifeline unused) |
| Piece left in the deck this stage | Cannot be captured — only summoned pieces are at risk |
| Enemy piece captured | Salvage coins (`floor(value/3)`); no effect on the enemy deck (there isn't one) |
| Player king "captured" | Impossible — checkmate ends the stage instead |

**Every piece on the board was chosen, so every risk was chosen.** There is no free army: the only
pieces that cost nothing to have on the board are the King (which cannot die) and the stage's spawned
pawns (which leave nothing behind). Everything else was summoned, paid durability, and can die
permanently. Bringing less is always safe and always slower.

## 7. The King

| Property | Rule |
|---|---|
| Presence | Guaranteed in the deck; always placed by the player in the Deployment phase, free: it costs no spawn points |
| Capacity | Occupies no deck slot |
| Durability | Infinite; never decremented, never spent |
| Rarity | None — `null`, outside the rarity system (§4) |
| Capture | Impossible (invariant I3) |
| Removal | Cannot be sold, sacked, or destroyed by any effect |
| Defeat | Checkmate of the player king ends the run |

The King is the run's anchor. Because it can never be lost, the player can never reach an unwinnable
state caused by an empty deck — only one caused by their own play. This is a load-bearing guarantee:
it is what lets the game promise "the King, the stage's spawned pawns and a solver-checked board mean
you are never forced to lose."

## 8. Guardrails

| Lever | Rule | Prevented failure |
|---|---|---|
| **King immunity** | King never lost | Deck emptied entirely |
| **King + spawned pawns** | The King is always placed, and every stage spawns pawns | Stage starts with no army |
| **Summon choice** | Pieces left in the deck spend no durability and cannot die | A fragile deck forced into every fight |
| **Spawned pawns** | Every stage gives the player free pawns, whatever the deck holds | Broke and piece-less |
| **Recovery offer** | Pieces lost in the last stage and non-king deck < 4 → one discounted replacement guaranteed | Post-catastrophe death spiral |
| **Salvage** | Captures pay coins | Attrition has no counter-income |
| **Telegraphing** | UI warns when a deployment square is attacked | Losing pieces to invisible threats |

## 9. Communication rules (UI contract)

Durability must be readable without opening a panel.

1. **Durability pips** on every deck tile — filled for remaining, hollow for spent. Never a bare
   number alone: the pips are the primary read.
2. **Summon hover** shows `durability 2 → 1`, not just `1`.
3. **Spent warning:** summoning a piece whose durability would reach 0 shows a persistent
   "last deployment — removed after this stage" marker on the Start confirm.
4. **Capture telegraph:** if a deployment square is attacked by an enemy piece, the square is marked
   with the threat and the capture line is previewed. This is information the player could
   derive by hand; hiding it only punishes carelessness, not judgment.
5. **Deck panel sort:** group by durability ascending? **No** — group by `pieceType` (stable), with a
   filter for "spent" and "one deployment left." Sorting by durability would reshuffle under the
   player's hand mid-plan. Within a type, order by rarity (Normal first), which is stable for the
   life of each instance.
6. **Rarity marker** on every Hero Piece tile, spawned pawn and shop card: the tier name plus a
   distinct frame shape per tier, readable without color. Rarity never uses glow or the hot accent
   colors — those are reserved for threat and rule-breaking
   ([00](00-vision-and-pillars.md#tone--art-direction-brief)). Enemy pieces show no rarity marker,
   because theirs never varies. The King shows none either.
7. **Promotion preview** on every spawned pawn: its `promotesTo` result ("→ Rare Knight") is always
   visible on the pawn, not hidden behind a hover.
8. **Ability legibility:** a piece's move preview shows every square its rarity abilities reach, and
   leap-only (non-capturing) moves look visibly different from capturing ones.

## 10. Edge cases

| Case | Resolution |
|---|---|
| Deck contains only the King | The King and the spawned pawns are the whole army; the solver still had to find a mate, so the stage is winnable, but the UI offers abandon-run |
| Summon onto an occupied square, or onto ranks 5–8 | Not placeable (I8) |
| Summons that cost more than the stage's spawn points | Start refused (I15); nothing paid, placements kept |
| Start with the King in check | Start refused (I2); nothing paid, placements kept |
| More pieces in the deck than the spawn points can pay for | The player chooses; the rest stay in the deck untouched |
| Captured while transformed (Ascension) | Piece destroyed normally; no reversion step |
| Hero Piece transformed (Ascension) | Piece type changes for the turn; rarity does not |
| Captured Rare/Unique/Legendary piece | Destroyed like any other; rarity grants no protection and no refund |
| Promotion while the deck is full | The new piece joins the deck anyway; at stage end, before the shop, the player must merge, sell or cut pieces until the deck fits (I9) |
| Selling a piece | Only in the shop or the stage-end chooser; never the King or a `spent` piece; half its current price; it leaves the run like a cut piece ([07 §4](07-shop-phase.md#4-purchases)) |
| Spawned pawn captured | Lost for this stage only; nothing leaves the deck |
| Spawned pawn survives the stage without promoting | Discarded at stage end; nothing carries over |
| Promoted piece in the same stage | Joins the deck at once but cannot be summoned — the deck is locked after Start (I15). First summonable next stage |
| Legendary knight + Twin Step | Both apply: Twin Step adds a credit for any piece; the knight's bonus move is only for itself |
| Ascension on a Rare/Unique bishop | It moves as a Normal queen for the turn; its leap abilities return when the transform reverts |
| Ascension on a Legendary bishop | Not a legal target (`excludesRarity: [legendary]`): it already moves like a queen ([03 §5](03-skill-framework.md)) |
| Lifeline on a spent queen | Fires anyway: the first capture returns it with 1 durability whatever it had left. For a Legendary queen (always spent once summoned) this is its only way to be summoned twice |
| Legendary knight gives check, then tries to capture the king with its bonus move | Impossible: the king's square is never a legal destination (I3). The bonus move may go anywhere else |
| Multi-capture whose second target is the enemy king | The move stops on the first capture; the king is in check; nothing else happens |
| Legendary rook leaps an ally, then meets two connected enemies | Captures the first only — a rook never multi-captures after a leap. A Legendary queen would take both |
| Unique queen captured, lifeline unused | Returns to the deck at stage end with 1 durability; still counts as 9 lost material; cannot return to the board that stage |
| Unique queen captured a second time | Destroyed normally — the lifeline is once per run per instance |
| Lifeline queen returns while the deck is full | It only reclaims its own slot, so capacity is unchanged |
| Two instances of one type at different tiers | Both legal; they are independent instances (§3) |
| Repaired piece at max durability | Repair is not offered (cannot exceed max) |
| Spent piece captured | Same as any capture — it was already leaving the deck; the capture just gets it first |
| Deck exceeds capacity (e.g. after a purchase bug) | Invariant I9 fails loudly at commit; purchases are refused at the shop instead |
| Three identical pieces, but the result would exceed the act ceiling | Merge refused with the reason shown ("Unique unlocks in Act II") |
| Merge with a damaged input | Allowed if every input has durability ≥ 1; the result is full regardless |
| Merge three Unique queens, one with its lifeline used | Allowed; the Legendary result is a new instance with its lifeline unused |
| Merge three Legendary pieces | Not possible — Legendary is the top tier |
| Merging drops the deck below 4 | Recovery offer does **not** fire: it needs pieces lost in the stage, not merged away |
| All non-king pieces captured mid-run | Run continues with the King and each stage's spawned pawns (as long as the solver finds a mate); the shop's recovery offer fires; abandoning is allowed and labelled honestly |
