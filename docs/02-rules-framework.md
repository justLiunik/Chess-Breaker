# 02 — Rules Framework (Authoritative)

This document is the authority. If any other document disagrees with it, this one wins. Tuning
*numbers* live in [`data/economy.yaml`](../data/economy.yaml); the *rules* below do not.

---

## 1. Definitions

| Term | Definition |
|---|---|
| **Run** | One attempt: 3 acts × 3 stages. Ends on any stage loss. State lives in `RunState`. |
| **Stage** | One chess encounter with a turn limit and terminal conditions. State lives in `StageState`. |
| **Turn** | One player commit + resolution + one enemy reply. |
| **Action** | A single entry in the player's action queue: `MOVE`, `DEPLOY`, or `ACTIVATE_SKILL`. |
| **Action Queue** | The ordered list of actions committed for a turn. |
| **Move credit** | Currency that pays for `MOVE` and `DEPLOY`. Starts at 1 per turn (the **Free Move**). |
| **Focus** | Currency that pays for `ACTIVATE_SKILL` only. Refills to the pool value each turn. |
| **Durability** | A piece instance's remaining deployments (see [06](06-deck-durability-and-permadeath.md)). |
| **Deployment square** | An empty square in the player's deployment ranks where a piece may be placed. |
| **End state** | The board position after the queue resolves *and* after end-of-turn expiry (step R1). |

**The player always plays White and always moves first.** Playing Black is deferred
([11](11-open-decisions.md)).

## 2. Board and pieces

- Standard 8×8 board, algebraic coordinates `a1`–`h8`, White at ranks 1–2.
- Standard chess piece movement, blocking, and capture, with these exceptions:
  - **The king can never be captured.** Checkmate is the only way to defeat a king.
  - Castling and en passant are **disabled** (they are position-dependent complexity that adds
    nothing to sparse puzzle boards and complicate transform/durability interactions).
  - Pawn promotions that would occur are handled by the normal chess rule (to queen only), but
    generated stage templates avoid promotion squares so the interaction never arises in MVP.
- Castling rights are absent; generated stages have no castling flags.

### Deliberately ignored chess rules

| Rule | Status | Why |
|---|---|---|
| Threefold repetition | Ignored | Stages are short and decisive; repetition cannot stall a decision |
| Fifty-move rule | Ignored | Turn limits dominate |
| Insufficient material | Ignored | Turn limit and domination threshold handle "no progress" |
| Draw by agreement | Doesn't exist | There is only win or loss |
| Stalemate | **Enemy passes** (see §8) | Prevents dead stages and enables zugzwang play |

## 3. Turn structure — "Plan & Commit"

A turn has five phases:

1. **Plan.** The player assembles an ordered action queue. All costs are accounted sequentially.
2. **Validate.** The engine simulates the entire queue plus end-of-turn expiry (R1) and checks the
   result against the legality invariants (§9). Failure blocks the commit and explains why.
3. **Commit.** The queue becomes immutable.
4. **Resolve.** Actions execute in order. Captures, transforms, placements, and durability spends
   apply **immediately** as each action executes.
5. **Reply.** End-of-turn resolution (§6) runs, then the enemy takes one move per its policy (§8).

**Nothing is evaluated mid-queue.** A queue is not required to be legal at any intermediate point —
only at its end. This is a core mechanic, not a loophole:

- You may move your king *through* an attacked square to reach a safe one in two moves.
- You may give a "check" with your first move and then move the checker away; no check ever existed.
- A piece may temporarily occupy a square that would normally be impossible.

**What is *not* deferred:** each individual `MOVE` must still be a legal move *for that piece in the
board state at that moment* — blocking, path, and occupancy rules still apply. Durability and
deployment rules still apply. Skills break exactly one named rule each. "Move twice" is two real
moves, not a teleport.

## 4. Action types and costs

| Action | Payload | Costs | Notes |
|---|---|---|---|
| `MOVE` | `{ pieceId, from, to }` | 1 move credit | Must be legal for that piece right now |
| `DEPLOY` | `{ pieceInstanceId, to }` | 1 move credit + 1 durability | Target must be an empty deployment square |
| `ACTIVATE_SKILL` | `{ skillId, target? }` | Focus equal to the skill's cost | Does **not** cost a move credit; may grant credits |

Cost accounting is **sequential**: walking the queue, each action must be affordable *at the moment
it executes*. A skill that grants a move credit cannot retroactively pay for a move already committed
earlier in the queue.

