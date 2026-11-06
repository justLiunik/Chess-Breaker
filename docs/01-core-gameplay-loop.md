# 01 — Core Gameplay Loop

## The four loops

```
┌─────────────────────────────────────────────────────────────────────┐
│ RUN LOOP            3 acts × 3 stages  ·  ends on any stage loss    │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ SHOP LOOP       spend coins → power → refill the deck       │   │
│   │                                                             │   │
│   │   ┌─────────────────────────────────────────────────────┐   │   │
│   │   │ STAGE LOOP      clear within the turn limit         │   │   │
│   │   │                                                     │   │   │
│   │   │   ┌─────────────────────────────────────────────┐   │   │   │
│   │   │   │ ACTION LOOP   plan → commit → resolve       │   │   │   │
│   │   │   └─────────────────────────────────────────────┘   │   │   │
│   │   └─────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

Each loop is a different decision horizon, and the game's whole strategy is the exchange rate
between them.

| Loop | Horizon | Question | Resource spent |
|---|---|---|---|
| **Action** | seconds | "How do I sequence this turn?" | Focus, move credits |
| **Stage** | 1–3 minutes | "Do I win fast, or cheap?" | Turns, durability |
| **Shop** | 1 minute | "What does my deck need now?" | Coins |
| **Run** | 25–35 minutes | "What shape is this deck becoming?" | Deck slots, lives |

## The conversion chain

This is the economic heartbeat of the game. Read it left to right:

```
durability  ──►  tempo  ──►  leftover turns  ──►  coins  ──►  power  ──►  (back to durability)
 (long-run)      (stage)         (stage)          (run)      (run)
```

- **Durability buys tempo.** Deploying a piece costs one durability and one action. You spend it to
  bring more force to bear sooner.
- **Tempo buys coins.** Winning in 3 of 8 turns pays 5 remaining turns × the act rate.
- **Coins buy power.** Pieces (new durability), skills (new options), repairs, deck slots.
- **Power buys deeper stages** — which demand *more* tempo, closing the loop.

**The friction that makes it a game:** you cannot skip a step. There is no way to convert coins
directly into a faster stage, no way to win turns without spending durability, and no way to regain
durability except by buying a *new* piece instance. The chain has a leak — pieces get captured —
and managing that leak is the run.

## Loop 1 — Action

1. **Read.** Position, enemy threats, turns remaining, Focus, remaining charges.
2. **Plan.** Assemble an ordered action queue: the Free Move, deployments, skill activations.
3. **Preview.** The engine simulates the queue, including end-of-turn expiry, and shows the
   resulting position plus the legal-state verdict.
4. **Commit.** Only the *end* state must be legal; mid-queue impossibilities are allowed.
5. **Resolve.** Actions execute in order; the enemy replies with one move.
6. **Refill.** Focus resets; turn counter decrements.

Everything is reversible until commit. After commit it is not — the enemy has moved. This is the
entire skill expression of the game: the plan is where you are clever, the commit is where you
are held to it.

## Loop 2 — Stage

- Entry: the stage is generated from the player's **actual deck** (see
  [04](04-stage-generation-and-authoring.md)), so it is always provably solvable.
- Play until a terminal condition fires (see
  [02 §7](02-rules-framework.md#7-stage-end-evaluation)).
- Exit routes, in payoff order:
  | Route | Speed | Payout |
  |---|---|---|
  | Checkmate | Fastest | Full rate — `leftover × coinRate` |
  | Domination (material threshold) | Slower, safer | Half rate |
  | Turn limit reached | — | **Loss** |
  | King checkmated | — | **Loss, run over** |

The stage loop's core tension is the **coin preview in the HUD**. It tells you, every turn, exactly
what winning *right now* is worth — and it goes down by one rate step each turn you hesitate. That
single number is the pressure that makes the durability economy bite.

## Loop 3 — Shop

After each cleared stage (never after the last): spend coins. Four purchase categories compete for
one purse:

- **Pieces** — replace attrition, or upgrade the deck's power per slot.
- **Skills** — the only way to break chess; also the only way to exceed one action per turn.
- **Repairs** — restore durability on a piece you want to keep.
- **Capacity and rerolls** — make every future shop better.

See [07 — Shop Phase](07-shop-phase.md). Skipping the shop banks coins for a later, larger buy —
a real option early in a run when piece prices outrun income.

## Loop 4 — Run

- 3 acts × 3 stages. The third stage of each act is a boss.
- Deck attrition, not stage difficulty, is the primary difficulty curve: an under-equipped Act III
  is harder than a well-built one.
- One loss ends the run. There is no retry, no undo, no checkpoint — the durability you spent is
  exactly the durability you have.
- Save/resume exists so a run can span sessions; it is not a rewind.

## Failure economics

| Moment | Cost to player | Recovery |
|---|---|---|
| Bad turn, committed | The enemy's reply | Play on |
| Stage lost on turns | The run | — |
| King mated | The run | — |
| Piece captured | Its remaining durability, permanently | Buy or repair at the shop |
| Skill charge spent | One charge, refreshed next stage | Wait for next stage |

The asymmetry is deliberate: **turns are cheap to lose per-turn and brutal to lose per-run**, while
**durability is silent until it is fatal**. Players should fear the turn counter in the moment and
fear the deck quietly.

## Emotional cadence

1. **Read** — "I see the line." (confidence)
2. **Plan** — "If I deploy here, and twin-step…" (creativity)
3. **Commit** — "That's it." (decisiveness)
4. **Reveal** — the enemy reply lands (relief or dread)
5. **Clock** — turns remaining ticks down (urgency)
6. **Resolve** — win, coins tick up; or a piece dies (greed or loss)
7. **Shop** — rebuild and re-plan (agency)

The run should produce roughly one "I should have seen that" and one "that was beautiful" per stage.

## Session targets

| Segment | Target duration |
|---|---|
| Single stage | 1–3 min |
| Full run | 25–35 min |
| First-run tutorial (Act I only) | 8–12 min |
| Shop visit | 30–90 s |

A run is deliberately short enough to lose and immediately restart — the roguelike contract.
