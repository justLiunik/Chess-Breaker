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

After every other won stage the run goes **straight to the shop**; there is no stage-end chooser. If a
promotion pushed the deck above 8 pieces ([02 §2.2](02-rules-framework.md#22-promotion)), the shop
works as usual — except that buying a piece is refused, and **leaving for the next stage is refused**
(`deck_over_capacity`) until selling, merging or cutting brings the deck back to 8 (I9). Cutting is
always possible, so the gate cannot lock a run. After the final stage the deck size no longer matters.

## 2. Income: stage reward + turns → coins

Checkmate is the only way to clear a stage ([02 §7](02-rules-framework.md#7-stage-end-evaluation)).
Every stage has a **par**, "Mate in X" (X = 2–5), that the solver has proved reachable
([04 §5](04-stage-generation-and-authoring.md#5-the-solver)). There is **no turn limit**: turns 1 to
X are free, and every later turn costs **overtime**. A cleared stage pays its **base reward**, less
any overtime it covered, plus a **par bonus** for a mate within X, plus **interest** on the wallet,
plus **salvage** for captures.

```
coins = max(0, baseReward(act, tier) − overtimePaid) + (turnsUsed ≤ mateIn ? parBonus(act, tier) : 0)
        + interest + salvage
```

| Act | Base reward (normal / boss ×1.5) | Par bonus (normal / boss ×1.5) | `overtimeCost` per turn past the par |
|---|---|---|---|
| I | 4 / 6 | 6 / 9 | 2 |
| II | 6 / 9 | 9 / 14 | 3 |
| III | 8 / 12 | 12 / 18 | 4 |

Boss amounts are rounded to the nearest coin.

**Overtime** is paid when a turn past the par starts: **from the stage's pending base reward first,
then from the wallet**. If the two together cannot pay, the run is lost (`out_of_coins`,
[02 §7](02-rules-framework.md#7-stage-end-evaluation)). Drawing on the reward first means the first
stage of a run, played with an empty wallet, still allows a few overtime turns.

### Reward table — Act I normal stage, par Mate in 5

| Mated on turn | Overtime paid (reward / wallet) | Base left | Par bonus | Stage pays (before salvage) | Wallet |
|---|---|---|---|---|---|
| 2–5 | — | 4 | 6 | **10** | ±0 |
| 6 | 2 / 0 | 2 | 0 | 2 | ±0 |
| 7 | 4 / 0 | 0 | 0 | 0 | ±0 |
| 8 | 4 / 2 | 0 | 0 | 0 | −2 |
| 9 | 4 / 4 | 0 | 0 | 0 | −4 |

The par is the incentive and the overtime is the clock. A mate within the par pays two and a half
times the base reward; past it, the stage first eats its own reward and then the run's savings, and a
player who cannot pay loses the run. **The par is hidden in the shop preview** — the player plans
the deployment from the board alone — and **shown on the HUD once the stage starts**, with the
overtime bill counting up after it ([08](08-progression-and-ux.md)).

### Interest

Savings earn interest (decided 2026-11-13, M4). A won stage pays **1 coin for every 5 coins in the
wallet, at most 5**:

```
interest = min(interest.max, floor(walletAtMate / interest.per) × interest.coins)     # 5, 5, 1
```

| Wallet at the mate | 0–4 | 5–9 | 10–14 | 15–19 | 20–24 | 25+ |
|---|---|---|---|---|---|---|
| Interest | 0 | 1 | 2 | 3 | 4 | **5** |

`walletAtMate` is the wallet when the mate lands, **before** the stage's award is added: it already
holds the salvage earned in this stage and has already paid any overtime the reward could not cover.
So a slow mate costs twice — the overtime itself, and the interest on the coins it took from the
wallet. Interest is the same in every act and on bosses (never boss-scaled), is paid on the final
stage too, and is part of the coin preview, so preview still equals payout (I10). A lost stage pays
nothing; the run is over.

Interest is the reward for banking ([§5](#5-failure-spiral-guardrails), [07 §5](07-shop-phase.md#5-bank--skip)):
skipping a purchase now pays a little every later stage, and a wallet kept at 25 doubles as the
buffer that pays for overtime.

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

| Piece | Value | Spawn cost | Price | Durability | Coins per durability |
|---|---|---|---|---|---|
| Pawn | 1 | — | not sold | — | — (spawned free by each stage) |
| Knight | 3 | 3 | 8 | 2 | 4.0 |
| Bishop | 3 | 3 | 8 | 2 | 4.0 |
| Rook | 5 | 5 | 10 | 2 | 5.0 |
| Queen | 9 | 9 | 16 | 2 | 8.0 |

**Price inflation:** `price(act) = round(basePrice × (1 + 0.20 × (act − 1)))` — Act II ×1.2,
Act III ×1.4 (linear, not compounding).

Durability is flat ([06 §1](06-deck-durability-and-permadeath.md#1-the-piece-table)), so the last
column now tracks price alone: a knight or bishop is still the cheapest way to buy **summons**, a
queen the most expensive. What keeps the queen from being the obvious buy is the spawn-cost column —
it spends a whole Act I budget — not its durability. Whether 16 coins is still the right price for a
queen that can be summoned twice is an M6 balance question ([10](10-roadmap-and-milestones.md)). The cheapest action of all is a spawned pawn, which costs no coins — only the turns spent
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
bishop (24 base) costs more than a Normal queen (16) and 5 spawn points to summon instead of 3. The full
price grid is in [07 §2.2](07-shop-phase.md#22-prices-by-rarity).

Promotion is the other way to gain a piece: a spawned pawn that reaches rank 8 becomes the piece the
player chooses — knight, bishop, rook or queen — at the **pawn's rarity**, stays on the board for the
rest of the stage, and joins the deck ([02 §2.2](02-rules-framework.md#22-promotion)). It costs no
coins — it costs the turns spent pushing the pawn, which the coin preview prices at one rate step per
turn — and it pays at once, on the board, as well as in later stages.

### Services

| Service | Price | Effect |
|---|---|---|
| Repair | 4 | +1 durability to one piece (never above its max); repeatable within a visit |
| Reroll | 2 | Reroll slots 1–4 (first reroll each visit is free; at most 3 per visit) |
| **Sell** | pays **½** of the piece's current price, rounded down, **never more than it cost** | The piece leaves the run; never the King or a `spent` piece ([07 §4](07-shop-phase.md#4-purchases)) |

**Selling is a release valve, not a profit.** Buying and selling loses half. Using a piece once and
selling it nets 4 coins per summon for a Normal knight — exactly the repair rate, so selling never
beats keeping a piece alive. A promoted piece joins the deck with `pricePaid: 0`, so it **sells for
0** — selling it is in effect a cut. Promotion is never a coin source; it pays in board strength (M5.1,
to be revisited in the tuning pass after the next playtest). The sell factor may
never exceed the recovery discount (both 0.5), or buying the discounted recovery piece and selling
it back would print coins — the validator enforces this. Act inflation alone could still do it (a
recovery knight bought for 4 in Act I would sell for 5 in Act II or III), so a shop-bought
piece remembers what it cost (`pricePaid`) and **never sells for more**:
`sell = min(floor(0.5 × current price), pricePaid)`. Starter and merged pieces cost no coins and
are not capped; a promoted piece is capped at its `pricePaid` of 0.

### Income vs. expenditure sanity check

An Act I stage mated within the par pays 10 coins. A Normal knight costs 8 and a Rare knight 12. So
**one well-played stage ≈ one meaningful piece** — the run's core pacing unit. A stage mated past
the par pays at most 2, and can cost savings, which buys nothing.

There is no capacity to buy: the deck is fixed at 8 pieces ([06 §2](06-deck-durability-and-permadeath.md#2-deck-capacity)),
so coins go into pieces, skills, repairs and rerolls only; selling a piece is the only way back from
pieces to coins, at half price. Merging three identical pieces into one
of the next tier is free ([06 §4.5](06-deck-durability-and-permadeath.md#45-merging)) — it costs pieces,
not coins. If a player is clearing most stages past the par, they are on an
economic treadmill and will visibly fall behind in Act II. That is the intended failure mode: the
game tells you that you are losing before it kills you.

## 4. Illustrative run

Assumptions: no losses, one salvage per stage on average, no promotions. Coins earned are base (less
overtime) + par bonus + salvage + interest (interest on the wallet at the mate, which already holds
that stage's salvage). Prices shown at that act's inflation and the item's rarity.

| Stage | Par | Mated on | Coins earned | Balance | Purchase / merge | Balance after | Deck |
|---|---|---|---|---|---|---|---|
| I-1 | 5 | 4 | 4 + 6 + 1 + 0 = 11 | 11 | Knight (8), then merge 3 Knights → Rare Knight | 3 | 3/8 |
| I-2 | 5 | 5 | 4 + 6 + 1 + 0 = 11 | 14 | Rook (10) | 4 | 4/8 |
| I-3 ★ | 4 | 4 | 6 + 9 + 1 + 1 = 17 | 21 | Reroll (free) + Repair (4) + Bishop (8), then merge 3 Bishops → Rare Bishop | 9 | 3/8 |
| II-1 | 4 | 3 | 6 + 9 + 1 + 2 = 18 | 27 | Skill: Twin Step (5) | 22 | 3/8 |
| II-2 | 3 | 4 | (6 − 3) + 0 + 1 + 4 = 8 | 30 | Rare Rook (18) | 12 | 4/8 |
| II-3 ★ | 3 | 3 | 9 + 14 + 1 + 2 = 26 | 38 | Rare Knight (14) | 24 | 5/8 |
| III-1 | 3 | 3 | 8 + 12 + 1 + 5 = 26 | 50 | Repair ×2 (8) | 42 | 5/8 |
| III-2 | 2 | 2 | 8 + 12 + 1 + 5 = 26 | 68 | Rare Queen (34) | 34 | 6/8 |
| III-3 ★ | 2 | — | — | — | — | — | — |

II-2 shows a missed par: one overtime turn eats 3 of the 6 base coins and the par bonus is lost, so
the stage pays 8 instead of 20. Interest (2026-11-13) adds about 2 coins a stage in Act II and the
full 5 in Act III once the wallet stays above 25, which makes banking a real line; with single-use
skills at 3–5 coins, Act III wallets run rich here. Re-tuning prices, interest and income together is
an M6 item.

Read the shape: the player oscillates between rich (can buy power) and broke (must survive on what
they have), and merges trade deck width for tier — the deck shrinks to 3 twice in Act I to buy two
Rare pieces early. That oscillation is the desired texture. A run should never let a player feel
permanently comfortable.

The par economy (2026-11-11) replaced the leftover-turn bonus. A run that hits every par earns
about what the old economy paid for a turn-4 clear, but a missed par now costs more than it used to:
the bonus is gone and overtime eats the base reward. Prices have not been re-tuned for that yet; it is
the first item for the M6 balance pass.

## 5. Failure-spiral guardrails

The interaction of permadeath and a fixed income is the game's most dangerous feedback loop. Seven
levers, in order of precedence:

| # | Lever | Rule | Rationale |
|---|---|---|---|
| 1 | **Base reward** | Overtime is paid from the stage's base reward before the wallet | A slow clear spends its own prize before the run's savings |
| 2 | **Salvage** | Captures pay coins | Aggressive recovery self-funds |
| 3 | **Spawned pawns** | Every stage gives the player free pawns, and a pawn that promotes becomes the piece the player chooses, on the board and in the deck | A broke player still gets free pieces on the board every stage, and a coin-free way to rebuild the deck |
| 4 | **Recovery offer** | If pieces were lost in the stage just cleared and the non-king deck is now < 4, the shop guarantees one discounted replacement (50% off) | Insurance against one catastrophic stage — not a reward for merging down |
| 5 | **Bank & skip** | Shop may be skipped to accumulate; savings earn interest (§2, up to 5 a stage) | Early banking enables a mid-run power spike, and the wallet buffers overtime |
| 6 | **Par** | Difficulty does not increase with a weak deck | The run's difficulty comes from deck quality, so the player controls it |
| 7 | **Summon choice** | Pieces left in the deck at Deployment spend no durability and cannot be captured ([02 §5](02-rules-framework.md#5-deployment)) | A fragile deck can be protected by bringing less, at the price of a slower mate |

**Explicit non-lever:** the game will **not** quietly raise income when the player is losing, and
will **not** scale the enemy to the deck. Hidden assistance would destroy the "fair and provable"
pillar. A lost run must be *diagnosable* from the numbers on screen.

**The one documented exception — the unproven-stage pawn.** When the generator cannot prove a stage
within its par (three boards, [04 §3](04-stage-generation-and-authoring.md#3-generation-pipeline)), it
adds one spawned pawn to the first board. Weak decks fail the proof more often, so this pawn reaches
them more often. It stays inside the pillar because the rule is public (the Codex states it, [08 §7](08-progression-and-ux.md#7-hints-and-chess-literacy)) and
the pawn is on the board like any other: nothing about the run is hidden except *which* stage got it.
The shop preview carries no label ([07 §1](07-shop-phase.md#1-entry-exit-and-flow)).

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
| `parBonus.{act}` | 6/9/12 | Makes a mate within the par pay more |
| `overtimeCost.{act}` | 2/3/4 | Makes every turn past the par cost more; raises the risk of `out_of_coins` |
| `salvage.divisor` | 3 | Makes contact play more profitable |
| `interest.{per, coins, max}` | 5 / 1 / 5 | Makes banking pay more (lower `per`, higher `coins` or `max`) |
| `shop.skillChance` | 0.2 | Makes skills commoner in slots 3–4 |
| `shop.pieceTypeWeights` | N35 B35 R20 Q10 | Shifts shop pieces toward bigger types |
| `priceInflationPerAct` | 0.20 | Tightens Act II–III economy |
| `starterCoins` | 0 | Front-loads build choices before stage 1 |
| `shop.slots` | 5 | Widens variance and choice |
| `rarity.pool.{act}.weights` | 75/25 · 50/38/12 · 30/40/24/6 | Makes higher tiers commoner in that act (shop and spawned pawns) |
| `rarity.pool.{act}.ceiling` | rare · unique · legendary | Unlocks higher tiers earlier (Act I must stay at `rare`) |
| `rarity.priceMultiplier` | 1 / 1.5 / 2 / 3 | Makes higher tiers costlier; must never fall with tier |
| `deployment.maxQueenSummons` | 1 | Lets more queens be summoned into one stage ([02 §5](02-rules-framework.md#5-deployment)) |
| `deck.merge.inputs` | 3 | Makes merging rarer and costlier in pieces (2 = cheaper merges) |
| `services.sell.priceFactor` | 0.5 | Makes selling pay more; must stay ≤ `shop.recoveryDiscount` |
| `rarity.retention.queen.legendary` | 0.2 | Makes Legendary queens less rare (1.0 = as common as other Legendaries) |

**Tuning order:** `baseReward` and `parBonus` first (together they set income; `parBonus` alone sets
the reward for speed), then `interest`, then `overtimeCost`, then `priceInflationPerAct`, then prices. Never tune a
template's `mateIn` range and `parBonus` in the same pass — you will not be able to attribute the
change.
