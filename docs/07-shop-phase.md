# 07 — Shop Phase

The shop is where a run is won or lost. It converts the stage's tempo into the next stage's
possibility, and it is the only screen where the player holds full information and unlimited time.

---

## 1. Entry, exit, and flow

```
stage cleared (win)  ──►  next stage generated  ──►  SHOP (with its preview)  ──►  stage
                         (in the background)          │
                                                      └─► (or skipped / final stage → results)
```

| Property | Rule |
|---|---|
| Trigger | Immediately after every **won** stage |
| Final stage | **No shop** — results screen instead |
| Exit conditions | Buy/leave, or skip (`Bank & continue`) |
| Time limit | None. The shop never pressures. |
| Can be re-entered | No. One visit per stage. |
| Losing a stage | No shop; the run ends |
| Next-stage preview | The next stage is generated as soon as this one is cleared, with the deck as it stands after the stage-end chooser, and shown in the shop as a full board: enemy formation, spawned pawns and their promotion results. **The par (`mateIn`) is never shown here** ([08 §3.1](08-progression-and-ux.md#31-coin-preview--the-load-bearing-number)). The panel reads "preparing the stage…" until generation finishes; buying never waits for it |
| Deck changes after the preview | The preview is proven against the deck the shop opened with. Buying cannot break it; selling or merging a piece the plan needs is the player's informed choice, and nothing is re-checked |

The shop is deliberately unhurried. The *stage* is where time pressure lives; the shop is where the
player is meant to think about the next three stages at once.

## 2. Stock generation

Five slots, generated from the run seed **after** the stage's coins are awarded:

| Slot | Source | Guarantee |
|---|---|---|
| 1 | **Piece** | One random knight, bishop or rook — or the recovery offer (§3) |
| 2 | **Piece** | One random piece |
| 3 | **Piece or Skill** | Random |
| 4 | **Piece or Skill** | Random |
| 5 | **Service** | Repair or reroll |

Generation rules:

- **Pawns are never sold.** The shop offers knights, bishops, rooks and queens only; pawns come from
  the stage ([02 §2.1](02-rules-framework.md#21-pawns-come-from-the-stage-never-the-deck)).
- Every piece offer is a **Hero Piece** and carries a rarity tier (see §2.1).
- The deck is fixed at **8** pieces; the shop never sells capacity. A piece purchase with a full deck
  needs a cut, a sale or a merge first (§4, §4.1).
- Repair is only offered if at least one piece has durability below its max.
- Skills already at their loadout cap (3) are still offered, but flagged `replace` — buying one
  prompts a swap.
- The same skill may appear at most once per visit.
- An item the player cannot possibly afford is still shown (with a disabled state) so the shop
  teaches future pricing; it is never silently hidden.

### 2.1 Rarity pool and progression gating

Rarity is rolled for every **random** piece offer (any piece in slots 1–4 except the recovery
offer), after its piece type, from the pool of the act whose stage was just cleared — the same act
whose prices apply. The roll uses the shop seed, so it is reproducible like the rest of the stock.
The same act pools also set the rarity of each stage's spawned pawns
([02 §2.1](02-rules-framework.md#21-pawns-come-from-the-stage-never-the-deck)).

| Pool (act) | Ceiling | Normal | Rare | Unique | Legendary |
|---|---|---|---|---|---|
| **Act I** | **Rare** | 75 | 25 | — | — |
| **Act II** | Unique | 50 | 38 | 12 | — |
| **Act III** | Legendary | 30 | 40 | 24 | 6 |

Weights are relative; `—` means weight 0, impossible. Values live in
[`data/economy.yaml`](../data/economy.yaml) → `rarity.pool` and are provisional until the M6
balance pass. The structural rules are not provisional:

1. **The ceiling is hard.** Nothing in an act is above its ceiling — no shop offer, reroll,
   recovery offer, spawned pawn or promotion result. Unique and Legendary pieces are impossible to
   acquire in Act I.
2. **Ceilings never go down.** A later act's ceiling is equal to or higher than an earlier act's.
3. **The recovery offer is Normal.** Pity items are a floor, not a lottery.
4. **Rerolls re-roll rarity too.** A reroll redraws type *and* tier for slots 1–4 from the same pool
   (keeping the recovery offer if it fired); it cannot raise the ceiling.
5. **The Legendary queen is the rarest roll.** Any roll that lands on a Legendary queen — a shop
   offer or a promotion result — keeps that tier only **20%** of the time (`rarity.retention`);
   otherwise it becomes a Unique queen. In an Act III shop that turns a 6% Legendary chance per queen
   offer into about 1.2%, roughly five times rarer than any other Legendary piece.
6. **No pity timer, no guarantee of a high tier.** A visit may offer only Normal pieces. Hidden
   "bad-luck protection" would conflict with the fair-and-provable pillar; the pool is the whole truth,
   and the shop can show it (§6).

### 2.2 Prices by rarity

```
price = round(basePrice × rarityMultiplier × (1 + 0.20 × (act − 1)))
rarityMultiplier:  Normal ×1 · Rare ×1.5 · Unique ×2 · Legendary ×3
```

| Piece (Act I base) | Normal | Rare | Unique | Legendary |
|---|---|---|---|---|
| Knight (8) | 8 | 12 | 16 | 24 |
| Bishop (8) | 8 | 12 | 16 | 24 |
| Rook (10) | 10 | 15 | 20 | 30 |
| Queen (16) | 16 | 24 | 32 | 48 |

Unique cannot appear in Act I and Legendary not before Act III, so those columns are only ever paid
with that act's inflation on top. A tier that adds power adds cost — pillar 2. A Legendary bishop
costs more than a Normal queen *and* 5 spawn points to summon instead of 3, so it is never a free
upgrade. The Legendary queen is the one deliberate outlier: at 48 base coins, with the rarest roll in
the game and durability 1, it is the run's most expensive and least likely item.

### 2.3 Skill prices

Skills have no rarity, so their price is the skill's own `price` with act inflation only:

```
skillPrice = round(price × (1 + 0.20 × (act − 1)))
upgrade    = round(skillPrice × 0.5)          # +1 charge to an owned skill
```

| Skill (Act I) | Price | Act II | Act III | Upgrade (Act I) |
|---|---|---|---|---|
| Lockdown · Gallop · Bulwark | 10 | 12 | 14 | 5 |
| Twin Step · Ascension · Recall | 12 | 14 | 17 | 6 |
| Phase Step | 14 | 17 | 20 | 7 |

Only `status: mvp` skills are stocked until the engine supports the rest: Twin Step, Ascension and
Lockdown from M2; Gallop, Phase Step, Recall and Bulwark from M6
([03 §5](03-skill-framework.md)). Why skills cost more than a knight is in
[03 §6](03-skill-framework.md).

## 3. Guarantees

### No pawn floor

Earlier designs kept a pawn in slot 1 so a broke player could always buy an action. Pawns are no
longer sold: every stage now **spawns free pawns** for the player instead, so a broke player still
gets extra pieces on the board every stage without spending a coin. The shop needs no floor item.

### Recovery offer

If the player **lost at least one piece in the stage just cleared** (captured or spent) and their
**non-king deck now holds fewer than `recoveryDeckThreshold` (4) pieces**, slot 1 is replaced by a
guaranteed **Normal-rarity knight or bishop** at **50% of its normal price**. Merging down to fewer
than 4 pieces does not trigger it — the offer is insurance against losses, not a merge discount.

This is insurance against one catastrophic stage, not an ongoing subsidy: the offer disappears as
soon as the deck is back to 4 pieces.

## 4. Purchases

| Category | Item | Notes |
|---|---|---|
| **Piece** | Any of knight / bishop / rook / queen, at a rolled rarity (§2.1) — never a pawn | Creates a **new Hero Piece instance** at full durability for its type and rarity; must fit in capacity |
| **Skill** | One of the skill catalogue, at its price (§2.3) | Occupies a loadout slot (3 max); permanent for the run |
| **Skill upgrade** | A skill already owned | **+1 charge** at 50% price — deepen a build, don't widen it |
| **Repair** | +1 durability to one chosen piece | Never above that piece's max; not offered for `spent` pieces |
| **Reroll** | Reroll slots 1–5 (except a recovery offer) | First reroll each visit free, then 2 coins |
| **Sell** | One deck piece, not the King and not `spent` | Pays `floor(0.5 × its current price)` — its type × rarity × this act's inflation (§2.2), whatever its durability. The piece leaves the run |

Selling is available at any time in the shop, any number of times, and in the stage-end chooser
when a promotion overflows the deck (beside merge and cut). It never restocks or regenerates the
shop: in particular, selling the deck below 4 pieces does not create a recovery offer, which is
decided on entry from the pieces lost in the stage (§3). Selling down to the King alone is allowed,
with a warning.

| Sell price examples | Buys for | Sells for |
|---|---|---|
| Normal knight, Act I | 8 | 4 |
| Normal rook, Act I | 10 | 5 |
| Normal queen, Act I | 16 | 8 |
| Rare knight, Act II | 14 | 7 |
| Legendary queen, Act III | 69 | 34 |

Prices inflate per act by 20% and scale with rarity (§2.2,
[05 §3](05-run-structure-and-economy.md#3-expenditure-coins--power)).

### Purchase flow

1. Player selects an item.
2. If the purchase needs a target (repair → piece; skill → loadout swap) a chooser appears.
3. Engine validates: affordable, a free slot in the 8-piece deck (or a cut, sale or merge chosen),
   targets valid. A sale validates that the piece is neither the King nor `spent`.
4. On confirm: coins deducted, instance created or modified, stock slot marked `sold`.
5. All state changes are immediate and **irreversible** — no undo in the shop.

Sold slots empty out and do not restock. The shop is a fixed menu for the visit.

### 4.1 Merging in the shop

Whenever the deck holds **three pieces of the same type and tier** (each with durability ≥ 1), the
shop offers a **Merge** action on them: the three become one piece of the next tier, at full
durability, for **no coins** ([06 §4.5](06-deck-durability-and-permadeath.md#45-merging)).

- Merging is free and can be done any number of times per visit, before or after buying.
- It respects the act's ceiling: in Act I only Normal → Rare is possible.
- It frees two deck slots, which is the main way to make room under the fixed capacity of 8.
- Buying a third copy *in order to* merge is a legitimate plan, even though it always costs more
  coins than buying the higher tier outright (prices ×1.5 / ×2 / ×3 rise slower than ×3 inputs).
- Like every shop action, a merge is immediate and irreversible.

## 5. Bank & skip

A single button, `Leave shop`, exits without purchasing. Coins carry over with no penalty and no cap.

This exists because the Act II price wall is real: a player who clears Act I efficiently may be better
off banking 25 coins into Act II at ×1.2 prices than buying Act I power they will not need. Skip is a
genuine strategic option, not a failure state, and the UI should not frame it as "decline."

## 6. Screen layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  CHECKBREAKER              ACT II · STAGE 2          ◈ 18 coins      │
├──────────────────────────────────────────────────────────────────────┤
│  DECK (4 / 8)                           LOADOUT (2 / 3)              │
│  ┌────┐┌────┐┌────┐┌────┐               ┌─────────────┐┌────────────┐│
│  │ N  ││ B  ││ N  ││ R  │               │ ● Twin Step ││ ● Lockdown ││
│  │ Nrm││ Nrm││ Rar││ Unq│               │ 3 charges   ││ 3 charges  ││
│  │●○  ││●○  ││●●  ││●●  │               │             ││            ││
│  └────┘└────┘└────┘└────┘               └─────────────┘└────────────┘│
├──────────────────────────────────────────────────────────────────────┤
│  SHOP                                                                │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐                  │
│  │ KNIGHT ││ ROOK   ││ QUEEN  ││ BISHOP ││ REPAIR │                  │
│  │ Normal ││ Rare   ││ Unique ││ Normal ││        │                  │
│  │ ◈ 10   ││ ◈ 18   ││ ◈ 38   ││ ◈ 10   ││ ◈ 4    │                  │
│  │ ●●     ││ ●●     ││ ●      ││ ●●     ││ +1 pip │                  │
│  │[BUY]   ││[BUY]   ││[BUY]   ││[BUY]   ││[BUY]   │                  │
│  └────────┘└────────┘└────────┘└────────┘└────────┘                  │
│  POOL Act II · up to Unique   [ Reroll ◈ 0 ]   [ Leave shop ]        │
├──────────────────────────────────────────────────────────────────────┤
│  NEXT STAGE  (board preview: enemy formation, spawned pawns — no par)│
└──────────────────────────────────────────────────────────────────────┘
```

Design notes:
- **Coins top-right, always.** Every price is compared against one number.
- **Deck with durability pips visible while shopping** — the purchase decision depends on deck health.
- **Durability pips on item cards** so the player compares like with like.
- Price of a piece the player cannot afford is shown in a muted color, never hidden.
- **Rarity on every piece card and deck tile**, as a tier name (abbreviated on deck tiles) plus frame
  shape ([06 §9](06-deck-durability-and-permadeath.md#9-communication-rules-ui-contract)). Hovering a
  card lists that tier's movement abilities.
- **Merge on deck tiles:** three matching tiles light up with a `[MERGE → Rare]` action; never hidden.
- **No pawn card, ever** — the deck shows no pawns either; they belong to the stage.
- **The pool line** states the current act's ceiling ("up to Unique"); hovering it shows the weight
  table from §2.1. The player can always see what the shop *could* have offered.
- **Next-stage preview** shows the board the next stage will start from, so the player can buy for
  it. It never shows the par: how fast the mate must come is learned only on the Stage screen.
- The loadout panel shows **remaining charges** (they refresh next stage — the shop should say so on
  hover, once).

## 7. Edge cases

| Case | Resolution |
|---|---|
| No items affordable | Leave is the only action; next stage's spawned pawns still arrive for free |
| Capacity full (8), tries to buy a piece | Blocked with an explicit chooser: sell a piece, cut a piece, or merge three identical pieces if possible; sales and cuts are permanent and confirmed |
| All non-king pieces spent, deck effectively empty | Recovery offer fires; run continues |
| Repair target has no damage | Repair not offered in stock generation |
| Duplicate skill purchase | Becomes a +1 charge upgrade at 50% price |
| Loadout full, buys new skill | Forced swap chooser; the displaced skill is lost |
| Player has 0 coins | Shop still opens, shows stock, allows leaving (no reroll) |
| Rerolling for a higher tier in Act I | Impossible — the Act I pool's ceiling is Rare, and rerolls draw from the same pool |
| Recovery offer fires in Act III | Still Normal; the guarantee is a piece, not a tier |
| Capacity full, wants a higher-tier copy of an owned piece | Same "cut a piece" chooser; the cut piece's rarity is lost with it |
| Deck over capacity from a promotion | The stage-end chooser (merge, sell or cut) runs before the shop opens, so the shop always opens with a legal deck and the coins from a sale can be spent at once |
| Sells the deck down to the King | Allowed after a warning; the next stage is still solver-checked against the deck as it is |
| Sells a piece whose lifeline was used | Sells at the normal price; lifeline has no resale value |
| Merge would exceed the act ceiling | The Merge action is shown disabled with the reason ("Unique unlocks in Act II") |
| Two identical pieces, wants to merge | Not enough: a merge needs three. The shop highlights pieces that would complete a set |
| Shop opens on a lost stage | Impossible by definition — the run is over |