- **Move credits** start at 1 per turn (`freeMovesPerTurn`). Only skills grant more.
- **Focus** starts at the pool value (default 3) each turn, does not carry over, and **can never buy
  a move credit**. This is the balance anchor: exceeding one action per turn requires a skill.
- **Skill charges** are per stage, not per turn (see [03](03-skill-framework.md)). A skill with 2
  charges may be activated twice in the same stage — including twice in one turn, Focus permitting.

## 5. Deployment

Deployment is how the deck becomes an army. It is action-priced, so reinforcement always competes
directly with playing chess.

**Rules**

1. Target square must be **empty**.
2. Target square must be in the player's **deployment ranks** (default 1 and 2 — the player's two home
   ranks). Templates may narrow this.
3. The piece must still have **durability ≥ 1**; deploying decrements it by exactly 1.
4. Deployment consumes **1 move credit**.
5. Deployments per turn are limited (`deploymentsPerTurn`, default 1) unless a skill or template
   raises it.

**Opening line (automatic).** Before turn 1 the engine draws the **opening line**: a randomized
subset of the player's current deck, `openingPlacements` pieces strong (default 3, capped at deck
size), **always including the King**. Those pieces are placed on randomly chosen legal squares
within the deployment ranks.

Opening placement costs **no durability and no action**. It is the game supplying your starting army,
which guarantees a run can never reach a stage with an empty board. The randomization is the game's;
your control over your army's *position* begins with `DEPLOY`. Everything still in the deck after the
draw is the **deployable pool** for the stage.

Deployments and the opening line are therefore two different things, and the difference is the whole
point: **the opening line is free but not yours to choose; a deployment is yours to choose but costs
durability.**

**Deployment failures are non-destructive.** If a deployment cannot legally complete (no valid
square, or it would produce an illegal end state), it does not execute and its durability is **not**
spent.

**Deployed pieces are removed from the deck's available pool for the stage** but remain in the deck
for the run. A piece that survives the stage returns to the deck with its reduced durability. A piece
captured during the stage is destroyed permanently (see [06](06-deck-durability-and-permadeath.md)).

## 6. End-of-turn resolution order

This order is fixed and load-bearing. Changing it changes the game.

| Step | Name | What happens |
|---|---|---|
| **R1** | Expire temporary modifiers | All modifiers with duration `this_turn` revert. A bishop-turned-queen becomes a bishop again. |
| **R2** | Illegal end-state assertion | The post-R1 state must satisfy §9. At runtime this should never fire (commit-time validation already covered it); if it does, it is an engine bug and the turn is rolled back. |
| **R3** | Checkmate evaluation | If the enemy king is in check and has no legal move, the player **wins by checkmate**. |
| **R4** | Objective and economy evaluation | Domination threshold checked; turn counter decremented; coin payout computed (see [05](05-run-structure-and-economy.md)). |
| **R5** | Enemy turn | The enemy makes one move per its policy, then the turn ends: Focus refills, new turn begins. |

**Consequence worth calling out explicitly:** a temporarily transformed piece that delivers mate
does **not** deliver mate, because R1 reverts it *before* R3 evaluates. Burst transformations cannot
win the stage but can win *material* — which is exactly the intended use.

Similarly, an end state in which reverting a transform would expose the player's own king is illegal
and cannot be committed. A "free" transform is never free of positional consequence.

## 7. Stage end evaluation

Evaluated at R4 each turn, in this order; the first match wins:

| Priority | Condition | Outcome |
|---|---|---|
| 1 | Enemy king is checkmated (from R3) | **WIN** — checkmate payout |
| 2 | Player king is checkmated | **LOSS** — run ends immediately |
| 3 | Player material **swing** ≥ stage threshold | **WIN** — domination payout (half rate) |
| 4 | Turns remaining = 0 | **LOSS** — run ends |

**Domination is a material *swing*, not a board total:**

```
swing = (value of enemy pieces you captured) − (value of your pieces lost)
WIN when swing ≥ materialThreshold      values: P1 N3 B3 R5 Q9, king never counted
```

This is the definition that matters, and it is deliberately **not** `playerMaterial −
enemyMaterial` on the board. Two reasons:

1. The enemy army is normally *larger* than the player's opening line, so a board total would make
   domination almost unreachable no matter how well the player trades.
2. A board total could be inflated by simply **deploying** a large piece — buying the win condition
   with durability instead of winning the exchange. The swing metric is immune to that: only captures
   and losses move it.

