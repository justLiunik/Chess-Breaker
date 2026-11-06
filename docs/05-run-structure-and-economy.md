# 05 — Run Structure & Economy

The economy is where the four systems meet: turns become coins, coins become power, and power is
consumed by durability. This document fixes the run's shape and every number that converts between
them. **All constants here also exist in [`data/economy.yaml`](../data/economy.yaml), which is the
single source of truth at runtime.**

---

## 1. Run shape

| Property | Value |
|---|---|
| Acts | 3 |
| Stages per act | 3 |
| Total stages | 9 |
| Boss | stage 3 of each act (3 per run) |
| Target run length | 25–35 min |
| Shop visits | 8 (after every stage except the last) |
| Turn limits | Act I 8 · Act II 6 · Act III 5 · bosses −1 |
| Loss | any stage loss ends the run immediately |

```
ACT I                    ACT II                   ACT III
[s1]→[s2]→[s3 BOSS] ──► [s1]→[s2]→[s3 BOSS] ──► [s1]→[s2]→[s3 BOSS]
   shop shop  shop         shop shop  shop         shop shop   (no shop)
```

The last stage of the run is followed by a results screen, not a shop.

## 2. Income: turns → coins

Coins are awarded **only** for unused turns, plus **salvage** for captures.

```
checkmate win:   coins = (turnLimit − turnsUsed) × coinRate(act)
domination win:  coins = floor((turnLimit − turnsUsed) × coinRate(act) × 0.5)
```

| Act | `coinRate` |
|---|---|
| I | 2 |
| II | 3 |
| III | 4 |

### Payout table — Act I, turn limit 8

| Cleared on turn | Turns remaining | Checkmate payout | Domination payout |
|---|---|---|---|
| 2 | 6 | 12 | 6 |
| 3 | 5 | 10 | 5 |
| 4 | 4 | 8 | 4 |
| 5 | 3 | 6 | 3 |
| 6 | 2 | 4 | 2 |
| 7 | 1 | 2 | 1 |
| 8 | 0 | **0** | **0** |

Winning on the final turn is a win worth nothing. That is intentional and must be legible on the
HUD: the coin preview reads **"+0"** on the last turn, which turns the final turn into a pure
survival check rather than a reward.

### Salvage

Capturing an enemy piece pays `floor(pieceValue / 3)` coins, immediately, during the stage.

| Enemy piece captured | Salvage |
|---|---|
| Pawn | 0 |
| Knight / Bishop / Rook | 1 |
| Queen | 3 |

Salvage is the economy's pressure valve. Turn bonuses reward *speed*; salvage rewards *contact*.
A player who loses pieces to a bad trade still earns something for the counter-punch, which keeps
the deck-attrition loop from becoming a pure downward spiral.

`data/economy.yaml → economy.salvage.enabled` can switch salvage off for tuning experiments; the
default is on.

## 3. Expenditure: coins → power

### Piece prices (Act I base, Normal rarity)

| Piece | Value | Price | Durability | Coins per durability |
|---|---|---|---|---|
| Pawn | 1 | not sold | — | — (spawned free by each stage) |
| Knight | 3 | 8 | 2 | 4.0 |
| Bishop | 3 | 8 | 2 | 4.0 |
| Rook | 5 | 10 | 2 | 5.0 |
| Queen | 9 | 16 | 1 | 16.0 |

**Price inflation:** `price(act) = round(basePrice × (1 + 0.20 × (act − 1)))` — Act II ×1.2,
Act III ×1.44.

That last column is the design statement: a knight or bishop is the cheapest way to buy
**actions**, a queen is the most expensive way to buy **one** action. Durability is priced, not
hidden. The cheapest action of all is a spawned pawn, which costs no coins — only the turns spent
moving it.

### Rarity and prices

Every piece bought in the shop is a Hero Piece with a rarity tier, rolled from an act-gated pool:
Act I can offer at most **Rare**, Act II at most **Unique**, Act III up to **Legendary** (full table
in [07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)). Moving through the acts
therefore raises two things together: prices *and* the rarity ceiling.

Rarity multiplies the price:

```
price = round(basePrice × rarityMultiplier × (1 + 0.20 × (act − 1)))
rarityMultiplier:  Normal ×1 · Rare ×1.5 · Unique ×2 · Legendary ×3
```

