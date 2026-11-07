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

## 2. Income: stage reward + turns → coins

Checkmate is the only way to clear a stage ([02 §7](02-rules-framework.md#7-stage-end-evaluation)).
Every cleared stage pays its **base reward in full**, plus **bonus coins** for every unused turn,
plus **salvage** for captures.

```
coins = baseReward(act, tier) + (turnLimit − turnsUsed) × coinRate(act) + salvage
```

| Act | Base reward (normal) | Base reward (boss, ×1.5) | `coinRate` per unused turn |
|---|---|---|---|
| I | 4 | 6 | 2 |
| II | 6 | 9 | 3 |
| III | 8 | 12 | 4 |

### Reward table — Act I normal stage, turn limit 8

| Cleared on turn | Turns remaining | Base | Turn bonus | Total (before salvage) |
|---|---|---|---|---|
| 2 | 6 | 4 | 12 | 16 |
| 3 | 5 | 4 | 10 | 14 |
| 4 | 4 | 4 | 8 | 12 |
| 5 | 3 | 4 | 6 | 10 |
| 6 | 2 | 4 | 4 | 8 |
| 7 | 1 | 4 | 2 | 6 |
| 8 | 0 | 4 | **0** | **4** |

Winning on the final turn still pays the base reward — clearing the stage is always worth something —
but nothing more. That must be legible on the HUD: the coin preview reads **"+4 ◈ FINAL TURN"**,
so the player sees that every turn they saved would have been worth extra.

The base reward is the floor; the turn bonus is the incentive. Speed is still the main lever: in Act
I, a turn-4 clear pays three times a turn-8 clear.

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
| Reroll | 2 | Reroll the shop (first reroll each visit is free) |

### Income vs. expenditure sanity check

An Act I stage cleared on turn 4 pays 12 coins. A Normal knight costs 8 and a Rare knight 12. So
**one well-played stage ≈ one meaningful piece** — the run's core pacing unit. Stages cleared late
pay 4–8 coins, which buys a repair, a Normal piece, or a banked surplus.

There is no capacity to buy: the deck is fixed at 8 pieces ([06 §2](06-deck-durability-and-permadeath.md#2-deck-capacity)),
so coins go into pieces, skills, repairs and rerolls only. Merging three identical pieces into one
of the next tier is free ([06 §4.5](06-deck-durability-and-permadeath.md#45-merging)) — it costs pieces,
not coins. If a player is clearing most stages on their last turn, they are on an
economic treadmill and will visibly fall behind in Act II. That is the intended failure mode: the
game tells you that you are losing before it kills you.

## 4. Illustrative run

Assumptions: no losses, one salvage per stage on average, no promotions. Coins earned are
base + turn bonus + salvage. Prices shown at that act's inflation and the item's rarity.

| Stage | Limit | Cleared on | Coins earned | Balance | Purchase / merge | Balance after | Deck |
|---|---|---|---|---|---|---|---|
| I-1 | 8 | 4 | 4 + 8 + 1 = 13 | 13 | Knight (8), then merge 3 Knights → Rare Knight | 5 | 3/8 |
| I-2 | 8 | 4 | 4 + 8 + 1 = 13 | 18 | Rook (10) | 8 | 4/8 |
| I-3 ★ | 7 | 4 | 6 + 6 + 1 = 13 | 21 | Reroll (free) + Repair (4) + Bishop (8), then merge 3 Bishops → Rare Bishop | 9 | 3/8 |
| II-1 | 6 | 3 | 6 + 9 + 1 = 16 | 25 | Skill: Twin Step (10) | 15 | 3/8 |
| II-2 | 6 | 3 | 6 + 9 + 1 = 16 | 31 | Rare Rook (18) | 13 | 4/8 |
| II-3 ★ | 5 | 3 | 9 + 6 + 1 = 16 | 29 | Rare Knight (14) | 15 | 5/8 |
| III-1 | 5 | 3 | 8 + 8 + 1 = 17 | 32 | Repair ×2 (8) | 24 | 5/8 |
| III-2 | 5 | 2 | 8 + 12 + 1 = 21 | 45 | Rare Queen (35) | 10 | 6/8 |
| III-3 ★ | 4 | — | — | — | — | — | — |

Read the shape: the player oscillates between rich (can buy power) and broke (must survive on what
they have), and merges trade deck width for tier — the deck shrinks to 3 twice in Act I to buy two
Rare pieces early. That oscillation is the desired texture. A run should never let a player feel
permanently comfortable.

Compared with the earlier turn-bonus-only economy, the base reward raises income by roughly 40%, and
the 12–14-coin deck-slot sink is gone. Prices have not been re-tuned for that yet; it is the first
item for the M6 balance pass.

## 5. Failure-spiral guardrails

The interaction of permadeath and a fixed income is the game's most dangerous feedback loop. Seven
levers, in order of precedence:

| # | Lever | Rule | Rationale |
|---|---|---|---|
| 1 | **Base reward** | Every cleared stage pays its base reward, even on the final turn | A slow clear is never worthless |
| 2 | **Salvage** | Captures pay coins | Aggressive recovery self-funds |
| 3 | **Spawned pawns** | Every stage gives the player free pawns, and a pawn that promotes becomes a deck piece | A broke player still gets free pieces on the board every stage, and a coin-free way to rebuild the deck |
| 4 | **Recovery offer** | If pieces were lost in the stage just cleared and the non-king deck is now < 4, the shop guarantees one discounted replacement (50% off) | Insurance against one catastrophic stage — not a reward for merging down |
| 5 | **Bank & skip** | Shop may be skipped to accumulate | Early banking enables a mid-run power spike |
| 6 | **Turn limits** | Difficulty does not increase with a weak deck | The run's difficulty comes from deck quality, so the player controls it |
| 7 | **Summon choice** | Pieces left in the deck at Deployment spend no durability and cannot be captured ([02 §5](02-rules-framework.md#5-deployment)) | A fragile deck can be protected by bringing less, at the price of a slower mate |

**Explicit non-lever:** the game will **not** quietly raise income when the player is losing, and
will **not** scale the enemy to the deck. Hidden assistance would destroy the "fair and provable"
pillar. A lost run must be *diagnosable* from the numbers on screen.

## 6. What "rich" and "poor" mean

| State | Symptom | Player response |
|---|---|---|
| Rich (≥20 coins) | Buying power, not survival | Take riskier, faster lines; buy a second skill |
| Comfortable (8–19) | One meaningful purchase per shop | Standard play |
| Poor (1–7) | Repair only, or bank | Must slow down; must protect pieces; promotion becomes attractive |
| Broke (0) | Cannot buy | Win the next stage with what the deck still holds and the spawned pawns |

The broke state is recoverable — the King is always available, every stage spawns free pawns, and the
solver proves each stage winnable with the deck as it actually is, so a player is never *forced* to
lose. They are only forced to play well.

## 7. Tuning knobs (all in `data/economy.yaml`)

| Knob | Default | Raising it does |
|---|---|---|
| `baseReward.{act}` | 4/6/8 | Makes every clear worth more, regardless of speed |
| `baseReward.bossMultiplier` | 1.5 | Makes bosses pay more |
| `coinRate.{act}` | 2/3/4 | Makes speed pay more |
| `salvage.divisor` | 3 | Makes contact play more profitable |
| `priceInflationPerAct` | 0.20 | Tightens Act II–III economy |
| `starterCoins` | 0 | Front-loads build choices before stage 1 |
| `shop.slots` | 5 | Widens variance and choice |
| `rarity.pool.{act}.weights` | 75/25 · 50/38/12 · 30/40/24/6 | Makes higher tiers commoner in that act (shop and spawned pawns) |
| `rarity.pool.{act}.ceiling` | rare · unique · legendary | Unlocks higher tiers earlier (Act I must stay at `rare`) |
| `rarity.priceMultiplier` | 1 / 1.5 / 2 / 3 | Makes higher tiers costlier; must never fall with tier |
| `promotion.tierUpChance` | 0.75 | Makes promotion a stronger reward |
| `promotion.resultTypeWeights` | N35 B35 R20 Q10 | Shifts promotion toward bigger pieces |
| `deck.merge.inputs` | 3 | Makes merging rarer and costlier in pieces (2 = cheaper merges) |
| `rarity.retention.queen.legendary` | 0.2 | Makes Legendary queens less rare (1.0 = as common as other Legendaries) |

**Tuning order:** `baseReward` and `coinRate` first (together they set income; `coinRate` alone sets
the reward for speed), then `priceInflationPerAct`, then prices. Never tune `turnLimit` and `coinRate` in the same pass — you will not be able to attribute
the change.