`StageState.swing = { captured, lost }` is tracked continuously and shown on the HUD, so the player
can always read "I am 2 material from a domination win."

Note that swing is monotonic within a stage: it only ever gets easier to reach, which means the
domination route is the *reliable* one and checkmate is the *fast* one. That asymmetry is the
[payout](05-run-structure-and-economy.md#2-income-turns--coins) rationale.

**Checkmate always outranks domination** so that the better play always gets the better payout, even
when both fire on the same turn.

## 8. Enemy behavior

- The enemy is **standard-move-only** in MVP: it never deploys, never uses skills, and never gains
  reinforcement mid-stage. (Boss skills are an M6 feature; the schema already reserves
  `enemyLoadout`.)
- The enemy takes exactly **one standard move** per turn.
- The enemy's policy is one of:
  - `best_move` — seeded, fixed-depth minimax with stable move ordering. Deterministic for a given
    seed and position.
  - `scripted` — a fixed authored line, used for teaching and boss stages.
- **Stalemated enemy passes.** If the enemy has no legal move and is *not* in check, it does nothing
  and the turn proceeds normally. The player is never awarded a stalemate draw and never forced into
  one.

## 9. Legality invariants

These are the contract the engine, the generator, and the tests all share.

| ID | Invariant |
|---|---|
| **I1** | Exactly one white king and one black king exist on the board at all times. |
| **I2** | The end state has the player's king **not** in check. |
| **I3** | A king is never captured and never removed by any effect. |
| **I4** | Every `MOVE` was legal for its piece in the position at the moment it executed. |
| **I5** | The number of `MOVE` + `DEPLOY` actions in a queue never exceeds the credits earned in it. |
| **I6** | Total Focus spent in a queue never exceeds the pool plus Focus granted during that queue. |
| **I7** | A piece's durability never goes below 0; deploying requires durability ≥ 1. |
| **I8** | No `DEPLOY` places a piece on an occupied square or outside the deployment ranks. |
| **I9** | Deck size never exceeds capacity; the king is never destroyed or removed from the deck. |
| **I10** | The coin payout shown in the preview equals the payout at evaluation, for the same plan. |
| **I11** | Given identical `(RunState, seed)`, generation and all enemy decisions are reproducible. |

## 10. Worked example turn

Stage: Act I template, 8 turns, Focus 3. The deck contains a Rook (durability 2) and the skill
**Twin Step** (cost 1, 3 charges). Board: player king on `e1`; enemy king on `g8`, enemy rook on `d4`.
The enemy rook controls the `d`-file, including `d1`.

Deploying the rook to a natural square would drop it straight onto `d4`'s line. Two actions, however,
reach `h7` — outside the enemy rook's reach and dominant along the seventh rank. The player builds
this queue:

| # | Action | Cost | Running state |
|---|---|---|---|
| 1 | `ACTIVATE_SKILL Twin Step` | 1 Focus (2 left), grants +1 move credit | 2 credits; rook still in the deck |
| 2 | `DEPLOY Rook → h1` | 1 credit (1 left) + 1 durability (2→1) | Rook on `h1`, outside `d4`'s lines |
| 3 | `MOVE Rook h1 → h7` | 1 credit (0 left) | Rook on `h7` |

Validation: the end state leaves the player king on `e1` not in check (I2 ✓), 2 credits spent / 2
earned (I5 ✓), 1 Focus spent of 3 available (I6 ✓), 1 durability remaining (I7 ✓), `h1` was empty and
inside ranks 1–2 (I8 ✓).

R1: no `this_turn` modifiers to expire.
R2: end-state legality assertion passes.
R3: the enemy king on `g8` is not in check — no win.
R4: swing unchanged (`captured 0, lost 0`) and turns remain — play continues.
R5: the enemy replies; the `best_move` policy likely consolidates on the queenside.

Note what the player *didn't* do: deploy onto `d1`'s line and hand the enemy 5 material of swing.

And note the freedom deferred validation buys: the same king may **step into check on one action and
out of it on the next**, because check is evaluated only on the end state. That is not a loophole —
it is the mechanic that makes extra moves worth buying.

## 11. Rules that are out of scope for MVP

- Playing as Black; any color asymmetry.
- Castling, en passant, underpromotion.
- Enemy deployment, enemy skills, enemy reinforcement waves.
- Obstacles, terrain, walls, or special squares.
- Multi-king or non-standard variants.

Each of these has a reserved extension point in
[09 — Technical Architecture](09-technical-architecture.md) and a row in
[11 — Open Decisions](11-open-decisions.md).