A tier that adds power adds cost, which keeps the coins-per-durability column honest. A Legendary
bishop (24 base) costs more than a Normal queen (16) and, like the queen, deploys only once. The full
price grid is in [07 §2.2](07-shop-phase.md#22-prices-by-rarity).

Promotion is the other source of tiers: a spawned pawn that reaches rank 8 becomes a deck piece,
usually one tier above the pawn ([02 §2.2](02-rules-framework.md#22-promotion)). It costs no coins —
it costs the turns spent pushing the pawn, which the coin preview prices at one rate step per turn.

### Services

| Service | Price | Effect |
|---|---|---|
| Repair | 4 | +1 durability to one piece (never above its max) |
| Deck slot | 12 | +1 capacity, up to `maxCapacity` (14) |
| Reroll | 2 | Reroll the shop (first reroll each visit is free) |

### Income vs. expenditure sanity check

An Act I stage cleared on turn 4 pays 8 coins. A knight costs 8. So **one well-played stage ≈ one
meaningful piece** — the run's core pacing unit. Stages cleared late pay 2–4 coins, which buys a
repair or a banked surplus. If a player is clearing most stages on their last turn, they are on an
economic treadmill and will visibly fall behind in Act II. That is the intended failure mode: the
game tells you that you are losing before it kills you.

## 4. Illustrative run

Assumptions: no losses, checkmate wins, one salvage per stage on average, no promotions. Prices
shown at that act's inflation and the item's rarity.

| Stage | Limit | Cleared on | Coins earned | Balance | Purchase | Balance after |
|---|---|---|---|---|---|---|
| I-1 | 8 | 4 | 8 + 1 | 9 | — (bank) | 9 |
| I-2 | 8 | 4 | 8 + 1 | 18 | Rare Knight (12) | 6 |
| I-3 ★ | 7 | 4 | 6 + 1 | 13 | Reroll (0, free) + Repair (4) | 9 |
| II-1 | 6 | 3 | 9 + 1 | 19 | Rook (12) | 7 |
| II-2 | 6 | 3 | 9 + 1 | 17 | Skill: Twin Step (10) | 7 |
| II-3 ★ | 5 | 3 | 6 + 1 | 14 | Deck slot (14) | 0 |
| III-1 | 5 | 3 | 12 + 1 | 13 | Repair ×2 (8) | 5 |
| III-2 | 5 | 2 | 16 + 1 | 22 | Rare Bishop (17) | 5 |
| III-3 ★ | 4 | — | — | — | — | — |

Read the shape: the player oscillates between rich (can buy power) and broke (must survive on what
they have). That oscillation is the desired texture. A run should never let a player feel permanently
comfortable.

## 5. Failure-spiral guardrails

The interaction of permadeath and a fixed income is the game's most dangerous feedback loop. Five
levers, in order of precedence:

| # | Lever | Rule | Rationale |
|---|---|---|---|
| 1 | **Salvage** | Captures pay coins | Aggressive recovery self-funds |
| 2 | **Spawned pawns** | Every stage gives the player free pawns, and a pawn that promotes becomes a deck piece | A broke player still gets free pieces on the board every stage, and a coin-free way to rebuild the deck |
| 3 | **Recovery offer** | If non-king deck < 4, the shop guarantees one discounted replacement (50% off) | Insurance against one catastrophic stage |
| 4 | **Bank & skip** | Shop may be skipped to accumulate | Early banking enables a mid-run power spike |
| 5 | **Turn limits** | Difficulty does not increase with a weak deck | The run's difficulty comes from deck quality, so the player controls it |

**Explicit non-lever:** the game will **not** quietly raise income when the player is losing, and
will **not** scale the enemy to the deck. Hidden assistance would destroy the "fair and provable"
pillar. A lost run must be *diagnosable* from the numbers on screen.

## 6. What "rich" and "poor" mean

| State | Symptom | Player response |
|---|---|---|
| Rich (≥20 coins) | Buying power, not survival | Take riskier, faster lines; buy a second skill |
| Comfortable (8–19) | One meaningful purchase per shop | Standard play |
| Poor (1–7) | Repair only, or bank | Must slow down; must protect pieces; promotion becomes attractive |
| Broke (0) | Cannot buy | Win the next stage on the opening line and spawned pawns |

The broke state is recoverable — the guaranteed opening line plus each stage's spawned pawns mean a
player is never *forced* to lose. They are only forced to play well.

## 7. Tuning knobs (all in `data/economy.yaml`)

| Knob | Default | Raising it does |
|---|---|---|
| `coinRate.{act}` | 2/3/4 | Makes runs richer and builds faster |
| `dominationPayoutMultiplier` | 0.5 | Makes the safe route more attractive |
| `salvage.divisor` | 3 | Makes contact play more profitable |
| `priceInflationPerAct` | 0.20 | Tightens Act II–III economy |
| `starterCoins` | 0 | Front-loads build choices before stage 1 |
| `shop.slots` | 5 | Widens variance and choice |
| `rarity.pool.{act}.weights` | 75/25 · 50/38/12 · 30/40/24/6 | Makes higher tiers commoner in that act (shop and spawned pawns) |
| `rarity.pool.{act}.ceiling` | rare · unique · legendary | Unlocks higher tiers earlier (Act I must stay at `rare`) |
| `rarity.priceMultiplier` | 1 / 1.5 / 2 / 3 | Makes higher tiers costlier; must never fall with tier |
| `promotion.tierUpChance` | 0.75 | Makes promotion a stronger reward |
| `promotion.resultTypeWeights` | N35 B35 R20 Q10 | Shifts promotion toward bigger pieces |
| `rarity.retention.queen.legendary` | 0.2 | Makes Legendary queens less rare (1.0 = as common as other Legendaries) |

**Tuning order:** `coinRate` first (it is the universal dial), then `priceInflationPerAct`, then
prices. Never tune `turnLimit` and `coinRate` in the same pass — you will not be able to attribute
the change.
