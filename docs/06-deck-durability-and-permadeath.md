# 06 — Deck, Durability & Permadeath

This is the game's long-run resource and its emotional core. Turns are the clock the player watches;
**durability is the clock that kills them.**

---

## 1. The piece table

| Piece | Value | Price (Act I, Normal) | Durability max | Notes |
|---|---|---|---|---|
| King | — | not sold | ∞ | Run identity; never destroyed |
| Pawn | 1 | **not sold** | — | Never in the deck: spawned free by each stage; promotes into a deck piece ([02 §2.1](02-rules-framework.md#21-pawns-come-from-the-stage-never-the-deck)) |
| Knight | 3 | 8 | 2 | Standard mid-piece; widening jumps by rarity |
| Bishop | 3 | 8 | 2 (Legendary: **1**) | Standard mid-piece; Ascension target; leaps allies by rarity |
| Rook | 5 | 10 | 2 | Reach; leaps allies, then a two-piece battering ram by rarity |
| Queen | 9 | 16 | **1** | One deployment ever — a burst, not a soldier; lifeline, then full sweep by rarity; Legendary is the rarest piece |

Rarity multiplies the price (×1 / ×1.5 / ×2 / ×3) and adds abilities to knights, bishops, rooks and
queens ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)).

### The single most important design decision in this table

**Durability is inversely correlated with piece power.** A queen is the strongest piece and can be
deployed exactly once per purchase. A knight or bishop can be deployed twice.

This makes every deck slot a real trade:

- A **reliable** deck of knights and bishops plays slowly but never collapses.
- A **spiky** deck with queens wins specific stages spectacularly and then evaporates.
- The correct answer changes per template, which is what makes deckbuilding a skill.

If durability were flat, the queen would strictly dominate every slot and the deck would have one
correct shape. It must not. **Rarity obeys the same rule:** a tier that makes a piece move like a
queen also makes it deploy like one, which is why a Legendary bishop has a durability of 1. No tier
ever raises durability.

## 2. Deck capacity

| Property | Value |
|---|---|
| Starting capacity | 8 slots |
| Maximum capacity | 14 slots (bought in shop) |
| King occupies a slot | **No** — capacity counts non-king pieces |
| Starter deck | King + 2 Knights + 2 Bishops, all Normal (4 of 8 slots) |
| Pawns | Never in the deck — they come from the stage |

The starter deck leaves **four free slots**. That is deliberate: the first shop should be able to sell
you something, and the first promotion should land in the deck, without forcing a cut — the
deckbuilding lesson lands before the deckbuilding pressure. The board still feels full early on
because every stage spawns its own pawns.

Capacity is the run's power ceiling. Raising it is expensive (12 coins) because capacity is the
purchase with the highest long-run return — it makes every subsequent shop better.

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

