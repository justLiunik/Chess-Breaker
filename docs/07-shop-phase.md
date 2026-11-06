# 07 — Shop Phase

The shop is where a run is won or lost. It converts the stage's tempo into the next stage's
possibility, and it is the only screen where the player holds full information and unlimited time.

---

## 1. Entry, exit, and flow

```
stage cleared (win)  ──►  SHOP  ──►  stage generated  ──►  stage
                            │
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

The shop is deliberately unhurried. The *stage* is where time pressure lives; the shop is where the
player is meant to think about the next three stages at once.

## 2. Stock generation

Five slots, generated from the run seed **after** the stage's coins are awarded:

| Slot | Source | Guarantee |
|---|---|---|
| 1 | **Pawn** | Always present, always affordable (§3) |
| 2 | **Piece** | One random piece, at least one of knight/bishop/rook |
| 3 | **Piece or Skill** | Random |
| 4 | **Piece or Skill** | Random |
| 5 | **Service** | Repair, deck slot, or reroll |

Generation rules:

- No item may exceed the player's `maxCapacity` implications (no deck slot offer at max capacity).
- Repair is only offered if at least one piece has durability below its max.
- Skills already at their loadout cap (3) are still offered, but flagged `replace` — buying one
  prompts a swap.
- The same skill may appear at most once per visit.
- An item the player cannot possibly afford is still shown (with a disabled state) so the shop
  teaches future pricing; it is never silently hidden.

## 3. Guarantees

### Pawn floor

Slot 1 is always a Pawn. If the player's coin balance is below the pawn price, it is offered **at
their full balance** (minimum 1 coin). This is a floor, not a grant — it consumes everything they
have.

*Exploit assessment:* buying a pawn for 1 coin when pawns cost 3 requires having nearly banked
nothing. The exploit's ceiling is a single pawn at a moment when the player has no other option; it
is accepted as pity with negligible balance impact.

### Recovery offer

If the player's **non-king deck contains fewer than `recoveryDeckThreshold` (4) pieces**, slot 2 is
replaced by a guaranteed replacement piece at **50% of its normal price**.

This is insurance against one catastrophic stage, not an ongoing subsidy: the offer disappears as
soon as the deck is back to 4 pieces. It fires in addition to the pawn floor.

## 4. Purchases

| Category | Item | Notes |
|---|---|---|
| **Piece** | Any of pawn / knight / bishop / rook / queen | Creates a **new instance** at full durability; must fit in capacity |
| **Skill** | One of the skill catalogue | Occupies a loadout slot (3 max); permanent for the run |
| **Skill upgrade** | A skill already owned | **+1 charge** at 50% price — deepen a build, don't widen it |
| **Repair** | +1 durability to one chosen piece | Never above that piece's max; not offered for `spent` pieces |
| **Deck slot** | +1 capacity | Up to 14 |
| **Reroll** | Reroll slots 2–5 | First reroll each visit free, then 2 coins |

Prices inflate per act by 20% ([05 §3](05-run-structure-and-economy.md#3-expenditure-coins--power)).

### Purchase flow

1. Player selects an item.
2. If the purchase needs a target (repair → piece; skill → loadout swap) a chooser appears.
3. Engine validates: affordable, capacity available, targets valid.
4. On confirm: coins deducted, instance created or modified, stock slot marked `sold`.
5. All state changes are immediate and **irreversible** — no undo in the shop.

Sold slots empty out and do not restock. The shop is a fixed menu for the visit.

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
│  DECK (7 / 8)                           LOADOUT (2 / 3)              │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐   ┌─────────────┐┌────────────┐│
│  │ P  ││ P  ││ P  ││ N  ││ B  ││ R  │   │ ● Twin Step ││ ● Lockdown ││
│  │●●● ││●●○ ││●●● ││●○  ││●●  ││●○  │   │ 3 charges   ││ 3 charges  ││
│  └────┘└────┘└────┘└────┘└────┘└────┘   └─────────────┘└────────────┘│
├──────────────────────────────────────────────────────────────────────┤
│  SHOP                                                                │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐                  │
│  │ PAWN   ││ ROOK   ││ Queen  ││ BISHOP ││ REPAIR │                  │
│  │ ◈ 3    ││ ◈ 12   ││ ◈ 19   ││ ◈ 10   ││ ◈ 4    │                  │
│  │ ●●●    ││ ●●     ││ ●      ││ ●●     ││ +1 pip │                  │
│  │[BUY]   ││[BUY]   ││[BUY]   ││[BUY]   ││[BUY]   │                  │
│  └────────┘└────────┘└────────┘└────────┘└────────┘                  │
│                           [ Reroll ◈ 0 ]   [ Leave shop ]           │
└──────────────────────────────────────────────────────────────────────┘
```

Design notes:
- **Coins top-right, always.** Every price is compared against one number.
- **Deck with durability pips visible while shopping** — the purchase decision depends on deck health.
- **Durability pips on item cards** so the player compares like with like.
- Price of a piece the player cannot afford is shown in a muted color, never hidden.
- The loadout panel shows **remaining charges** (they refresh next stage — the shop should say so on
  hover, once).

## 7. Edge cases

| Case | Resolution |
|---|---|
| No items affordable | Pawn floor is discounted to balance (min 1) or the leave button is the only action |
| Capacity full, tries to buy a piece | Blocked with an explicit "cut a piece" chooser; cuts are permanent and confirmed |
| All non-king pieces spent, deck effectively empty | Recovery offer fires; run continues |
| Repair target has no damage | Repair not offered in stock generation |
| Duplicate skill purchase | Becomes a +1 charge upgrade at 50% price |
| Loadout full, buys new skill | Forced swap chooser; the displaced skill is lost |
| Player has 0 coins | Shop still opens, shows stock, allows leaving (no reroll) |
| Shop opens on a lost stage | Impossible by definition — the run is over |
