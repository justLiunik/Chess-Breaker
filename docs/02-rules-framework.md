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
| **Hero Piece** | A piece the player owns: an instance in `RunState.deck`. On a board it carries an `instanceId`. May hold any rarity. |
| **Stage Piece** | A piece placed by the stage itself, not drawn from the deck: the enemy army and the player's spawned pawns (and any future neutral pieces). No `instanceId`, never joins the deck. Enemy Stage Pieces are always Normal rarity. |
| **Spawned pawn** | A free, stage-only pawn the stage places for the player, with a rolled rarity and a visible promotion result (§2.2). The only way the player gets pawns. |
| **Promotion** | A spawned pawn reaching rank 8 leaves the board and becomes a new Hero Piece in the deck (§2.2). |
| **Rarity** | A piece's tier: Normal, Rare, Unique, Legendary (ascending). Every piece except the King has one. Bishops, knights, rooks and queens gain abilities by tier (§2.3); see also [06 §4](06-deck-durability-and-permadeath.md#4-piece-categories-and-rarity). |
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
  - **Player pawn promotion** follows §2.2, not the chess rule. **Enemy pawns** promote by the
    normal chess rule, to a Normal queen only.
  - Pieces with a rarity above Normal gain the movement abilities in §2.3.
- Castling rights are absent; generated stages have no castling flags.
- Every piece on the board is either a **Hero Piece** (the player's, from the deck) or a **Stage
  Piece** (placed by the stage: the enemy army and the player's spawned pawns). Every piece except
  the King has a **rarity**; enemy pieces are always Normal. Material values (P1 N3 B3 R5 Q9) are
  the same at every tier; they set salvage and the enemy army's value band.

### 2.1 Pawns come from the stage, never the deck

Pawns cannot be bought and never enter the deck. Each stage **spawns** pawns for the player instead:

- The template sets how many (`spawnedPawns.count`) and on which ranks (`spawnedPawns.ranks`). The
  ranks are chosen so that rank 8 is reachable within the turn limit.
- Each spawned pawn gets a rarity rolled from the act's rarity pool
  ([07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)): Act I pawns are Normal or Rare.
- Spawned pawns cost nothing: no deck slot, no durability, no deployment. They are placed with the
  opening line, before turn 1.
- They move and capture as standard chess pawns at every tier (one square forward, capture
  diagonally; the two-square first step applies only from rank 2). Their rarity changes only what
  they promote into.
- A captured spawned pawn is gone for the stage only; there is nothing permanent to lose. At stage
  end every surviving
  spawned pawn is discarded.

### 2.2 Promotion

When a spawned pawn reaches rank 8, it **promotes**:

1. The pawn leaves the board immediately; its square becomes empty. Nothing appears in its place.
2. A new **Hero Piece** instance is created: the pawn's `promotesTo` result, at full durability for
   its type and tier, with `origin: promotion`.
3. The new piece joins the deck **at once** and is part of the deployable pool for the rest of the
   stage — later in the same queue, if credits allow.

**The result is rolled at stage generation, not at promotion**, and is shown on the pawn from turn 1
("→ Rare Knight"). Promotion is random, but never a hidden dice roll: the player plans with the
result in view, the solver knows it, and preview equals outcome (I10).

| Roll | Rule |
|---|---|
| Piece type | Knight 35 · Bishop 35 · Rook 20 · Queen 10 (`promotion.resultTypeWeights`) |
| Tier | One tier above the pawn with 75% chance, otherwise the pawn's own tier (`promotion.tierUpChance`) |
| Ceiling | Never above the act's rarity ceiling: in Act I a Rare pawn always promotes to Rare. A Legendary pawn promotes to Legendary |
| Legendary queen | A result that would be a Legendary queen keeps that tier only 20% of the time, else it is a Unique queen ([07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)) |

**Over capacity.** The deck holds at most 8 pieces. If the new piece pushes it above 8, the stage
continues normally; at stage end, before the shop, the player must merge
([06 §4.5](06-deck-durability-and-permadeath.md#45-merging)) or cut pieces until the deck fits (I9).

Promotion is a tempo trade, exactly as pillar 2 requires: every move spent pushing a pawn is a move
not spent mating, and the coin preview drops one rate step per turn. The reward is a permanent piece
for a stage's worth of turns.

### 2.3 Rarity movement abilities

Bishops, knights, rooks and queens gain abilities by rarity. Abilities are **cumulative**: each tier
keeps everything below it. Data lives in `content/examples/pieces.yaml → rarityAbilities`.

**Bishop**

| Tier | Ability |
|---|---|
| Normal | Standard bishop. |
| Rare | **Leaps allies.** Its diagonal path may pass over the player's own pieces. Enemy pieces still block. A move that passed over at least one ally must end on an **empty** square: it cannot capture. A move that passed over no ally captures normally. |
| Unique | **Captures after a leap.** As Rare, but a move that passed over allies may end by capturing an enemy piece. |
| Legendary | **Moves like a queen.** As Unique, along orthogonal lines as well as diagonals — still leaping allies and capturing after a leap. Its `durabilityMax` is **1**, like a queen's. |

**Knight**

| Tier | Ability |
|---|---|
| Normal | Standard knight (the L leap). |
| Rare | **Straight leap.** May also leap exactly two squares orthogonally (from f3: f5, f1, d3, h3). |
| Unique | **Diagonal leap.** May also leap exactly two squares diagonally (from f3: d5, h5, d1, h1). |
| Legendary | **Moves twice.** After this knight makes a `MOVE`, it may make one more `MOVE` this turn at **no credit cost** (§4). |

**Rook**

| Tier | Ability |
|---|---|
| Normal | Standard rook. |
| Rare | **Leaps allies.** As the Rare bishop, along orthogonal lines: a move that passed over an ally cannot capture. |
| Unique | **Diagonal step.** May also step exactly one square diagonally, capturing normally. |
| Legendary | **Battering ram.** A move that passed over allies may now capture **one** enemy piece. A move that passed over **no** ally may **multi-capture** (below). Durability stays 2. |

**Queen**

| Tier | Ability |
|---|---|
| Normal | Standard queen. |
| Rare | **Leaps allies.** As the Rare bishop, in all eight directions: a move that passed over an ally cannot capture. |
| Unique | **Lifeline.** Once per run, when this queen is captured, it is not destroyed: it returns to the deck at stage end with 1 durability (below). |
| Legendary | **Full sweep.** A move that passed over allies may capture, and **any** move — with or without a leap — may **multi-capture**. Durability stays 1. The Legendary queen is the rarest piece in the game ([07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)). |

#### Multi-capture (Legendary rook and queen)

1. The piece moves along one straight line and captures the first enemy piece it reaches, on square
   **X**, exactly like a normal capture.
2. If the square **directly beyond X** in the same direction, **Y**, holds another enemy piece, the
   player may continue: that piece is captured too and the mover ends on **Y**. Stopping on X is
   always allowed — the second capture is a choice, not forced.
3. The two enemies must be **connected**. If Y is empty, holds an allied piece, or is off the board,
   only the single capture on X happens. There is no capture across a gap.
4. **King exception.** If Y holds the **enemy king**, it is not captured (I3). The move ends on X,
   and the king is in check from the mover in the ordinary way.
5. A multi-capture is **one `MOVE`**: one move credit, one entry in the queue. Both captured pieces
   each pay their salvage.
6. **When it is allowed.** A Legendary queen may multi-capture on any move, including one that passed
   over allies. A Legendary rook may multi-capture only on a move that passed over **no** ally; after a
   leap it captures one piece at most.
7. At most two pieces are ever captured by one move. Multi-capture never chains a third.

#### Lifeline (Unique and Legendary queen)

- Triggers the first time in the run that this queen instance is captured — on the board from a
  deployment or from the opening line.
- The queen leaves the board as usual.
- Instead of being destroyed, the instance returns to the deck **at stage end** with **1 durability**,
  and is not deployable again during the stage in which it was captured.
- The instance records `usedOnce: [lifeline]`; the next capture destroys it normally.

Rules that apply to every ability:

- **Leaps are leaps.** Knight leaps of every kind ignore what lies between, like the standard L. They
  capture normally and land on any square not occupied by an allied piece.
- **Attacks follow moves.** A piece gives check and controls squares along exactly the moves it could
  make. A Rare bishop, rook or queen does **not** attack through an ally (its leaping moves cannot
  capture); a Unique or Legendary bishop and a Legendary rook or queen do. Multi-capture never adds
  attacked squares beyond Y.
- **The king is never captured — by any ability.** No rarity ability can capture or land on a king's
  square (I3). In particular, a **Legendary knight that gives check with its first move can never use
  its bonus move to capture the king**: the king's square is simply not a legal destination. After
  giving check, the knight may still spend its bonus move elsewhere, and the turn is judged on its
  end state as always.
- **Transforms suspend rarity.** A transformed piece (e.g. Ascension) moves as a Normal piece of its
  temporary type until the transform reverts, then regains its abilities.
- **Only the player has them.** Enemy pieces are always Normal, so the enemy policy never moves with
  rarity abilities — but it must respect the squares the player's abilities attack.
- **Abilities are never forced.** A piece with extra moves may always make a standard move instead.

### Deliberately ignored chess rules

| Rule | Status | Why |
|---|---|---|
| Threefold repetition | Ignored | Stages are short and decisive; repetition cannot stall a decision |
| Fifty-move rule | Ignored | Turn limits dominate |
| Insufficient material | Ignored | The turn limit handles "no progress": a stage that cannot be mated in time is lost |
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
| `MOVE` | `{ pieceId, from, to }` | 1 move credit (0 for a Legendary knight's bonus move) | Must be legal for that piece right now, including its rarity abilities (§2.3) |
| `DEPLOY` | `{ pieceInstanceId, to }` | 1 move credit + 1 durability | Target must be an empty deployment square |
| `ACTIVATE_SKILL` | `{ skillId, target? }` | Focus equal to the skill's cost | Does **not** cost a move credit; may grant credits |

Cost accounting is **sequential**: walking the queue, each action must be affordable *at the moment
it executes*. A skill that grants a move credit cannot retroactively pay for a move already committed
earlier in the queue.

- **Move credits** start at 1 per turn (`freeMovesPerTurn`). Only skills grant more.
- **Focus** starts at the pool value (default 3) each turn, does not carry over, and **can never buy
  a move credit**. This is the balance anchor: exceeding one action per turn requires a skill — or a
  Legendary knight.
- **Legendary knight bonus move.** Once per turn, after a Legendary knight has made a paid `MOVE`, its
  *next* `MOVE` that turn costs 0 credits. The bonus belongs to that knight: it cannot pay for any
  other piece's move or a deployment, and it does not carry over. With two Legendary knights, each
  has its own bonus. Deploying a knight is not a `MOVE` and does not unlock the bonus.
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
| **R4** | Stage end and economy evaluation | Stage end conditions checked (§7); turn counter decremented; coin reward computed on a win (see [05](05-run-structure-and-economy.md)). |
| **R5** | Enemy turn | The enemy makes one move per its policy, then the turn ends: Focus refills, new turn begins. |

**Consequence worth calling out explicitly:** a temporarily transformed piece that delivers mate
does **not** deliver mate, because R1 reverts it *before* R3 evaluates. Burst transformations cannot
win the stage; they win *position and material* — clearing defenders out of a mating net and
earning salvage — which is exactly the intended use.

Similarly, an end state in which reverting a transform would expose the player's own king is illegal
and cannot be committed. A "free" transform is never free of positional consequence.

## 7. Stage end evaluation

**Checkmate is the only way to clear a stage.** There is no material win, no domination route and no
swing metric.

Evaluated at R4 each turn, in this order; the first match wins:

| Priority | Condition | Outcome |
|---|---|---|
| 1 | Enemy king is checkmated (from R3) | **WIN** — stage reward ([05 §2](05-run-structure-and-economy.md#2-income-stage-reward--turns--coins)) |
| 2 | Player king is checkmated | **LOSS** — run ends immediately |
| 3 | Turns remaining = 0 | **LOSS** — run ends |

**Stage reward:**

```
coins = baseReward(act, tier) + (turnLimit − turnsUsed) × coinRate(act) + salvage
```

The base reward is paid in full for every cleared stage, even one cleared on its final turn; every
unused turn adds bonus coins on top. Salvage for captured enemy pieces is paid as it happens.

**What captures are for.** Capturing no longer wins anything by itself. It is worth doing for three
reasons: it removes defenders from the mating net, it removes attackers from the player's pieces, and
it pays salvage. Losing a piece costs the run that piece; it does not move any win condition.

**Why checkmate only.** A fallback material win let a player trade down slowly and still clear the
stage. Without it, every stage is a mating problem against the clock, the solver proves exactly one
thing (a mate exists within the limit, [04 §5](04-stage-generation-and-authoring.md#5-the-solver)),
and the turn counter is the only pressure the player has to read.

## 8. Enemy behavior

- The enemy is **standard-move-only** in MVP: it never deploys, never uses skills, and never gains
  reinforcement mid-stage. (Boss skills are an M6 feature; the schema already reserves
  `enemyLoadout`.)
- Every enemy piece is a **Stage Piece** at Normal rarity. Enemy rarity is never rolled or authored,
  so the enemy never uses rarity abilities. Enemy pawns that reach rank 1 promote to a Normal queen.
- The enemy takes exactly **one standard move** per turn.
- The enemy's policy is one of:
  - `best_move` — fixed-depth alpha-beta minimax with a seeded tie-break (§8.1). Deterministic for a given
    seed and position.
  - `scripted` — a fixed authored line, used for teaching and boss stages.
- **The enemy AI is our own code.** `best_move` is a small minimax in `packages/engine`, written
  against *these* rules — multi-action player turns, rarity abilities, stalemate-passes, the turn
  limit. No external chess engine plays the enemy: a standard engine would misread every one of those
  rules, and could not be called the hundreds of thousands of times the solver needs. Stockfish has a
  role only as an offline design tool ([09 §1](09-technical-architecture.md#1-stack)).
- **Stalemated enemy passes.** If the enemy has no legal move and is *not* in check, it does nothing
  and the turn proceeds normally. The player is never awarded a stalemate draw and never forced into
  one.

### 8.1 Enemy AI

The enemy is one pure function, `enemyMove(stage, seed) → move | pass`, used unchanged by the engine,
the solver and replay. Same position + same seed → same move, always. Every constant below lives in
[`data/economy.yaml`](../data/economy.yaml) → `enemyAI`.

**What the enemy wants.** The enemy "wins" when the player runs out of turns or is mated, so its job
is to **defend first and punish mistakes**: survive the clock, keep its king safe, take the player's
pieces when that is safe, and mate the player's king whenever it can. It does not launch risky
attacks.

**Search.**

| Element | Rule |
|---|---|
| Algorithm | Alpha-beta minimax with **iterative deepening** (depth 1, 2, … up to the policy depth) and a deterministic **transposition table** |
| Depth | The template's `enemyPolicy.depth`: Act I 2, Act II–III 3, bosses 4 ([04 §6](04-stage-generation-and-authoring.md#6-difficulty-curve)) |
| One ply | One enemy move, or one player reply |
| The player's reply | **One standard move**, including rarity movement abilities (leaps, multi-capture). The enemy does **not** imagine deploys, skills, or a Legendary knight's bonus move — those stay genuine surprises, which is what makes them feel like breaking the rules |
| Quiescence | At the horizon, keep searching **captures only**, at most 2 more plies, so the enemy never hangs a piece just past its depth |
| The clock | The search knows how many turns the player has left. A line where the player runs out of turns is a win for the enemy |

The enemy's model of the player is deliberately simpler than the player. The solver is not: it
searches the player's full action set ([04 §5](04-stage-generation-and-authoring.md#5-the-solver)),
so every stage stays provably clearable however the enemy misjudges the player.

**Evaluation** — scores from the enemy's point of view; higher is better for the enemy.

| Outcome (always outranks any position) | Score |
|---|---|
| Player king mated | +100,000, minus plies to reach it (sooner is better) |
| Player out of turns | +50,000 |
| Enemy king mated | −100,000, plus plies to reach it (an unavoidable mate is delayed as long as possible) |

| Positional term | Weight |
|---|---|
| Each legal move of the enemy king (escape square) | +30 |
| Each square next to the enemy king that the player attacks | −25 |
| Enemy king in check | −60 |
| Material: enemy minus player on-board value (P1 N3 B3 R5 Q9) | ±10 per point |
| Each legal enemy move (mobility) | +2 |

King safety outweighs material — one escape square is worth three pawns — so the enemy gives up a
pawn to keep its king mobile, but grabs a piece the moment it is free. "Attacked" uses the player's
real attack map, rarity abilities included (§2.3).

**Tie-break.** Moves with exactly equal scores are first ordered stably (captures, then checks, then
by from- and to-square), and one is then picked with `hash(stageSeed, turnsUsed)`. Runs differ;
replays do not.

**Scripted enemies.** A `scripted` policy plays its `line` move by move, tracking its position in
`StageState.enemyPolicy.cursor`. If the next scripted move is illegal — its piece was captured, the
path is blocked, or it would leave the enemy king in check — or the line has run out, the enemy
**falls back permanently** to `best_move` at the template's `fallbackDepth` (default 3) for the rest
of the stage, and `fellBack` is set. A script never "skips ahead" to a later move.

## 9. Legality invariants

These are the contract the engine, the generator, and the tests all share.

| ID | Invariant |
|---|---|
| **I1** | Exactly one white king and one black king exist on the board at all times. |
| **I2** | The end state has the player's king **not** in check. |
| **I3** | A king is never captured and never removed by any effect — including multi-capture and the Legendary knight's bonus move. |
| **I4** | Every `MOVE` was legal for its piece — including its rarity abilities (§2.3) — in the position at the moment it executed. |
| **I5** | The number of paid `MOVE` + `DEPLOY` actions in a queue never exceeds the credits earned in it; each Legendary knight makes at most one free bonus move per turn. |
| **I6** | Total Focus spent in a queue never exceeds the pool plus Focus granted during that queue. |
| **I7** | A piece's durability never goes below 0; deploying requires durability ≥ 1. |
| **I8** | No `DEPLOY` places a piece on an occupied square or outside the deployment ranks. |
| **I9** | Outside a stage, deck size never exceeds the fixed capacity of 8 (a promotion may overflow it during a stage; the cut happens at stage end); the king is never destroyed or removed from the deck; the deck never holds a pawn. |
| **I10** | The coin payout shown in the preview equals the payout at evaluation, for the same plan. |
| **I11** | Given identical `(RunState, seed)`, generation and all enemy decisions are reproducible. |
| **I12** | The King has no rarity (`null`); every other piece has exactly one tier, fixed for the life of the instance (a merge creates a new instance; it never changes an existing one). |
| **I13** | Every enemy piece is Normal rarity. |
| **I14** | Nothing — shop offer, spawned pawn, or promotion result — is above its act's rarity ceiling; the Act I ceiling is Rare. |

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
R4: no checkmate and turns remain — play continues.
R5: the enemy replies; the `best_move` policy likely consolidates on the queenside.

Note what the player *didn't* do: deploy onto `d1`'s line and hand the enemy a free rook — lost
for the run, and one less piece for the mating net.

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
