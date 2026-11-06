# 06 — Deck, Durability & Permadeath

This is the game's long-run resource and its emotional core. Turns are the clock the player watches;
**durability is the clock that kills them.**

---

## 1. The piece table

| Piece | Value | Price (Act I) | Durability max | Notes |
|---|---|---|---|---|
| King | — | not sold | ∞ | Run identity; never destroyed |
| Pawn | 1 | 3 | 3 | Cheap, sustainable action |
| Knight | 3 | 8 | 2 | Standard mid-piece |
| Bishop | 3 | 8 | 2 | Standard mid-piece; Ascension target |
| Rook | 5 | 10 | 2 | Reach |
| Queen | 9 | 16 | **1** | One deployment ever — a burst, not a soldier |

### The single most important design decision in this table

**Durability is inversely correlated with piece power.** A queen is the strongest piece and can be
deployed exactly once per purchase. A pawn is the weakest and can be deployed three times.

This makes every deck slot a real trade:

- A **reliable** deck of pawns and knights plays slowly but never collapses.
- A **spiky** deck with queens wins specific stages spectacularly and then evaporates.
- The correct answer changes per template, which is what makes deckbuilding a skill.

If durability were flat, the queen would strictly dominate every slot and the deck would have one
correct shape. It must not.

## 2. Deck capacity

| Property | Value |
|---|---|
| Starting capacity | 8 slots |
| Maximum capacity | 14 slots (bought in shop) |
| King occupies a slot | **No** — capacity counts non-king pieces |
| Starter deck | King + 4 Pawns + 1 Knight + 1 Bishop (7 of 8 slots) |

The starter deck leaves **one free slot**. That is deliberate: the first shop should be able to sell
you something immediately without forcing a cut, so the deckbuilding lesson lands before the
deckbuilding pressure.

Capacity is the run's power ceiling. Raising it is expensive (12 coins) because capacity is the
purchase with the highest long-run return — it makes every subsequent shop better.

## 3. Piece instances

A piece in the deck is an **instance**, not a type. Two knights are distinct objects with separate
durability and separate fates.

```ts
interface PieceInstance {
  instanceId: string;        // stable for the run, e.g. "p_a1f3_07"
  pieceType: 'king' | 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';
  durability: number;        // remaining deployments
  durabilityMax: number;     // from the piece definition
  origin: 'starter' | 'shop' | 'reward';
  acquiredAtStage: number;
  status: 'in_deck' | 'deployed' | 'captured' | 'spent';
}
```

Durability is **instance state persisted in `RunState`**. It is the reason a run cannot be
reconstructed from its piece list alone, and the reason save files must version the deck.

## 4. Durability lifecycle

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
   effect, shop, or skill can recover it. Only a *new instance* of the same type can be bought.
5. A piece with 0 durability can still be **repaired** during the same stage it went spent? **No.**
   `spent` is final — this closes a repair-dodge loophole and keeps the 0-durability threshold
   meaningful. Repairs only apply to `in_deck` or `deployed` pieces with durability ≥ 1.

**Why "spent" rather than instant destruction:** a piece that vanishes the moment it is summoned is
absurd to watch and removes the tension of playing out a stage with a doomed army. Marking it spent
lets the player spend it *now* and feel the cost *after* — which is the same shape as the coin
economy and teaches the same lesson.

## 5. Capture and permadeath

| Event | Effect on the run |
|---|---|
| Player piece captured while deployed | Instance destroyed; removed from deck permanently |
| Player piece captured as part of the opening line | **Same** — the opening line is drawn from the deck |
| Enemy piece captured | Salvage coins (`floor(value/3)`); no effect on the enemy deck (there isn't one) |
| Player king "captured" | Impossible — checkmate ends the stage instead |

**The opening line is drawn from the deck, so it is not safe.** The only difference between an
opening-line piece and a deployed piece is who chose the square. Both persist, both carry durability,
both die permanently. This closes the "free cannon fodder" loophole that would otherwise let a player
avoid all risk by never deploying.

## 6. The King

| Property | Rule |
|---|---|
| Presence | Guaranteed in the deck; always placed in the opening line |
| Capacity | Occupies no deck slot |
| Durability | Infinite; never decremented, never spent |
| Capture | Impossible (invariant I3) |
| Removal | Cannot be sold, sacked, or destroyed by any effect |
| Defeat | Checkmate of the player king ends the run |

The King is the run's anchor. Because it can never be lost, the player can never reach an unwinnable
state caused by an empty deck — only one caused by their own play. This is a load-bearing guarantee:
it is what lets the game promise "the pawn floor plus the opening line means you are never forced to
lose."

## 7. Guardrails

| Lever | Rule | Prevented failure |
|---|---|---|
| **King immunity** | King never lost | Deck emptied entirely |
| **Opening line** | Always drawn from the remaining deck | Stage starts with no army |
| **Pawn floor** | Shop always stocks an affordable Pawn | Broke and piece-less |
| **Recovery offer** | Non-king deck < 4 → one discounted replacement guaranteed | Post-catastrophe death spiral |
| **Salvage** | Captures pay coins | Attrition has no counter-income |
| **Telegraphing** | UI warns when a deployment target is attacked | Losing pieces to invisible threats |

## 8. Communication rules (UI contract)

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
   player's hand mid-plan.

## 9. Edge cases

| Case | Resolution |
|---|---|
| Deck contains only the King | Opening line = King only; stage is playable but nearly impossible; UI offers abandon-run |
| Deploy with no legal square | Action cannot be committed; durability not spent |
| Deploy that would leave own king in check | Commit refused (I2); durability not spent |
| Captured while transformed (Ascension) | Piece destroyed normally; no reversion step |
| Repaired piece at max durability | Repair is not offered (cannot exceed max) |
| Spent piece captured | Same as any capture — it was already leaving the deck; the capture just gets it first |
| Deck exceeds capacity (e.g. after a purchase bug) | Invariant I9 fails loudly at commit; purchases are refused at the shop instead |
| All non-king pieces captured mid-run | Run continues with the King; the shop's recovery offer fires; abandoning is allowed and labelled honestly |