**Opening-line pieces are Hero Pieces.** They are drawn from the deck ([02 §5](02-rules-framework.md#5-deployment))
and keep their own rarity; "placed at stage start" does not make a piece a Stage Piece.

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
   through the shop and through promotion.
5. **Rarity is fixed at creation.** An instance keeps its tier for its whole life. Transforms
   (e.g. Ascension) change the piece type temporarily, never the rarity. Repairs do not change
   rarity. There is no upgrade path.
6. **Rarity availability is gated by progression.** Shop offers, spawned pawns and promotion results
   all respect the act's rarity ceiling; in Act I that ceiling is **Rare**, so Unique and Legendary
   pieces cannot be acquired until later acts. Full rules: [07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating).
7. **Skills have no rarity.** Rarity is a property of pieces only.

### 4.4 What rarity does

| Piece | What its tier changes |
|---|---|
| Pawn | Only its promotion result: usually one tier above the pawn ([02 §2.2](02-rules-framework.md#22-promotion)) |
| Bishop | Rare leaps allies (no capture on a leap) · Unique captures after a leap · Legendary moves like a queen, durability 1 ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) |
| Knight | Rare adds a 2-square straight leap · Unique adds a 2-square diagonal leap · Legendary gets a free second move each turn ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) |
| Rook | Rare leaps allies (no capture on a leap) · Unique adds a 1-square diagonal step · Legendary captures one piece after a leap and multi-captures two connected enemies on a non-leap move ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) |
| Queen | Rare leaps allies (no capture on a leap) · Unique gains a once-per-run lifeline · Legendary captures after a leap and multi-captures on any move ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)) |
| Every type | Shop price ×1 / ×1.5 / ×2 / ×3 ([05 §3](05-run-structure-and-economy.md#3-expenditure-coins--power)) |

What rarity never changes: chess material value (swing and salvage), the cost of deploying (1 credit
+ 1 durability), or repairs. Permadeath has exactly one exception: the Unique+ queen's once-per-run
lifeline (§6).

## 5. Durability lifecycle

```
                    ┌──────────────────────────────────────────┐
                    │              in_deck                     │
                    │   durability: n  (n ≥ 1)                 │
                    └───────────────┬──────────────────────────┘
                                    │ DEPLOY  (cost: 1 move credit
                                    │          + 1 durability)
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

**Rules**

1. Deploying decrements durability by exactly 1 and requires durability ≥ 1.
2. A deployed piece that survives returns to the deck with its reduced durability.
3. **A piece whose durability reaches 0 is marked `spent`.** It remains on the board for the rest of
   the stage (it is still a piece!) but is **removed from the deck at stage end**. It cannot be
   deployed again, repaired, or used next stage.
4. **A captured piece is destroyed immediately and permanently.** It leaves the run. No repair
   effect, shop, or skill can recover it. Only a *new instance* of the same type can be bought. The
   single exception is a Unique or Legendary queen's **lifeline**: once per run, the captured queen
   returns to the deck at stage end with 1 durability instead ([02 §2.3](02-rules-framework.md#23-rarity-movement-abilities)).
5. A piece with 0 durability can still be **repaired** during the same stage it went spent? **No.**
   `spent` is final — this closes a repair-dodge loophole and keeps the 0-durability threshold
   meaningful. Repairs only apply to `in_deck` or `deployed` pieces with durability ≥ 1.

**Why "spent" rather than instant destruction:** a piece that vanishes the moment it is summoned is
absurd to watch and removes the tension of playing out a stage with a doomed army. Marking it spent
lets the player spend it *now* and feel the cost *after* — which is the same shape as the coin
economy and teaches the same lesson.

## 6. Capture and permadeath

| Event | Effect on the run |
|---|---|
| Player piece captured while deployed | Instance destroyed; removed from deck permanently (except a Unique+ queen with its lifeline unused) |
| Player piece captured as part of the opening line | **Same** — the opening line is drawn from the deck |
| Enemy piece captured | Salvage coins (`floor(value/3)`); no effect on the enemy deck (there isn't one) |
| Player king "captured" | Impossible — checkmate ends the stage instead |

**The opening line is drawn from the deck, so it is not safe.** The only difference between an
opening-line piece and a deployed piece is who chose the square. Both persist, both carry durability,
both die permanently. This closes the "free cannon fodder" loophole that would otherwise let a player
avoid all risk by never deploying.

## 7. The King

| Property | Rule |
|---|---|
| Presence | Guaranteed in the deck; always placed in the opening line |
| Capacity | Occupies no deck slot |
| Durability | Infinite; never decremented, never spent |
| Rarity | None — `null`, outside the rarity system (§4) |
| Capture | Impossible (invariant I3) |
| Removal | Cannot be sold, sacked, or destroyed by any effect |
| Defeat | Checkmate of the player king ends the run |

The King is the run's anchor. Because it can never be lost, the player can never reach an unwinnable
state caused by an empty deck — only one caused by their own play. This is a load-bearing guarantee:
it is what lets the game promise "the opening line plus the stage's spawned pawns mean you are never
forced to lose."

## 8. Guardrails

| Lever | Rule | Prevented failure |
|---|---|---|
| **King immunity** | King never lost | Deck emptied entirely |
| **Opening line** | Always drawn from the remaining deck | Stage starts with no army |
| **Spawned pawns** | Every stage gives the player free pawns, whatever the deck holds | Broke and piece-less |
| **Recovery offer** | Non-king deck < 4 → one discounted replacement guaranteed | Post-catastrophe death spiral |
| **Salvage** | Captures pay coins | Attrition has no counter-income |
| **Telegraphing** | UI warns when a deployment target is attacked | Losing pieces to invisible threats |

## 9. Communication rules (UI contract)

Durability must be readable without opening a panel.

1. **Durability pips** on every deck tile — filled for remaining, hollow for spent. Never a bare
   number alone: the pips are the primary read.
2. **Deploy hover** shows `durability 2 → 1`, not just `1`.
3. **Spent warning:** deploying a piece whose durability would reach 0 shows a persistent
   "last deployment — removed after this stage" marker on the confirm.
4. **Capture telegraph:** if the deployment target square is attacked by an enemy piece, the target
   is marked with the threat and the capture line is previewed. This is information the player could
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
| Deck contains only the King | Opening line = King only; stage is playable but nearly impossible; UI offers abandon-run |
| Deploy with no legal square | Action cannot be committed; durability not spent |
| Deploy that would leave own king in check | Commit refused (I2); durability not spent |
| Captured while transformed (Ascension) | Piece destroyed normally; no reversion step |
| Hero Piece transformed (Ascension) | Piece type changes for the turn; rarity does not |
| Captured Rare/Unique/Legendary piece | Destroyed like any other; rarity grants no protection and no refund |
| Promotion while the deck is full | The new piece joins the deck anyway; at stage end, before the shop, the player must cut pieces until the deck fits (I9) |
| Spawned pawn captured | Lost for this stage only; counts as 1 lost material in the swing; nothing leaves the deck |
| Spawned pawn survives the stage without promoting | Discarded at stage end; nothing carries over |
| Promoted piece deployed in the same stage | Allowed — it joins the deployable pool at once and pays the normal deploy cost |
| Legendary knight + Twin Step | Both apply: Twin Step adds a credit for any piece; the knight's bonus move is only for itself |
| Ascension on a Rare/Unique bishop | It moves as a Normal queen for the turn; its leap abilities return when the transform reverts |
| Legendary knight gives check, then tries to capture the king with its bonus move | Impossible: the king's square is never a legal destination (I3). The bonus move may go anywhere else |
| Multi-capture whose second target is the enemy king | The move stops on the first capture; the king is in check; nothing else happens |
| Legendary rook leaps an ally, then meets two connected enemies | Captures the first only — a rook never multi-captures after a leap. A Legendary queen would take both |
| Unique queen captured, lifeline unused | Returns to the deck at stage end with 1 durability; still counts as 9 lost material; not redeployable that stage |
| Unique queen captured a second time | Destroyed normally — the lifeline is once per run per instance |
| Lifeline queen returns while the deck is full | It only reclaims its own slot, so capacity is unchanged |
| Two instances of one type at different tiers | Both legal; they are independent instances (§3) |
| Repaired piece at max durability | Repair is not offered (cannot exceed max) |
| Spent piece captured | Same as any capture — it was already leaving the deck; the capture just gets it first |
| Deck exceeds capacity (e.g. after a purchase bug) | Invariant I9 fails loudly at commit; purchases are refused at the shop instead |
| All non-king pieces captured mid-run | Run continues with the King and each stage's spawned pawns; the shop's recovery offer fires; abandoning is allowed and labelled honestly |
